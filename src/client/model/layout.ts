/**
 * dsh-workflow-lite — 自动布局（纯函数，同步，不吃额外依赖）。
 *
 * 从左到右分层：**列 = 执行批次**，所以版面本身就在讲执行次序；同一列里按上游的平均
 * 行号排，让连线尽量不交叉；每一列相对最高的那一列垂直居中。
 *
 * `(0,0)` 是"还没摆过"的哨兵值（host 新建节点时的初始坐标），所以版面原点不落在它上面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/layout
 */

import { fileGraph } from '../../shared/files.ts'
import type { GraphAnalysis } from '../../shared/graph.ts'
import { byId } from '../../shared/graph.ts'
import { isFile } from '../../shared/model.ts'
import type { Point, WorkflowDocument, WorkflowNode } from '../../shared/types.ts'

/** 步骤卡的宽度（CSS 里写死同一个数）与估算高度。 */
export const NODE_W = 216
export const NODE_H = 96

/** 文件卡的宽度（CSS 里写死同一个数）与估算高度。 */
export const FILE_W = 188
export const FILE_H = 56

/** 列距与行距。 */
export const COL_STEP = 284
export const ROW_STEP = 132

/**
 * 文件卡相对写它的步骤：挂在步骤正下方、稍往右错一点——写线从步骤底边落下来，
 * 读线从文件右边连到下一列的步骤（文件右沿要在下一列左边之前）。
 */
const FILE_DX = 40
const FILE_DY = NODE_H + 36
const FILE_ROW = FILE_H + 20

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function boxOf(node: WorkflowNode, at: Point = node.position): Box {
  return isFile(node)
    ? { x: at.x, y: at.y, w: FILE_W, h: FILE_H }
    : { x: at.x, y: at.y, w: NODE_W, h: NODE_H }
}

function hits(a: Box, b: Box): boolean {
  const gap = 16
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  )
}

/** 从 `want` 起往下找一个不压住任何已有卡片的位置（按真实尺寸比）。 */
function freeBox(occupied: readonly Box[], want: Box, step: number): Point {
  const spot = { ...want }
  while (occupied.some((box) => hits(box, spot))) spot.y += step
  return { x: spot.x, y: spot.y }
}

/**
 * 一个文件卡该放哪：挂在写它的步骤（没人写就是读它的步骤）的右下方，被占了就往下找。
 * @param anchor - 写它 / 读它的步骤的坐标；没有就放在版面左下。
 */
export function fileSpot(doc: WorkflowDocument, anchor: Point | undefined, skip?: string): Point {
  const occupied = doc.nodes
    .filter((node) => node.id !== skip && !isUnplaced(node.position))
    .map((node) => boxOf(node))
  const base =
    anchor ??
    (occupied.length === 0
      ? ORIGIN
      : {
          x: Math.min(...occupied.map((box) => box.x)),
          y: Math.max(...occupied.map((box) => box.y + box.h)),
        })
  return freeBox(
    occupied,
    { x: base.x + FILE_DX, y: base.y + FILE_DY, w: FILE_W, h: FILE_H },
    FILE_ROW,
  )
}

/** 文件卡的锚点：第一个写它的步骤，没有就第一个读它的步骤。 */
function anchorOf(
  doc: WorkflowDocument,
  fileId: string,
  position: (id: string) => Point | undefined,
): Point | undefined {
  const info = fileGraph(doc).get(fileId)
  if (info === undefined) return undefined
  for (const id of [...info.writers.map((writer) => writer.id), ...info.readers]) {
    const at = position(id)
    if (at !== undefined) return at
  }
  return undefined
}

const ORIGIN: Point = { x: 80, y: 80 }

/** 这个节点是不是还没摆过。 */
export function isUnplaced(position: Point): boolean {
  return position.x === 0 && position.y === 0
}

/** 整图重排：每个节点都重算，同一张图必然摆成同一版式。 */
export function tidy(doc: WorkflowDocument, analysis: GraphAnalysis): Record<string, Point> {
  const row = new Map<string, number>()
  const columns: string[][] = []
  for (const batch of analysis.batches) {
    const rank = (id: string): number => {
      const rows = (analysis.predecessors.get(id) ?? [])
        .map((predecessor) => row.get(predecessor))
        .filter((value): value is number => value !== undefined)
      if (rows.length === 0) return Number.POSITIVE_INFINITY
      return rows.reduce((sum, value) => sum + value, 0) / rows.length
    }
    const ordered = [...batch.nodes].sort((a, b) => rank(a) - rank(b) || byId(a, b))
    ordered.forEach((id, index) => {
      row.set(id, index)
    })
    columns.push(ordered)
  }

  const tallest = Math.max(1, ...columns.map((column) => column.length))
  const placed: Record<string, Point> = {}
  columns.forEach((column, columnIndex) => {
    const top = ORIGIN.y + ((tallest - column.length) / 2) * ROW_STEP
    column.forEach((id, rowIndex) => {
      placed[id] = { x: ORIGIN.x + columnIndex * COL_STEP, y: top + rowIndex * ROW_STEP }
    })
  })
  // 批次之外的步骤（理论上没有）：排在最后一列之后，别让它们叠在原点。
  let stray = 0
  for (const node of doc.nodes) {
    if (placed[node.id] !== undefined || isFile(node)) continue
    placed[node.id] = {
      x: ORIGIN.x + columns.length * COL_STEP,
      y: ORIGIN.y + stray * ROW_STEP,
    }
    stray += 1
  }
  // 文件卡：挂在写它的步骤右下方；按文件中的顺序摆，后摆的避开先摆的。
  const boxes: Box[] = doc.nodes
    .filter((node) => !isFile(node) && placed[node.id] !== undefined)
    .map((node) => boxOf(node, placed[node.id]))
  const bottom = Math.max(ORIGIN.y, ...boxes.map((box) => box.y + box.h))
  let loose = 0
  for (const node of doc.nodes) {
    if (!isFile(node)) continue
    const anchor = anchorOf(doc, node.id, (id) => placed[id])
    const want = anchor ?? { x: ORIGIN.x + loose * (FILE_W + 24) - FILE_DX, y: bottom }
    if (anchor === undefined) loose += 1
    const spot = freeBox(
      boxes,
      { x: want.x + FILE_DX, y: want.y + FILE_DY, w: FILE_W, h: FILE_H },
      FILE_ROW,
    )
    placed[node.id] = spot
    boxes.push(boxOf(node, spot))
  }
  return placed
}

/** 两张卡会不会叠在一起（留一点呼吸空间）。 */
function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < NODE_W + 24 && Math.abs(a.y - b.y) < NODE_H + 24
}

/** 从 `want` 起往下找一个不压住任何已有卡片的位置。 */
export function freeSpot(occupied: readonly Point[], want: Point): Point {
  let spot = want
  while (occupied.some((point) => overlaps(point, spot))) {
    spot = { x: spot.x, y: spot.y + ROW_STEP }
  }
  return spot
}

/** 「添加下一步」的落点：源步骤的右边一列，被占了就往下找。 */
export function nextTo(doc: WorkflowDocument, source: Point): Point {
  return freeSpot(
    doc.nodes.map((node) => node.position),
    { x: source.x + COL_STEP, y: source.y },
  )
}

/**
 * 给**还没摆过**的节点补坐标（已有坐标的一律不动）。
 *
 * 全都没摆过 ⇒ 整图重排；只有个别没摆过（模型用工具新加了一步）⇒ 挨着它的上游放，
 * 不去动用户已经摆好的版面。
 */
export function placeMissing(
  doc: WorkflowDocument,
  analysis: GraphAnalysis,
): Record<string, Point> {
  const missing = doc.nodes.filter((node) => isUnplaced(node.position))
  if (missing.length === 0) return {}
  if (missing.length === doc.nodes.length) return tidy(doc, analysis)

  const position = new Map<string, Point>()
  for (const node of doc.nodes) {
    if (!isUnplaced(node.position)) position.set(node.id, node.position)
  }
  const bottom = Math.max(...[...position.values()].map((point) => point.y))
  const left = Math.min(...[...position.values()].map((point) => point.x))
  const placed: Record<string, Point> = {}
  const occupied = (): Point[] => [...position.values()]
  // 按批次序走：同一轮里先摆上游，下游才有参照。
  for (const id of analysis.batches.flatMap((batch) => batch.nodes)) {
    if (position.has(id)) continue
    const anchor = (analysis.predecessors.get(id) ?? [])
      .map((predecessor) => position.get(predecessor))
      .find((point) => point !== undefined)
    const want =
      anchor === undefined
        ? { x: left, y: bottom + ROW_STEP }
        : { x: anchor.x + COL_STEP, y: anchor.y }
    const spot = freeSpot([...position.values()], want)
    position.set(id, spot)
    placed[id] = spot
  }
  // 文件卡（模型用工具加的、老图迁移出来的）：挂到写它的步骤右下方。
  for (const node of missing) {
    if (placed[node.id] !== undefined || !isFile(node)) continue
    const anchor = anchorOf(doc, node.id, (id) => position.get(id))
    const current: WorkflowDocument = {
      ...doc,
      nodes: doc.nodes.map((item) => {
        const at = position.get(item.id)
        return at === undefined ? { ...item, position: { x: 0, y: 0 } } : { ...item, position: at }
      }),
    }
    const spot = fileSpot(current, anchor, node.id)
    position.set(node.id, spot)
    placed[node.id] = spot
  }
  // 批次里没有的步骤（理论上没有）：放到版面下方，别让它留在原点。
  for (const node of missing) {
    if (placed[node.id] !== undefined) continue
    const spot = freeSpot(occupied(), { x: left, y: bottom + ROW_STEP })
    position.set(node.id, spot)
    placed[node.id] = spot
  }
  return placed
}
