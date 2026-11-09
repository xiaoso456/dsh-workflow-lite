/**
 * dsh-workflow-lite — React Flow 报上来的节点变化：记下量出的尺寸，拖动中只改临时坐标，松手一次写进文档。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/hooks/useNodeChanges
 */

import type { NodeChange } from '@xyflow/react'
import { useCallback } from 'react'
import type { Point } from '../../../../shared/types.ts'
import type { Size } from '../../../model/canvasGeometry.ts'
import type { Edit } from '../../../model/editor.ts'
import type { FlowNode } from '../types.ts'

export interface NodeChangesInput {
  /** 量出来的卡片尺寸（见 `useCardSizes`）：这里记下 React Flow 报上来的。 */
  sizes: Map<string, Size>
  draggingRef: React.MutableRefObject<Record<string, Point>>
  setSized: React.Dispatch<React.SetStateAction<number>>
  setDragging: React.Dispatch<React.SetStateAction<Record<string, Point>>>
  onEdit(edit: Edit): void
}

export function useNodeChanges({
  sizes,
  draggingRef,
  setSized,
  setDragging,
  onEdit,
}: NodeChangesInput) {
  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]): void => {
      let moved: Record<string, Point> | null = null
      let resized = false
      const settled: Record<string, Point> = {}
      let finished = false
      for (const change of changes) {
        if (change.type === 'dimensions' && change.dimensions !== undefined) {
          const before = sizes.get(change.id)
          if (
            before === undefined ||
            Math.abs(before.width - change.dimensions.width) > 0.5 ||
            Math.abs(before.height - change.dimensions.height) > 0.5
          ) {
            resized = true
          }
          sizes.set(change.id, change.dimensions)
          continue
        }
        if (change.type !== 'position' || change.position === undefined) continue
        if (change.dragging === false) {
          finished = true
          settled[change.id] = change.position
        } else {
          moved = { ...(moved ?? draggingRef.current), [change.id]: change.position }
        }
      }
      if (resized) setSized((count) => count + 1)
      if (finished) {
        // 松手：把这次拖拽的终点一次写进文档，同一批里清掉临时坐标。
        onEdit({ type: 'moveNodes', positions: { ...draggingRef.current, ...settled } })
        setDragging({})
        return
      }
      if (moved !== null) setDragging(moved)
    },
    [onEdit],
  )
  return onNodesChange
}
