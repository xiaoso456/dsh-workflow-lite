/**
 * `src/shared/graphDiff.ts`：两版图之间改了什么（实例视图的「已改 x 处」、写给模型的通知）。
 * `src/shared/runSync.ts`：图改了以后状态怎么跟着对齐。
 */

import { describe, expect, it } from 'vitest'
import { affectsPlan, describeGraphChange, graphChanges } from '../../src/shared/graphDiff.ts'
import { isStep } from '../../src/shared/model.ts'
import { graphFacts, initialRunState, type RunState } from '../../src/shared/runState.ts'
import { applySync, hasHistory, syncOps } from '../../src/shared/runSync.ts'
import {
  NODE_TYPE,
  type NodeData,
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

/** scan → review；review 通过去 report、未通过去 fix；review 写 notes。 */
const BASE: WorkflowDocument = {
  nodes: [
    { id: 'scan', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: 'a' } },
    {
      id: 'review',
      type: NODE_TYPE,
      position: { x: 100, y: 0 },
      data: { prompt: 'b', label: '审查' },
    },
    { id: 'fix', type: NODE_TYPE, position: { x: 200, y: 0 }, data: { prompt: 'c' } },
    { id: 'report', type: NODE_TYPE, position: { x: 300, y: 0 }, data: { prompt: 'd' } },
    {
      id: 'notes',
      type: RESOURCE_TYPE,
      position: { x: 100, y: 200 },
      data: { items: [{ kind: 'file', value: 'notes.md' }] },
    },
  ],
  edges: [
    edge('scan', 'review'),
    edge('review', 'report', 'pass'),
    edge('review', 'fix', 'fail'),
    edge('review', 'notes'),
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
}

/** 改一个步骤的 `data`。 */
function patch(id: string, data: Partial<NodeData>): WorkflowDocument {
  return {
    ...BASE,
    nodes: BASE.nodes.map((node) =>
      node.id === id && isStep(node) ? { ...node, data: { ...node.data, ...data } } : node,
    ),
  }
}

describe('graphChanges', () => {
  it('没改就是空的；视口不算', () => {
    expect(graphChanges(BASE, { ...BASE, viewport: { x: 5, y: 5, zoom: 2 } })).toEqual([])
  })

  it('改了步骤的字段：一处，列出改了哪几样；只改描述、图标不进计划', () => {
    const next = patch('review', { prompt: 'B', description: '看一遍' })
    const changes = graphChanges(BASE, next)
    expect(changes).toEqual([
      { object: 'step', kind: 'changed', id: 'review', fields: ['description', 'prompt'] },
    ])
    expect(affectsPlan(changes[0] as never)).toBe(true)
    const cosmetic = graphChanges(BASE, patch('review', { description: '看一遍' }))
    expect(cosmetic.map(affectsPlan)).toEqual([false])
    expect(describeGraphChange(changes[0] as never, BASE, next)).toBe(
      '步骤 review（审查）：改了描述、提示词',
    )
  })

  it('加步骤连同连它的线算一处；删步骤连带的线也不另算', () => {
    const added: WorkflowDocument = {
      ...BASE,
      nodes: [
        ...BASE.nodes,
        { id: 'lint', type: NODE_TYPE, position: { x: 0, y: 300 }, data: { prompt: 'l' } },
      ],
      edges: [...BASE.edges, edge('scan', 'lint')],
    }
    expect(graphChanges(BASE, added)).toEqual([
      { object: 'step', kind: 'added', id: 'lint', fields: [] },
    ])
    const removed: WorkflowDocument = {
      ...BASE,
      nodes: BASE.nodes.filter((node) => node.id !== 'fix'),
      edges: BASE.edges.filter((item) => item.target !== 'fix'),
    }
    expect(graphChanges(BASE, removed)).toEqual([
      { object: 'step', kind: 'removed', id: 'fix', fields: [] },
    ])
  })

  it('改条件换了线的 id：按两端认成同一条线改了条件；新连、删掉的线各一处', () => {
    const next: WorkflowDocument = {
      ...BASE,
      edges: [
        edge('scan', 'review'),
        edge('review', 'report', 'ok'),
        edge('review', 'notes'),
        edge('fix', 'report'),
      ],
    }
    const changes = graphChanges(BASE, next)
    expect(changes).toEqual([
      { object: 'edge', kind: 'removed', id: 'review->fix#fail', fields: [] },
      {
        object: 'edge',
        kind: 'changed',
        id: 'review->report#ok',
        was: 'review->report#pass',
        fields: ['when'],
      },
      { object: 'edge', kind: 'added', id: 'fix->report', fields: [] },
    ])
    expect(describeGraphChange(changes[1] as never, BASE, next)).toBe(
      '连线 review → report（条件 ok）：改了条件',
    )
  })

  it('挪卡片合成一处布局，排在最后、不进计划；资源改了内容是一处', () => {
    const next = {
      ...BASE,
      nodes: BASE.nodes.map((node) =>
        node.id === 'scan'
          ? { ...node, position: { x: 9, y: 9 } }
          : node.id === 'notes' && node.type === RESOURCE_TYPE
            ? {
                ...node,
                position: { x: 1, y: 1 },
                data: { items: [{ kind: 'file' as const, value: 'notes.md', note: '只写结论' }] },
              }
            : node,
      ),
    }
    const changes = graphChanges(BASE, next)
    expect(changes).toEqual([
      { object: 'resource', kind: 'changed', id: 'notes', fields: ['items'] },
      { object: 'layout', kind: 'changed', id: '', fields: ['scan', 'notes'] },
    ])
    expect(changes.map(affectsPlan)).toEqual([true, false])
  })
})

describe('runSync', () => {
  function state(): RunState {
    const base = initialRunState({
      instance: 'i',
      workflow: 'w',
      plan: 'p1',
      graph: '/g.json',
      mode: 'auto',
      now: '2026-10-04T10:00:00+08:00',
      steps: ['scan', 'review', 'fix', 'report'],
    })
    return {
      ...base,
      next: ['fix', 'report'],
      nodes: {
        ...base.nodes,
        scan: { status: 'done', round: 1, finishedAt: '2026-10-04T10:01:00+08:00' },
        review: { status: 'done', round: 1, verdict: 'pass' },
      },
      log: [{ at: '2026-10-04T10:01:00+08:00', node: 'scan', event: 'done', round: 1 }],
    }
  }

  it('新步骤补 pending，删掉的去掉，指定的下一步跟着去掉，没了条件出边的步骤去掉判定，plan 换新', () => {
    const next: WorkflowDocument = {
      ...BASE,
      nodes: [
        ...BASE.nodes.filter((node) => node.id !== 'fix'),
        { id: 'lint', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: 'l' } },
      ],
      edges: [edge('scan', 'review'), edge('review', 'report'), edge('review', 'lint')],
    }
    const ops = syncOps(state(), graphFacts(next), 'p2')
    expect(ops).toEqual([
      { path: ['plan'], to: 'p2' },
      { path: ['nodes', 'lint'], to: { status: 'pending' } },
      { path: ['nodes', 'review', 'verdict'], to: null },
      { path: ['nodes', 'fix'], to: null },
      { path: ['next'], to: ['report'] },
    ])
    const synced = applySync(state(), ops)
    expect(Object.keys(synced.nodes).sort()).toEqual(['lint', 'report', 'review', 'scan'])
    expect(synced.nodes.review).toEqual({ status: 'done', round: 1 })
    expect(synced.plan).toBe('p2')
    expect(state().nodes.fix).toEqual({ status: 'pending' })
  })

  it('图没变就没什么要对齐的；执行过（不是 pending 或流水里有它）的步骤算有过记录', () => {
    expect(syncOps(state(), graphFacts(BASE))).toEqual([])
    expect(hasHistory(state(), 'scan')).toBe(true)
    expect(hasHistory(state(), 'review')).toBe(true)
    expect(hasHistory(state(), 'fix')).toBe(false)
  })
})
