/**
 * dsh-workflow-lite — 画布上卡片占的地方：按文档里的坐标和卡片尺寸（量出来的优先，没量过按标称）算。
 *
 * 看全图、按视口挑要挂的卡片（`cull.ts`）、走线都按这一套算，不问 React Flow 挂着哪些卡片——
 * 只挂一部分卡片时，它那里的节点不是全图。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/canvasGeometry
 */

import type { Point, WorkflowNode } from '../../shared/types.ts'
import { cardSize } from './layout.ts'
import type { Rect } from './route.ts'

/** 量出来的卡片尺寸（React Flow 报上来的）。 */
export interface Size {
  width: number
  height: number
}

/** 卡片 id → 量出来的尺寸。 */
export type SizeTable = ReadonlyMap<string, Size>

/** 一张卡占的矩形：`at` 是拖动中的临时坐标，不给就是文档里的坐标。 */
export function cardRect(node: WorkflowNode, sizes: SizeTable, at: Point = node.position): Rect {
  const size = sizes.get(node.id)
  if (size !== undefined) return { x: at.x, y: at.y, w: size.width, h: size.height }
  const nominal = cardSize(node)
  return { x: at.x, y: at.y, w: nominal.w, h: nominal.h }
}

/** 一组卡片合起来的外框；一张都没有是 `null`。 */
export function boundsOf(nodes: readonly WorkflowNode[], sizes: SizeTable): Rect | null {
  if (nodes.length === 0) return null
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const node of nodes) {
    const box = cardRect(node, sizes)
    left = Math.min(left, box.x)
    top = Math.min(top, box.y)
    right = Math.max(right, box.x + box.w)
    bottom = Math.max(bottom, box.y + box.h)
  }
  return { x: left, y: top, w: right - left, h: bottom - top }
}
