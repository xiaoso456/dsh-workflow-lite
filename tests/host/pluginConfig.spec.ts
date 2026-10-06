/**
 * 工作流中心「设置」页的后端：经设置服务读写本插件那一行，只露给人用的那几项。
 *
 * @module tests/host/pluginConfig.spec
 */

import { describe, expect, it } from 'vitest'
import {
  readPluginConfig,
  type SettingsPort,
  type SettingsRow,
  writePluginConfig,
} from '../../src/host/pluginConfig.ts'
import type { PluginConfigValues } from '../../src/shared/wire.ts'

const DEFAULTS: PluginConfigValues = {
  dataDir: '/home/u/.dsh/workflow-lite',
  maxNodes: 400,
  saveDebounceMs: 400,
  maxResultBytes: 262_144,
  installSkill: true,
}

/** 一个最小的设置服务：一行 `workflow-lite`，`user` 层就是改过的那几项。 */
function fakePort(
  options: { ns?: string; writable?: boolean; user?: Record<string, unknown> } = {},
) {
  let user: Record<string, unknown> = { ...(options.user ?? {}) }
  let revision = 3
  const calls: unknown[] = []
  const port: SettingsPort = {
    writable: options.writable ?? true,
    describe: (): SettingsRow[] => [
      { ns: 'llm-deepseek', revision: 9, value: { apiKey: 'x' } },
      {
        ns: options.ns ?? 'workflow-lite',
        revision,
        value: { ...DEFAULTS, routePrefix: '/workflow-lite', ...user },
        base: { ...DEFAULTS, routePrefix: '/workflow-lite' },
        user,
      },
    ],
    mutate: async (ns, ops, expected) => {
      calls.push({ ns, ops, expected })
      if (expected !== revision) {
        throw Object.assign(new Error('stale'), { code: 'SETTINGS_CONFLICT' })
      }
      const next = { ...user }
      for (const op of ops) {
        const key = op.path[0] ?? ''
        if (op.op === 'unset') delete next[key]
        else next[key] = op.value
      }
      user = next
      revision += 1
    },
  }
  return { port, calls }
}

const live = () => DEFAULTS

describe('读设置', () => {
  it('没有设置服务：只读，显示活配置的现值', () => {
    const view = readPluginConfig(undefined, live)
    expect(view).toMatchObject({ available: false, writable: false, values: DEFAULTS })
  })

  it('读出这几项、默认值和改过哪几项；接线细节不露', () => {
    const { port } = fakePort({ user: { maxNodes: 600 } })
    const view = readPluginConfig(port, live)
    expect(view.available).toBe(true)
    expect(view.revision).toBe(3)
    expect(view.values.maxNodes).toBe(600)
    expect(view.defaults.maxNodes).toBe(400)
    expect(view.overridden).toEqual(['maxNodes'])
    expect(Object.keys(view.values)).not.toContain('routePrefix')
  })

  it('行 id 被换过：按字段认出自己那一行', () => {
    const { port } = fakePort({ ns: 'my-workflows', user: { saveDebounceMs: 800 } })
    expect(readPluginConfig(port, live).values.saveDebounceMs).toBe(800)
  })
})

describe('写设置', () => {
  it('改几项、恢复几项：一次路径编辑，带上修订号', async () => {
    const { port, calls } = fakePort({ user: { saveDebounceMs: 800 } })
    const outcome = await writePluginConfig(port, live, {
      revision: 3,
      set: { maxNodes: 500, dataDir: '  D:/flows  ' },
      reset: ['saveDebounceMs'],
    })
    expect(outcome.ok).toBe(true)
    expect(calls).toEqual([
      {
        ns: 'workflow-lite',
        expected: 3,
        ops: [
          { op: 'unset', path: ['saveDebounceMs'] },
          { op: 'set', path: ['maxNodes'], value: 500 },
          { op: 'set', path: ['dataDir'], value: 'D:/flows' },
        ],
      },
    ])
    if (!outcome.ok) return
    expect(outcome.result.values).toMatchObject({ maxNodes: 500, dataDir: 'D:/flows' })
    expect(outcome.result.overridden.sort()).toEqual(['dataDir', 'maxNodes'])
    expect(outcome.result.revision).toBe(4)
  })

  it('别处先改过：报 conflict，不覆盖', async () => {
    const { port } = fakePort()
    const outcome = await writePluginConfig(port, live, { revision: 1, set: { maxNodes: 500 } })
    expect(outcome).toMatchObject({ ok: false, error: { code: 'conflict' } })
  })

  it.each([
    [{ maxNodes: 0 }],
    [{ maxNodes: 1.5 }],
    [{ saveDebounceMs: -1 }],
    [{ maxResultBytes: 100 }],
    [{ dataDir: '   ' }],
    [{ installSkill: 'yes' }],
    [{ routePrefix: '/x' }],
  ])('坏值 %j 在写之前就挡下', async (set) => {
    const { port, calls } = fakePort()
    const outcome = await writePluginConfig(port, live, { revision: 3, set })
    expect(outcome).toMatchObject({ ok: false, error: { code: 'invalid_args' } })
    expect(calls).toEqual([])
  })

  it('不能写（没有设置服务 / profile 只读）：unavailable', async () => {
    expect(
      await writePluginConfig(undefined, live, { revision: 0, set: { maxNodes: 9 } }),
    ).toMatchObject({ ok: false, error: { code: 'unavailable' } })
    const { port } = fakePort({ writable: false })
    expect(
      await writePluginConfig(port, live, { revision: 3, set: { maxNodes: 9 } }),
    ).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    })
  })
})
