import { describe, expect, it } from 'vitest'
import { busPoints, findBuses } from '../../src/client/model/bus.ts'
import {
  COL_STEP,
  freeSpot,
  memorySpot,
  NODE_H,
  NODE_W,
  nextTo,
  placeMissing,
  RES_DX,
  RES_H,
  RES_W,
  TRIGGER_H,
  TRIGGER_W,
  tidy,
} from '../../src/client/model/layout.ts'
import {
  FILE_SPOTS,
  routeFileLink,
  STEP_SPOTS,
  spotOf,
  writePoints,
} from '../../src/client/model/route.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { edgeKind, nodeIndex } from '../../src/shared/resources.ts'
import { DEFAULT_TRIGGER } from '../../src/shared/trigger.ts'
import type { Point, WorkflowDocument, WorkflowEdge, WorkflowNode } from '../../src/shared/types.ts'

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
    doc.nodes.push({
      id: file,
      type: 'wfResource',
      position: { x: 0, y: 0 },
      data: { items: [{ kind: 'file', value: file }] },
    })
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
    const file = node.type === 'wfResource'
    return { id: node.id, x: at.x, y: at.y, w: file ? RES_W : NODE_W, h: file ? RES_H : NODE_H }
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

/** 整理后走总线的读写线（见 model/bus.ts）：线的 id 和它的折线。 */
function busLines(
  doc: WorkflowDocument,
  placed: Record<string, Point>,
): { id: string; step: string; file: string; points: [number, number][] }[] {
  const rects = new Map(boxes(doc, placed).map((box) => [box.id, box]))
  const index = nodeIndex(doc)
  const buses = findBuses(doc, index, rects)
  const lines: { id: string; step: string; file: string; points: [number, number][] }[] = []
  for (const edge of doc.edges) {
    const kind = edgeKind(index, edge)
    if (kind !== 'read' && kind !== 'write') continue
    const [step, file] = kind === 'write' ? [edge.source, edge.target] : [edge.target, edge.source]
    const bus = buses.get(file)
    if (bus === undefined || !(kind === 'write' ? bus.writes : bus.reads).has(step)) continue
    const stepEnd = spotOf(
      rects.get(step) as Box,
      STEP_SPOTS[kind === 'write' ? 'fileUp' : 'readTop'],
    )
    const fileEnd = spotOf(
      rects.get(file) as Box,
      FILE_SPOTS[kind === 'write' ? 'inBus' : 'outBus'],
    )
    lines.push({ id: edge.id, step, file, points: busPoints(fileEnd, stepEnd, bus.trunk) })
  }
  return lines.sort((a, b) => a.id.localeCompare(b.id))
}

/** 每条总线都不穿过两头以外的卡片。 */
function expectClear(doc: WorkflowDocument, placed: Record<string, Point>): void {
  const all = boxes(doc, placed)
  for (const line of busLines(doc, placed)) {
    for (let i = 1; i < line.points.length; i += 1) {
      for (const box of all.filter((item) => item.id !== line.step && item.id !== line.file)) {
        expect(
          crosses(line.points[i - 1] as [number, number], line.points[i] as [number, number], box),
          `${line.id} 穿过 ${box.id}`,
        ).toBe(false)
      }
    }
  }
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
      expect(file.x).toBe(code.x + RES_DX)
      expect(file.y).toBeGreaterThan(code.y + NODE_H)
      if (row > 0) expect(file.y).toBeGreaterThan((files[row - 1] as Point).y + RES_H)
    }
    // 同一列下一个步骤在这串文件下面，不是夹在步骤和它的文件之间。
    expect(Math.min(placed.scout?.y ?? 0, placed.scout2?.y ?? 0)).toBeGreaterThan(
      (files[2] as Point).y + RES_H,
    )
    for (const edge of doc.edges) {
      const file = all.find((box) => box.id === edge.target && box.w === RES_W)
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
    expect(placed.a?.x).toBe((placed.input?.x ?? 0) - RES_DX + COL_STEP)
    expect((placed.input?.x ?? 0) + RES_W).toBeLessThan(placed.a?.x ?? 0)
  })

  it('贯穿好几步的文档放在主线上方、第一个用到它的步骤正上方，读写线走总线', async () => {
    const update = (step: string, file: string): WorkflowEdge => ({
      id: `${step}->${file}`,
      source: step,
      target: file,
      sourceHandle: null,
      targetHandle: null,
      data: { update: true },
    })
    const chain: [string, string][] = [
      ['a', 'b'],
      ['b', 'c'],
    ]
    // 更新之前就被读的状态文档。
    const doc = withFiles(['a', 'b', 'c'], chain, [['ledger', null, 'a']])
    doc.edges.push(update('c', 'ledger'))
    const placed = await tidy(doc, analyzeGraph(doc))
    expect(placed.ledger?.x).toBe(placed.a?.x)
    expect((placed.ledger?.y ?? 0) + RES_H).toBeLessThan(placed.a?.y ?? 0)
    expect(busLines(doc, placed).map((line) => line.id)).toEqual(['c->ledger', 'ledger->a'])
    expectClear(doc, placed)
    // 先产出、后面又有别的步骤更新的档案。
    const archive = withFiles(['a', 'b', 'c'], chain, [['notes', 'a', 'b']])
    archive.edges.push(update('c', 'notes'))
    const laidArchive = await tidy(archive, analyzeGraph(archive))
    expect((laidArchive.notes?.y ?? 0) + RES_H).toBeLessThan(laidArchive.a?.y ?? 0)
    expect(busLines(archive, laidArchive)).toHaveLength(3)
    expectClear(archive, laidArchive)
    // 没人写、三步都读的规范。
    const spec = withFiles(['a', 'b', 'c'], chain, [['spec', null, 'a', 'b', 'c']])
    const laidSpec = await tidy(spec, analyzeGraph(spec))
    expect((laidSpec.spec?.y ?? 0) + RES_H).toBeLessThan(laidSpec.a?.y ?? 0)
    expect(busLines(spec, laidSpec)).toHaveLength(3)
    // 后面整份产出它的另算：照旧挂在产出它的步骤下面。
    const made = withFiles(['a', 'b'], [['a', 'b']], [['out', 'b', 'a']])
    const laid = await tidy(made, analyzeGraph(made))
    expect(laid.out?.x).toBe((laid.b?.x ?? 0) + RES_DX)
    // 只被一步更新、之后才读的：还是挂在那一步下面；只有两步读的：照旧放在前一列。
    const once = withFiles(['a', 'b'], [['a', 'b']], [['log', null, 'b']])
    once.edges.push(update('a', 'log'))
    const kept = await tidy(once, analyzeGraph(once))
    expect(kept.log?.x).toBe((kept.a?.x ?? 0) + RES_DX)
    expect(kept.log?.y).toBeGreaterThan(kept.a?.y ?? 0)
    const pair = withFiles(['a', 'b'], [['a', 'b']], [['ref', null, 'a', 'b']])
    const laidPair = await tidy(pair, analyzeGraph(pair))
    expect(laidPair.ref?.x).toBe((laidPair.a?.x ?? 0) - COL_STEP + RES_DX)
  })

  it('几份贯穿好几步的文档并排一排、底边对齐，不往上叠；各自的总线不穿过别的卡', async () => {
    const doc = withFiles(
      ['a', 'b', 'c', 'd'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
      ],
      [
        ['queue', null, 'a', 'd'],
        ['archive', null, 'd'],
      ],
    )
    for (const [step, file] of [
      ['a', 'queue'],
      ['c', 'queue'],
      ['b', 'archive'],
      ['c', 'archive'],
    ] as const) {
      doc.edges.push({
        id: `${step}->${file}`,
        source: step,
        target: file,
        sourceHandle: null,
        targetHandle: null,
        data: { update: true },
      })
    }
    const placed = await tidy(doc, analyzeGraph(doc))
    const queue = placed.queue as Point
    const archive = placed.archive as Point
    expect(queue.y).toBe(archive.y)
    expect(queue.x + RES_W).toBeLessThan(archive.x)
    expect(busLines(doc, placed)).toHaveLength(7)
    expectClear(doc, placed)
  })

  it('主线（最长的一条路）摆成一条直线，跳过几步的分支从旁边绕', async () => {
    const doc = graph(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
        ['d', 'e'],
        ['a', 'e'],
        ['b', 'e'],
        ['c', 'e'],
      ],
    )
    const placed = await tidy(doc, analyzeGraph(doc))
    for (const id of ['b', 'c', 'd', 'e']) expect(placed[id]?.y, id).toBe(placed.a?.y)
  })

  it('触发卡片放在主线头一个步骤左边、和它摆在一条线上；多了排成几列', async () => {
    const doc = graph(['a', 'b'], [['a', 'b']])
    doc.nodes.push({
      id: 'when',
      type: 'wfTrigger',
      position: { x: 0, y: 0 },
      data: DEFAULT_TRIGGER,
    })
    const placed = await tidy(doc, analyzeGraph(doc))
    const a = placed.a as Point
    const when = placed.when as Point
    expect(when.x + TRIGGER_W).toBeLessThan(a.x)
    expect(Math.abs(when.y + TRIGGER_H / 2 - (a.y + NODE_H / 2))).toBeLessThanOrEqual(1)

    // 十张：往下排、往左开列，不摞成一根长条，也不往主线上面伸。
    const many = graph(['a', 'b'], [['a', 'b']])
    for (let i = 0; i < 10; i += 1) {
      many.nodes.push({
        id: `t${i}`,
        type: 'wfTrigger',
        position: { x: 0, y: 0 },
        data: DEFAULT_TRIGGER,
      })
    }
    const laid = await tidy(many, analyzeGraph(many))
    const cards = many.nodes
      .filter((node) => node.type === 'wfTrigger')
      .map((node) => laid[node.id] as Point)
    const columns = new Map<number, number>()
    for (const card of cards) {
      expect(card.x + TRIGGER_W).toBeLessThan(laid.a?.x ?? 0)
      expect(card.y).toBeGreaterThanOrEqual((laid.a?.y ?? 0) - TRIGGER_H)
      columns.set(card.x, (columns.get(card.x) ?? 0) + 1)
    }
    expect(Math.max(...columns.values())).toBe(4)
    for (const [i, p] of cards.entries()) {
      for (const q of cards.slice(i + 1)) {
        expect(
          overlap(
            { id: '', x: p.x, y: p.y, w: TRIGGER_W, h: TRIGGER_H },
            { id: '', x: q.x, y: q.y, w: TRIGGER_W, h: TRIGGER_H },
          ),
        ).toBe(false)
      }
    }
  })

  it('跨好几列的读线不把主线挤歪：一条链仍摆在同一条水平线上', async () => {
    // 输入被第一步和最后一步读；中间几列的块不该被这条长读线的占位挤开。
    const doc = withFiles(
      ['a', 'b', 'c', 'd', 'e'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'd'],
        ['d', 'e'],
      ],
      [
        ['shared', null, 'a', 'c', 'e'],
        ['notes', null, 'a', 'd'],
        ['a.md', 'a', 'e'],
        ['b.md', 'b', 'e'],
      ],
    )
    const placed = await tidy(doc, analyzeGraph(doc))
    for (const id of ['b', 'c', 'd', 'e']) expect(placed[id]?.y, id).toBe(placed.a?.y)
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

describe('输入卡的位置', () => {
  it('整图重排：输入卡放在第一个用到它的步骤的前一列；没连的放到左上角', async () => {
    const doc = graph(['a', 'b'], [['a', 'b']])
    doc.nodes.push(
      { id: 'q', type: 'wfInput', position: { x: 0, y: 0 }, data: { question: '问' } },
      { id: 'loose', type: 'wfInput', position: { x: 0, y: 0 }, data: { question: '问 2' } },
    )
    doc.edges.push({ id: 'q->b', source: 'q', target: 'b', sourceHandle: null, targetHandle: null })
    const placed = await tidy(doc, analyzeGraph(doc))
    const a = placed.a as Point
    const b = placed.b as Point
    const q = placed.q as Point
    expect(q.x).toBeLessThan(b.x)
    expect(q.x).toBeGreaterThanOrEqual(a.x)
    // 谁都不连的：左上角一排，在整张图上面。
    const loose = placed.loose as Point
    expect(loose.x).toBe(Math.min(...Object.values(placed).map((point) => point.x)))
    expect(loose.y + 56).toBeLessThan(Math.min(a.y, b.y, q.y))
  })

  it('补位：模型新加的输入卡挨着读它的步骤、放在左边', async () => {
    const doc = graph(['a'], [], { a: { x: 600, y: 200 } })
    doc.nodes.push({ id: 'q', type: 'wfInput', position: { x: 0, y: 0 }, data: { question: '问' } })
    doc.edges.push({ id: 'q->a', source: 'q', target: 'a', sourceHandle: null, targetHandle: null })
    const placed = await placeMissing(doc, analyzeGraph(doc))
    expect((placed.q as Point).x).toBeLessThan(600)
    expect((placed.q as Point).y).toBe(200)
  })
})

describe('记忆卡的位置', () => {
  const stepOf = (doc: WorkflowDocument, id: string): WorkflowNode =>
    doc.nodes.find((node) => node.id === id) as WorkflowNode

  it('下面空着：挂在步骤下面、往右缩进（和产出一样）', () => {
    const doc = graph(['a', 'b'], [['a', 'b']], {
      a: { x: 100, y: 100 },
      b: { x: 100 + COL_STEP, y: 100 },
    })
    const spot = memorySpot(doc, stepOf(doc, 'a'))
    expect(spot.x).toBe(100 + RES_DX)
    expect(spot.y).toBeGreaterThan(100 + NODE_H)
  })

  it('下面压着别的步骤：改放到步骤上面，写线不用绕', () => {
    const doc = graph(['a', 'b'], [['a', 'b']], {
      a: { x: 100, y: 300 },
      b: { x: 100, y: 300 + NODE_H + 30 },
    })
    const spot = memorySpot(doc, stepOf(doc, 'a'))
    expect(spot.y + RES_H).toBeLessThan(300)
    // 上边的写点比底边的靠右：写线还得是一个直角（竖着上去、横着进卡片左边），不绕路。
    const from = spotOf({ x: 100, y: 300, w: NODE_W, h: NODE_H }, STEP_SPOTS.fileUp)
    const points = writePoints(from, { x: spot.x, y: spot.y + RES_H / 2 }, RES_H)
    expect(points).toHaveLength(3)
  })

  it('上下都压着别的步骤：退回下面能放下的地方', () => {
    const doc = graph(['top', 'a', 'low'], [], {
      top: { x: 100, y: 100 },
      a: { x: 100, y: 100 + NODE_H + 40 },
      low: { x: 100, y: 100 + (NODE_H + 40) * 2 },
    })
    const spot = memorySpot(doc, stepOf(doc, 'a'))
    expect(spot.y).toBeGreaterThan(100 + (NODE_H + 40) * 2)
  })
})
