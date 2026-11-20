/**
 * dsh-workflow-lite — 「运行实例」页「画布」页签里那张小图：只画步骤和步骤之间的线，排版、走线都和画布用同一套。
 *
 * - 排版：把图里的步骤和流程线单拿出来，交给画布「整理」用的 {@link tidy}（ELK，列 = 执行批次），
 *   卡片按小图的尺寸喂进去；列距换成小图的列距（为判定牌子多拉开的那一截照留），行距本来就按卡片高度排，不用再收。
 * - 走线：画布的 {@link routeEdge} 挑走法——往右的贝塞尔（{@link flowPath}，同一对卡片之间几条画成一条、判定叠开），
 *   压到卡片的改走直角（{@link bypass}），往回走的循环绕到走廊上（{@link detour}）。
 *
 * 卡片、判定的坐标是小图自己的（左上角留了边），连线的路径整体挪 `shift`；框宽变了外面整体缩放，不重排。分支上写判定，走过的线（`takenEdges`）标出来。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/runMap
 */

import { analyzeGraph, edgeWhen } from '../../../../shared/graph.ts'
import { idKey, isStep } from '../../../../shared/model.ts'
import { edgeKind, nodeIndex } from '../../../../shared/resources.ts'
import type { WorkflowDocument } from '../../../../shared/types.ts'
import { COL_STEP, tidy } from '../../../model/layout.ts'
import { flowPath, type Rect, stackChips } from '../../../model/route.ts'
import { bypass, detour, laneStart, routeEdge } from '../../canvas/lines/route.ts'

/** 小图上一张卡片多大：只放状态图标和名字（放不下就截断，悬停看全名）。 */
export const MAP_CARD = { w: 84, h: 28 } as const
/**
 * 小图的列距：卡片宽 + 列间的空。空要比往回走的线从出口伸出去的那一截（`LOOP_REACH`）宽，
 * 循环线竖着下去时才落在列间、不擦过下一列的卡片；也放得下线上的判定牌子。
 */
const MAP_COL = MAP_CARD.w + 72
/** 四周留的边；上边多留一行给左上角的计数、右上角的按钮。 */
const PAD = { x: 16, top: 44, bottom: 18 } as const

export interface MapCard {
  id: string
  /** 左上角（小图坐标）。 */
  x: number
  y: number
}

export interface MapLine {
  id: string
  source: string
  target: string
  /** SVG 路径（排版坐标：画的时候整体挪 {@link RunMap.shift}）。 */
  path: string
  /** 分支上的判定（有才有），写在 `mid`（小图坐标）。 */
  when?: string
  mid: { x: number; y: number }
  taken: boolean
}

export interface RunMap {
  width: number
  height: number
  /** 排版坐标挪到小图坐标要加多少（连线的路径整体挪）。 */
  shift: { x: number; y: number }
  cards: MapCard[]
  lines: MapLine[]
}

/** 排出小图；`taken` 是走过的连线。 */
export async function runMap(doc: WorkflowDocument, taken: ReadonlySet<string>): Promise<RunMap> {
  const steps = doc.nodes.filter(isStep)
  if (steps.length === 0) {
    return { width: 0, height: PAD.top + PAD.bottom, shift: { x: 0, y: 0 }, cards: [], lines: [] }
  }
  const index = nodeIndex(doc)
  const flows = doc.edges.filter((edge) => edgeKind(index, edge) === 'flow')
  const sub: WorkflowDocument = { ...doc, nodes: steps, edges: flows }
  const placed = await tidy(sub, analyzeGraph(sub), () => ({
    width: MAP_CARD.w,
    height: MAP_CARD.h,
  }))
  // 列距收成小图的：整理在挂着判定牌子的两列之间多拉开的那一截原样留着（牌子在小图上一样宽）。
  const lefts = [...new Set(steps.map((node) => Math.round((placed[node.id] ?? node.position).x)))]
  lefts.sort((a, b) => a - b)
  const columnX = new Map<number, number>()
  lefts.forEach((x, i) => {
    const before = lefts[i - 1]
    const at = before === undefined ? 0 : (columnX.get(before) ?? 0)
    columnX.set(x, before === undefined ? 0 : at + MAP_COL + Math.max(0, x - before - COL_STEP))
  })
  const rects = new Map<string, Rect>()
  for (const node of steps) {
    const at = placed[node.id] ?? node.position
    const x = columnX.get(Math.round(at.x)) ?? 0
    rects.set(idKey(node.id), { x, y: at.y, w: MAP_CARD.w, h: MAP_CARD.h })
  }
  const boxes = [...rects.values()]

  // 先挑走法：同一对卡片之间的几条直连线画成一条，要一起算判定牌子怎么叠开。
  const routes = flows.map((edge) => ({ edge, route: routeEdge(edge, 'flow', rects, boxes) }))
  const pairs = new Map<string, { id: string; rows: number }[]>()
  for (const { edge, route } of routes) {
    if (route?.direct === undefined) continue
    const list = pairs.get(route.direct.pair) ?? []
    list.push({ id: edge.id, rows: route.direct.rows })
    pairs.set(route.direct.pair, list)
  }
  const chipShifts = new Map<string, number>()
  for (const list of pairs.values()) {
    const at = stackChips(list.map((item) => item.rows))
    for (const [i, item] of list.entries()) chipShifts.set(item.id, at[i] ?? 0)
  }

  const drawn = routes.flatMap(({ edge, route }) => {
    const from = rects.get(idKey(edge.source))
    const to = rects.get(idKey(edge.target))
    if (from === undefined || to === undefined || route === null) return []
    const sx = from.x + from.w
    const sy = from.y + from.h / 2
    const tx = to.x
    const ty = to.y + to.h / 2
    const back = tx < sx + 8
    const [path, mx, my] = back
      ? detour(sx, sy, tx, ty, route.lane ?? laneStart(sy, ty))
      : route.lane === undefined
        ? flowPath(sx, sy, tx, ty)
        : bypass(sx, sy, tx, ty, route.lane)
    // 直连的线：牌子放在两列正中（小图的列间比画布窄，画布那个偏向终点的位置会压到下一张卡片）。
    const direct = !back && route.lane === undefined
    const y = my + (direct ? (chipShifts.get(edge.id) ?? 0) : 0)
    return [{ edge, path, mid: { x: direct ? (sx + tx) / 2 : mx, y }, lane: route.lane, back, sx }]
  })

  // 外框：卡片、走廊、往回走的线伸到出口右边的那一截、判定牌子。
  const xs = boxes.flatMap((box) => [box.x, box.x + box.w])
  const ys = boxes.flatMap((box) => [box.y, box.y + box.h])
  for (const line of drawn) {
    ys.push(line.mid.y - 12, line.mid.y + 12)
    if (line.lane !== undefined) ys.push(line.lane)
    if (line.back) xs.push(line.sx + 64)
  }
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const dx = PAD.x - minX
  const dy = PAD.top - minY
  return {
    width: Math.max(...xs) - minX + 2 * PAD.x,
    height: Math.max(...ys) - minY + PAD.top + PAD.bottom,
    shift: { x: dx, y: dy },
    cards: steps.flatMap((node) => {
      const rect = rects.get(idKey(node.id))
      return rect === undefined ? [] : [{ id: node.id, x: rect.x + dx, y: rect.y + dy }]
    }),
    // 走过的线排在后面画：同一对卡片之间的几条是同一条路径，走过的那条要盖在上面看得见。
    lines: [...drawn]
      .sort((a, b) => Number(taken.has(a.edge.id)) - Number(taken.has(b.edge.id)))
      .map(({ edge, path, mid }) => {
        const when = edgeWhen(edge)
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          path,
          mid: { x: mid.x + dx, y: mid.y + dy },
          taken: taken.has(edge.id),
          ...(when === undefined ? {} : { when }),
        }
      }),
  }
}
