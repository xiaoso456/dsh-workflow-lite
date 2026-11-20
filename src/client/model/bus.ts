/**
 * dsh-workflow-lite — 总线：一张资源卡 / 输入卡摆在用到它的几个步骤上方时，它的读写线怎么走。
 *
 * 好几个步骤都读写同一份文档（台账、状态文档、每一步都要读的规范或提问）时，平常的走法
 * （左边进、右边出）总有一组线要从画布另一头绕回来。卡片在这些步骤上方时改走总线：
 * 从卡片底边的连接点竖着落到一条横线（干线）上，沿干线走到步骤正上方，再竖着落进步骤的上边。
 * 同一张卡的读线共用一条干线、写线共用一条干线（颜色不同，分道时摆在相邻的两条道上），
 * 看着就是一条横线挂着几根短竖线，不管步骤在它左边还是右边。
 *
 * 什么时候走总线只看位置：卡片底边比它连着的每个步骤（至少两个）的上边都高出一截，
 * 干线横跨的那一段里卡片下面也空着一截（不穿过任何卡）。
 * 干线贴着卡片走（卡片底边往下一小截），不放在空当正中：步骤上方那一截留给跳过几步的流程线和它们的牌子
 * （它们挑离步骤最近的走廊），两类线各占一条带，不搅在一起。
 * 整理（layout.ts）把这类文档摆到主线上方，用户手动挪过去的也一样走总线；挪到步骤下面就回到平常的走法。
 * 竖线落进步骤的那一截要是压着别的卡（比如主线上方的分支步骤、只被读的资料），这一条线照平常的走法。
 *
 * 纯计算，不碰 DOM。
 * @module @xiaoso/dsh-workflow-lite/client/model/bus
 */

import { idKey, isInput, isResource } from '../../shared/model.ts'
import { edgeKind, type nodeIndex } from '../../shared/resources.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import { type Anchor, type Rect, STEP_SPOTS, spotOf } from './route.ts'

/** 卡片底边至少比步骤上边高出这么多才走总线：竖线要有地方拐弯，干线要有地方分道。 */
export const BUS_ROOM = 40

/** 干线在卡片底边往下多远（几条干线挤在一起时由分道往下摆开）。 */
export const BUS_DROP = 18

/** 竖线离别的卡至少留这么宽（贴着卡边走也看着像穿过去）。 */
const DROP_CLEAR = 6

/**
 * 一张走总线的卡：干线的起始高度（卡片底边往下 {@link BUS_DROP}；几条干线挤在一起时由分道再摆开），
 * 和竖线落得下去的读线 / 写线（步骤的 idKey；读线落进步骤上边的读点，写线从上边的写点出来）。
 */
export interface Bus {
  trunk: number
  reads: ReadonlySet<string>
  writes: ReadonlySet<string>
}

/**
 * 走总线的卡片（idKey）→ 它的干线。
 * @param rects - 画布上每张卡片的矩形（idKey）。
 */
export function findBuses(
  doc: WorkflowDocument,
  index: ReturnType<typeof nodeIndex>,
  rects: ReadonlyMap<string, Rect>,
): Map<string, Bus> {
  const users = new Map<string, { reads: Set<string>; writes: Set<string> }>()
  for (const edge of doc.edges) {
    const kind = edgeKind(index, edge)
    if (kind !== 'read' && kind !== 'ask' && kind !== 'write') continue
    const write = kind === 'write'
    const card = idKey(write ? edge.target : edge.source)
    const step = idKey(write ? edge.source : edge.target)
    const node = index.get(card)
    if (node === undefined || (!isResource(node) && !isInput(node))) continue
    const ways = users.get(card) ?? { reads: new Set<string>(), writes: new Set<string>() }
    if (write) ways.writes.add(step)
    else ways.reads.add(step)
    users.set(card, ways)
  }
  const buses = new Map<string, Bus>()
  for (const [card, ways] of users) {
    const steps = new Set([...ways.reads, ...ways.writes])
    if (steps.size < 2) continue
    const box = rects.get(card)
    if (box === undefined) continue
    const bottom = box.y + box.h
    const spans = [...steps].map((step) => rects.get(step)).filter((rect) => rect !== undefined)
    if (spans.length === 0) continue
    // 每个步骤都得在卡片下面留出一截。
    if (Math.min(...spans.map((rect) => rect.y)) - bottom < BUS_ROOM) continue
    // 干线横跨的这一段里，卡片下面最高的那张卡（多半是步骤，也可能是摆在主线上方的资料）：干线在它上面。
    const left = Math.min(box.x, ...spans.map((rect) => rect.x))
    const right = Math.max(box.x + box.w, ...spans.map((rect) => rect.x + rect.w))
    let top = Infinity
    for (const [key, other] of rects) {
      if (key === card || other.y < bottom || other.x >= right || other.x + other.w <= left)
        continue
      top = Math.min(top, other.y)
    }
    if (top - bottom < BUS_ROOM) continue
    const trunk = bottom + BUS_DROP
    const clear = (list: ReadonlySet<string>, spot: 'readTop' | 'fileUp'): Set<string> =>
      new Set(
        [...list].filter((step) => {
          const rect = rects.get(step)
          return rect !== undefined && dropIsClear(rect, spot, trunk, [step, card], rects)
        }),
      )
    buses.set(card, {
      trunk,
      reads: clear(ways.reads, 'readTop'),
      writes: clear(ways.writes, 'fileUp'),
    })
  }
  return buses
}

/** 从干线竖着落进步骤上边那个点的一截，有没有压着别的卡（`ends` 是线两头的卡，不算）。 */
function dropIsClear(
  step: Rect,
  spot: 'readTop' | 'fileUp',
  trunk: number,
  ends: readonly string[],
  rects: ReadonlyMap<string, Rect>,
): boolean {
  const x = spotOf(step, STEP_SPOTS[spot]).x
  for (const [key, other] of rects) {
    if (ends.includes(key)) continue
    const across = other.x - DROP_CLEAR < x && x < other.x + other.w + DROP_CLEAR
    const between = other.y + other.h > trunk && other.y < step.y
    if (across && between) return false
  }
  return true
}

/**
 * 一条总线上的线：竖着出去、沿干线横着走、竖着进去（两头对齐时就是一根竖线）。
 * @param from / to - 线的两头（卡片底边的点 / 步骤上边的点，看线往哪个方向走）。
 * @param trunk - 干线的高度。
 */
export function busPoints(from: Anchor, to: Anchor, trunk: number): [number, number][] {
  if (Math.abs(from.x - to.x) < 0.5) {
    return [
      [from.x, from.y],
      [to.x, to.y],
    ]
  }
  return [
    [from.x, from.y],
    [from.x, trunk],
    [to.x, trunk],
    [to.x, to.y],
  ]
}
