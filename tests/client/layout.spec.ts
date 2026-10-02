import { describe, expect, it } from 'vitest'
import {
  COL_STEP,
  FILE_DX,
  FILE_H,
  FILE_W,
  freeSpot,
  NODE_H,
  NODE_W,
  nextTo,
  placeMissing,
  tidy,
} from '../../src/client/model/layout.ts'
import { routeFileLink, STEP_SPOTS, spotOf, writePoints } from '../../src/client/model/route.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import type { Point, WorkflowDocument, WorkflowNode } from '../../src/shared/types.ts'

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

/** 步骤 + 文件的图：`files` 是 `[文件, 写它的步骤 | null, 读它的步骤…]`。 */
function withFiles(
  ids: string[],
  links: [string, string][],
  files: [string, string | null, ...string[]][],
): WorkflowDocument {
  const doc = graph(ids, links)
  for (const [file, writer, ...readers] of files) {
    doc.nodes.push({ id: file, type: 'wfFile', position: { x: 0, y: 0 }, data: { path: file } })
    const edge = (source: string, target: string) => ({
      id: `${source}->${target}`,
      source,
      target,
      sourceHandle: null,
      targetHandle: null,
    })
    if (writer !== null) doc.edges.push(edge(writer, file))
    for (const reader of readers) doc.edges.push(edge(file, reader))
  }
  return doc
}

interface Box {
  id: string
  x: number
  y: number
  w: number
  h: number
}

function boxes(doc: WorkflowDocument, placed: Record<string, Point>): Box[] {
  return doc.nodes.map((node: WorkflowNode) => {
    const at = placed[node.id] as Point
    const file = node.type === 'wfFile'
    return { id: node.id, x: at.x, y: at.y, w: file ? FILE_W : NODE_W, h: file ? FILE_H : NODE_H }
  })
}

function overlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

/** 一段横 / 竖线是否穿过卡片内部（贴边不算）。 */
function crosses(a: [number, number], b: [number, number], box: Box): boolean {
  const pad = 1
  const [minX, maxX] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])]
  const [minY, maxY] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])]
  return (
    maxX > box.x + pad &&
    minX < box.x + box.w - pad &&
    maxY > box.y + pad &&
    minY < box.y + box.h - pad
  )
}

describe('tidy', () => {
  it('按执行批次从左到右分列，列距整齐，卡片互不重叠，也不落在原点哨兵上', async () => {
    const doc = graph(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b'],
        ['a', 'c'],
        ['b', 'd'],
        ['c', 'd'],
      ],
    )
    const placed = await tidy(doc, analyzeGraph(doc))
    expect(placed.b?.x).toBe((placed.a?.x ?? 0) + COL_STEP)
    expect(placed.b?.x).toBe(placed.c?.x)
    expect(placed.d?.x).toBe((placed.b?.x ?? 0) + COL_STEP)
    const all = boxes(doc, placed)
    expect(all.some((a, i) => all.slice(i + 1).some((b) => overlap(a, b)))).toBe(false)
    expect(Object.values(placed).some((p) => p.x === 0 && p.y === 0)).toBe(false)
  })

  it('一个步骤写的几份文件竖着挂在它下面、往右缩进；写线一条也不穿过别的卡片', async () => {
    // 截图里的情形：同一列三个步骤，最上面那个写了三份文件；下一列两个步骤各写两份。
    const doc = withFiles(
      ['code', 'scout', 'scout2', 'split', 'fix', 'fix2'],
      [
        ['code', 'split'],
        ['scout', 'split'],
        ['scout2', 'split'],
        ['split', 'fix'],
        ['split', 'fix2'],
      ],
      [
        ['scan', 'code', 'split'],
        ['notes', 'code'],
        ['extra', 'code'],
        ['plan', 'split', 'fix'],
        ['fixA', 'fix'],
        ['fixB', 'fix'],
        ['fixC', 'fix2'],
      ],
    )
    const placed = await tidy(doc, analyzeGraph(doc))
    const all = boxes(doc, placed)
    expect(all.some((a, i) => all.slice(i + 1).some((b) => overlap(a, b)))).toBe(false)
    const code = placed.code as Point
    const files = ['scan', 'notes', 'extra'].map((id) => placed[id] as Point)
    for (const [row, file] of files.entries()) {
      expect(file.x).toBe(code.x + FILE_DX)
      expect(file.y).toBeGreaterThan(code.y + NODE_H)
      if (row > 0) expect(file.y).toBeGreaterThan((files[row - 1] as Point).y + FILE_H)
    }
    // 同一列下一个步骤在这串文件下面，不是夹在步骤和它的文件之间。
    expect(Math.min(placed.scout?.y ?? 0, placed.scout2?.y ?? 0)).toBeGreaterThan(
      (files[2] as Point).y + FILE_H,
    )
    for (const edge of doc.edges) {
      const file = all.find((box) => box.id === edge.target && box.w === FILE_W)
      const step = all.find((box) => box.id === edge.source)
      if (file === undefined || step === undefined) continue
      const route = routeFileLink('write', step, file)
      const points = writePoints(
        spotOf(step, STEP_SPOTS[route.step]),
        { x: file.x, y: file.y + file.h / 2 },
        file.h,
      )
      for (const box of all) {
        if (box.id === step.id || box.id === file.id) continue
        for (let i = 1; i < points.length; i += 1) {
          expect(
            crosses(points[i - 1] as [number, number], points[i] as [number, number], box),
            `${edge.id} 穿过 ${box.id}`,
          ).toBe(false)
        }
      }
    }
  })

  it('上游挂着一串文件也不会把下游挤歪：一条链摆在同一条水平线上', async () => {
    const doc = withFiles(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
      [
        ['f1', 'a'],
        ['f2', 'a'],
        ['f3', 'a'],
      ],
    )
    const placed = await tidy(doc, analyzeGraph(doc))
    expect(placed.b?.y).toBe(placed.a?.y)
    expect(placed.c?.y).toBe(placed.a?.y)
  })

  it('没人写、只被读的文件放在读它的步骤前一列', async () => {
    const doc = withFiles(['a', 'b'], [['a', 'b']], [['input', null, 'a']])
    const placed = await tidy(doc, analyzeGraph(doc))
    expect(placed.a?.x).toBe((placed.input?.x ?? 0) - FILE_DX + COL_STEP)
    expect((placed.input?.x ?? 0) + FILE_W).toBeLessThan(placed.a?.x ?? 0)
  })

  it('相邻两列之间的线上挂着长条件时，只把那一处拉开到放得下牌子', async () => {
    const doc = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
      ],
    )
    const edge = doc.edges[0]
    if (edge !== undefined) edge.data = { when: '审查结论里没有阻塞项时才往下走' }
    const placed = await tidy(doc, analyzeGraph(doc))
    const first = (placed.b?.x ?? 0) - (placed.a?.x ?? 0)
    expect(first).toBeGreaterThan(COL_STEP)
    // 牌子（最宽 120 字宽 + 边距）放得下：两张步骤卡之间的空当比它宽。
    expect(first - NODE_W).toBeGreaterThanOrEqual(120 + 18 + 28)
    expect((placed.c?.x ?? 0) - (placed.b?.x ?? 0)).toBe(COL_STEP)
  })

  it('同一张图总是摆成同一版式', async () => {
    const doc = graph(
      ['a', 'b', 'c'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
      ],
    )
    expect(await tidy(doc, analyzeGraph(doc))).toEqual(await tidy(doc, analyzeGraph(doc)))
  })

  it('按量出来的真实高度排：高的卡片下面的文件跟着往下挪', async () => {
    const doc = withFiles(['a'], [], [['f', 'a']])
    const placed = await tidy(doc, analyzeGraph(doc), (id) =>
      id === 'a' ? { width: NODE_W, height: 180 } : undefined,
    )
    expect(placed.f?.y).toBeGreaterThan((placed.a?.y ?? 0) + 180)
  })
})

describe('placeMissing', () => {
  it('全都没摆过 ⇒ 整图重排', async () => {
    const doc = graph(['a', 'b'], [['a', 'b']])
    expect(await placeMissing(doc, analyzeGraph(doc))).toEqual(await tidy(doc, analyzeGraph(doc)))
  })

  it('只补没摆过的：挨着上游放，已经摆好的不动', async () => {
    const doc = graph(['a', 'b'], [['a', 'b']], { a: { x: 500, y: 300 } })
    const placed = await placeMissing(doc, analyzeGraph(doc))
    expect(Object.keys(placed)).toEqual(['b'])
    expect(placed.b).toEqual({ x: 500 + COL_STEP, y: 300 })
  })

  it('都摆过了就什么都不做', async () => {
    const doc = graph(['a'], [], { a: { x: 1, y: 2 } })
    expect(await placeMissing(doc, analyzeGraph(doc))).toEqual({})
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
