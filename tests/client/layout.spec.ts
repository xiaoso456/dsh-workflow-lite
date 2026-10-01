import { describe, expect, it } from 'vitest'
import {
  COL_STEP,
  freeSpot,
  NODE_H,
  NODE_W,
  nextTo,
  placeMissing,
  tidy,
} from '../../src/client/model/layout.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import type { Point, WorkflowDocument } from '../../src/shared/types.ts'

function graph(
  ids: string[],
  links: [string, string][],
  at: Record<string, Point> = {},
): WorkflowDocument {
  return {
    nodes: ids.map((id) => ({
      id,
      type: 'wfNode',
      position: at[id] ?? { x: 0, y: 0 },
      data: { prompt: id },
    })),
    edges: links.map(([source, target]) => ({
      id: `${source}->${target}`,
      source,
      target,
      sourceHandle: null,
      targetHandle: null,
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

function overlapping(points: Point[]): boolean {
  return points.some((a, i) =>
    points.slice(i + 1).some((b) => Math.abs(a.x - b.x) < NODE_W && Math.abs(a.y - b.y) < NODE_H),
  )
}

describe('tidy', () => {
  it('按执行批次从左到右分列，卡片互不重叠，也不落在原点哨兵上', () => {
    const doc = graph(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b'],
        ['a', 'c'],
        ['b', 'd'],
        ['c', 'd'],
      ],
    )
    const placed = tidy(doc, analyzeGraph(doc))
    expect(placed.a?.x).toBeLessThan(placed.b?.x ?? 0)
    expect(placed.b?.x).toBe(placed.c?.x)
    expect(placed.d?.x).toBe((placed.b?.x ?? 0) + COL_STEP)
    const points = Object.values(placed)
    expect(overlapping(points)).toBe(false)
    expect(points.some((p) => p.x === 0 && p.y === 0)).toBe(false)
  })

  it('同一张图总是摆成同一版式', () => {
    const doc = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
      ],
    )
    expect(tidy(doc, analyzeGraph(doc))).toEqual(tidy(doc, analyzeGraph(doc)))
  })
})

describe('placeMissing', () => {
  it('全都没摆过 ⇒ 整图重排', () => {
    const doc = graph(['a', 'b'], [['a', 'b']])
    expect(placeMissing(doc, analyzeGraph(doc))).toEqual(tidy(doc, analyzeGraph(doc)))
  })

  it('只补没摆过的：挨着上游放，已经摆好的不动', () => {
    const doc = graph(['a', 'b'], [['a', 'b']], { a: { x: 500, y: 300 } })
    const placed = placeMissing(doc, analyzeGraph(doc))
    expect(Object.keys(placed)).toEqual(['b'])
    expect(placed.b).toEqual({ x: 500 + COL_STEP, y: 300 })
  })

  it('都摆过了就什么都不做', () => {
    const doc = graph(['a'], [], { a: { x: 1, y: 2 } })
    expect(placeMissing(doc, analyzeGraph(doc))).toEqual({})
  })
})

describe('freeSpot / nextTo', () => {
  it('被占了就往下找', () => {
    const spot = freeSpot([{ x: 100, y: 100 }], { x: 110, y: 110 })
    expect(spot.x).toBe(110)
    expect(spot.y).toBeGreaterThan(100 + NODE_H)
  })

  it('「添加下一步」落在右边一列', () => {
    const doc = graph(['a'], [], { a: { x: 100, y: 100 } })
    expect(nextTo(doc, { x: 100, y: 100 })).toEqual({ x: 100 + COL_STEP, y: 100 })
  })
})
