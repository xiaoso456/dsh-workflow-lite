/**
 * dsh-workflow-lite — 画布的视口：换基线时恢复上次的视角；是默认视角（新图）就看全图。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/hooks/useViewportRestore
 */

import type { ReactFlowInstance } from '@xyflow/react'
import { useEffect, useRef } from 'react'
import type { WorkflowDocument } from '../../../../shared/types.ts'
import { recallViewport } from '../../../app/viewport.ts'
import type { CanvasProps } from '../Canvas.tsx'
import type { FlowEdge, FlowNode } from '../types.ts'

/** 自动看全图不放大过 100%，也不缩到读不了字。 */
const AUTO_FIT = { minZoom: 0.55, maxZoom: 1 }

export interface ViewportRestoreInput {
  flow: ReactFlowInstance<FlowNode, FlowEdge>
  docRef: React.MutableRefObject<WorkflowDocument>
  props: Pick<CanvasProps, 'insets' | 'onSettled' | 'loadKey'>
  viewKey: string | undefined
}

export function useViewportRestore({ flow, docRef, props, viewKey }: ViewportRestoreInput): void {
  const insets = useRef(props.insets)
  insets.current = props.insets
  const settled = useRef(props.onSettled)
  settled.current = props.onSettled
  useEffect(() => {
    const saved =
      (viewKey === undefined ? null : recallViewport(viewKey)) ?? docRef.current.viewport
    const untouched = saved.x === 0 && saved.y === 0 && saved.zoom === 1
    const settle = (): number =>
      requestAnimationFrame(() => {
        settled.current?.()
      })
    if (!untouched) {
      void flow.setViewport(saved)
      const done = settle()
      return () => cancelAnimationFrame(done)
    }
    if (docRef.current.nodes.length === 0) {
      settled.current?.()
      return
    }
    // 等卡片渲染并量完尺寸再看全图（隔两帧）。
    let second = 0
    let third = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        void flow.fitView({
          ...AUTO_FIT,
          padding: {
            top: '84px',
            bottom: '64px',
            left: `${insets.current.left + 28}px`,
            right: `${insets.current.right + 28}px`,
          },
        })
        third = settle()
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
      cancelAnimationFrame(third)
    }
  }, [props.loadKey, viewKey, flow])
}
