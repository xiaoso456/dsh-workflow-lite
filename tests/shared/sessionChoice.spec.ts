/**
 * 新建会话用的预设、模型：读（认不出的当没写）、按项合并（卡片 → 工作流 → 默认）、存盘来回、导出时去掉。
 */

import { describe, expect, it } from 'vitest'
import { readDocument, writeDocument } from '../../src/shared/model.ts'
import { readOrigin } from '../../src/shared/runState.ts'
import {
  documentHasSessionChoice,
  documentWithoutSessionChoice,
  readModelChoice,
  readSessionAgent,
  readSessionChoice,
  resolveSessionChoice,
  sessionAgent,
} from '../../src/shared/sessionChoice.ts'
import { DEFAULT_TRIGGER, readTriggerData } from '../../src/shared/trigger.ts'
import {
  NODE_TYPE,
  TRIGGER_TYPE,
  type TriggerData,
  type WorkflowDocument,
} from '../../src/shared/types.ts'

const MODEL = { provider: 'deepseek', model: 'deepseek-v4', effort: 'high' }

function trigger(launch: TriggerData['launch']): WorkflowDocument['nodes'][number] {
  return {
    id: 'tick',
    type: TRIGGER_TYPE,
    position: { x: 0, y: 0 },
    data: {
      source: { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } },
      ...(launch === undefined ? {} : { launch }),
    },
  }
}

function doc(extra: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    nodes: [{ id: 'write', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: '写' } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...extra,
  }
}

describe('读', () => {
  it('服务商、模型都要有；档位可缺；空的、太长的、不是字符串的当没写', () => {
    expect(readModelChoice(MODEL)).toEqual(MODEL)
    expect(readModelChoice({ provider: ' deepseek ', model: 'v4' })).toEqual({
      provider: 'deepseek',
      model: 'v4',
    })
    expect(readModelChoice({ provider: 'deepseek' })).toBeUndefined()
    expect(readModelChoice({ provider: '', model: 'v4' })).toBeUndefined()
    expect(readModelChoice({ provider: 'p', model: 'x'.repeat(201) })).toBeUndefined()
    expect(readModelChoice({ provider: 'p', model: 'm', effort: 3 })).toEqual({
      provider: 'p',
      model: 'm',
    })
    expect(readModelChoice('deepseek/v4')).toBeUndefined()
    expect(readSessionChoice({ preset: '  ', model: null })).toEqual({})
    expect(readSessionChoice({ preset: 'ptc', model: MODEL })).toEqual({
      preset: 'ptc',
      model: MODEL,
    })
  })

  it('工作流设置、触发卡片的启动方式都认这两项，存盘来回不丢', () => {
    const document = doc({
      nodes: [trigger({ preset: 'minimal', model: { provider: 'p', model: 'm' } })],
      settings: { preset: 'ptc', model: MODEL },
    })
    const back = readDocument(writeDocument(document)).document
    if (back === null) throw new Error('读不回来')
    expect(back.settings).toEqual({ preset: 'ptc', model: MODEL })
    const [node] = back.nodes
    // 只写了预设、模型的启动方式：会话方式照旧是缺省的「每次新建」（不写盘）。
    expect(readTriggerData(node?.data).launch).toEqual({
      preset: 'minimal',
      model: { provider: 'p', model: 'm' },
    })
  })
})

describe('按项合并', () => {
  it('卡片写了的项用卡片的，否则用工作流的；都没写就不出现（跟随 DSH）', () => {
    expect(resolveSessionChoice(undefined, undefined)).toEqual({})
    expect(resolveSessionChoice({}, { preset: 'ptc', model: MODEL })).toEqual({
      preset: 'ptc',
      model: MODEL,
    })
    expect(
      resolveSessionChoice(
        { model: { provider: 'p', model: 'cheap' } },
        { preset: 'ptc', model: MODEL },
      ),
    ).toEqual({ preset: 'ptc', model: { provider: 'p', model: 'cheap' } })
    expect(resolveSessionChoice({ preset: 'minimal' }, undefined)).toEqual({ preset: 'minimal' })
  })
})

describe('运行权限', () => {
  it('工作流设置、触发卡片都认，存盘来回不丢；按项合并时卡片优先', () => {
    const document = doc({
      nodes: [trigger({ permission: 'read-only' })],
      settings: { permission: 'workspace-write' },
    })
    const back = readDocument(writeDocument(document)).document
    if (back === null) throw new Error('读不回来')
    expect(back.settings).toEqual({ permission: 'workspace-write' })
    expect(readTriggerData(back.nodes[0]?.data).launch).toEqual({ permission: 'read-only' })
    expect(resolveSessionChoice({ permission: 'read-only' }, { permission: 'x' })).toEqual({
      permission: 'read-only',
    })
    expect(resolveSessionChoice(undefined, { permission: 'x' })).toEqual({ permission: 'x' })
  })

  it('新拖出来的触发卡片直接写着完全权限，不跟随工作流', () => {
    expect(DEFAULT_TRIGGER.launch).toEqual({ permission: 'danger-full-access' })
    expect(readTriggerData(DEFAULT_TRIGGER).launch).toEqual({ permission: 'danger-full-access' })
  })

  it('卡片没写权限就跟随工作流，工作流也没设就跟随 DSH（不另外兜底成完全权限）', () => {
    expect(resolveSessionChoice({}, { permission: 'read-only' })).toEqual({
      permission: 'read-only',
    })
    expect(resolveSessionChoice({}, undefined)).toEqual({})
  })

  it('导出不带模型和预设时一起去掉；回退项读得回来', () => {
    const stripped = documentWithoutSessionChoice(
      doc({ nodes: [trigger({ permission: 'read-only' })], settings: { permission: 'x' } }),
    )
    expect(stripped.settings).toBeUndefined()
    expect(stripped.nodes.map((node) => (node.data as TriggerData).launch)).toEqual([undefined])
    expect(
      readSessionAgent({
        permission: 'read-only',
        fallbacks: [
          { kind: 'permission', permission: 'read-only' },
          { kind: 'permissionUnsupported', permission: 'read-only' },
          { kind: 'permission' },
        ],
      }),
    ).toEqual({
      permission: 'read-only',
      fallbacks: [
        { kind: 'permission', permission: 'read-only' },
        { kind: 'permissionUnsupported', permission: 'read-only' },
      ],
    })
  })
})

describe('导出时去掉', () => {
  it('工作流设置、各触发卡片上的都去掉，别的照旧；没设的原样返回', () => {
    const plain = doc({ nodes: [trigger({ session: 'last' })], settings: { runState: true } })
    expect(documentHasSessionChoice(plain)).toBe(false)
    expect(documentWithoutSessionChoice(plain)).toBe(plain)

    const chosen = doc({
      nodes: [trigger({ session: 'last', model: MODEL }), trigger({ preset: 'ptc' })],
      settings: { runState: true, preset: 'ptc', model: MODEL },
    })
    expect(documentHasSessionChoice(chosen)).toBe(true)
    const stripped = documentWithoutSessionChoice(chosen)
    expect(stripped.settings).toEqual({ runState: true })
    expect(stripped.nodes.map((node) => (node.data as TriggerData).launch)).toEqual([
      { session: 'last' },
      undefined,
    ])
    expect(documentHasSessionChoice(stripped)).toBe(false)

    const onlyChoice = doc({ settings: { model: MODEL } })
    expect(documentWithoutSessionChoice(onlyChoice).settings).toBeUndefined()
  })
})

describe('新建会话记下的', () => {
  it('设了什么、哪几项没用上；什么都没设也没回退时不记', () => {
    expect(sessionAgent({}, [])).toBeUndefined()
    expect(sessionAgent({ preset: 'ptc' }, [{ kind: 'preset', preset: 'ptc' }])).toEqual({
      preset: 'ptc',
      fallbacks: [{ kind: 'preset', preset: 'ptc' }],
    })
    expect(sessionAgent({ model: MODEL }, [])).toEqual({ model: MODEL })
  })

  it('读的时候认不出的回退项丢掉；来源里带着它', () => {
    const agent = readSessionAgent({
      model: MODEL,
      fallbacks: [
        { kind: 'unsupported' },
        { kind: 'model', provider: 'deepseek', model: 'v4' },
        { kind: 'whatever' },
        { kind: 'preset' },
        'x',
      ],
    })
    expect(agent).toEqual({
      model: MODEL,
      fallbacks: [{ kind: 'unsupported' }, { kind: 'model', provider: 'deepseek', model: 'v4' }],
    })
    expect(readSessionAgent({ fallbacks: [] })).toBeUndefined()
    expect(readOrigin({ channel: 'manual', agent })).toEqual({ channel: 'manual', agent })
    expect(readOrigin({ channel: 'manual', agent: 'ptc' })).toEqual({ channel: 'manual' })
  })
})
