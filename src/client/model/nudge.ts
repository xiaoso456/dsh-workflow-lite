/**
 * dsh-workflow-lite — 直角线分道（nudging）：不同颜色的线不叠在同一条道上。
 *
 * 每条直角线是各自挑路的（走廊、绕行折线），两条不同种类的线常常挑中同一条缝、同一条走廊，
 * 叠成一根分不清。这里在挑完路之后统一过一遍（libavoid 的 orthogonal nudging 那一步的简化版）：
 * - 找出**共线（或挨得不到一个道距）、又有一段重叠**的横段 / 竖段，连成一簇；
 * - 同一种颜色（`group`）的线可以继续合在一条道上（本来就是一类线，合着反而清爽）；
 * - 不同颜色的分到相邻的平行道上，道距 `GAP`，在这一簇所在的空当（上下 / 左右最近的卡片之间）里
 *   尽量居中摆开，空当窄就把道距压小；
 * - 只挪中间的段：接在连接点上的头尾两段不动，挪一段只是让它两头相邻的段变长 / 变短，线还是直角的；
 * - 道的先后按线从哪边来、往哪边去排（从上面来的走上面那条道），尽量不因为分道再多出交叉。
 *
 * 纯计算，不碰 DOM。
 * @module @xiaoso/dsh-workflow-lite/client/model/nudge
 */

import type { Rect } from './route.ts'

export interface Track {
  id: string
  /** 颜色类（同一类的线可以合道）。 */
  group: string
  /** 折点（含两头）。 */
  points: readonly [number, number][]
}

/** 平行道之间的距离、道离卡片边的最小距离、空当再窄时道距的下限。 */
const GAP = 7
const MARGIN = 4
const MIN_GAP = 3
/** 两段算"同一条道"的容差、算"重叠"要叠过的最短长度。 */
const SAME = 1.5
const OVERLAP = 6

interface Segment {
  track: number
  index: number
  /** 横段的 y / 竖段的 x。 */
  at: number
  lo: number
  hi: number
  /** 头尾两段接在连接点上，不能挪。 */
  fixed: boolean
  /** 这段两头接着的点在垂直方向上的平均位置（排道的先后用）。 */
  side: number
}

/**
 * 给一组直角线分道。返回挪过的线的新折点（没挪的不在结果里）；传进来的数组不改。
 * @param boxes - 卡片（道不能摆进卡片里）。
 */
export function nudge(
  tracks: readonly Track[],
  boxes: readonly Rect[],
): Map<string, [number, number][]> {
  const points = tracks.map((track) => track.points.map((point) => [...point] as [number, number]))
  const moved = new Set<number>()
  const groupOf = (segment: Segment): string => tracks[segment.track]?.group ?? ''
  for (const axis of ['h', 'v'] as const) {
    const segments = collect(points, axis)
    for (const cluster of clusters(segments, groupOf)) {
      spread(cluster, groupOf, points, boxes, axis, moved)
    }
  }
  const result = new Map<string, [number, number][]>()
  for (const index of moved) {
    const track = tracks[index]
    if (track !== undefined) result.set(track.id, points[index] as [number, number][])
  }
  return result
}

function collect(points: [number, number][][], axis: 'h' | 'v'): Segment[] {
  const along = axis === 'h' ? 0 : 1
  const across = 1 - along
  const segments: Segment[] = []
  points.forEach((line, track) => {
    for (let index = 0; index < line.length - 1; index += 1) {
      const a = line[index] as [number, number]
      const b = line[index + 1] as [number, number]
      if (Math.abs(a[across] - b[across]) > 0.01 || Math.abs(a[along] - b[along]) < 0.01) continue
      const before = line[index - 1]
      const after = line[index + 2]
      const ends = [before, after].filter((point) => point !== undefined) as [number, number][]
      segments.push({
        track,
        index,
        at: a[across],
        lo: Math.min(a[along], b[along]),
        hi: Math.max(a[along], b[along]),
        fixed: index === 0 || index + 1 === line.length - 1,
        side:
          ends.length === 0
            ? a[across]
            : ends.reduce((sum, point) => sum + point[across], 0) / ends.length,
      })
    }
  })
  return segments
}

/**
 * 挨得太近又重叠的段连成簇（并查集）：同色的只有共线才连，不同颜色的离得不到一个道距就连
 * （否则分道时把一条线挪到旁边另一种颜色的线身上）。只留至少两种颜色的簇。
 */
function clusters(segments: Segment[], groupOf: (segment: Segment) => string): Segment[][] {
  const order = segments
    .map((_, index) => index)
    .sort((a, b) => {
      const left = segments[a] as Segment
      const right = segments[b] as Segment
      return left.at - right.at
    })
  const parent = segments.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root] as number
    parent[index] = root
    return root
  }
  for (let i = 0; i < order.length; i += 1) {
    const a = segments[order[i] as number] as Segment
    for (let j = i + 1; j < order.length; j += 1) {
      const b = segments[order[j] as number] as Segment
      const distance = b.at - a.at
      if (distance > GAP - 0.5) break
      if (a.track === b.track) continue
      if (distance > SAME && groupOf(a) === groupOf(b)) continue
      if (Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) < OVERLAP) continue
      parent[find(order[i] as number)] = find(order[j] as number)
    }
  }
  const groups = new Map<number, Segment[]>()
  segments.forEach((segment, index) => {
    const root = find(index)
    const list = groups.get(root) ?? []
    list.push(segment)
    groups.set(root, list)
  })
  return [...groups.values()].filter((list) => new Set(list.map(groupOf)).size > 1)
}

function spread(
  cluster: Segment[],
  groupOf: (segment: Segment) => string,
  points: [number, number][][],
  boxes: readonly Rect[],
  axis: 'h' | 'v',
  moved: Set<number>,
): void {
  const names = [...new Set(cluster.map(groupOf))]
  if (names.length < 2) return
  // 定住的颜色：有头尾段（挪不动）在这一簇里，它就待在原处。两种颜色都定住就分不开，整簇不动。
  const pinned = names.filter((name) => cluster.some((s) => s.fixed && groupOf(s) === name))
  if (pinned.length > 1) return
  const sideOf = (name: string): number => {
    const own = cluster.filter((s) => groupOf(s) === name)
    return own.reduce((sum, s) => sum + s.side, 0) / own.length
  }
  names.sort((a, b) => sideOf(a) - sideOf(b) || (a < b ? -1 : a > b ? 1 : 0))

  // 这一簇能摆开的空当：每一段上下（左右）最近的卡片之间，取交集。
  let low = -Infinity
  let high = Infinity
  for (const segment of cluster) {
    const [from, to] = channel(segment, boxes, axis)
    low = Math.max(low, from + MARGIN)
    high = Math.min(high, to - MARGIN)
  }
  const count = names.length
  let gap = GAP
  if (Number.isFinite(low) && Number.isFinite(high) && high - low < gap * (count - 1)) {
    gap = Math.max(MIN_GAP, (high - low) / (count - 1))
  }
  // 每种颜色一条道：以这一簇的中线为准摆开；有定住的颜色就以它的位置为准。
  const fixedAt = cluster.find((s) => s.fixed)?.at
  const middle = cluster.reduce((sum, s) => sum + s.at, 0) / cluster.length
  let lanes = names.map((_, index) => middle + (index - (count - 1) / 2) * gap)
  if (fixedAt !== undefined) {
    const shift = fixedAt - (lanes[names.indexOf(pinned[0] as string)] as number)
    lanes = lanes.map((lane) => lane + shift)
  } else {
    // 整组在空当里挪一挪，别伸出空当。
    const first = lanes[0] as number
    const last = lanes[count - 1] as number
    if (Number.isFinite(low) && first < low) lanes = lanes.map((lane) => lane + (low - first))
    else if (Number.isFinite(high) && last > high) lanes = lanes.map((lane) => lane - (last - high))
  }
  const across = axis === 'h' ? 1 : 0
  for (const segment of cluster) {
    if (segment.fixed) continue
    const target = lanes[names.indexOf(groupOf(segment))] as number
    if (Math.abs(target - segment.at) < 0.01) continue
    const line = points[segment.track] as [number, number][]
    ;(line[segment.index] as [number, number])[across] = target
    ;(line[segment.index + 1] as [number, number])[across] = target
    moved.add(segment.track)
  }
}

/** 一段横（竖）线上下（左右）最近的卡片边：它能在这中间挪。压在卡片里的不算（本来就不该有）。 */
function channel(segment: Segment, boxes: readonly Rect[], axis: 'h' | 'v'): [number, number] {
  let from = -Infinity
  let to = Infinity
  for (const box of boxes) {
    const [start, size, cross, depth] =
      axis === 'h' ? [box.x, box.w, box.y, box.h] : [box.y, box.h, box.x, box.w]
    if (start + size <= segment.lo + 1 || start >= segment.hi - 1) continue
    if (cross + depth <= segment.at + 0.5) from = Math.max(from, cross + depth)
    else if (cross >= segment.at - 0.5) to = Math.min(to, cross)
  }
  return [from, to]
}

/** 走廊线上的一块条件牌子：挂在 `y` 这条走廊上，只能在 `from`..`to` 之间挪，原本想放在 `prefer`。 */
export interface Chip {
  id: string
  y: number
  from: number
  to: number
  prefer: number
  width: number
}

/** 两块牌子之间至少留多宽、上下离多近才算会叠上（牌子连同下面的交接标记大约这么高）。 */
const CHIP_GAP = 10
const CHIP_REACH = 34

/**
 * 走廊上的条件牌子错开摆：两条线并排走同一段走廊时（比如同一对步骤之间的「通过」和「未通过」），
 * 牌子原本落在同一个位置、一块压住另一块。按 id 依次摆，叠上了就沿着自己的走廊往两边挪，
 * 挪到走廊尽头都放不下就留在原处。返回每块牌子中心的 x。
 */
export function placeChips(chips: readonly Chip[]): Map<string, number> {
  const placed: { x: number; y: number; width: number }[] = []
  const result = new Map<string, number>()
  for (const chip of [...chips].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const fits = (x: number): boolean =>
      placed.every(
        (other) =>
          Math.abs(other.y - chip.y) >= CHIP_REACH ||
          Math.abs(other.x - x) >= (other.width + chip.width) / 2 + CHIP_GAP,
      )
    const low = Math.min(chip.from, chip.to) + chip.width / 2
    const high = Math.max(chip.from, chip.to) - chip.width / 2
    const step = chip.width / 2 + CHIP_GAP
    let x = chip.prefer
    if (!fits(x)) {
      x = chip.prefer
      for (let k = 1; k <= 40; k += 1) {
        const right = chip.prefer + k * step
        const left = chip.prefer - k * step
        if (right <= high && fits(right)) {
          x = right
          break
        }
        if (left >= low && fits(left)) {
          x = left
          break
        }
        if (right > high && left < low) break
      }
    }
    placed.push({ x, y: chip.y, width: chip.width })
    result.set(chip.id, x)
  }
  return result
}
