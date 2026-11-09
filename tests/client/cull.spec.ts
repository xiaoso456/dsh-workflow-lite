/**
 * `src/client/model/cull.ts`：大图只挂视口附近的——区域怎么定、什么时候换、区域里挂哪些。
 */

import { describe, expect, it } from 'vitest'
import {
  decide,
  MARGIN,
  mountedIn,
  regionFor,
  sameMounted,
  viewOf,
} from '../../src/client/model/cull.ts'
import { tidy } from '../../src/client/model/layout.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { idKey } from '../../src/shared/model.ts'
import type { WorkflowDocument, WorkflowNode } from '../../src/shared/types.ts'
import { bigGraph } from '../perf/bigGraph.ts'

const step = (id: string, x: number, y: number): WorkflowNode => ({
  id,
  type: 'wfNode',
  position: { x, y },
  data: { prompt: 'p' },
})

const NONE = new Set<string>()
const noPath = (): undefined => undefined

describe('视口与区域', () => {
  it('视口换算成画布坐标；区域每边多出 MARGIN', () => {
    const view = viewOf([-200, -100, 2], 1000, 600)
    expect(view).toEqual({ x: 100, y: 50, w: 500, h: 300, zoom: 2 })
    const region = regionFor(view)
    expect(region.x).toBe(100 - 500 * MARGIN)
    expect(region.w).toBe(500 * (1 + 2 * MARGIN))
    expect(region.zoom).toBe(2)
  })

  it('没有区域就当场定；在区域中间挪一点不换', () => {
    const view = viewOf([0, 0, 1], 1000, 600)
    expect(decide(view, null)).toBe('now')
    const region = regionFor(view)
    expect(decide(view, region)).toBe('keep')
    expect(decide(viewOf([-100, -50, 1], 1000, 600), region)).toBe('keep')
  })

  it('偏离中心较远：停下来再换；快到区域边上：当场换', () => {
    const region = regionFor(viewOf([0, 0, 1], 1000, 600))
    // 往右挪了 0.4 个视口宽：还有余量，但偏了中心。
    expect(decide(viewOf([-400, 0, 1], 1000, 600), region)).toBe('later')
    // 挪了 0.6 个视口宽：右边只剩 0.15，不够 RESERVE。
    expect(decide(viewOf([-600, 0, 1], 1000, 600), region)).toBe('now')
  })

  it('放大很多：停下来再换（挂得太多）；缩小到区域装不下：当场换', () => {
    const region = regionFor(viewOf([0, 0, 1], 1000, 600))
    // 绕视口中心放大到 2 倍。
    expect(decide(viewOf([-500, -300, 2], 1000, 600), region)).toBe('later')
    // 绕视口中心缩到一半：视口变成两倍大，超出区域。
    expect(decide(viewOf([250, 150, 0.5], 1000, 600), region)).toBe('now')
  })
})

describe('mountedIn', () => {
  const doc = {
    nodes: [step('a', 0, 0), step('b', 400, 0), step('far', 9000, 0), step('far2', 9400, 0)],
    edges: [
      { id: 'a->b', source: 'a', target: 'b' },
      { id: 'far->far2', source: 'far', target: 'far2' },
    ],
  } as WorkflowDocument
  const region = { x: -100, y: -100, w: 1000, h: 600 }

  it('挂区域里的卡片和线，区域外的不挂', () => {
    const got = mountedIn({
      doc,
      sizes: new Map(),
      region,
      pinnedNodes: NONE,
      pinnedEdges: NONE,
      pathOf: noPath,
    })
    expect([...got.nodes].sort()).toEqual(['a', 'b'])
    expect([...got.edges]).toEqual(['a->b'])
  })

  it('钉住的卡片、线照挂；钉住的线两头一起挂', () => {
    const got = mountedIn({
      doc,
      sizes: new Map(),
      region,
      pinnedNodes: new Set(['far']),
      pinnedEdges: new Set(['far->far2']),
      pathOf: noPath,
    })
    expect(got.nodes.has('far')).toBe(true)
    expect(got.nodes.has('far2')).toBe(true)
    expect(got.edges.has('far->far2')).toBe(true)
  })

  it('横穿区域的长线：两头都在区域外，线和两头照挂', () => {
    const across = {
      nodes: [step('l', -5000, 100), step('r', 5000, 100)],
      edges: [{ id: 'l->r', source: 'l', target: 'r' }],
    } as WorkflowDocument
    const got = mountedIn({
      doc: across,
      sizes: new Map(),
      region,
      pinnedNodes: NONE,
      pinnedEdges: NONE,
      pathOf: noPath,
    })
    expect([...got.nodes].sort()).toEqual(['l', 'r'])
    expect([...got.edges]).toEqual(['l->r'])
  })

  it('走廊伸进区域的线也挂：按走法的 lane / 折点算外框', () => {
    const below = {
      nodes: [step('p', 0, -3000), step('q', 400, -3000)],
      edges: [{ id: 'p->q', source: 'p', target: 'q' }],
    } as WorkflowDocument
    const base = { doc: below, sizes: new Map(), region, pinnedNodes: NONE, pinnedEdges: NONE }
    expect(mountedIn({ ...base, pathOf: noPath }).edges.size).toBe(0)
    expect(mountedIn({ ...base, pathOf: () => ({ lane: 200 }) }).edges.has('p->q')).toBe(true)
    expect(
      mountedIn({ ...base, pathOf: () => ({ bend: [[100, 100] as const] }) }).edges.has('p->q'),
    ).toBe(true)
  })

  it('量出来的尺寸更大：按量出来的算', () => {
    const tall = { nodes: [step('t', 0, -2000)], edges: [] } as unknown as WorkflowDocument
    const base = { doc: tall, region, pinnedNodes: NONE, pinnedEdges: NONE, pathOf: noPath }
    expect(mountedIn({ ...base, sizes: new Map() }).nodes.size).toBe(0)
    expect(
      mountedIn({ ...base, sizes: new Map([['t', { width: 300, height: 2000 }]]) }).nodes.size,
    ).toBe(1)
  })

  it('挂着的每条线两头都挂着（大图上逐个视口核对）', async () => {
    const graph = bigGraph(4) as WorkflowDocument
    const positions = await tidy(graph, analyzeGraph(graph))
    const laid = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        position: positions[node.id] ?? node.position,
      })),
    }
    let partial = 0
    for (let x = -2000; x < 12000; x += 1700) {
      for (let y = -1500; y < 6000; y += 1300) {
        const got = mountedIn({
          doc: laid,
          sizes: new Map(),
          region: regionFor(viewOf([-x, -y, 1], 1400, 900)),
          pinnedNodes: NONE,
          pinnedEdges: NONE,
          pathOf: noPath,
        })
        for (const edge of laid.edges) {
          if (!got.edges.has(edge.id)) continue
          expect(got.nodes.has(idKey(edge.source))).toBe(true)
          expect(got.nodes.has(idKey(edge.target))).toBe(true)
        }
        if (got.nodes.size > 0 && got.nodes.size < laid.nodes.length) partial += 1
      }
    }
    // 确实有只挂了一部分的视口（不是全挂、也不是全不挂）。
    expect(partial).toBeGreaterThan(3)
  })

  it('两次挑出来一样就判成相同', () => {
    const a = { nodes: new Set(['a', 'b']), edges: new Set(['x']) }
    expect(sameMounted(a, { nodes: new Set(['b', 'a']), edges: new Set(['x']) })).toBe(true)
    expect(sameMounted(a, { nodes: new Set(['a']), edges: new Set(['x']) })).toBe(false)
    expect(sameMounted(a, { nodes: new Set(['a', 'c']), edges: new Set(['x']) })).toBe(false)
  })
})
