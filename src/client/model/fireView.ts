/**
 * dsh-workflow-lite — 触发记录怎么看：一条记录算哪一类结果、时刻怎么写、按天分组、各类有几条。
 *
 * 纯计算，面板、工作流中心「触发」页和记录详情共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/fireView
 */

import type { FireRecord } from '../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { clockTime, shortTime } from './time.ts'

/** 结果的四类：发出去了但模型判断不需要的，从「已发出」里单独拿出来。 */
export type FireKind = 'sent' | 'skipped' | 'failed' | 'declined'

export const FIRE_KIND_TEXT: Record<FireKind, LocaleKey> = {
  sent: 'trigger.outcome.sent',
  skipped: 'trigger.outcome.skipped',
  failed: 'trigger.outcome.failed',
  declined: 'trigger.outcome.declined',
}

export const FIRE_CHANNEL_TEXT: Record<FireRecord['channel'], LocaleKey> = {
  schedule: 'trigger.channel.schedule',
  poll: 'trigger.channel.poll',
  listen: 'trigger.channel.listen',
  http: 'trigger.channel.http',
  after: 'trigger.channel.after',
  now: 'trigger.channel.now',
}

export function fireKind(record: Pick<FireRecord, 'outcome' | 'declined'>): FireKind {
  return record.declined === undefined ? record.outcome : 'declined'
}

/** 跳过、失败、不需要的原因；顺利发出去的没有。 */
export function fireWhy(record: Pick<FireRecord, 'reason' | 'declined'>): string | undefined {
  return record.declined ?? record.reason
}

/** 那一天零点（本地时间）。 */
export function dayOf(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** `at` 那天在 `now` 的几天前（0 今天、1 昨天；按日历日算，不按 24 小时）。 */
function daysAgo(at: number, now: number): number {
  return Math.round((dayOf(now) - dayOf(at)) / 86_400_000)
}

/** 一天的小标题：今天、昨天，再早是 `11-12`，不是今年的带上年份。 */
export function dayText(t: T, day: number, now: number): string {
  const ago = daysAgo(day, now)
  if (ago === 0) return t('trigger.fire.today')
  if (ago === 1) return t('trigger.fire.yesterday')
  const date = new Date(day)
  const monthDay = shortTime(day).slice(0, 5)
  return date.getFullYear() === new Date(now).getFullYear()
    ? monthDay
    : `${date.getFullYear()}-${monthDay}`
}

/** 不分组时一条记录的时刻：今天的只写 `09:22`，昨天写「昨天 02:30」，再早写 `11-12 02:30`。 */
export function fireWhen(t: T, at: number, now: number): string {
  const ago = daysAgo(at, now)
  if (ago === 0) return clockTime(at)
  if (ago === 1) return `${t('trigger.fire.yesterday')} ${clockTime(at)}`
  return shortTime(at)
}

/** 按天分组，保持原来的先后（记录本来新的在前，分出来的天也是新的在前）。 */
export function groupByDay(fires: readonly FireRecord[]): { day: number; fires: FireRecord[] }[] {
  const groups: { day: number; fires: FireRecord[] }[] = []
  for (const record of fires) {
    const day = dayOf(record.at)
    const last = groups[groups.length - 1]
    if (last !== undefined && last.day === day) last.fires.push(record)
    else groups.push({ day, fires: [record] })
  }
  return groups
}
