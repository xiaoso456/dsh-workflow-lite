/**
 * `src/shared/runState.ts`：状态文件的校验、初始状态与派生量。
 */

import { describe, expect, it } from 'vitest'
import {
  graphFacts,
  initialRunState,
  isoNow,
  progressOf,
  type RunState,
  takenEdges,
  validateRunState,
} from '../../src/shared/runState.ts'
import {
  NODE_TYPE,
  RESOURCE_TYPE,
  type WorkflowDocument,
  type WorkflowEdge,
} from '../../src/shared/types.ts'

function edge(source: string, target: string, when?: string): WorkflowEdge {
  return {
    id: when === undefined ? `${source}->${target}` : `${source}->${target}#${when}`,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(when === undefined ? {} : { data: { when } }),
  }
}

/** scan → review；review 通过去 report、未通过去 fix，fix 回 review；review 写 review.md。 */
const DOC: WorkflowDocument = {
  nodes: [
    { id: 'scan', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: 'a' } },
    { id: 'review', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: 'b' } },
    { id: 'fix', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: 'c' } },
    { id: 'report', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: 'd' } },
    {
      id: 'file-review.md',
      type: RESOURCE_TYPE,
      position: { x: 0, y: 0 },
      data: { items: [{ kind: 'file', value: 'review.md' }] },
    },
  ],
  edges: [
    edge('scan', 'review'),
    edge('review', 'report', 'pass'),
    edge('review', 'fix', 'fail'),
    edge('fix', 'review'),
    edge('review', 'file-review.md'),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
}

const FACTS = graphFacts(DOC)
const T = '2026-10-02T14:30:00+08:00'

function initial(): RunState {
  return initialRunState({
    instance: '20261002-143000-a3f9',
    workflow: 'code-review',
    plan: '3f9a1c2e',
    graph: '/data/runs/20261002-143000-a3f9/graph.json',
    mode: 'subagent',
    goal: '审一遍',
    now: T,
    steps: FACTS.steps,
  })
}

function paths(value: unknown): string[] {
  return validateRunState(value, FACTS, { instance: '20261002-143000-a3f9' }).issues.map(
    (issue) => issue.path,
  )
}

describe('graphFacts', () => {
  it('只收步骤，判定取值来自到步骤的条件出边', () => {
    expect(FACTS.steps).toEqual(['scan', 'review', 'fix', 'report'])
    expect(FACTS.verdicts).toEqual({ review: ['pass', 'fail'] })
  })
})

describe('initialRunState', () => {
  it('建出来的初始状态本身合法', () => {
    const check = validateRunState(initial(), FACTS, { instance: '20261002-143000-a3f9' })
    expect(check.issues).toEqual([])
    expect(check.state?.status).toBe('pending')
    expect(Object.values(check.state?.nodes ?? {}).every((node) => node.status === 'pending')).toBe(
      true,
    )
  })

  it('isoNow 带时区偏移、精确到毫秒、能过校验', () => {
    const now = isoNow(new Date(2026, 9, 2, 9, 5, 7, 12))
    expect(now).toMatch(/^2026-10-02T09:05:07\.012[+-]\d{2}:\d{2}$/u)
    expect(paths({ ...initial(), updatedAt: now })).toEqual([])
    // 同一秒里的两次调用必须分得开：「同一次调用写下的几步」靠 at 相同来认（见 runCursor）。
    expect(isoNow(new Date(2026, 9, 2, 9, 5, 7, 12))).not.toBe(
      isoNow(new Date(2026, 9, 2, 9, 5, 7, 13)),
    )
  })
})

describe('validateRunState', () => {
  it('执行到一半的正常状态合法', () => {
    const state = initial()
    state.status = 'running'
    state.nodes.scan = { status: 'done', round: 1, startedAt: T, finishedAt: T, summary: '好' }
    state.nodes.review = { status: 'done', round: 1, startedAt: T, finishedAt: T, verdict: 'fail' }
    state.nodes.fix = { status: 'running', round: 1, startedAt: T, by: 'subagent' }
    state.log = [
      { at: T, node: 'scan', event: 'start' },
      { at: T, node: 'review', event: 'done', verdict: 'fail' },
    ]
    expect(paths(state)).toEqual([])
  })

  it('枚举、时间、轮次写错都指到具体位置', () => {
    const state = initial() as unknown as Record<string, unknown>
    const nodes = state.nodes as Record<string, unknown>
    state.status = 'complete'
    state.updatedAt = '2026-10-02 14:30'
    nodes.scan = { status: 'running' }
    nodes.fix = { status: 'done', round: 0, finishedAt: T }
    expect(paths(state)).toEqual([
      'status',
      'updatedAt',
      'nodes.scan.round',
      'nodes.scan.startedAt',
      'nodes.fix.round',
    ])
  })

  it('判定必须取自出边条件；有条件出边的步骤完成时必须写判定', () => {
    const state = initial()
    state.nodes.review = { status: 'done', round: 1, finishedAt: T }
    state.nodes.scan = { status: 'done', round: 1, finishedAt: T, verdict: 'pass' }
    const issues = validateRunState(state, FACTS).issues
    expect(issues.map((issue) => issue.path)).toEqual([
      'nodes.scan.verdict',
      'nodes.review.verdict',
    ])
    expect(issues[1]?.message).toContain('pass / fail')
    state.nodes.review = { status: 'done', round: 1, finishedAt: T, verdict: 'maybe' }
    state.nodes.scan = { status: 'done', round: 1, finishedAt: T }
    expect(paths(state)).toEqual(['nodes.review.verdict'])
  })

  it('步骤缺了、多了、只差大小写', () => {
    const state = initial()
    const { review, ...rest } = state.nodes
    state.nodes = { ...rest, Review: review ?? { status: 'pending' }, extra: { status: 'pending' } }
    const issues = validateRunState(state, FACTS).issues
    expect(issues.map((issue) => issue.path)).toEqual(['nodes.review', 'nodes.extra'])
    expect(issues[0]?.message).toContain('Review')
  })

  it('身份字段被改、未知字段、失败没写原因、整体完成却还有在跑的', () => {
    const state = initial() as unknown as Record<string, unknown>
    state.instance = 'other'
    state.stauts = 'running'
    state.status = 'done'
    const nodes = state.nodes as Record<string, unknown>
    nodes.scan = { status: 'failed', round: 1, finishedAt: T }
    nodes.fix = { status: 'running', round: 2, startedAt: T }
    expect(paths(state)).toEqual(['stauts', 'instance', 'nodes.scan.error', 'nodes.fix.status'])
  })

  it('YAML 把纯数字的 planId 读成数字也照样认', () => {
    const state = { ...initial(), plan: 12345678 }
    const check = validateRunState(state, FACTS, { plan: '12345678' })
    expect(check.issues).toEqual([])
    expect(check.state?.plan).toBe('12345678')
  })

  it('流水：事件不认识、步骤不存在、by 只能是 user', () => {
    const state = initial() as unknown as Record<string, unknown>
    state.log = [
      { at: T, event: 'begin' },
      { at: T, node: 'nope', event: 'start' },
      { at: T, node: 'scan', event: 'start', by: 'agent' },
      { at: T, node: 'scan', event: 'edit', by: 'user' },
    ]
    expect(paths(state)).toEqual(['log[0].event', 'log[1].node', 'log[2].by'])
  })

  it('摘要太长要报', () => {
    const state = initial()
    state.nodes.scan = { status: 'done', round: 1, finishedAt: T, summary: '长'.repeat(600) }
    expect(paths(state)).toEqual(['nodes.scan.summary'])
  })

  it('没有图事实时只查格式', () => {
    const state = initial()
    state.nodes = { anything: { status: 'pending' } }
    expect(validateRunState(state).issues).toEqual([])
  })

  it('顶层不是映射', () => {
    expect(validateRunState('hello').issues).toEqual([
      { path: '', message: '顶层必须是一个映射（key: value 的形式）' },
    ])
  })
})

describe('派生量', () => {
  it('进度：完成与跳过都算走完', () => {
    const state = initial()
    state.nodes.scan = { status: 'done', round: 1, finishedAt: T }
    state.nodes.fix = { status: 'skipped' }
    state.nodes.review = { status: 'running', round: 1, startedAt: T }
    expect(progressOf(state)).toEqual({
      done: 2,
      total: 4,
      running: ['review'],
      failed: [],
      waiting: [],
    })
  })

  it('走过的线：循环里先 fail 后 pass，两条条件边都算；没开始的目标不算', () => {
    const state = initial()
    state.nodes.scan = { status: 'done', round: 1, finishedAt: T }
    state.nodes.review = { status: 'running', round: 2, startedAt: T }
    state.nodes.fix = { status: 'done', round: 1, finishedAt: T }
    state.log = [{ at: T, node: 'review', event: 'done', round: 1, verdict: 'fail' }]
    expect([...takenEdges(DOC, state)].sort()).toEqual(
      ['fix->review', 'review->file-review.md', 'review->fix#fail', 'scan->review'].sort(),
    )
    state.nodes.review = { status: 'done', round: 2, finishedAt: T, verdict: 'pass' }
    state.nodes.report = { status: 'running', round: 1, startedAt: T }
    expect(takenEdges(DOC, state).has('review->report#pass')).toBe(true)
    expect(takenEdges(DOC, state).has('review->fix#fail')).toBe(true)
  })
})
