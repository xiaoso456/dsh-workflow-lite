/**
 * 新建会话用的预设、模型在界面上怎么写：下拉的几项（跟随 + 分组的模型 + 设了但没有的）、
 * 用不了的提醒、一行摘要、换模型时档位留不留，以及「执行」新建会话时带预设、装模型、回退默认。
 */

import { describe, expect, it } from 'vitest'
import { openChosenSession } from '../../src/client/app/agents.ts'
import { zh } from '../../src/client/i18n.ts'
import {
  agentLines,
  choiceIssues,
  choiceSummary,
  effortOptions,
  FOLLOW,
  fallbackNote,
  issueLines,
  modelKey,
  modelOptions,
  pickModel,
  presetOptions,
  readModelKey,
  withEffort,
} from '../../src/client/model/sessionChoice.ts'
import type { WorkflowLiteRpc } from '../../src/client/rpc.ts'
import type { HostAgentsResponse } from '../../src/shared/wire/host.ts'

const t = (key: keyof typeof zh): string => zh[key]

const CATALOG: HostAgentsResponse = {
  presets: [
    { id: 'standard', isDefault: true },
    { id: 'ptc', isDefault: false },
    { id: 'mine', name: '我的组合', description: '自己配的', isDefault: false },
    { id: 'bad', isDefault: false, broken: '缺工具' },
  ],
  providers: [
    {
      id: 'deepseek',
      name: 'DeepSeek 账号',
      models: [
        {
          id: 'v4',
          name: 'DeepSeek V4',
          efforts: [
            { id: 'low', name: '低' },
            { id: 'high', name: '高' },
          ],
          defaultEffort: 'low',
        },
        { id: 'v4-flash', name: 'DeepSeek V4 Flash', efforts: [] },
      ],
    },
  ],
  failures: [{ id: 'moon', name: 'Moonshot', message: 'timeout' }],
  defaultModel: { provider: 'deepseek', model: 'v4-flash' },
  modelSelectable: true,
}

describe('下拉', () => {
  it('预设：跟随（写现在是什么）+ 能用的（内置的按 DSH 的叫法）+ 设了但没有的；坏了的不列', () => {
    const options = presetOptions(t, CATALOG, 'gone', 'default', undefined)
    expect(options.map((option) => option.value)).toEqual([
      FOLLOW,
      'standard',
      'ptc',
      'mine',
      'gone',
    ])
    expect(options[0]).toMatchObject({ label: '跟随默认', valueDesc: '标准模式' })
    expect(options[2]?.label).toBe('PTC 模式')
    expect(options[3]).toMatchObject({ label: '我的组合', desc: '自己配的' })
    expect(options[4]).toMatchObject({ label: 'gone', desc: '这台机器上没有' })
    // 卡片上跟随的是工作流设的那个。
    expect(presetOptions(t, CATALOG, undefined, 'workflow', 'ptc')[0]).toMatchObject({
      label: '跟随工作流',
      valueDesc: 'PTC 模式',
    })
  })

  it('模型：按服务商分组、下面写档位；设了但读不出列表的服务商写原因', () => {
    const current = { provider: 'moon', model: 'kimi' }
    const options = modelOptions(t, CATALOG, current, 'default', undefined)
    expect(options.map((option) => option.value)).toEqual([
      FOLLOW,
      'deepseek/v4',
      'deepseek/v4-flash',
      'moon/kimi',
    ])
    expect(options[0]?.valueDesc).toBe('DeepSeek V4 Flash')
    expect(options[1]).toMatchObject({ group: 'DeepSeek 账号', desc: '思考：低 / 高' })
    expect(options[2]?.desc).toBeUndefined()
    expect(options[3]).toMatchObject({ valueDesc: 'Moonshot', desc: '读不出模型列表' })
    // 清单还没读到：只有跟随和设了的那一项，不报没有。
    expect(modelOptions(t, null, current, 'default', undefined)).toEqual([
      { value: FOLLOW, label: '跟随默认' },
      { value: 'moon/kimi', label: 'kimi', valueDesc: 'moon' },
    ])
  })

  it('模型的值按第一个 / 拆（模型 id 里可以有 /）', () => {
    expect(readModelKey(modelKey({ provider: 'or', model: 'qwen/qwen3' }))).toEqual({
      provider: 'or',
      model: 'qwen/qwen3',
    })
    expect(readModelKey(FOLLOW)).toBeUndefined()
    expect(readModelKey('/x')).toBeUndefined()
  })

  it('档位：默认 + 模型的档位；不分档的模型没有这一项；换模型时档位还在才留着', () => {
    const v4 = { provider: 'deepseek', model: 'v4', effort: 'high' }
    expect(effortOptions(t, CATALOG, v4).map((option) => option.value)).toEqual([
      FOLLOW,
      'low',
      'high',
    ])
    expect(effortOptions(t, CATALOG, { provider: 'deepseek', model: 'v4-flash' })).toEqual([])
    expect(withEffort(v4, FOLLOW)).toEqual({ provider: 'deepseek', model: 'v4' })
    expect(pickModel(CATALOG, 'deepseek/v4-flash', v4)).toEqual({
      provider: 'deepseek',
      model: 'v4-flash',
    })
    expect(pickModel(CATALOG, 'deepseek/v4', { ...v4, model: 'other' })).toEqual(v4)
    expect(pickModel(CATALOG, FOLLOW, v4)).toBeUndefined()
  })
})

describe('用不了的', () => {
  it('预设没有或坏了、模型没有、档位没有、DSH 不能按会话换模型；服务商读不出列表时不算', () => {
    expect(choiceIssues(CATALOG, { preset: 'bad' })).toEqual([{ kind: 'preset', preset: 'bad' }])
    expect(choiceIssues(CATALOG, { preset: 'ptc' })).toEqual([])
    expect(choiceIssues(CATALOG, { model: { provider: 'deepseek', model: 'gpt' } })).toMatchObject([
      { kind: 'model' },
    ])
    expect(
      choiceIssues(CATALOG, { model: { provider: 'deepseek', model: 'v4', effort: 'max' } }),
    ).toMatchObject([{ kind: 'effort' }])
    expect(choiceIssues(CATALOG, { model: { provider: 'moon', model: 'kimi' } })).toEqual([])
    expect(
      choiceIssues(
        { ...CATALOG, modelSelectable: false },
        { model: { provider: 'deepseek', model: 'v4' } },
      ),
    ).toEqual([{ kind: 'unsupported' }])
    expect(choiceIssues(null, { preset: 'gone' })).toEqual([])
    expect(issueLines(t, CATALOG, { kind: 'preset', preset: 'ptc' })[0]).toContain('PTC 模式')
    // DSH 不能按会话换模型：原因之外另起一条写要哪个版本。
    expect(issueLines(t, CATALOG, { kind: 'unsupported' })).toEqual([
      zh['session.issue.unsupported'],
      zh['session.issue.version'],
    ])
  })
})

describe('摘要与提示', () => {
  it('「DeepSeek V4 · 思考 高 · PTC 模式」；什么都没设是空的', () => {
    expect(
      choiceSummary(t, CATALOG, {
        preset: 'ptc',
        model: { provider: 'deepseek', model: 'v4', effort: 'high' },
      }),
    ).toBe('DeepSeek V4 · 思考 高 · PTC 模式')
    expect(choiceSummary(t, CATALOG, {})).toBe('')
    expect(
      fallbackNote(t, CATALOG, [{ kind: 'preset', preset: 'ptc' }, { kind: 'unsupported' }]),
    ).toBe('预设 PTC 模式 不可用，用了默认预设; 这个 DSH 版本不能按工作流选模型，用了默认模型')
  })
})

describe('「执行」新建会话', () => {
  /** 记下调了什么的假 RPC：清单给 `catalog`，装模型回 `fallbacks`（或抛错）。 */
  function fakeRpc(
    catalog: HostAgentsResponse,
    prepare: () => Promise<{ fallbacks: [] }>,
  ): { rpc: WorkflowLiteRpc; calls: string[] } {
    const calls: string[] = []
    const rpc = {
      call: async (endpoint: string, args: unknown) => {
        calls.push(`${endpoint} ${JSON.stringify(args)}`)
        if (endpoint === 'host/agents') return catalog
        if (endpoint === 'host/prepareSession') return prepare()
        throw new Error(`没想到会调 ${endpoint}`)
      },
    } as WorkflowLiteRpc
    return { rpc, calls }
  }

  it('带上能用的预设建会话，再装模型；什么都没设时不读清单、不装', async () => {
    const { rpc, calls } = fakeRpc(CATALOG, async () => ({ fallbacks: [] }))
    const created: (string | undefined)[] = []
    const opened = await openChosenSession(
      rpc,
      'here-1',
      { preset: 'ptc', model: { provider: 'deepseek', model: 'v4' } },
      async (preset) => {
        created.push(preset)
        return 'new-1'
      },
    )
    expect(opened).toMatchObject({ session: 'new-1', fallbacks: [] })
    expect(created).toEqual(['ptc'])
    expect(calls).toEqual([
      'host/agents {"session":"here-1"}',
      'host/prepareSession {"session":"new-1","model":{"provider":"deepseek","model":"v4"}}',
    ])

    const quiet = fakeRpc(CATALOG, async () => ({ fallbacks: [] }))
    expect((await openChosenSession(quiet.rpc, 'here-2', {}, async () => 'new-2')).session).toBe(
      'new-2',
    )
    expect(quiet.calls).toEqual([])
  })

  it('预设用不了就不带、记一条；装模型出错也照常建好，当作回退默认', async () => {
    const { rpc } = fakeRpc(CATALOG, () => Promise.reject(new Error('连接断了')))
    const created: (string | undefined)[] = []
    const opened = await openChosenSession(
      rpc,
      'here-3',
      { preset: 'bad', model: { provider: 'deepseek', model: 'v4' } },
      async (preset) => {
        created.push(preset)
        return 'new-3'
      },
    )
    expect(created).toEqual([undefined])
    expect(opened.fallbacks).toEqual([
      { kind: 'preset', preset: 'bad' },
      { kind: 'failed', message: '连接断了' },
    ])
  })
})

describe('实例来源里的预设、模型', () => {
  it('用上了写设的；回退了写 DSH 的默认、旁边写设的是什么；档位没用上写模型和那一档', () => {
    const model = { provider: 'deepseek', model: 'v4', effort: 'high' }
    expect(agentLines(t, { preset: 'ptc', model })).toEqual({
      preset: { text: 'PTC 模式' },
      model: { text: 'v4 · 思考 high' },
    })
    expect(
      agentLines(t, {
        preset: 'ptc',
        model,
        fallbacks: [{ kind: 'preset', preset: 'ptc' }, { kind: 'unsupported' }],
      }),
    ).toEqual({
      preset: { text: 'DSH 的默认', wanted: '设的 PTC 模式 没用上' },
      model: { text: 'DSH 的默认', wanted: '设的 v4 · 思考 high 没用上' },
    })
    expect(
      agentLines(t, { model, fallbacks: [{ kind: 'effort', model: 'v4', effort: 'high' }] }),
    ).toEqual({ model: { text: 'v4', wanted: '没有「high」这一档，用了默认档' } })
  })
})
