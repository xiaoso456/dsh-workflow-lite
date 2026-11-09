/**
 * dsh-workflow-lite — 画布的滚轮缩放：带缓动，按光标位置算目标视口。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/hooks/useWheelZoom
 */

import type { ReactFlowInstance } from '@xyflow/react'
import { useEffect } from 'react'
import type { FlowEdge, FlowNode } from '../types.ts'

/** 用户开了「减少动态效果」：滚轮缩放直接到位。 */
const REDUCED = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
export const MIN_ZOOM = 0.2
export const MAX_ZOOM = 1.5

export interface WheelZoomInput {
  wrapRef: React.RefObject<HTMLDivElement>
  flow: ReactFlowInstance<FlowNode, FlowEdge>
}

export function useWheelZoom({ wrapRef, flow }: WheelZoomInput): void {
  // 滚轮缩放换成「带缓动」的：d3 默认是每一格滚轮立刻跳一档，这里按光标位置算出目标视口，用 150ms 的过渡滑过去。
  // 目标记在 `pending` 里（连续滚时从目标接着算，不从还在动的中间值算，免得越滚越偏），停 250ms 就放掉。
  // 触控板捏合（带 ctrl）仍交给 d3，它的增量本来就细；`nowheel` 里的（带滚动条的面板）不管。
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    let pending: { x: number; y: number; zoom: number } | null = null
    let release = 0
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return
      const target = event.target
      if (!(target instanceof Element) || target.closest('.nowheel') !== null) return
      if (!target.closest('.react-flow')) return
      event.preventDefault()
      event.stopPropagation()
      const from = pending ?? flow.getViewport()
      const delta = -event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002)
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, from.zoom * 2 ** delta))
      if (zoom === from.zoom) return
      const box = wrap.getBoundingClientRect()
      const px = event.clientX - box.left
      const py = event.clientY - box.top
      const k = zoom / from.zoom
      pending = { x: px - (px - from.x) * k, y: py - (py - from.y) * k, zoom }
      void flow.setViewport(pending, { duration: REDUCED ? 0 : 150 })
      window.clearTimeout(release)
      release = window.setTimeout(() => {
        pending = null
      }, 250)
    }
    wrap.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.clearTimeout(release)
      wrap.removeEventListener('wheel', onWheel, { capture: true })
    }
  }, [flow])
}
