import { describe, expect, it } from 'vitest'

import {
  EMPTY_ORDER,
  type HistoryOrder,
  type HistorySide,
  reconcileOrder,
  redoStep,
  type SideHistory,
  undoStep,
} from '../../src/client/model/runHistory.ts'

const side = (past: number, future: number, seq: number): SideHistory => ({ past, future, seq })
const both = (graph: SideHistory, state: SideHistory): Record<HistorySide, SideHistory> => ({
  graph,
  state,
})

describe('撤销排成一条：图和状态', () => {
  it('两边各有新的一步：按发生的顺序排；撤销先撤最后那一步', () => {
    let order: HistoryOrder = EMPTY_ORDER
    let now = both(side(0, 0, 0), side(0, 0, 0))
    const step = (next: Record<HistorySide, SideHistory>) => {
      const result = reconcileOrder(order, now, next)
      order = result.order
      now = next
      return result
    }
    step(both(side(1, 0, 1), side(0, 0, 0))) // 改图
    step(both(side(1, 0, 1), side(1, 0, 1))) // 改状态
    step(both(side(2, 0, 2), side(1, 0, 1))) // 又改图
    expect(order.past).toEqual(['graph', 'state', 'graph'])

    const undone = undoStep(order, now)
    expect(undone?.side).toBe('graph')
    order = undone?.order ?? order
    now = both(side(1, 1, 2), side(1, 0, 1))
    // 那一边撤完之后再对齐：顺序已经对了，不动
    expect(reconcileOrder(order, now, now).order).toBe(order)
    expect(undoStep(order, now)?.side).toBe('state')
    expect(redoStep(order, now)?.side).toBe('graph')
  })

  it('撤销之后另一边有了新的一步：重做全部作废，告诉调用方丢掉那一边的重做栈', () => {
    const order: HistoryOrder = { past: ['state'], future: ['graph'] }
    const before = both(side(0, 1, 1), side(1, 0, 1))
    const after = both(side(0, 1, 1), side(2, 0, 2))
    const result = reconcileOrder(order, before, after)
    expect(result.order).toEqual({ past: ['state', 'state'], future: [] })
    expect(result.dropFuture).toEqual(['graph'])
  })

  it('一边被清空（存完、放弃、换基线）：顺序里它的那些步都去掉', () => {
    const order: HistoryOrder = { past: ['graph', 'state', 'graph'], future: ['state'] }
    const before = both(side(2, 0, 5), side(1, 1, 3))
    const after = both(side(0, 0, 5), side(1, 1, 3))
    expect(reconcileOrder(order, before, after).order).toEqual({
      past: ['state'],
      future: ['state'],
    })
  })

  it('到了上限：长度不变但多压了一步，挤掉最早的那一步', () => {
    const order: HistoryOrder = { past: ['graph', 'state', 'graph'], future: [] }
    const before = both(side(2, 0, 7), side(1, 0, 1))
    const after = both(side(2, 0, 8), side(1, 0, 1))
    expect(reconcileOrder(order, before, after).order.past).toEqual(['state', 'graph', 'graph'])
  })

  it('顺序之外压进去的（打开时恢复的改动）补在最前面', () => {
    const result = reconcileOrder(
      { past: ['state'], future: [] },
      both(side(0, 0, 0), side(1, 0, 1)),
      both(side(1, 0, 0), side(1, 0, 1)),
    )
    expect(result.order.past).toEqual(['graph', 'state'])
  })

  it('什么都撤不了 / 重做不了：回 null', () => {
    const none = both(side(0, 0, 0), side(0, 0, 0))
    expect(undoStep(EMPTY_ORDER, none)).toBeNull()
    expect(redoStep(EMPTY_ORDER, none)).toBeNull()
  })
})
