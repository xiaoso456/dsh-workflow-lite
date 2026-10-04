/**
 * dsh-workflow-lite — 实例视图的撤销 / 重做：图的改动和状态的改动排成一条。
 *
 * 两边各有自己的撤销栈（图：编辑器状态机；状态：草稿）。这里只记"每一步是哪一边的"，
 * 撤销时弹出最后一步、交给那一边撤；两边的栈有了变化（新的一步、到上限挤掉最早的、存完 / 放弃后清空），
 * 用 {@link reconcileOrder} 把这条顺序对齐回去。
 *
 * 新的一步之后不能再重做：哪一边有了新的一步，另一边的重做栈也要丢掉（`dropFuture` 告诉调用方丢哪边）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/runHistory
 */

export type HistorySide = 'graph' | 'state'

export const HISTORY_SIDES: readonly HistorySide[] = ['graph', 'state']

/** 一边的撤销栈：能撤几步、能重做几步、一共压过几步（只增不减）。 */
export interface SideHistory {
  past: number
  future: number
  seq: number
}

/** 排成一条的顺序：`past` 的最后一项是下一次撤销的那一边，`future` 的最后一项是下一次重做的那一边。 */
export interface HistoryOrder {
  past: HistorySide[]
  future: HistorySide[]
}

export const EMPTY_ORDER: HistoryOrder = { past: [], future: [] }

function count(list: readonly HistorySide[], side: HistorySide): number {
  return list.filter((item) => item === side).length
}

/** 去掉最早的几项 `side`，直到只剩 `keep` 项。 */
function trim(list: HistorySide[], side: HistorySide, keep: number): HistorySide[] {
  let extra = count(list, side) - keep
  if (extra <= 0) return list
  return list.filter((item) => {
    if (item !== side || extra === 0) return true
    extra -= 1
    return false
  })
}

/** 两边的栈从 `before` 变成 `after` 之后，对齐这条顺序。 */
export function reconcileOrder(
  order: HistoryOrder,
  before: Record<HistorySide, SideHistory>,
  after: Record<HistorySide, SideHistory>,
): { order: HistoryOrder; dropFuture: HistorySide[] } {
  let past = [...order.past]
  let future = [...order.future]
  const fresh = HISTORY_SIDES.filter((side) => after[side].seq > before[side].seq)
  for (const side of fresh) {
    past.push(...Array.from({ length: after[side].seq - before[side].seq }, () => side))
  }
  const dropFuture: HistorySide[] = []
  if (fresh.length > 0) {
    future = []
    for (const side of HISTORY_SIDES) {
      if (!fresh.includes(side) && after[side].future > 0) dropFuture.push(side)
    }
  }
  for (const side of HISTORY_SIDES) {
    past = trim(past, side, after[side].past)
    // 少了（这条顺序之外压进去的，比如打开时恢复的草稿）：补在最前面，最后才撤到它们。
    const missing = after[side].past - count(past, side)
    if (missing > 0) past = [...Array.from({ length: missing }, () => side), ...past]
    const futureKeep = dropFuture.includes(side) ? 0 : after[side].future
    future = trim(future, side, futureKeep)
  }
  const same =
    past.length === order.past.length &&
    future.length === order.future.length &&
    past.every((side, index) => side === order.past[index]) &&
    future.every((side, index) => side === order.future[index])
  return { order: same ? order : { past, future }, dropFuture }
}

/** 撤一步：弹出最后一步交给那一边（顺序空了但某一边还能撤，就撤那一边）。 */
export function undoStep(
  order: HistoryOrder,
  sides: Record<HistorySide, SideHistory>,
): { order: HistoryOrder; side: HistorySide } | null {
  const last = order.past.at(-1)
  const side =
    last !== undefined && sides[last].past > 0
      ? last
      : HISTORY_SIDES.find((candidate) => sides[candidate].past > 0)
  if (side === undefined) return null
  const index = order.past.lastIndexOf(side)
  const past = index < 0 ? order.past : order.past.filter((_, i) => i !== index)
  return { order: { past, future: [...order.future, side] }, side }
}

/** 重做一步：弹出最近撤掉的那一步。 */
export function redoStep(
  order: HistoryOrder,
  sides: Record<HistorySide, SideHistory>,
): { order: HistoryOrder; side: HistorySide } | null {
  const last = order.future.at(-1)
  const side =
    last !== undefined && sides[last].future > 0
      ? last
      : HISTORY_SIDES.find((candidate) => sides[candidate].future > 0)
  if (side === undefined) return null
  const index = order.future.lastIndexOf(side)
  const future = index < 0 ? order.future : order.future.filter((_, i) => i !== index)
  return { order: { past: [...order.past, side], future }, side }
}
