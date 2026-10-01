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

import type { GraphAnalysis } from '../../shared/graph.ts'
import { byId } from '../../shared/graph.ts'
import type { Point, WorkflowDocument } from '../../shared/types.ts'

/** 步骤卡的宽度（CSS 里写死同一个数）与估算高度。 */
export const NODE_W = 216
export const NODE_H = 96

/** 列距与行距。 */
export const COL_STEP = 284
export const ROW_STEP = 132

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
  // 批次之外的节点（理论上没有）：排在最后一列之后，别让它们叠在原点。
  let stray = 0
  for (const node of doc.nodes) {
    if (placed[node.id] !== undefined) continue
    placed[node.id] = {
      x: ORIGIN.x + columns.length * COL_STEP,
      y: ORIGIN.y + stray * ROW_STEP,
    }
    stray += 1
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
  // 批次里没有的节点（理论上没有）：放到版面下方，别让它留在原点。
  for (const node of missing) {
    if (placed[node.id] !== undefined) continue
    const spot = freeSpot([...position.values()], { x: left, y: bottom + ROW_STEP })
    position.set(node.id, spot)
    placed[node.id] = spot
  }
  return placed
}
