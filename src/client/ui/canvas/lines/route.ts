/**
 * dsh-workflow-lite — 连线的路径与走法：圆角折线、写线与绕行线的路径，以及为每条线挑走廊、绕行点。
 *
 * 只有算术，不碰 React；线组件（LinkLine、FileLine、ConnectionLine）和画布共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/lines/route
 */

import { type InternalNode, Position } from '@xyflow/react'
import { edgeWhen } from '../../../../shared/graph.ts'
import { idKey } from '../../../../shared/model.ts'
import { type edgeKind, resolveHandoff } from '../../../../shared/resources.ts'
import type { WorkflowEdge } from '../../../../shared/types.ts'
import type { HandleLink } from '../../../model/connect.ts'
import { NODE_H, RES_H } from '../../../model/layout.ts'
import type { Track } from '../../../model/nudge.ts'
import {
  bezierBlocked,
  FILE_SPOTS,
  flowBlocked,
  freeLane,
  LOOP_REACH,
  nearestLane,
  type OrthoRoute,
  orthoRoute,
  pointsBlocked,
  type Rect,
  routeFileLink,
  STEP_SPOTS,
  type StepFileHandle,
  spotOf,
  writePoints,
} from '../../../model/route.ts'
import { whenKind } from '../../../model/whenKind.ts'
import type { LaneShift } from '../types.ts'

/** 折线从连接点伸出去多远再拐弯。 */
const ROUTE_PAD = 26
const ROUTE_RADIUS = 12

/** 把一串直角折点连成圆角路径。 */
function roundedPath(points: readonly [number, number][]): string {
  const first = points[0]
  if (first === undefined) return ''
  let d = `M ${first[0]} ${first[1]}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const [px, py] = points[index - 1] as [number, number]
    const [cx, cy] = points[index] as [number, number]
    const [nx, ny] = points[index + 1] as [number, number]
    // 圆角半径不超过相邻两段各自的一半，短段也不会被拐穿。
    const r = Math.min(
      ROUTE_RADIUS,
      Math.hypot(cx - px, cy - py) / 2,
      Math.hypot(nx - cx, ny - cy) / 2,
    )
    const inX = cx - Math.sign(cx - px) * r
    const inY = cy - Math.sign(cy - py) * r
    const outX = cx + Math.sign(nx - cx) * r
    const outY = cy + Math.sign(ny - cy) * r
    d += ` L ${inX} ${inY} Q ${cx} ${cy} ${outX} ${outY}`
  }
  const last = points[points.length - 1] as [number, number]
  return `${d} L ${last[0]} ${last[1]}`
}

/**
 * 写线：从步骤的写点竖着出去、横着进文件卡左边的直角折线（折点见 route.ts 的 `writePoints`）。
 * @returns `[路径, 标签 x, 标签 y]`：标签落在竖段（树干）的中间，绕行时落在横走的那段中间。
 */
export function writePath(
  sourceX: number,
  sourceY: number,
  sourcePosition: Position,
  targetX: number,
  targetY: number,
  cardH: number = RES_H,
): [string, number, number] {
  const points = writePoints(
    { x: sourceX, y: sourceY, side: sourcePosition === Position.Top ? 'top' : 'bottom' },
    { x: targetX, y: targetY },
    cardH,
  )
  const path = roundedPath(points)
  if (points.length === 3) return [path, sourceX, (sourceY + targetY) / 2]
  const [ax, ay] = points[1] as [number, number]
  const [bx] = points[2] as [number, number]
  return [path, (ax + bx) / 2, ay]
}

/**
 * 画布挑好的绕行折线（见 route.ts 的 `orthoRoute`）：两头换成 React Flow 量出来的连接点坐标
 * （和按卡片尺寸算的可能差一两个像素），伸出去的那一小段跟着对齐，线才严丝合缝地接在点上。
 * @returns `[路径, 标签 x, 标签 y]`：标签落在最长那一段的中间。
 */
export function routedPath(
  points: readonly [number, number][],
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): [string, number, number] {
  const fixed = points.map((point) => [...point] as [number, number])
  const snap = (end: number, next: number, x: number, y: number): void => {
    const at = fixed[end] as [number, number]
    const near = fixed[next] as [number, number] | undefined
    if (near !== undefined) {
      // 伸出去的那段是竖的就对齐 x，横的就对齐 y。
      if (near[0] === at[0]) near[0] = x
      else near[1] = y
    }
    fixed[end] = [x, y]
  }
  snap(0, 1, sourceX, sourceY)
  snap(fixed.length - 1, fixed.length - 2, targetX, targetY)
  let best = 0
  let mid: [number, number] = [sourceX, sourceY]
  for (let index = 1; index < fixed.length; index += 1) {
    const [ax, ay] = fixed[index - 1] as [number, number]
    const [bx, by] = fixed[index] as [number, number]
    const length = Math.abs(bx - ax) + Math.abs(by - ay)
    if (length > best) {
      best = length
      mid = [(ax + bx) / 2, (ay + by) / 2]
    }
  }
  return [roundedPath(fixed), mid[0], mid[1]]
}

/**
 * 走廊线上挂的东西（条件牌子、交接标记）大约多宽，错开牌子时用；什么都不挂是 `null`。
 * 「通过 / 未通过」画出来是翻译过的短词，按三个字算；牌子文字最宽 120px（见 `.linkLabel`）。
 */
function chipWidth(edge: WorkflowEdge, back: boolean): number | null {
  const when = edgeWhen(edge)
  const handoff = resolveHandoff(edge.data?.handoff)
  const mark = !handoff.result || handoff.note !== undefined ? 34 : 0
  if (when === undefined && !back) return mark === 0 ? null : mark
  let text = 0
  if (when === 'pass' || when === 'fail') text = 33
  else if (when !== undefined) {
    for (const char of when) text += (char.codePointAt(0) ?? 0) >= 0x2e80 ? 11 : 6.5
  }
  return Math.max(mark, 18 + Math.min(120, text) + (back ? 14 : 0))
}

/** 往回走的线从哪儿开始找走廊：两张卡上下错开时从两行中间找，挨在同一行时从两张卡下方找。 */
export function laneStart(sy: number, ty: number): number {
  return Math.abs(ty - sy) > NODE_H + 40 ? (sy + ty) / 2 : Math.max(sy, ty) + NODE_H / 2 + 18
}

/** 走廊线按卡片算出来的出口 / 入口位置（分道之后据此换算竖段挪了多少）。 */
export interface Corridor {
  right: number
  left: number
  back: boolean
  chip: number | null
}

/** 一条线挑好的走法（分道之前）。 */
export interface EdgeRoute {
  /** 走廊线横着走的那一段的 y。 */
  lane?: number
  corridor?: Corridor
  /** 读写线改走的绕行折线。 */
  bend?: [number, number][]
  /** 参与分道的直角线。 */
  track?: Track
  /** 读写线挂在哪两个连接点上，以及两张卡上各占了哪个点。 */
  handles?: { source: string; target: string }
  marks?: [string, string][]
  /** 别的卡挪到 `moved` 时这条线会不会被压到（拖卡片时据此决定要不要重新挑路）。 */
  hitBy: (moved: readonly Rect[]) => boolean
}

/** 挑一条线的走法；两头的卡不在 `rects` 里、或不是要挑路的线时返回 `null`。 */
export function routeEdge(
  edge: WorkflowEdge,
  kind: ReturnType<typeof edgeKind>,
  rects: ReadonlyMap<string, Rect>,
  boxes: readonly Rect[],
): EdgeRoute | null {
  if (kind === 'flow') {
    // 往回走的线（终点在出口左边）：挑一条不压到任何卡片的走廊。
    const from = rects.get(idKey(edge.source))
    const to = rects.get(idKey(edge.target))
    if (from === undefined || to === undefined) return null
    const sx = from.x + from.w
    const sy = from.y + from.h / 2
    const ty = to.y + to.h / 2
    let lane: number | undefined
    if (to.x >= sx + 8) {
      // 往右走：贝塞尔压到中间的卡片（跨列时常见）才改走直角，挑离终点那一行最近的走廊。
      const ends = [from, to]
      if (flowBlocked(boxes, sx, sy, to.x, ty, ends)) {
        lane = nearestLane(boxes, sx + LOOP_REACH, to.x - ROUTE_PAD, ty, ends)
      }
    } else {
      lane = freeLane(boxes, to.x - ROUTE_PAD, sx + LOOP_REACH, laneStart(sy, ty))
    }
    if (lane === undefined) {
      return { hitBy: (moved) => flowBlocked(moved, sx, sy, to.x, ty) }
    }
    const right = sx + LOOP_REACH
    const left = to.x - ROUTE_PAD
    const points: [number, number][] = [
      [sx, sy],
      [right, sy],
      [right, lane],
      [left, lane],
      [left, ty],
      [to.x, ty],
    ]
    return {
      lane,
      corridor: { right, left, back: to.x < sx + 8, chip: chipWidth(edge, to.x < sx + 8) },
      track: { id: edge.id, group: `when:${whenKind(edgeWhen(edge))}`, points },
      hitBy: (moved) => pointsBlocked(points, moved, []),
    }
  }
  if (kind !== 'write' && kind !== 'read' && kind !== 'ask') return null
  // 输入 → 步骤的走法和读资源一样（输入卡在这里就是一张"被读"的卡）。
  const way = kind === 'write' ? 'write' : 'read'
  const stepId = way === 'write' ? edge.source : edge.target
  const fileId = way === 'write' ? edge.target : edge.source
  const stepBox = rects.get(idKey(stepId))
  const fileBox = rects.get(idKey(fileId))
  if (stepBox === undefined || fileBox === undefined) return null
  const route = routeFileLink(way, stepBox, fileBox)
  let stepHandle: StepFileHandle = route.step
  // 平时的走法（写 = 树干直角，读 = 贝塞尔）压到别的卡片时，改走绕开卡片的直角折线；
  // 上下两个点都试一试，挑便宜的那条。
  const skip = [stepBox, fileBox]
  const fileEnd = spotOf(fileBox, FILE_SPOTS[route.file])
  const stepEnd = spotOf(stepBox, STEP_SPOTS[route.step])
  const simple = way === 'write' ? writePoints(stepEnd, fileEnd, fileBox.h) : null
  const blocked =
    simple === null
      ? fileBox.x + fileBox.w / 2 > stepBox.x + stepBox.w / 2 ||
        bezierBlocked(fileEnd, stepEnd, boxes, skip)
      : simple.length !== 3 || pointsBlocked(simple, boxes, skip)
  let bend: [number, number][] | undefined
  if (blocked) {
    const options: StepFileHandle[] = way === 'write' ? ['file', 'fileUp'] : ['read', 'readTop']
    let best: { handle: StepFileHandle; route: OrthoRoute } | null = null
    for (const handle of options) {
      const end = spotOf(stepBox, STEP_SPOTS[handle])
      const found =
        way === 'write'
          ? orthoRoute(end, fileEnd, boxes, stepBox, fileBox)
          : orthoRoute(fileEnd, end, boxes, fileBox, stepBox)
      if (found !== null && (best === null || found.cost < best.route.cost)) {
        best = { handle, route: found }
      }
    }
    if (best !== null) {
      stepHandle = best.handle
      bend = best.route.points
    }
  }
  const drawn = bend ?? (blocked ? null : simple)
  const access =
    kind === 'ask'
      ? 'ask'
      : kind === 'read'
        ? 'read'
        : edge.data?.update === true
          ? 'update'
          : 'produce'
  return {
    ...(bend === undefined ? {} : { bend }),
    ...(drawn === null ? {} : { track: { id: edge.id, group: `access:${access}`, points: drawn } }),
    handles:
      way === 'write'
        ? { source: stepHandle, target: route.file }
        : { source: route.file, target: stepHandle },
    marks: [
      [stepId, stepHandle],
      [fileId, route.file],
    ],
    hitBy: (moved) =>
      drawn !== null ? pointsBlocked(drawn, moved, []) : bezierBlocked(fileEnd, stepEnd, moved, []),
  }
}

/**
 * 往回走的线：从出口向右伸出去，拐到一条横向"走廊"上走回来，再从左边进入目标。
 * 走廊由画布按卡片的位置挑（`freeLane`：不压到任何卡片，包括步骤下面挂着的文件卡）；
 * 右边那条竖段让过出口下面那串文件卡多伸出来的一截。
 * @returns `[路径, 标签 x, 标签 y]`（标签落在走廊正中）。
 */
export function detour(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  lane: number,
  shift: LaneShift | null = null,
): [string, number, number] {
  const right = sx + LOOP_REACH + (shift?.out ?? 0)
  const left = tx - ROUTE_PAD + (shift?.in ?? 0)
  const path = roundedPath([
    [sx, sy],
    [right, sy],
    [right, lane],
    [left, lane],
    [left, ty],
    [tx, ty],
  ])
  // 标签放在走廊偏目标的一侧：正中间常常正好压在别的线的标签上。
  return [path, left + (right - left) * 0.3, lane]
}

/**
 * 往右走、但贝塞尔会压到中间某张卡片的线（跨列的线最常见）：改走直角，先横着出去到列间的空当，
 * 竖着到一条不压卡片的走廊，横着过去，再竖着对齐入口进去。
 * @returns `[路径, 标签 x, 标签 y]`（标签落在走廊正中）。
 */
export function bypass(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  lane: number,
  shift: LaneShift | null = null,
): [string, number, number] {
  const right = sx + LOOP_REACH + (shift?.out ?? 0)
  const left = tx - ROUTE_PAD + (shift?.in ?? 0)
  const points: [number, number][] = [
    [sx, sy],
    [right, sy],
    [right, lane],
    [left, lane],
    [left, ty],
    [tx, ty],
  ]
  // 走廊正好和某一头齐平时，那一头的拐弯就省掉（不留零长的段）。
  const kept = points.filter((point, index) => {
    const previous = points[index - 1]
    const next = points[index + 1]
    if (previous === undefined || next === undefined) return true
    const straight =
      (previous[0] === point[0] && point[0] === next[0]) ||
      (previous[1] === point[1] && point[1] === next[1])
    return !straight
  })
  return [roundedPath(kept), (right + left) / 2, lane]
}

/** 卡片在画布上的矩形（还没量出尺寸时按标称尺寸算）。 */
export function rectOf(node: InternalNode | undefined, width: number, height: number): Rect | null {
  if (node === undefined) return null
  const at = node.internals.positionAbsolute
  return {
    x: at.x,
    y: at.y,
    w: node.measured.width ?? width,
    h: node.measured.height ?? height,
  }
}

/** 把一次拖线摆正成 source → target（倒着从入口拖时两头对调）。 */
export function linkOf(
  fromNode: string,
  fromHandle: { id?: string | null; type: 'source' | 'target' },
  toNode: string,
  toHandle: string | null | undefined,
): HandleLink {
  return fromHandle.type === 'source'
    ? {
        source: fromNode,
        sourceHandle: fromHandle.id ?? null,
        target: toNode,
        targetHandle: toHandle,
      }
    : {
        source: toNode,
        sourceHandle: toHandle,
        target: fromNode,
        targetHandle: fromHandle.id ?? null,
      }
}
