/**
 * dsh-workflow-lite — 定时规则「接下来 7 天」的时间轴：从今天起每天一行，一天里哪几个时刻执行。
 * 纯计算，给「触发方式」对话框里的时间轴用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerWeek
 */

import { nextFire } from '../../shared/schedule.ts'
import type { TriggerSchedule } from '../../shared/types.ts'

/** 列几天。 */
export const WEEK_DAYS = 7
/** 一天里最多画几个点；再多就画成一条（「每 5 分钟」这类）。 */
export const DAY_DOTS_MAX = 48

export interface WeekDay {
  /** 这一天 0 点。 */
  start: number
  /** ISO 星期：周一 1 … 周日 7。 */
  weekday: number
  /** 几天后（今天 0）。 */
  ahead: number
  /** 这一天里各次执行在一天中的位置（0 = 0 点，1 = 24 点）；太密时是空的，看 {@link dense}。 */
  fires: number[]
  /** 已经过去的那几次（只有今天有；位置同 `fires`）。 */
  past: number[]
  /** 这一天执行的次数。 */
  count: number
  /** 太密，画成一条。 */
  dense: boolean
}

export interface Week {
  days: WeekDay[]
  /** 现在在今天里的位置。 */
  now: number
  /** 下一次执行：时刻、在第几天、在那一天里的位置；没有是 `undefined`。 */
  next: { at: number; ahead: number; spot: number } | undefined
  /** 从现在到第 7 天结束还要执行几次。 */
  upcoming: number
}

function dayStart(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** 第 `offset` 天的 0 点（按日历加，夏令时那天也对）。 */
function dayAfter(start: number, offset: number): number {
  const date = new Date(start)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset).getTime()
}

/**
 * 接下来 7 天的样子。
 * @param live - 卡片开着时宿主排好的下一次（「每隔多久」从打开开关那一刻起算，有它就从它排）；
 *   没有（关着、或草稿改过）就当现在打开。
 */
export function weekOf(schedule: TriggerSchedule, now: number, live?: number): Week {
  const today = dayStart(now)
  const end = dayAfter(today, WEEK_DAYS)
  const days: WeekDay[] = Array.from({ length: WEEK_DAYS }, (_, ahead) => {
    const start = dayAfter(today, ahead)
    const weekday = new Date(start).getDay() === 0 ? 7 : new Date(start).getDay()
    return { start, weekday, ahead, fires: [], past: [], count: 0, dense: false }
  })
  const place = (at: number): { day: WeekDay; spot: number } | undefined => {
    const index = days.findIndex((day, i) => at >= day.start && at < (days[i + 1]?.start ?? end))
    const day = days[index]
    if (day === undefined) return undefined
    const length = (days[index + 1]?.start ?? end) - day.start
    return { day, spot: (at - day.start) / length }
  }
  const add = (at: number, past: boolean): void => {
    const found = place(at)
    if (found === undefined) return
    found.day.count += 1
    if (found.day.count > DAY_DOTS_MAX) {
      found.day.dense = true
      found.day.fires = []
      found.day.past = []
    } else if (!found.day.dense) {
      ;(past ? found.day.past : found.day.fires).push(found.spot)
    }
  }
  // 「每隔多久」从打开那一刻起算，今天早些时候的说不准：只排往后的。别的规则把今天已经过去的也画出来。
  const every = schedule.kind === 'every'
  const anchor = every && live !== undefined && live > now ? live - schedule.minutes * 60_000 : now
  let from = new Date(every ? now : today - 1)
  let next: Week['next']
  let upcoming = 0
  // 最多走这么多步（一天最密也就 1440 次）。
  for (let step = 0; step < WEEK_DAYS * 1440 + 1; step += 1) {
    const fire = nextFire(schedule, from, new Date(anchor))
    if (fire === null || fire.getTime() >= end) break
    const at = fire.getTime()
    const past = at <= now
    if (!past) upcoming += 1
    if (!past && next === undefined) {
      const found = place(at)
      if (found !== undefined) next = { at, ahead: found.day.ahead, spot: found.spot }
    }
    add(at, past)
    from = fire
  }
  const length = dayAfter(today, 1) - today
  return { days, now: (now - today) / length, next, upcoming }
}
