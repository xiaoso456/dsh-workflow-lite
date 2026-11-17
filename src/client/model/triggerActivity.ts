/**
 * dsh-workflow-lite — 一张触发卡片最近怎样、接下来怎样：工作流中心「触发」页「概览」「时间线」的纯计算。
 *
 * - {@link tallyActivity}：近 7 天的几样数和「节律」（7 天 × 24 小时，从早到晚一天一行，每格这一小时里触发过几次、结果怎样），
 *   数和格子从宿主数好的同一份近况算（{@link rhythmSince} 起），对得上；模型判断不需要的算「已发出」（确实发进会话了）；
 * - {@link plannedHours}：定时规则今天还要触发的几个钟点（节律里画虚线圈）；
 * - {@link upcomingAt}：时间线「接下来」的几次（到点就执行的按规则排，带检查的是下一次检查）；
 * - {@link matchesOutcome}：时间线按结果筛选。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerActivity
 */

import { nextFire } from '../../shared/schedule.ts'
import type { TriggerSource } from '../../shared/types.ts'
import type { FireRecord, TriggerActivitySlot, TriggerView } from '../../shared/wire/trigger.ts'
import { dayOf } from './fireView.ts'
import { weekOf } from './triggerWeek.ts'

/** 节律看几天（含今天）。 */
export const RHYTHM_DAYS = 7
export const HOURS = 24

/** 统计、节律里的三类结果。 */
export type Outcome = 'sent' | 'skipped' | 'failed'
export const OUTCOMES: readonly Outcome[] = ['sent', 'skipped', 'failed']

/** 时间线的筛选：全部，或三类结果之一。 */
export type OutcomeFilter = 'all' | Outcome

/** 按结果筛选（模型判断不需要的发进会话了，记录上本来就是已发出；排队中的还没有结果，哪一类都不算）。 */
export function matchesOutcome(
  record: Pick<FireRecord, 'outcome'>,
  filter: OutcomeFilter,
): boolean {
  if (record.outcome === 'queued') return false
  return filter === 'all' || record.outcome === filter
}

/** 节律里的一格：这一小时触发了几次；颜色看最要紧的那次（失败 > 已发出 > 跳过）。 */
export interface RhythmCell {
  outcome: Outcome
  count: number
}

export interface FireTally {
  total: number
  counts: Record<Outcome, number>
  /** 一天一行，从早到晚（最后一行是今天，和日历一样往下走）；每天 24 格，没触发过的是 `null`。 */
  cells: (RhythmCell | null)[][]
  /** 各行那天的 0 点（和 `cells` 同序）。 */
  days: number[]
}

const RANK: Record<Outcome, number> = { failed: 3, sent: 2, skipped: 1 }

/** 第 `back` 天前的 0 点（按日历减，夏令时那天也对）。 */
function dayBefore(today: number, back: number): number {
  const date = new Date(today)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - back).getTime()
}

/** 节律最早的那天的 0 点（问宿主要近况从这里起）。 */
export function rhythmSince(now: number): number {
  return dayBefore(dayOf(now), RHYTHM_DAYS - 1)
}

/**
 * 近 {@link RHYTHM_DAYS} 天（今天和前 6 天）的触发：几样数和节律。更早的、比现在还晚的格子不算。
 * @param slots - 宿主按一小格（15 分钟）数好的次数；格子落在哪个钟点按本地时间算。
 */
export function tallyActivity(slots: readonly TriggerActivitySlot[], now: number): FireTally {
  const today = dayOf(now)
  const days = Array.from({ length: RHYTHM_DAYS }, (_, row) =>
    dayBefore(today, RHYTHM_DAYS - 1 - row),
  )
  const cells = days.map(() => Array.from({ length: HOURS }, (): RhythmCell | null => null))
  const counts: Record<Outcome, number> = { sent: 0, skipped: 0, failed: 0 }
  let total = 0
  for (const slot of slots) {
    if (slot.at > now || slot.count <= 0) continue
    const row = days.indexOf(dayOf(slot.at))
    if (row < 0) continue
    const { outcome } = slot
    counts[outcome] += slot.count
    total += slot.count
    const hour = new Date(slot.at).getHours()
    const line = cells[row] as (RhythmCell | null)[]
    const cell = line[hour] ?? null
    line[hour] =
      cell === null
        ? { outcome, count: slot.count }
        : {
            outcome: RANK[outcome] > RANK[cell.outcome] ? outcome : cell.outcome,
            count: cell.count + slot.count,
          }
  }
  return { total, counts, cells, days }
}

/**
 * 定时规则今天还要触发的钟点（0–23，去重、从早到晚）。一天里次数太多（「每 5 分钟」）时不画，回空的。
 * @param live - 卡片开着时宿主排好的下一次（「每隔多久」从它往后排）。
 */
export function plannedHours(source: TriggerSource, now: number, live?: number): number[] {
  if (source.kind !== 'schedule') return []
  const today = weekOf(source.schedule, now, live).days[0]
  if (today === undefined || today.dense) return []
  return [...new Set(today.fires.map((spot) => Math.min(HOURS - 1, Math.floor(spot * HOURS))))]
}

/**
 * 时间线「接下来」的几次（从早到晚，最多 `max` 次）：定时按规则排（开着时从宿主排好的下一次起），
 * 带检查的是下一次检查；被动的（监听、HTTP、接续）没有。关着、出了问题时没有。
 */
export function upcomingAt(
  source: TriggerSource,
  view: Pick<TriggerView, 'state' | 'next'> | undefined,
  now: number,
  max: number,
): number[] {
  if (view === undefined || (view.state !== 'waiting' && view.state !== 'elsewhere')) return []
  if (source.kind !== 'schedule') return []
  if (source.check !== undefined) return view.next === undefined ? [] : [view.next]
  const { schedule } = source
  const first = view.next ?? nextFire(schedule, new Date(now))?.getTime()
  if (first === undefined) return []
  const list = [first]
  // 「每隔多久」从排好的那一次起算，往后一次加一个间隔。
  const anchor = new Date(first)
  while (list.length < max) {
    const after = nextFire(schedule, new Date(list[list.length - 1] as number), anchor)
    if (after === null) break
    list.push(after.getTime())
  }
  return list
}
