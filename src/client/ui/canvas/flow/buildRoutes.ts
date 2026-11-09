/**
 * dsh-workflow-lite — 画布上读写线的走法：每条线挂在哪两个连接点上、绕不绕行、并排的线怎么分道、牌子怎么错开。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/flow/buildRoutes
 */

import { edgeWhen } from '../../../../shared/graph.ts'
import { idKey } from '../../../../shared/model.ts'
import { edgeKind, nodeIndex, resolveHandoff } from '../../../../shared/resources.ts'
import type {
  Point,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from '../../../../shared/types.ts'
import { cardSize } from '../../../model/layout.ts'
import { type Chip, nudge, placeChips, type Track } from '../../../model/nudge.ts'
import type { Rect } from '../../../model/route.ts'
import { type Corridor, type EdgeRoute, routeEdge } from '../lines/route.ts'
import type { LaneShift } from '../types.ts'

/** 没在拖卡片时挑好的各条线的走法：拖动中没碰到的线照用（见 `buildRoutes`）。 */
export interface RouteBase {
  doc: WorkflowDocument
  sized: number
  routes: Map<string, EdgeRoute | null>
}

export interface RoutesInput {
  doc: WorkflowDocument
  /** 拖动中的临时坐标。 */
  dragging: Record<string, Point>
  /** 卡片尺寸量出来 / 变了就加一。 */
  sized: number
  /** React Flow 量出来的卡片尺寸（传 ref 本身：读的是调用那一刻的 `.current`）。 */
  measured: React.MutableRefObject<Map<string, { width: number; height: number }>>
  routeBase: React.MutableRefObject<RouteBase | null>
}

/**
 * 每条读写线挂在哪两个连接点上（按两张卡当下的位置挑，见 model/route.ts），
 * 以及每张卡上哪些点挂着线（备用的点只有挂上线才显示）。拖动中的卡按临时坐标算，线实时换点。
 */
export function buildRoutes({ doc, dragging, sized, measured, routeBase }: RoutesInput) {
  const index = nodeIndex(doc)
  const rectFor = (node: WorkflowNode): Rect => {
    const at = dragging[node.id] ?? node.position
    const size = measured.current.get(node.id)
    const nominal = cardSize(node)
    return {
      x: at.x,
      y: at.y,
      w: size?.width ?? nominal.w,
      h: size?.height ?? nominal.h,
    }
  }
  const handles = new Map<string, { source: string; target: string }>()
  const used = new Map<string, string[]>()
  const lanes = new Map<string, number>()
  /** 改走绕行直角折线的读写线：折点（含两头）。 */
  const bends = new Map<string, [number, number][]>()
  const rects = new Map(doc.nodes.map((node) => [idKey(node.id), rectFor(node)]))
  const boxes = [...rects.values()]
  /** 直角走的线（走廊线、绕行折线、写线的树干）：挑完路之后统一分道，不同颜色的不叠在一条道上。 */
  const tracks: Track[] = []
  const corridors = new Map<string, Corridor>()
  // 拖卡片时只给碰到的线重新挑路：两头有被拖的卡、或被拖的卡压到了它松手前的走法。
  // 其余的线沿用松手前那一份（被拖的卡离开后它们可能有更短的走法，松手时整张图重挑一次）。
  const movedIds = new Set(Object.keys(dragging).map(idKey))
  const base = routeBase.current
  const reuse =
    movedIds.size > 0 && base !== null && base.doc === doc && base.sized === sized
      ? base.routes
      : null
  const moved = [...movedIds].flatMap((id) => rects.get(id) ?? [])
  const picked = new Map<string, EdgeRoute | null>()
  for (const edge of doc.edges) {
    const cached = reuse?.get(edge.id)
    const route =
      cached !== undefined &&
      !movedIds.has(idKey(edge.source)) &&
      !movedIds.has(idKey(edge.target)) &&
      (cached === null || !cached.hitBy(moved))
        ? cached
        : routeEdge(edge, edgeKind(index, edge), rects, boxes)
    picked.set(edge.id, route)
    if (route === null) continue
    if (route.lane !== undefined) lanes.set(edge.id, route.lane)
    if (route.corridor !== undefined) corridors.set(edge.id, route.corridor)
    if (route.bend !== undefined) bends.set(edge.id, route.bend)
    if (route.track !== undefined) tracks.push(route.track)
    if (route.handles !== undefined) handles.set(edge.id, route.handles)
    for (const [nodeId, handle] of route.marks ?? []) {
      const list = used.get(idKey(nodeId)) ?? []
      if (!list.includes(handle)) list.push(handle)
      used.set(idKey(nodeId), list)
    }
  }
  if (movedIds.size === 0) routeBase.current = { doc, sized, routes: picked }
  const shifts = new Map<string, LaneShift>()
  for (const [id, points] of nudge(tracks, boxes)) {
    const corridor = corridors.get(id)
    if (corridor === undefined) {
      bends.set(id, points)
      continue
    }
    const [, outer, lane, inner] = points as [number, number][]
    if (outer === undefined || lane === undefined || inner === undefined) continue
    lanes.set(id, lane[1])
    shifts.set(id, { out: outer[0] - corridor.right, in: inner[0] - corridor.left })
  }
  // 并排走同一段走廊的线，牌子沿走廊错开，不一块压住一块。
  const chips: Chip[] = []
  for (const [id, corridor] of corridors) {
    const lane = lanes.get(id)
    if (lane === undefined || corridor.chip === null) continue
    const shift = shifts.get(id)
    const right = corridor.right + (shift?.out ?? 0)
    const left = corridor.left + (shift?.in ?? 0)
    chips.push({
      id,
      y: lane,
      from: left,
      to: right,
      prefer: corridor.back ? left + (right - left) * 0.3 : (left + right) / 2,
      width: corridor.chip,
    })
  }
  const labels = placeChips(chips)
  return { handles, used, lanes, bends, shifts, labels }
}

export type CanvasRoutes = ReturnType<typeof buildRoutes>

/** 两条线走法相关的部分一样吗：两头、条件（牌子宽度、分道颜色）、交接标记、读写方式。 */
function sameEdgeRoute(a: WorkflowEdge, b: WorkflowEdge): boolean {
  if (a === b) return true
  if (a.id !== b.id || a.source !== b.source || a.target !== b.target) return false
  if (edgeWhen(a) !== edgeWhen(b) || a.data?.update !== b.data?.update) return false
  const ha = resolveHandoff(a.data?.handoff)
  const hb = resolveHandoff(b.data?.handoff)
  return ha.result === hb.result && (ha.note === undefined) === (hb.note === undefined)
}

/**
 * 两份文档的走线是否一定相同：`buildRoutes` 只看卡片的 id、种类、位置、估算尺寸，和 {@link sameEdgeRoute} 里那几样。
 * 改提示词、标题、描述这类只动文字的编辑，走线不用重算——大图上全图走线一次要几十毫秒，每敲一个字都算就卡。
 */
export function sameRouting(a: WorkflowDocument, b: WorkflowDocument): boolean {
  if (a === b) return true
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false
  for (let i = 0; i < a.nodes.length; i += 1) {
    const x = a.nodes[i] as WorkflowNode
    const y = b.nodes[i] as WorkflowNode
    if (x === y) continue
    if (x.id !== y.id || x.type !== y.type) return false
    if (x.position.x !== y.position.x || x.position.y !== y.position.y) return false
    const sx = cardSize(x)
    const sy = cardSize(y)
    if (sx.w !== sy.w || sx.h !== sy.h) return false
  }
  for (let i = 0; i < a.edges.length; i += 1) {
    if (!sameEdgeRoute(a.edges[i] as WorkflowEdge, b.edges[i] as WorkflowEdge)) return false
  }
  return true
}
