/**
 * `src/shared/runCursor.ts`：最后执行的步骤与接下来该做的步骤（循环里不漂）。
 */

import { describe, expect, it } from 'vitest'
import { runCursor } from '../../src/shared/runCursor.ts'
import {
  graphFacts,
  initialRunState,
  type LogEvent,
  type NodeStatus,
  type RunState,
  statusFields,
} from '../../src/shared/runState.ts'
import { NODE_TYPE, type WorkflowDocument, type WorkflowEdge } from '../../src/shared/types.ts'

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

function doc(ids: string[], edges: WorkflowEdge[]): WorkflowDocument {
  return {
    nodes: ids.map((id) => ({
      id,
      type: NODE_TYPE,
      position: { x: 0, y: 0 },
      data: { prompt: id },
    })),
    edges,
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

/** scan → review；review 通过去 report、未通过去 fix，fix 回 review。 */
const LOOP = doc(
  ['scan', 'review', 'fix', 'report'],
  [
    edge('scan', 'review'),
    edge('review', 'report', 'pass'),
    edge('review', 'fix', 'fail'),
    edge('fix', 'review'),
  ],
)

/** a 扇出到 b、c，两路在 d 汇合。 */
const DIAMOND = doc(
  ['a', 'b', 'c', 'd'],
  [edge('a', 'b'), edge('a', 'c'), edge('b', 'd'), edge('c', 'd')],
)

const EVENT: Record<NodeStatus, LogEvent> = {
  pending: 'note',
  running: 'start',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
}

type Move = [id: string, status: NodeStatus, verdict?: string]

/** 照 `state` 动作的样子一次次改：每次调用一个时刻，插件补轮次、时间、流水。 */
function play(document: WorkflowDocument, calls: Move[][]): RunState {
  const state = initialRunState({
    instance: '20261002-143000-a3f9',
    workflow: 'w',
    plan: 'p',
    graph: '/g.json',
    mode: 'auto',
    now: '2026-10-02T14:00:00+08:00',
    steps: graphFacts(document).steps,
  })
  calls.forEach((call, minute) => {
    const at = `2026-10-02T14:${String(minute + 1).padStart(2, '0')}:00+08:00`
    for (const [id, status, verdict] of call) {
      const node = state.nodes[id] ?? { status: 'pending' }
      const next: Record<string, unknown> = { ...node }
      for (const [key, value] of Object.entries(statusFields(node, status, at))) {
        if (value === null) delete next[key]
        else next[key] = value
      }
      if (verdict !== undefined) next.verdict = verdict
      state.nodes[id] = next as unknown as RunState['nodes'][string]
      const round = state.nodes[id]?.round
      state.log.push({
        at,
        node: id,
        event: EVENT[status],
        ...(round === undefined ? {} : { round }),
        ...(status === 'done' && verdict !== undefined ? { verdict } : {}),
      })
    }
  })
  return state
}

const nexts = (state: RunState, document = LOOP) =>
  runCursor(document, state).next.map((step) => [step.node, step.round, step.reason, step.from])
const lasts = (state: RunState, document = LOOP) =>
  runCursor(document, state).last.map((step) => [step.node, step.round, step.status])

describe('runCursor', () => {
  it('还没开始：接下来是入口步骤，没有最后执行', () => {
    const state = play(LOOP, [])
    expect(nexts(state)).toEqual([['scan', 1, 'start', undefined]])
    expect(lasts(state)).toEqual([])
  })

  it('一步做完、下游没动：它是最后执行，下游是接下来', () => {
    const state = play(LOOP, [[['scan', 'running']], [['scan', 'done']]])
    expect(lasts(state)).toEqual([['scan', 1, 'done']])
    expect(nexts(state)).toEqual([['review', 1, 'flow', 'scan']])
  })

  it('循环：修完回到审查第 2 轮，而不是跳到环外的 report', () => {
    const state = play(LOOP, [
      [['scan', 'running']],
      [
        ['scan', 'done'],
        ['review', 'running'],
      ],
      [['review', 'done', 'fail']],
      [['fix', 'running']],
      [['fix', 'done']],
    ])
    expect(lasts(state)).toEqual([['fix', 1, 'done']])
    const cursor = runCursor(LOOP, state)
    expect(cursor.next).toEqual([
      { node: 'review', round: 2, reason: 'flow', from: 'fix', loop: true },
    ])
  })

  it('同一次调用里做完一步、开始下一步：最后执行是做完的那步，接下来为空（在跑）', () => {
    const state = play(LOOP, [
      [['scan', 'running']],
      [
        ['scan', 'done'],
        ['review', 'running'],
      ],
      [
        ['review', 'done', 'fail'],
        ['fix', 'running'],
      ],
    ])
    const cursor = runCursor(LOOP, state)
    expect(cursor.running).toEqual(['fix'])
    expect(cursor.next).toEqual([])
    expect(lasts(state)).toEqual([['review', 1, 'done']])
  })

  it('第 2 轮通过：接下来是 report；全部做完：最后执行是 report，没有接下来', () => {
    const passed = play(LOOP, [
      [['scan', 'done']],
      [['review', 'done', 'fail']],
      [['fix', 'done']],
      [['review', 'running']],
      [['review', 'done', 'pass']],
    ])
    expect(lasts(passed)).toEqual([['review', 2, 'done']])
    expect(nexts(passed)).toEqual([['report', 1, 'flow', 'review']])

    const finished = play(LOOP, [
      [['scan', 'done']],
      [['review', 'done', 'pass']],
      [['report', 'done']],
    ])
    expect(lasts(finished)).toEqual([['report', 1, 'done']])
    expect(nexts(finished)).toEqual([])
  })

  it('失败的步骤一直算最后执行，不往下排', () => {
    const state = play(LOOP, [[['scan', 'done']], [['review', 'running']], [['review', 'failed']]])
    expect(lasts(state)).toEqual([['review', 1, 'failed']])
    expect(nexts(state)).toEqual([])
  })

  it('改回 pending：前面都完成的那一步先重做', () => {
    const state = play(LOOP, [
      [['scan', 'done']],
      [['review', 'done', 'pass']],
      [['report', 'done']],
      [
        ['scan', 'pending'],
        ['review', 'pending'],
        ['report', 'pending'],
      ],
    ])
    expect(nexts(state)).toEqual([['scan', 2, 'reset', undefined]])
  })

  it('汇合：另一路还在跑时先不排汇合点；两路都完成再排', () => {
    const halfway = play(DIAMOND, [
      [['a', 'done']],
      [
        ['b', 'running'],
        ['c', 'running'],
      ],
      [['b', 'done']],
    ])
    expect(lasts(halfway, DIAMOND)).toEqual([['b', 1, 'done']])
    expect(nexts(halfway, DIAMOND)).toEqual([])

    const both = play(DIAMOND, [
      [['a', 'done']],
      [
        ['b', 'running'],
        ['c', 'running'],
      ],
      [['b', 'done']],
      [['c', 'done']],
    ])
    expect(lasts(both, DIAMOND)).toEqual([
      ['b', 1, 'done'],
      ['c', 1, 'done'],
    ])
    expect(nexts(both, DIAMOND)).toEqual([['d', 1, 'flow', 'b']])
  })

  it('手写的旧状态（没有流水）：按结束时间推', () => {
    const state = play(LOOP, [])
    state.nodes.scan = { status: 'done', round: 1, finishedAt: '2026-10-02T14:01:00+08:00' }
    expect(lasts(state)).toEqual([['scan', 1, 'done']])
    expect(nexts(state)).toEqual([['review', 1, 'flow', 'scan']])
  })
})
