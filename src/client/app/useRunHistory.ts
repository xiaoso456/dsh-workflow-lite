/**
 * dsh-workflow-lite — 实例视图的撤销 / 重做：把图的撤销栈和状态草稿的撤销栈排成一条
 * （顺序怎么对齐见 `model/runHistory.ts`）。顶栏的两个按钮和 Ctrl+Z / Ctrl+Shift+Z 都走这里。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useRunHistory
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EMPTY_ORDER,
  type HistoryOrder,
  type HistorySide,
  reconcileOrder,
  redoStep,
  type SideHistory,
  undoStep,
} from '../model/runHistory.ts'

/** 一边要交给这里的东西。 */
export interface HistorySource {
  history: SideHistory
  undo(): void
  redo(): void
  dropRedo(): void
}

export interface RunHistory {
  canUndo: boolean
  canRedo: boolean
  undo(): void
  redo(): void
}

export function useRunHistory(sources: Record<HistorySide, HistorySource>): RunHistory {
  const [order, setOrder] = useState<HistoryOrder>(EMPTY_ORDER)
  const orderRef = useRef(order)
  orderRef.current = order
  const sourcesRef = useRef(sources)
  sourcesRef.current = sources
  const seen = useRef<Record<HistorySide, SideHistory> | null>(null)

  const graph = sources.graph.history
  const state = sources.state.history
  useEffect(() => {
    const after = { graph, state }
    const before = seen.current ?? after
    seen.current = after
    const result = reconcileOrder(orderRef.current, before, after)
    if (result.order !== orderRef.current) {
      orderRef.current = result.order
      setOrder(result.order)
    }
    for (const side of result.dropFuture) sourcesRef.current[side].dropRedo()
  }, [graph, state])

  const apply = useCallback((step: typeof undoStep, act: 'undo' | 'redo'): void => {
    const current = sourcesRef.current
    const result = step(orderRef.current, {
      graph: current.graph.history,
      state: current.state.history,
    })
    if (result === null) return
    orderRef.current = result.order
    setOrder(result.order)
    current[result.side][act]()
  }, [])

  return {
    canUndo: graph.past + state.past > 0,
    canRedo: graph.future + state.future > 0,
    undo: useCallback(() => apply(undoStep, 'undo'), [apply]),
    redo: useCallback(() => apply(redoStep, 'redo'), [apply]),
  }
}
