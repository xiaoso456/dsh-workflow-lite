/**
 * dsh-workflow-lite — 大图只挂视口附近的卡片和线（判断全在 `model/cull.ts`）。
 *
 * - {@link useCullRegion}：订视口，按 `decide` 换区域。视口每动一下只做几次加减比较、不重渲染画布；
 *   要换区域时才更新一次状态。判成「停下来再换」的排进 `whenStill`，插拔落在视口停下的那一刻。
 * - {@link useCulledFlow}：按区域从整份节点 / 连线对象里挑出要交给 React Flow 的；挑出来的没变就交回上一份数组。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/hooks/useCulling
 */

import { useStoreApi } from '@xyflow/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { idKey } from '../../../../shared/model.ts'
import type { Point, WorkflowDocument } from '../../../../shared/types.ts'
import type { SizeTable } from '../../../model/canvasGeometry.ts'
import {
  CULL_MIN_NODES,
  decide,
  type Mounted,
  mountedIn,
  regionFor,
  sameMounted,
  type Viewbox,
  viewOf,
} from '../../../model/cull.ts'
import type { Selection } from '../../../model/editor.ts'
import { whenStill } from '../../motion/canvasMoving.ts'
import type { CanvasRoutes } from '../flow/buildRoutes.ts'
import type { FlowEdge, FlowNode } from '../types.ts'

/** 一块什么都碰不到的区域。 */
const NOWHERE: Viewbox = { x: 0, y: 0, w: 0, h: 0, zoom: 1 }

/** 当前要挂的区域；`enabled` 为假（小图）时是 `null`。 */
export function useCullRegion(enabled: boolean): Viewbox | null {
  const store = useStoreApi()
  const [region, setRegion] = useState<Viewbox | null>(null)
  const regionRef = useRef<Viewbox | null>(null)
  useEffect(() => {
    if (!enabled) {
      regionRef.current = null
      setRegion(null)
      return
    }
    let alive = true
    let waiting = false
    const current = (): Viewbox | null => {
      const { transform, width, height } = store.getState()
      return width === 0 || height === 0 ? null : viewOf(transform, width, height)
    }
    const apply = (view: Viewbox): void => {
      const next = regionFor(view)
      regionRef.current = next
      setRegion(next)
    }
    const check = (): void => {
      const view = current()
      if (view === null) return
      const decision = decide(view, regionRef.current)
      if (decision === 'now') apply(view)
      else if (decision === 'later' && !waiting) {
        waiting = true
        whenStill(() => {
          waiting = false
          if (!alive) return
          const settled = current()
          if (settled !== null && decide(settled, regionRef.current) !== 'keep') apply(settled)
        })
      }
    }
    check()
    const unsubscribe = store.subscribe(check)
    return () => {
      alive = false
      unsubscribe()
    }
  }, [enabled, store])
  return enabled ? region : null
}

export interface CulledFlowInput {
  /** 按它挑：只在结构、位置、尺寸变了时换（`Canvas` 的 `routeDoc`），打字不重挑。 */
  doc: WorkflowDocument
  nodes: FlowNode[]
  edges: FlowEdge[]
  sizes: SizeTable
  /** 卡片尺寸量出来 / 变了就加一（`Canvas` 的 `sized`）。 */
  sized: number
  routes: CanvasRoutes
  selection: Selection
  dragging: Record<string, Point>
  /** 正在拖的线从哪张卡拖出来。 */
  dragFrom: string | null
}

/** 交给 React Flow 的节点和连线：小图原样交回；大图只交视口附近的、钉住的。 */
export function useCulledFlow(input: CulledFlowInput): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const { doc, nodes, edges, sizes, sized, routes, selection, dragging, dragFrom } = input
  const enabled = doc.nodes.length >= CULL_MIN_NODES
  // 大图还不知道视口（画布刚挂上、还没量出大小）时只挂钉住的：别先把整张图挂上再拔掉。
  const region = useCullRegion(enabled) ?? (enabled ? NOWHERE : null)
  // 钉住的卡片按 id 串成一个键：拖动中坐标每帧都变，挂哪些不跟着重挑。
  const pinKey = [
    selection?.kind ?? '',
    selection?.id ?? '',
    dragFrom ?? '',
    ...Object.keys(dragging),
  ].join('\n')
  // 线的走法只在重挑时读一次（不进依赖：拖动中每帧都变）。
  const routesRef = useRef(routes)
  routesRef.current = routes
  const lastRef = useRef<Mounted | null>(null)
  const mounted = useMemo((): Mounted | null => {
    if (region === null) return null
    const [kind, id, from, ...moving] = pinKey.split('\n')
    const pinnedNodes = new Set(moving.map(idKey))
    if (kind === 'node' && id !== undefined) pinnedNodes.add(idKey(id))
    if (from !== undefined && from !== '') pinnedNodes.add(idKey(from))
    const next = mountedIn({
      doc,
      sizes,
      region,
      pinnedNodes,
      pinnedEdges: new Set(kind === 'edge' && id !== undefined ? [id] : []),
      pathOf: (edgeId) => {
        const lane = routesRef.current.lanes.get(edgeId)
        const bend = routesRef.current.bends.get(edgeId)
        return { lane, bend }
      },
    })
    const last = lastRef.current
    if (last !== null && sameMounted(last, next)) return last
    lastRef.current = next
    return next
    // sized：尺寸表是同一个 Map，量出新尺寸时靠它重挑。
  }, [doc, region, pinKey, sizes, sized])
  const shownNodes = useMemo(
    () => (mounted === null ? nodes : nodes.filter((node) => mounted.nodes.has(idKey(node.id)))),
    [nodes, mounted],
  )
  const shownEdges = useMemo(
    () => (mounted === null ? edges : edges.filter((edge) => mounted.edges.has(edge.id))),
    [edges, mounted],
  )
  return { nodes: shownNodes, edges: shownEdges }
}
