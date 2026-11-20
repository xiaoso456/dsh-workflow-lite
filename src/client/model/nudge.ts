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
 * - 道的先后取交叉最少的那种：一条道两头拐出去的竖段，往上拐的会穿过摆在它上面、又横跨这个位置的道，
 *   往下拐的穿过摆在它下面的；先按线从哪边来、往哪边去排（从上面来的走上面那条道），再两两换位，
 *   换了交叉变少才换；
 * - 同一家（`family`，比如同一张卡上的几条总线干线）的几种颜色挨着摆、道距收窄，家与家之间留宽一点，
 *   一眼看得出哪几条线是一起的；
 * - 挂着牌子的横段占一条宽道（`thick`）：牌子比线粗得多，旁边另一种颜色的线离得不到半块牌子高，
 *   看着就像牌子挂在那条线上，所以这样的线也算挨着、要让到牌子外面去。
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
  /** 横段上挂着牌子时，牌子从线往上下各伸出多少（分道时别的颜色的线要让出这么宽）；不挂是 0。 */
  thick?: number
  /** 同一家的几种颜色分道时挨着摆成一束（同一张卡的总线干线）；不给就各自一家。 */
  family?: string
}

/** 平行道之间的距离、道离卡片边的最小距离、空当再窄时道距的下限。 */
const GAP = 7
/** 同一家的几条道之间、成束的家和别的道之间的距离。 */
const BUNDLE_GAP = 3
const FAMILY_GAP = 10
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
  /** 这段线往两边各占多宽（挂着牌子的横段；别的是 0）。 */
  thick: number
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
  const familyOf = new Map<string, string>()
  for (const track of tracks) {
    if (track.family !== undefined) familyOf.set(track.group, track.family)
  }
  for (const axis of ['h', 'v'] as const) {
    const segments = collect(
      points,
      axis,
      tracks.map((track) => (axis === 'h' ? (track.thick ?? 0) : 0)),
    )
    for (const cluster of clusters(segments, groupOf)) {
      spread(cluster, groupOf, familyOf, points, boxes, axis, moved)
    }
  }
  const result = new Map<string, [number, number][]>()
  for (const index of moved) {
    const track = tracks[index]
    if (track !== undefined) result.set(track.id, points[index] as [number, number][])
  }
  return result
}

function collect(
  points: [number, number][][],
  axis: 'h' | 'v',
  thick: readonly number[],
): Segment[] {
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
        thick: index === 0 || index + 1 === line.length - 1 ? 0 : (thick[track] ?? 0),
        side:
          ends.length === 0
            ? a[across]
            : ends.reduce((sum, point) => sum + point[across], 0) / ends.length,
      })
    }
  })
  return segments
}

/** 两段不同颜色的线至少隔多远：一个道距，挂着牌子的还要让出牌子。 */
function apart(a: Segment, b: Segment): number {
  return Math.max(GAP, a.thick + b.thick)
}

/**
 * 挨得太近又重叠的段连成簇（并查集）：同色的只有共线才连，不同颜色的离得不到 {@link apart} 就连
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
  const reach = GAP + 2 * Math.max(0, ...segments.map((segment) => segment.thick))
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
      if (distance > reach - 0.5) break
      if (a.track === b.track) continue
      if (distance > SAME && groupOf(a) === groupOf(b)) continue
      if (distance > apart(a, b) - 0.5) continue
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
  familyOf: ReadonlyMap<string, string>,
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
  const order = arrange(names, cluster, groupOf, familyOf, points, axis)
  names.splice(0, names.length, ...order)
  const family = (name: string): string => familyOf.get(name) ?? name
  const bundled = (name: string): boolean =>
    names.some((other) => other !== name && family(other) === family(name))

  // 这一簇能摆开的空当：每一段上下（左右）最近的卡片之间，取交集；挂着牌子的段还要让牌子碰不到卡片。
  let low = -Infinity
  let high = Infinity
  for (const segment of cluster) {
    const [from, to] = channel(segment, boxes, axis)
    low = Math.max(low, from + Math.max(MARGIN, segment.thick))
    high = Math.min(high, to - Math.max(MARGIN, segment.thick))
  }
  const count = names.length
  // 相邻两条道隔多远：一个道距，挂着牌子的让出牌子；空当不够就整体按比例压小（不小于下限）。
  const thickOf = (name: string): number =>
    Math.max(0, ...cluster.filter((s) => groupOf(s) === name).map((s) => s.thick))
  const steps = names.slice(1).map((name, index) => {
    const before = names[index] as string
    const gap =
      family(before) === family(name)
        ? BUNDLE_GAP
        : bundled(before) || bundled(name)
          ? FAMILY_GAP
          : GAP
    return Math.max(gap, thickOf(before) + thickOf(name))
  })
  const span = steps.reduce((sum, step) => sum + step, 0)
  if (Number.isFinite(low) && Number.isFinite(high) && high - low < span) {
    const scale = (high - low) / span
    for (const [index, step] of steps.entries()) steps[index] = Math.max(MIN_GAP, step * scale)
  }
  // 每种颜色一条道：以这一簇的中线为准摆开；有定住的颜色就以它的位置为准。
  const fixedAt = cluster.find((s) => s.fixed)?.at
  const middle = cluster.reduce((sum, s) => sum + s.at, 0) / cluster.length
  const offsets = [0]
  for (const step of steps) offsets.push((offsets.at(-1) as number) + step)
  const half = (offsets.at(-1) as number) / 2
  let lanes = offsets.map((offset) => middle + offset - half)
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

/**
 * 一簇里各种颜色的道从上到下（从左到右）的次序：交叉最少。
 * 每段两头拐出去的竖段（横）：往上拐的穿过摆在它上面、横跨这个位置的道，往下拐的穿过摆在它下面的。
 * 两条道之间的交叉只看它俩谁在上，所以总数是两两之和；同一家的先排成一块，块与块、块里的道各自
 * 从给的次序起两两换位，换了严格变少才换（相等就不动：没有可省的交叉时次序和原来一样）。
 */
function arrange(
  names: readonly string[],
  cluster: readonly Segment[],
  groupOf: (segment: Segment) => string,
  familyOf: ReadonlyMap<string, string>,
  points: [number, number][][],
  axis: 'h' | 'v',
): string[] {
  const along = axis === 'h' ? 0 : 1
  const across = 1 - along
  /** 每种颜色：它占的几段（横跨的范围）和拐出去的竖段（位置、往哪边）。 */
  const shape = new Map<string, { spans: [number, number][]; legs: [number, -1 | 1][] }>()
  for (const name of names) shape.set(name, { spans: [], legs: [] })
  for (const segment of cluster) {
    const own = shape.get(groupOf(segment))
    if (own === undefined) continue
    own.spans.push([segment.lo, segment.hi])
    const line = points[segment.track] as [number, number][]
    for (const [end, next] of [
      [segment.index, segment.index - 1],
      [segment.index + 1, segment.index + 2],
    ] as const) {
      const point = line[end]
      const beyond = line[next]
      if (point === undefined || beyond === undefined) continue
      const way = Math.sign(beyond[across] - segment.at)
      if (way !== 0) own.legs.push([point[along], way as -1 | 1])
    }
  }
  const covers = (name: string, x: number): boolean =>
    (shape.get(name)?.spans ?? []).some(([lo, hi]) => x > lo + 0.5 && x < hi - 0.5)
  /** `upper` 摆在 `lower` 前面（上面 / 左边）时两者之间有几处交叉。 */
  const cost = (upper: string, lower: string): number =>
    (shape.get(upper)?.legs ?? []).filter(([x, way]) => way > 0 && covers(lower, x)).length +
    (shape.get(lower)?.legs ?? []).filter(([x, way]) => way < 0 && covers(upper, x)).length
  const settle = <T>(list: T[], pair: (a: T, b: T) => number): T[] => {
    for (let pass = 0; pass < list.length * list.length; pass += 1) {
      let swapped = false
      for (let i = 0; i + 1 < list.length; i += 1) {
        const a = list[i] as T
        const b = list[i + 1] as T
        if (pair(b, a) < pair(a, b)) {
          list[i] = b
          list[i + 1] = a
          swapped = true
        }
      }
      if (!swapped) break
    }
    return list
  }
  const blocks: string[][] = []
  for (const name of names) {
    const family = familyOf.get(name)
    const block =
      family === undefined ? undefined : blocks.find((b) => familyOf.get(b[0] as string) === family)
    if (block === undefined) blocks.push([name])
    else block.push(name)
  }
  const blockCost = (a: string[], b: string[]): number =>
    a.reduce((sum, x) => sum + b.reduce((inner, y) => inner + cost(x, y), 0), 0)
  return settle(blocks, blockCost).flatMap((block) => settle(block, cost))
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
