/**
 * dsh-workflow-lite — 从步骤库把步骤拖进画布：认放置区、解出载荷、落在指针处。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/hooks/useStepDrop
 */

import type { ReactFlowInstance } from '@xyflow/react'
import { useCallback } from 'react'
import type { Point } from '../../../../shared/types.ts'
import { NODE_H, NODE_W } from '../../../model/layout.ts'
import { DND_MIME, decodeStepSource, type StepSource } from '../../../model/library.ts'
import type { FlowEdge, FlowNode } from '../types.ts'

export interface StepDropInput {
  wrapRef: React.RefObject<HTMLDivElement>
  flow: ReactFlowInstance<FlowNode, FlowEdge>
  onDropSource(source: StepSource, flow: Point): void
}

export function useStepDrop({ wrapRef, flow, onDropSource }: StepDropInput) {
  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes(DND_MIME)) return
    // 不 preventDefault 的话浏览器不认这里是放置区，`drop` 永远不会来。
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      // 解不出自家载荷（外部拖进来的文件、链接）一律安静地忽略。
      const source = decodeStepSource(event.dataTransfer.getData(DND_MIME))
      if (source === null) return
      event.preventDefault()
      const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      // 让卡片的中心落在指针上。
      onDropSource(source, { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 })
      wrapRef.current?.focus()
    },
    [flow, onDropSource],
  )
  return { onDragOver, onDrop }
}
