import { describe, expect, it } from 'vitest'
import {
  applyDraft,
  downstreamOf,
  editedNodes,
  rebase,
  rerun,
  resolve,
  setField,
  setNodeStatus,
} from '../../src/client/model/runDraft.ts'
import { initialRunState, type RunState } from '../../src/shared/runState.ts'

const T = '2026-10-02T14:30:00+08:00'
const NOW = '2026-10-02T15:00:00+08:00'

function base(): RunState {
  const state = initialRunState({
    instance: '20261002-143000-a3f9',
    workflow: 'cr',
    plan: '3f9a1c2e',
    graph: '/g.json',
    mode: 'serial',
    now: T,
    steps: ['scan', 'review', 'fix'],
  })
  state.status = 'running'
  state.nodes.scan = { status: 'done', round: 1, startedAt: T, finishedAt: T }
  state.nodes.review = { status: 'running', round: 1, startedAt: T }
  return state
}

describe('runDraft', () => {
  it('同一字段第一次改记下改前；改回原值就撤掉', () => {
    let draft = setField([], base(), ['status'], 'waiting')
    expect(draft).toEqual([{ path: ['status'], from: 'running', to: 'waiting' }])
    draft = setField(draft, base(), ['status'], 'cancelled')
    expect(draft).toEqual([{ path: ['status'], from: 'running', to: 'cancelled' }])
    expect(setField(draft, base(), ['status'], 'running')).toEqual([])
  })

  it('改状态连带改轮次与时间；叠到状态上就是画布看到的样子', () => {
    const draft = setNodeStatus([], base(), 'review', 'done', NOW)
    expect(draft).toEqual([
      { path: ['nodes', 'review', 'status'], from: 'running', to: 'done' },
      { path: ['nodes', 'review', 'finishedAt'], from: null, to: NOW },
    ])
    const shown = applyDraft(base(), draft)
    expect(shown.nodes.review).toEqual({ status: 'done', round: 1, startedAt: T, finishedAt: NOW })
    expect(editedNodes(draft)).toEqual(new Set(['review']))
  })

  it('重跑：做过的步骤一起改回待执行、清掉结束时间', () => {
    const draft = rerun([], base(), ['scan', 'review', 'fix'], NOW)
    const shown = applyDraft(base(), draft)
    expect(shown.nodes.scan).toEqual({ status: 'pending', round: 1, startedAt: T })
    expect(shown.nodes.review?.status).toBe('pending')
    expect(draft.some((edit) => edit.path[1] === 'fix')).toBe(false)
  })

  it('刷新后：模型也改成了同样的值就撤掉；改成别的就是冲突；两种了结', () => {
    const draft = [
      ...setField([], base(), ['status'], 'waiting'),
      ...setField([], base(), ['nodes', 'review', 'status'], 'skipped'),
    ]
    const disk = base()
    disk.status = 'waiting'
    disk.nodes.review = { status: 'done', round: 1, startedAt: T, finishedAt: T }
    const result = rebase(draft, disk)
    expect(result.draft.map((edit) => edit.path.join('.'))).toEqual(['nodes.review.status'])
    expect(result.conflicts).toEqual([
      { path: ['nodes', 'review', 'status'], from: 'running', to: 'skipped', disk: 'done' },
    ])
    const conflict = result.conflicts[0]
    if (conflict === undefined) return
    expect(resolve(result.draft, conflict, 'theirs')).toEqual([])
    expect(resolve(result.draft, conflict, 'mine')).toEqual([
      { path: ['nodes', 'review', 'status'], from: 'done', to: 'skipped' },
    ])
  })

  it('下游：沿步骤之间的线走，含回边，只认步骤', () => {
    const edges = [
      { source: 'scan', target: 'review' },
      { source: 'review', target: 'fix' },
      { source: 'fix', target: 'review' },
      { source: 'review', target: 'file-x' },
    ]
    expect(downstreamOf(edges, new Set(['scan', 'review', 'fix']), 'review').sort()).toEqual([
      'fix',
      'review',
    ])
  })
})
