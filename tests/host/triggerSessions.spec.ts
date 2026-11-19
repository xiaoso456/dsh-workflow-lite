import type { Context } from '@deepseek-ai/cordis'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { createSessionPort } from '../../src/host/triggers/sessions.ts'

/** 只有 `get` 的假 ctx：按名字取 DSH 的服务。 */
function fakeContext(services: Record<string, unknown>): Context {
  return { get: (name: string) => services[name] } as unknown as Context
}

describe('触发器发进会话的消息', () => {
  it('按用户消息发：DSH 的 create_goal 只认本轮有用户消息的回合', async () => {
    const got: UserMessage[] = []
    const ctx = fakeContext({
      workspaceRegistry: { create: async () => ({ id: 'w1' }) },
      sessionController: {
        create: async () => ({ sessionId: 's1' }),
        rename: async () => undefined,
        resolveAgent: async () => ({
          agent: { followup: (message: UserMessage) => got.push(message) },
        }),
      },
    })
    await createSessionPort(ctx).send('s1', '执行工作流')
    expect(got).toHaveLength(1)
    expect(got[0]?.source).toEqual({ kind: 'user' })
    expect(got[0]?.content).toEqual([{ type: 'text', text: '执行工作流' }])
  })
})

/**
 * 一个假 DSH：记下建会话的入参、装上的模型、设的权限、告警。`select` 不给 = 0.2.1（agent 上没有 `model.select`）；
 * `permissions` 不给 = 没有权限服务（0.2.1）。
 */
function fakeDsh(options: {
  select?: boolean
  throws?: boolean
  presets?: { id: string; isDefault: boolean; broken?: string }[]
  permissions?: boolean
}) {
  const created: Record<string, unknown>[] = []
  const selected: unknown[] = []
  const permitted: { session: unknown; name: string }[] = []
  const warnings: string[] = []
  const session = { id: 's1' }
  const permissionPresets = {
    catalog: () => ({
      options: [
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
        { value: 'auto', name: 'Auto' },
      ],
      defaultOptions: [
        { value: 'read-only', name: '只读', description: '只能看' },
        { value: 'workspace-write', name: 'workspace-write' },
        { value: 'danger-full-access', name: 'danger-full-access' },
      ],
      defaultPreset: 'workspace-write',
    }),
    set: (target: unknown, name: string) => {
      permitted.push({ session: target, name })
    },
  }
  const agent = {
    followup: () => {},
    session,
    ...(options.select === true
      ? {
          model: {
            select(selection: unknown) {
              if (options.throws === true) throw new Error('炸了')
              selected.push(selection)
            },
          },
        }
      : {}),
  }
  const ctx = {
    get: (name: string) =>
      ({
        workspaceRegistry: { create: async () => ({ id: 'w1' }) },
        ...(options.permissions === true ? { permissionPresets } : {}),
        agentPresets: {
          remoteExportList: async () => ({
            presets: options.presets ?? [
              { id: 'standard', isDefault: true },
              { id: 'minimal', isDefault: false },
              { id: 'bad', isDefault: false, broken: '组不起来' },
            ],
          }),
        },
        sessionController: {
          create: async (input: Record<string, unknown>) => {
            created.push(input)
            return { sessionId: 's1' }
          },
          rename: async () => undefined,
          resolveAgent: async () => ({ agent }),
          modelCatalog: async () => ({
            default: { provider: 'acme', model: 'small' },
            groups: [
              {
                id: 'acme',
                name: 'Acme',
                models: [
                  { id: 'small', name: 'Small' },
                  {
                    id: 'big',
                    name: 'Big',
                    reasoning: {
                      efforts: [
                        { id: 'low', name: '低' },
                        { id: 'high', name: '高' },
                      ],
                      defaultEffort: 'low',
                    },
                  },
                ],
              },
            ],
            failures: [],
          }),
        },
      })[name],
    logger: { warn: (message: string) => warnings.push(message) },
  } as unknown as Context
  return { port: createSessionPort(ctx), created, selected, permitted, session, warnings }
}

describe('新建会话时的预设与模型', () => {
  const open = { cwd: '/w', title: 't' }

  it('都没设：不传预设、不装模型（跟随 DSH 的默认）', async () => {
    const dsh = fakeDsh({ select: true })
    const result = await dsh.port.open({ ...open, choice: {} })
    expect(result).toEqual({ session: 's1', fallbacks: [] })
    expect(dsh.created).toEqual([{ workspaceId: 'w1' }])
    expect(dsh.selected).toEqual([])
  })

  it('设了预设和模型：建会话带上预设，发消息前只给这个会话装上模型', async () => {
    const dsh = fakeDsh({ select: true })
    const result = await dsh.port.open({
      ...open,
      choice: { preset: 'minimal', model: { provider: 'acme', model: 'big', effort: 'high' } },
    })
    expect(result.fallbacks).toEqual([])
    expect(dsh.created).toEqual([{ workspaceId: 'w1', agentPreset: 'minimal' }])
    expect(dsh.selected).toEqual([{ provider: 'acme', model: 'big', reasoningEffort: 'high' }])
    expect(dsh.warnings).toEqual([])
  })

  it('预设不在了、坏了：不传（用默认预设），记一条回退', async () => {
    for (const preset of ['gone', 'bad']) {
      const dsh = fakeDsh({ select: true })
      const result = await dsh.port.open({ ...open, choice: { preset } })
      expect(dsh.created).toEqual([{ workspaceId: 'w1' }])
      expect(result.fallbacks).toEqual([{ kind: 'preset', preset }])
      expect(dsh.warnings).toHaveLength(1)
    }
  })

  it('模型不在了：不装（用默认模型），记一条回退', async () => {
    const dsh = fakeDsh({ select: true })
    const result = await dsh.port.open({
      ...open,
      choice: { model: { provider: 'other', model: 'x' } },
    })
    expect(dsh.selected).toEqual([])
    expect(result.fallbacks).toEqual([{ kind: 'model', provider: 'other', model: 'x' }])
  })

  it('这个模型没有那一档：模型照装、不带档位（用它的默认档），记一条回退', async () => {
    const dsh = fakeDsh({ select: true })
    const result = await dsh.port.open({
      ...open,
      choice: { model: { provider: 'acme', model: 'big', effort: 'max' } },
    })
    expect(dsh.selected).toEqual([{ provider: 'acme', model: 'big' }])
    expect(result.fallbacks).toEqual([{ kind: 'effort', model: 'big', effort: 'max' }])
  })

  it('DSH 不能只给一个会话换模型（0.2.1）：照常建、用默认模型，告警只打一次', async () => {
    const dsh = fakeDsh({})
    const choice = { model: { provider: 'acme', model: 'big' } }
    const first = await dsh.port.open({ ...open, choice })
    const second = await dsh.port.open({ ...open, choice })
    expect(first.fallbacks).toEqual([{ kind: 'unsupported' }])
    expect(second.fallbacks).toEqual([{ kind: 'unsupported' }])
    expect(dsh.warnings).toHaveLength(1)
    expect((await dsh.port.catalog()).modelSelectable).toBe(false)
  })

  it('装的时候出错：不抛，用默认模型，记一条回退', async () => {
    const dsh = fakeDsh({ select: true, throws: true })
    const result = await dsh.port.open({
      ...open,
      choice: { model: { provider: 'acme', model: 'big' } },
    })
    expect(result).toEqual({ session: 's1', fallbacks: [{ kind: 'failed', message: '炸了' }] })
  })

  it('设了权限：建好后、发消息前给这个会话换上那一套', async () => {
    const dsh = fakeDsh({ permissions: true })
    const result = await dsh.port.open({ ...open, choice: { permission: 'read-only' } })
    expect(result.fallbacks).toEqual([])
    expect(dsh.permitted).toEqual([{ session: dsh.session, name: 'read-only' }])
    expect(await dsh.port.prepare('s1', { permission: 'danger-full-access' })).toEqual([])
    expect(dsh.permitted[1]?.name).toBe('danger-full-access')
  })

  it('权限不在能选的里（含只能在会话里切的 auto）：不设，记一条回退', async () => {
    for (const permission of ['gone', 'auto']) {
      const dsh = fakeDsh({ permissions: true })
      const result = await dsh.port.open({ ...open, choice: { permission } })
      expect(dsh.permitted).toEqual([])
      expect(result.fallbacks).toEqual([{ kind: 'permission', permission }])
    }
  })

  it('DSH 没有权限服务（0.2.1）：照常建、用默认权限，告警只打一次；清单里没有权限', async () => {
    const dsh = fakeDsh({ select: true })
    const choice = { permission: 'danger-full-access' }
    const first = await dsh.port.open({ ...open, choice })
    await dsh.port.open({ ...open, choice })
    expect(first.fallbacks).toEqual([
      { kind: 'permissionUnsupported', permission: 'danger-full-access' },
    ])
    expect(dsh.warnings).toHaveLength(1)
    expect((await dsh.port.catalog()).permissions).toBeUndefined()
  })

  it('列出能设成新会话默认的几套权限和 DSH 的默认', async () => {
    const dsh = fakeDsh({ permissions: true })
    expect((await dsh.port.catalog()).permissions).toEqual({
      options: [
        { id: 'read-only', name: '只读', description: '只能看' },
        { id: 'workspace-write', name: 'workspace-write' },
        { id: 'danger-full-access', name: 'danger-full-access' },
      ],
      defaultId: 'workspace-write',
    })
  })

  it('列出预设、按服务商分组的模型（带档位）和默认模型', async () => {
    const dsh = fakeDsh({ select: true })
    const catalog = await dsh.port.catalog('s1')
    expect(catalog.modelSelectable).toBe(true)
    expect(catalog.presets.map((preset) => preset.id)).toEqual(['standard', 'minimal', 'bad'])
    expect(catalog.defaultModel).toEqual({ provider: 'acme', model: 'small' })
    expect(catalog.providers[0]?.models[1]).toEqual({
      id: 'big',
      name: 'Big',
      efforts: [
        { id: 'low', name: '低' },
        { id: 'high', name: '高' },
      ],
      defaultEffort: 'low',
    })
  })
})
