/**
 * dsh-workflow-lite — 定时规则「接下来几次」怎么写：每次一行（哪天、星期几、几点），本机时区怎么说，
 * 以及一条 cron 换成人话是哪句。纯计算，给「触发方式」对话框的右栏和 cron 输入框下面用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerUpcoming
 */

import { cronAsSimple, upcomingFires } from '../../shared/schedule.ts'
import type { TriggerSchedule } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { clockTime, shortTime } from './time.ts'
import { ruleText, weekdayText } from './triggerText.ts'

/** 列几次。 */
export const UPCOMING_COUNT = 5

/** 接下来的一次。 */
export interface UpcomingRow {
  at: number
  /** 今天、明天，再远是 `11-16`。 */
  day: string
  /** 周几。 */
  weekday: string
  /** `02:30`。 */
  clock: string
}

function dayStart(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function upcomingRow(t: T, at: number, now: number): UpcomingRow {
  const ahead = Math.round((dayStart(at) - dayStart(now)) / 86_400_000)
  const date = new Date(at)
  // ISO 星期：周一 1 … 周日 7。
  const weekday = date.getDay() === 0 ? 7 : date.getDay()
  return {
    at,
    day:
      ahead === 0
        ? t('trigger.upcoming.today')
        : ahead === 1
          ? t('trigger.upcoming.tomorrow')
          : shortTime(at).slice(0, 5),
    weekday: t('trigger.upcoming.weekday').replace('{day}', weekdayText(t, weekday)),
    clock: clockTime(at),
  }
}

/**
 * 接下来几次（规则写得不对、轮不到时是空的）。
 * @param live - 卡片开着时宿主排好的下一次：「每隔多久」从打开开关那一刻起算，有它就从它往后排；
 *   没有（卡片关着、或草稿改过）就当现在打开。
 */
export function upcomingRows(
  t: T,
  schedule: TriggerSchedule,
  now: number,
  live?: number,
): UpcomingRow[] {
  const fires =
    schedule.kind === 'every' && live !== undefined && live > now
      ? [
          new Date(live),
          ...upcomingFires(schedule, new Date(live), UPCOMING_COUNT - 1, new Date(live)),
        ]
      : upcomingFires(schedule, new Date(now), UPCOMING_COUNT)
  return fires.map((fire) => upcomingRow(t, fire.getTime(), now))
}

/** 本机时区的写法：`UTC+8`、`UTC-3:30`、`UTC`。 */
export function zoneText(now: number): string {
  // getTimezoneOffset 是「UTC 减本地」的分钟数，东八区是 -480。
  const minutes = -new Date(now).getTimezoneOffset()
  if (minutes === 0) return 'UTC'
  const size = Math.abs(minutes)
  const rest = size % 60
  return `UTC${minutes > 0 ? '+' : '-'}${String(Math.floor(size / 60))}${
    rest === 0 ? '' : `:${String(rest).padStart(2, '0')}`
  }`
}

/** 一条 cron 换成人话（「工作日 09:00」「每 15 分钟」）；说不成一句话的是 `null`。 */
export function cronPhrase(t: T, expression: string): string | null {
  const simple = cronAsSimple(expression)
  return simple === null ? null : ruleText(t, simple)
}
