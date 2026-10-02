/**
 * dsh-workflow-lite — 读写线挂在哪两个连接点上、怎么走。
 *
 * 画布的版式语法是「左右走流程，上下走文件」：步骤左右两侧只接步骤之间的线，读写线一律挂在
 * 步骤的上下边。文件卡和步骤卡一样「左进右出」：左边的空心圈接写入，右边的实心点拖出去是读取。
 * 每条线**都落在一个真实的连接点上**（点画在哪，线就接在哪），只是按两张卡当下的位置挑用哪一个：
 * - 写：文件在下方 = 步骤底边 `file` → 文件左边 `in`；文件在上方 = 步骤上边 `fileUp` → 文件左边 `in`；
 * - 读：文件右边 `out` 出发，步骤在上方落到它底边的 `read`，在下方落到上边的 `readTop`。
 *
 * 写线是直角折线：从步骤的写点竖着落下（升起）、拐个弯横着进文件卡的左边。一个步骤写的几份文件
 * 竖着挂在它下面，几条写线共用一根"树干"、各自分叉进自己的文件——像文件树，不会穿过别的卡片。
 *
 * 连接点在卡片边上的位置也定在这里（`STEP_SPOTS` / `FILE_SPOTS`），卡片组件照着摆，
 * 拖线预览照着算，三处永远一致。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/route
 */

export type Side = 'top' | 'right' | 'bottom' | 'left'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Anchor {
  x: number
  y: number
  side: Side
}

/** 一个连接点在卡片上的位置：在哪条边上、沿这条边走到几成处。 */
export interface Spot {
  side: Side
  at: number
}

/** 步骤上挂读写线的连接点（左 `in` / 右 `out` 是流程线的，不在这里）。 */
export type StepFileHandle = 'file' | 'fileUp' | 'read' | 'readTop'
/** 文件卡上的连接点：左进（被写）右出（被读）。 */
export type FileHandle = 'in' | 'out'

/**
 * 读点贴着左下角（读的文件多半来自左边的上游，从左边进来不用跨过自己的文件树），
 * 写点在它右边一点：那是文件树的树干，挂在下面的文件卡往右缩进、左边对着树干。
 * 上边的写点比底边的再靠右一点：同一列里下面的步骤往上写上面那个步骤的文件时，
 * 它的树干和上面那个步骤的树干错开，不会连成一根、看着像两个步骤连在了一起。
 */
export const STEP_SPOTS: Record<StepFileHandle, Spot> = {
  file: { side: 'bottom', at: 0.17 },
  fileUp: { side: 'top', at: 0.27 },
  read: { side: 'bottom', at: 0.075 },
  readTop: { side: 'top', at: 0.075 },
}

export const FILE_SPOTS: Record<FileHandle, Spot> = {
  in: { side: 'left', at: 0.5 },
  out: { side: 'right', at: 0.5 },
}

/** 两张卡上下"挨着"的容差：差这么点也算上下关系。 */
const TOUCH = 6

/** 写线从写点伸出去多远才拐弯 / 横着进文件卡前留多长。 */
export const WRITE_REACH = 22

/** 连接点在画布上的坐标。 */
export function spotOf(rect: Rect, spot: Spot): Anchor {
  switch (spot.side) {
    case 'top':
      return { x: rect.x + rect.w * spot.at, y: rect.y, side: 'top' }
    case 'bottom':
      return { x: rect.x + rect.w * spot.at, y: rect.y + rect.h, side: 'bottom' }
    case 'left':
      return { x: rect.x, y: rect.y + rect.h * spot.at, side: 'left' }
    case 'right':
      return { x: rect.x + rect.w, y: rect.y + rect.h * spot.at, side: 'right' }
  }
}

/** 文件在步骤下方（含并排时文件偏下）。 */
function fileIsBelow(step: Rect, file: Rect): boolean {
  if (file.y >= step.y + step.h - TOUCH) return true
  if (file.y + file.h <= step.y + TOUCH) return false
  return file.y + file.h / 2 >= step.y + step.h / 2
}

/**
 * 一条读写线挂在哪两个连接点上。
 * @param kind `'write'` 步骤 → 文件；`'read'` 文件 → 步骤。
 */
export function routeFileLink(
  kind: 'write' | 'read',
  step: Rect,
  file: Rect,
): { step: StepFileHandle; file: FileHandle } {
  const below = fileIsBelow(step, file)
  if (kind === 'write') return { step: below ? 'file' : 'fileUp', file: 'in' }
  return { step: below ? 'read' : 'readTop', file: 'out' }
}

/** 读写线两头的坐标（`from` 是线的起点：写 = 步骤，读 = 文件卡）——拖线预览用。 */
export function fileLinkEnds(
  kind: 'write' | 'read',
  step: Rect,
  file: Rect,
): { from: Anchor; to: Anchor } {
  const route = routeFileLink(kind, step, file)
  const stepEnd = spotOf(step, STEP_SPOTS[route.step])
  const fileEnd = spotOf(file, FILE_SPOTS[route.file])
  return kind === 'write' ? { from: stepEnd, to: fileEnd } : { from: fileEnd, to: stepEnd }
}

/**
 * 写线的折点：从步骤的写点竖着出去，横着从左边进文件卡。
 *
 * - 常见的情形（文件挂在步骤下方 / 上方、左边在树干右侧）：一个直角——竖着到文件那一行，横着进去；
 * - 否则绕一下：先竖着出去一小段，横着走到文件左边外侧，再竖着对齐入口、从左边进去；
 *   横走的那段若会穿过文件卡，就改从文件卡的另一侧绕过去。
 *
 * @param from 步骤上的写点（`side` 是 `bottom` 或 `top`）。
 * @param to 文件卡左边的入口。
 * @param fileH 文件卡的高度（绕行时要避开它）。
 */
export function writePoints(
  from: Anchor,
  to: { x: number; y: number },
  fileH: number,
): [number, number][] {
  const dir = from.side === 'top' ? -1 : 1
  const left = to.x - WRITE_REACH
  if (left >= from.x && (to.y - from.y) * dir >= WRITE_REACH) {
    return [
      [from.x, from.y],
      [from.x, to.y],
      [to.x, to.y],
    ]
  }
  let lane = from.y + dir * WRITE_REACH
  // 横走的一段只在文件卡在树干左边时才会扫过它：那时走廊要落在文件卡的上方或下方。
  const top = to.y - fileH / 2 - WRITE_REACH / 2
  const bottom = to.y + fileH / 2 + WRITE_REACH / 2
  if (left < from.x && lane > top && lane < bottom) lane = dir > 0 ? bottom : top
  return [
    [from.x, from.y],
    [from.x, lane],
    [left, lane],
    [left, to.y],
    [to.x, to.y],
  ]
}

// ─────────────────────────────────────────────────────────────
// 步骤之间的线
// ─────────────────────────────────────────────────────────────

/**
 * 往右走的流程线：一条三次贝塞尔。出口那头的控制柄拉得比入口那头长——线先横着走出一截、
 * 走到两列之间的空当里再拐下去（上来），不会斜着擦过出口下面挂着的那串文件卡（它们比步骤卡
 * 往右多伸出一截）。
 * @returns `[路径, 标签 x, 标签 y]`（曲线正中）。
 */
export function flowPath(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const [c1x, c2x] = flowControls(sx, tx)
  return [
    `M ${sx} ${sy} C ${c1x} ${sy} ${c2x} ${ty} ${tx} ${ty}`,
    (sx + 3 * c1x + 3 * c2x + tx) / 8,
    (sy + ty) / 2,
  ]
}

/** 流程线两个控制柄的横坐标（纵坐标分别与起点、终点齐平）。 */
function flowControls(sx: number, tx: number): [number, number] {
  const dx = Math.max(0, tx - sx)
  return [sx + Math.max(dx / 2, Math.min(dx + 28, 140)), tx - dx / 2]
}

/** 往回走的线：右边那条竖段离出口多远（要让过出口下面那串文件卡多伸出来的一截）。 */
export const LOOP_REACH = 64

/**
 * 往回走的线横着走回来的"走廊"放在哪：从 `from` 往下找第一条横穿 `[x1, x2]` 时不压到任何卡片的 y。
 * @param boxes 画布上的卡片（含文件卡）。
 */
export function freeLane(boxes: readonly Rect[], x1: number, x2: number, from: number): number {
  const gap = 18
  const [left, right] = x1 <= x2 ? [x1, x2] : [x2, x1]
  const across = boxes.filter((box) => box.x < right && box.x + box.w > left)
  let lane = from
  // 每被一张卡挡住就挪到它下沿之下，再从头查一遍（挪下去可能又撞上别的卡）。
  for (let moved = true; moved; ) {
    moved = false
    for (const box of across) {
      if (lane > box.y - gap && lane < box.y + box.h + gap) {
        lane = box.y + box.h + gap
        moved = true
      }
    }
  }
  return lane
}

/** 贝塞尔流程线（`flowPath` 的那条）会不会压到哪张卡片（不算两头自己的卡）。 */
export function flowBlocked(
  boxes: readonly Rect[],
  sx: number,
  sy: number,
  tx: number,
  ty: number,
): boolean {
  const [c1x, c2x] = flowControls(sx, tx)
  const inset = 4
  const inside = (x: number, y: number): boolean =>
    boxes.some(
      (box) =>
        x > box.x + inset &&
        x < box.x + box.w - inset &&
        y > box.y + inset &&
        y < box.y + box.h - inset,
    )
  // 两头各让出一点：起点 / 终点本来就贴在自己的卡片边上。
  for (let index = 1; index < 40; index += 1) {
    const t = index / 40
    const u = 1 - t
    const x = u ** 3 * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * tx
    const y = u ** 3 * sy + 3 * u * u * t * sy + 3 * u * t * t * ty + t ** 3 * ty
    if (x <= sx + 2 || x >= tx - 2) continue
    if (inside(x, y)) return true
  }
  return false
}

/**
 * 横穿 `[x1, x2]` 时不压到任何卡片、又离 `around` 最近的 y（往上往下都找）。
 * 候选就是 `around` 本身和每张挡路的卡片的上沿之上、下沿之下。
 */
export function nearestLane(
  boxes: readonly Rect[],
  x1: number,
  x2: number,
  around: number,
): number {
  const gap = 18
  const [left, right] = x1 <= x2 ? [x1, x2] : [x2, x1]
  const across = boxes.filter((box) => box.x < right && box.x + box.w > left)
  const clear = (y: number): boolean =>
    across.every((box) => y <= box.y - gap || y >= box.y + box.h + gap)
  const candidates = [
    around,
    ...across.flatMap((box) => [box.y - gap, box.y + box.h + gap]),
  ].filter(clear)
  return candidates.reduce(
    (best, y) => (Math.abs(y - around) < Math.abs(best - around) ? y : best),
    candidates[0] ?? around,
  )
}

// ─────────────────────────────────────────────────────────────
// 绕开卡片的直角走线（只给"简单走法会压到卡片"的读写线用）
// ─────────────────────────────────────────────────────────────

type Point2 = [number, number]

const DIRECTION: Record<Side, Point2> = {
  top: [0, -1],
  bottom: [0, 1],
  left: [-1, 0],
  right: [1, 0],
}

/** 从连接点先垂直伸出去多远再拐弯。 */
const STUB = 14
/** 线离卡片至少留多少（判断压没压到时把卡片往外扩这么多）。 */
const CLEAR = 6
/** 走廊贴着卡片边走时离边多远：步骤与文件之间 22px 的缝、文件与文件之间 14px 的缝都钻得过去。 */
const HUG = [11, 7] as const
/** 每多一个拐弯，相当于多走这么长：宁可绕远一点，也少拐弯。 */
const BEND_COST = 28

/** 一段横 / 竖线压没压到卡片（卡片往外扩 `pad`）。 */
function segmentHits(a: Point2, b: Point2, box: Rect, pad: number): boolean {
  const minX = Math.min(a[0], b[0])
  const maxX = Math.max(a[0], b[0])
  const minY = Math.min(a[1], b[1])
  const maxY = Math.max(a[1], b[1])
  return (
    maxX > box.x - pad &&
    minX < box.x + box.w + pad &&
    maxY > box.y - pad &&
    minY < box.y + box.h + pad
  )
}

/** 去掉零长的段和共线的中间点；出现原路折返就不要这条。 */
function simplify(points: readonly Point2[]): Point2[] | null {
  const out: Point2[] = []
  for (const point of points) {
    const last = out[out.length - 1]
    if (last !== undefined && last[0] === point[0] && last[1] === point[1]) continue
    out.push(point)
  }
  const kept: Point2[] = []
  for (const point of out) {
    const a = kept[kept.length - 2]
    const b = kept[kept.length - 1]
    if (a !== undefined && b !== undefined) {
      const dx1 = Math.sign(b[0] - a[0])
      const dy1 = Math.sign(b[1] - a[1])
      const dx2 = Math.sign(point[0] - b[0])
      const dy2 = Math.sign(point[1] - b[1])
      if (dx1 === -dx2 && dy1 === -dy2) return null
      if (dx1 === dx2 && dy1 === dy2) {
        kept[kept.length - 1] = point
        continue
      }
    }
    kept.push(point)
  }
  return kept
}

function pathLength(points: readonly Point2[]): number {
  let length = 0
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Point2
    const b = points[index] as Point2
    length += Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1])
  }
  return length
}

/** 代价 = 长度 + 拐弯（`points` 须已化简）。 */
function cost(points: readonly Point2[]): number {
  return pathLength(points) + BEND_COST * Math.max(0, points.length - 2)
}

/** 一条绕开卡片的直角走线：折点（含两头）与代价（长度 + 拐弯）。 */
export interface OrthoRoute {
  points: Point2[]
  cost: number
}

/**
 * 从 `start` 到 `end` 找一条不压到任何卡片的直角折线：两头都先垂直于所在的边伸出一小段，
 * 中间最多再拐三次，走在卡片之间的缝里。候选的竖道 / 横道取自附近卡片的四边外侧，
 * 按"长度 + 拐弯"从便宜到贵逐条检查，第一条走得通的就是答案；一条都走不通返回 `null`。
 * @param boxes 画布上所有卡片（含两头自己的卡片）。
 * @param startBox / endBox 两头自己的卡片：伸出去的那一小段本来就贴着它们。
 */
export function orthoRoute(
  start: Anchor,
  end: Anchor,
  boxes: readonly Rect[],
  startBox: Rect,
  endBox: Rect,
): OrthoRoute | null {
  const [sdx, sdy] = DIRECTION[start.side]
  const [edx, edy] = DIRECTION[end.side]
  const s: Point2 = [start.x, start.y]
  const e: Point2 = [end.x, end.y]
  const s1: Point2 = [start.x + sdx * STUB, start.y + sdy * STUB]
  const e1: Point2 = [end.x + edx * STUB, end.y + edy * STUB]
  // 候选的竖道 / 横道：两头伸出去的点，加上附近每张卡片四边外侧。
  const reach = 200
  const near = boxes.filter(
    (box) =>
      box.x < Math.max(s1[0], e1[0]) + reach &&
      box.x + box.w > Math.min(s1[0], e1[0]) - reach &&
      box.y < Math.max(s1[1], e1[1]) + reach &&
      box.y + box.h > Math.min(s1[1], e1[1]) - reach,
  )
  const xs = new Set<number>([s1[0], e1[0]])
  const ys = new Set<number>([s1[1], e1[1]])
  for (const box of near) {
    // 竖道只需一种离边距离（列与列之间的空当宽）；横道两种都要（要钻步骤和文件、文件和文件之间的缝）。
    xs.add(box.x - HUG[0])
    xs.add(box.x + box.w + HUG[0])
    for (const hug of HUG) {
      ys.add(box.y - hug)
      ys.add(box.y + box.h + hug)
    }
  }
  // 先试拐弯少的（一条竖道或一条横道），再试竖道 + 横道各一条的；后者只看比已找到的更便宜的。
  const simple: Point2[][] = [[[e1[0], s1[1]]], [[s1[0], e1[1]]]]
  for (const x of xs)
    simple.push([
      [x, s1[1]],
      [x, e1[1]],
    ])
  for (const y of ys)
    simple.push([
      [s1[0], y],
      [e1[0], y],
    ])
  const complex: Point2[][] = []
  for (const x of xs) {
    for (const y of ys) {
      complex.push([
        [x, s1[1]],
        [x, y],
        [e1[0], y],
      ])
      complex.push([
        [s1[0], y],
        [x, y],
        [x, e1[1]],
      ])
    }
  }
  /**
   * 按代价从低到高找第一条走得通的：先按"不算拐弯的长度"排（它是代价的下界），
   * 下界已经不比找到的更便宜就停——大部分候选根本不用展开检查。
   */
  const search = (middles: readonly Point2[][], under: number): OrthoRoute | null => {
    const bounded = middles
      .map((middle) => ({ middle, length: pathLength([s, s1, ...middle, e1, e]) }))
      .sort((a, b) => a.length - b.length)
    let best: OrthoRoute | null = null
    let limit = under
    for (const item of bounded) {
      if (item.length >= limit) break
      const points = simplify([s, s1, ...item.middle, e1, e])
      if (points === null) continue
      const total = cost(points)
      if (total >= limit || !clear(points)) continue
      best = { points, cost: total }
      limit = total
    }
    return best
  }
  const others = near.filter((box) => box !== startBox && box !== endBox)
  const clear = (points: readonly Point2[]): boolean => {
    for (let index = 1; index < points.length; index += 1) {
      const a = points[index - 1] as Point2
      const b = points[index] as Point2
      if (others.some((box) => segmentHits(a, b, box, CLEAR))) return false
      // 两头自己的卡片：只有贴着它的第一段 / 最后一段可以碰到它的边。
      if (index > 1 && segmentHits(a, b, startBox, 0)) return false
      if (index < points.length - 1 && segmentHits(a, b, endBox, 0)) return false
    }
    return true
  }
  const first = search(simple, Number.POSITIVE_INFINITY)
  return search(complex, first?.cost ?? Number.POSITIVE_INFINITY) ?? first
}

/** 一串直角折点压没压到哪张卡片（不算 `skip` 里的）。 */
export function pointsBlocked(
  points: readonly Point2[],
  boxes: readonly Rect[],
  skip: readonly Rect[],
): boolean {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Point2
    const b = points[index] as Point2
    if (boxes.some((box) => !skip.includes(box) && segmentHits(a, b, box, 2))) return true
  }
  return false
}

/**
 * React Flow 的贝塞尔（`getBezierPath`，曲率 0.25）压没压到哪张卡片（不算 `skip` 里的）：
 * 读线平时就用它画，只有压到卡片时才改走直角。
 */
export function bezierBlocked(
  from: Anchor,
  to: Anchor,
  boxes: readonly Rect[],
  skip: readonly Rect[],
): boolean {
  const offset = (distance: number): number =>
    distance >= 0 ? 0.5 * distance : 0.25 * 25 * Math.sqrt(-distance)
  const control = (anchor: Anchor, other: Anchor): Point2 => {
    switch (anchor.side) {
      case 'left':
        return [anchor.x - offset(anchor.x - other.x), anchor.y]
      case 'right':
        return [anchor.x + offset(other.x - anchor.x), anchor.y]
      case 'top':
        return [anchor.x, anchor.y - offset(anchor.y - other.y)]
      case 'bottom':
        return [anchor.x, anchor.y + offset(other.y - anchor.y)]
    }
  }
  const [c1x, c1y] = control(from, to)
  const [c2x, c2y] = control(to, from)
  for (let index = 2; index < 48; index += 1) {
    const t = index / 50
    const u = 1 - t
    const x = u ** 3 * from.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * to.x
    const y = u ** 3 * from.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * to.y
    // 两头自己的卡片只在线的两端豁免：绕一圈又压回自己的卡片上同样算挡路。
    const ends = t < 0.12 || t > 0.88
    const hit = boxes.some(
      (box) =>
        !(ends && skip.includes(box)) &&
        x > box.x &&
        x < box.x + box.w &&
        y > box.y &&
        y < box.y + box.h,
    )
    if (hit) return true
  }
  return false
}
