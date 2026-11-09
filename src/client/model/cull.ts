/**
 * dsh-workflow-lite — 大图只挂视口附近的卡片和线：挂哪一块（区域）、什么时候换区域、区域里挂哪些。
 *
 * 宿主页面有条 `:has()` 规则，视图里插拔一个元素就是整页样式重算，重算的开销又和页面上的元素数成正比：
 * 几百张卡全挂着时，拖一张卡、平移一下、打开一张图都慢。只挂视口附近的一块，元素少了，每次重算就便宜。
 *
 * 和「每帧按视口重挑」的做法不同，这里的区域比视口大一圈（{@link MARGIN}）且**有滞后**：
 * 视口在区域里挪动时什么都不插拔（{@link decide} 判 `keep`）；挪到区域边上之前才当场换（`now`）；
 * 缩放了很多、偏离区域中心较远时等视口停下来再换（`later`）——插拔集中在停下来的那一刻，平移中几乎没有。
 *
 * 全是纯函数：画布那边（`ui/canvas/hooks/useCulling.ts`）只负责订视口、在停下来时重算。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/cull
 */

import { idKey } from '../../shared/model.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import { cardRect, type SizeTable } from './canvasGeometry.ts'
import type { Rect } from './route.ts'

/** 卡片数到这么多才只挂视口附近的（小图全挂，行为和以前一样）。 */
export const CULL_MIN_NODES = 50

/** 区域每边比视口多出视口宽 / 高的这么多倍。 */
export const MARGIN = 0.75

/** 区域每边至少还剩视口宽 / 高的这么多倍，不够就当场换区域。 */
const RESERVE = 0.25

/** 缩放变到区域那时的这么多倍以外（放大或缩小），停下来时换区域。 */
const ZOOM_DRIFT = 1.4

/** 视口中心偏离区域中心超过视口宽 / 高的这么多倍，停下来时换区域。 */
const CENTER_DRIFT = MARGIN / 2

/** 卡片四周多算的一圈（阴影、连接点、外挂的时间线、牌子），单位是画布坐标。 */
const CARD_PAD = 48

/** 线的外框在两张卡之外多算的一圈：绕行的线往右伸出去一段、拐弯处有圆角、牌子有宽度。 */
const LINE_PAD = 96

/** 画布坐标里的一块：看得见的视口，或要挂的区域。`zoom` 是算它时的缩放。 */
export interface Viewbox extends Rect {
  zoom: number
}

/** 视口在画布坐标里是哪一块（React Flow 的 `transform` 是 `[平移 x, 平移 y, 缩放]`）。 */
export function viewOf(
  transform: readonly [number, number, number],
  width: number,
  height: number,
): Viewbox {
  const [tx, ty, zoom] = transform
  return { x: -tx / zoom, y: -ty / zoom, w: width / zoom, h: height / zoom, zoom }
}

/** 给视口配一块区域：每边多出 {@link MARGIN}。 */
export function regionFor(view: Viewbox): Viewbox {
  const dx = view.w * MARGIN
  const dy = view.h * MARGIN
  return { x: view.x - dx, y: view.y - dy, w: view.w + dx * 2, h: view.h + dy * 2, zoom: view.zoom }
}

/** 换区域的时机：`keep` 不换；`later` 等视口停下来再换；`now` 当场换（快看到没挂的地方了）。 */
export type CullDecision = 'keep' | 'later' | 'now'

export function decide(view: Viewbox, region: Viewbox | null): CullDecision {
  if (region === null) return 'now'
  const rx = view.w * RESERVE
  const ry = view.h * RESERVE
  if (
    view.x - rx < region.x ||
    view.y - ry < region.y ||
    view.x + view.w + rx > region.x + region.w ||
    view.y + view.h + ry > region.y + region.h
  ) {
    return 'now'
  }
  const ratio = view.zoom / region.zoom
  if (ratio > ZOOM_DRIFT || ratio < 1 / ZOOM_DRIFT) return 'later'
  const cx = view.x + view.w / 2 - (region.x + region.w / 2)
  const cy = view.y + view.h / 2 - (region.y + region.h / 2)
  if (Math.abs(cx) > view.w * CENTER_DRIFT || Math.abs(cy) > view.h * CENTER_DRIFT) return 'later'
  return 'keep'
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function grow(rect: Rect, pad: number): Rect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 }
}

/** 线走过的地方（不含两头之外的那一圈 {@link LINE_PAD}）。 */
export interface LinePath {
  /** 走廊线横着走的那一段的 y。 */
  lane?: number | undefined
  /** 绕行折线的折点。 */
  bend?: readonly (readonly [number, number])[] | undefined
}

export interface MountInput {
  doc: Pick<WorkflowDocument, 'nodes' | 'edges'>
  sizes: SizeTable
  region: Rect
  /** 无论在不在区域里都挂着的卡片（选中的、正在拖的、正在连线的）。 */
  pinnedNodes: ReadonlySet<string>
  /** 无论在不在区域里都挂着的线（选中的）：它的两头一起挂着。 */
  pinnedEdges: ReadonlySet<string>
  /** 线的走法（走廊、折点）：线伸出两张卡外框的部分。 */
  pathOf(edgeId: string): LinePath | undefined
}

/** 要挂的卡片与线（都是 `idKey` 之后的 id）。 */
export interface Mounted {
  nodes: Set<string>
  edges: Set<string>
}

/**
 * 区域里要挂哪些：外框碰到区域的卡片和线、钉住的，以及挂着的线的两头
 * （React Flow 画一条线要两头的卡片都在；横穿视口的长线两头都在区域外，也照样挂上）。
 */
export function mountedIn(input: MountInput): Mounted {
  const { doc, sizes, region, pinnedNodes, pinnedEdges, pathOf } = input
  const nodes = new Set<string>()
  const boxes = new Map<string, Rect>()
  for (const node of doc.nodes) {
    const key = idKey(node.id)
    const box = cardRect(node, sizes)
    boxes.set(key, box)
    if (pinnedNodes.has(key) || overlaps(grow(box, CARD_PAD), region)) nodes.add(key)
  }
  const edges = new Set<string>()
  for (const edge of doc.edges) {
    const source = idKey(edge.source)
    const target = idKey(edge.target)
    const a = boxes.get(source)
    const b = boxes.get(target)
    if (a === undefined || b === undefined) continue
    let keep = pinnedEdges.has(edge.id) || (nodes.has(source) && nodes.has(target))
    if (!keep) {
      let left = Math.min(a.x, b.x)
      let top = Math.min(a.y, b.y)
      let right = Math.max(a.x + a.w, b.x + b.w)
      let bottom = Math.max(a.y + a.h, b.y + b.h)
      const path = pathOf(edge.id)
      if (path?.lane !== undefined) {
        top = Math.min(top, path.lane)
        bottom = Math.max(bottom, path.lane)
      }
      for (const [x, y] of path?.bend ?? []) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
      keep = overlaps(grow({ x: left, y: top, w: right - left, h: bottom - top }, LINE_PAD), region)
    }
    if (!keep) continue
    edges.add(edge.id)
    nodes.add(source)
    nodes.add(target)
  }
  return { nodes, edges }
}

/** 两次挑出来的一样吗（一样就沿用上一次交给 React Flow 的数组）。 */
export function sameMounted(a: Mounted, b: Mounted): boolean {
  if (a.nodes.size !== b.nodes.size || a.edges.size !== b.edges.size) return false
  for (const id of a.nodes) if (!b.nodes.has(id)) return false
  for (const id of a.edges) if (!b.edges.has(id)) return false
  return true
}
