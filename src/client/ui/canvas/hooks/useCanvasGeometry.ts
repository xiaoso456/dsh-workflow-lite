/**
 * dsh-workflow-lite — 画布几何：卡片尺寸表、看全图。
 *
 * 尺寸表跟着 `ReactFlowProvider` 走（一个画布一份）：画布记下 React Flow 量出来的尺寸，
 * 同一画布外面的视图（整理排版、看全图）也从这里读，不问 React Flow 的内部节点——
 * 画布只挂视口附近的卡片时（见 `useCulling`），React Flow 那里不是全图。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/hooks/useCanvasGeometry
 */

import { getViewportForBounds, useReactFlow, useStoreApi } from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import type { WorkflowDocument } from '../../../../shared/types.ts'
import { boundsOf, type Size, type SizeTable } from '../../../model/canvasGeometry.ts'

/** 一块画布的卡片尺寸表，和它是给哪份文档量的。 */
interface Table {
  map: Map<string, Size>
  owner: string | null
}

/** 各画布的卡片尺寸表，按 store 的 `getState` 认。 */
const tables = new WeakMap<object, Table>()

/**
 * `useStoreApi()` 拿到的 store 的尺寸表。`useStoreApi()` 每处调用各包一层新对象，
 * 只有里面的 `getState` 才是同一画布共用的，所以按它认：画布、整理排版、看全图读写的是同一张表。
 *
 * 给了 `owner`（画布的 `loadKey`）且和上次不同就先清空：模板和实例共用一个画布，
 * 不同工作流的卡片 id 也会重名，别人量的尺寸不能拿来排版、看全图。
 */
export function sizeTableOf(store: { getState: object }, owner?: string): Map<string, Size> {
  let table = tables.get(store.getState)
  if (table === undefined) {
    table = { map: new Map(), owner: owner ?? null }
    tables.set(store.getState, table)
  } else if (owner !== undefined && owner !== table.owner) {
    table.map.clear()
    table.owner = owner
  }
  return table.map
}

/**
 * 这块画布的卡片尺寸表。画布自己传 `owner`（它的 `loadKey`），在 React Flow 报上尺寸时写进去；
 * 画布外面（整理排版、看全图）不传，只读。
 */
export function useCardSizes(owner?: string): Map<string, Size> {
  return sizeTableOf(useStoreApi(), owner)
}

/** 看全图时四边留的空（像素）。 */
export interface FitPadding {
  top: number
  right: number
  bottom: number
  left: number
}

export interface FitOptions {
  padding: FitPadding
  /** 不给就按画布的缩放范围。 */
  minZoom?: number
  maxZoom?: number
  duration?: number
}

/** 看全图的标准留空：上让出顶栏、下让出缩放条，左右让出两侧浮层。 */
export function fitPadding(insets: { left: number; right: number }): FitPadding {
  return { top: 84, bottom: 64, left: insets.left + 28, right: insets.right + 28 }
}

/** 自动看全图（打开新图、整理排版后）不放大过 100%，也不缩到读不了字。 */
export const AUTO_FIT = { minZoom: 0.55, maxZoom: 1 } as const

export interface CanvasGeometry {
  sizes: SizeTable
  /** 量出来的尺寸（整理排版用）；没量过是 `undefined`。 */
  sizeOf(id: string): Size | undefined
  /** 把整张图摆进画布：按文档里的坐标和尺寸表算，和挂着哪些卡片无关。 */
  fitDoc(doc: WorkflowDocument, options: FitOptions): void
}

export function useCanvasGeometry(): CanvasGeometry {
  const store = useStoreApi()
  const flow = useReactFlow()
  const sizes = useCardSizes()
  const sizeOf = useCallback((id: string): Size | undefined => sizes.get(id), [sizes])
  const fitDoc = useCallback(
    (doc: WorkflowDocument, options: FitOptions): void => {
      const { width, height, minZoom, maxZoom } = store.getState()
      const bounds = boundsOf(doc.nodes, sizes)
      if (bounds === null || width === 0 || height === 0) return
      const { top, right, bottom, left } = options.padding
      const viewport = getViewportForBounds(
        { x: bounds.x, y: bounds.y, width: bounds.w, height: bounds.h },
        width,
        height,
        options.minZoom ?? minZoom,
        options.maxZoom ?? maxZoom,
        { top: `${top}px`, right: `${right}px`, bottom: `${bottom}px`, left: `${left}px` },
      )
      void flow.setViewport(
        viewport,
        options.duration === undefined ? undefined : { duration: options.duration },
      )
    },
    [store, flow, sizes],
  )
  return useMemo(() => ({ sizes, sizeOf, fitDoc }), [sizes, sizeOf, fitDoc])
}
