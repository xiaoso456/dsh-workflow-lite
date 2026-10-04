/**
 * `src/client/model/runGraph.ts`：实例视图里单独撤回一处图的改动、哪些步骤删不得；
 * 编辑器的 `replaceDoc`（撤回走它，进撤销历史）。
 */

import { describe, expect, it } from 'vitest'
import { initialState, reduce } from '../../src/client/model/editor.ts'
import { lockedSteps, revertChange } from '../../src/client/model/runGraph.ts'
import { graphChanges } from '../../src/shared/graphDiff.ts'
import { initialRunState } from '../../src/shared/runState.ts'
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

const BASE: WorkflowDocument = {
  nodes: [
    { id: 'a', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: 'a' } },
    { id: 'b', type: NODE_TYPE, position: { x: 100, y: 0 }, data: { prompt: 'b' } },
    { id: 'c', type: NODE_TYPE, position: { x: 200, y: 0 }, data: { prompt: 'c' } },
  ],
  edges: [edge('a', 'b'), edge('b', 'c', 'pass')],
  viewport: { x: 0, y: 0, zoom: 1 },
}

describe('revertChange', () => {
  it('同时改了几处：撤回其中一处，其余不动', () => {
    const edited: WorkflowDocument = {
      ...BASE,
      nodes: [
        { ...BASE.nodes[0], position: { x: 50, y: 50 } } as WorkflowDocument['nodes'][number],
        { ...BASE.nodes[1], data: { prompt: 'B' } } as WorkflowDocument['nodes'][number],
        { id: 'd', type: NODE_TYPE, position: { x: 0, y: 200 }, data: { prompt: 'd' } },
      ],
      edges: [edge('a', 'b'), edge('a', 'd')],
    }
    const changes = graphChanges(BASE, edited)
    expect(changes.map((change) => `${change.object}:${change.kind}:${change.id}`)).toEqual([
      'step:removed:c',
      'step:changed:b',
      'step:added:d',
      'layout:changed:',
    ])
    let doc = edited
    for (const change of changes) {
      const reverted = revertChange(BASE, doc, change)
      const left = graphChanges(BASE, reverted)
      expect(left).toHaveLength(graphChanges(BASE, doc).length - 1)
      doc = reverted
    }
    expect(graphChanges(BASE, doc)).toEqual([])
    // 删掉的步骤放回来时，连它的线一起回来。
    expect(doc.edges.map((item) => item.id).sort()).toEqual(['a->b', 'b->c#pass'])
  })

  it('改了条件的线：换回原来那条', () => {
    const edited: WorkflowDocument = { ...BASE, edges: [edge('a', 'b'), edge('b', 'c', 'fail')] }
    const [change] = graphChanges(BASE, edited)
    if (change === undefined) throw new Error('no change')
    expect(revertChange(BASE, edited, change).edges).toEqual(BASE.edges)
  })
})

describe('lockedSteps', () => {
  it('执行过的步骤锁住；不记状态的实例不锁', () => {
    const state = {
      ...initialRunState({
        instance: 'i',
        workflow: 'w',
        plan: 'p',
        graph: '/g',
        mode: 'auto',
        now: '2026-10-04T10:00:00+08:00',
        steps: ['a', 'b', 'c'],
      }),
      log: [{ at: '2026-10-04T10:00:00+08:00', node: 'b', event: 'start' as const }],
    }
    const locked = lockedSteps({
      ...state,
      nodes: { ...state.nodes, a: { status: 'done', round: 1 } },
    })
    expect(['a', 'b', 'c'].map(locked)).toEqual([true, true, false])
    expect(lockedSteps(null)('a')).toBe(false)
  })
})

describe('editor replaceDoc', () => {
  it('整张换掉、进撤销历史；选中的东西不在了就放掉', () => {
    let state = reduce(initialState, {
      type: 'loaded',
      name: 'x',
      doc: BASE,
      baseHash: 'h',
      problems: [],
    })
    state = reduce(state, { type: 'select', selection: { kind: 'node', id: 'c' } })
    const smaller = { ...BASE, nodes: BASE.nodes.slice(0, 2), edges: [edge('a', 'b')] }
    state = reduce(state, { type: 'replaceDoc', doc: smaller })
    expect(state.doc).toBe(smaller)
    expect(state.selection).toBeNull()
    state = reduce(state, { type: 'undo' })
    expect(state.doc).toBe(BASE)
  })
})
