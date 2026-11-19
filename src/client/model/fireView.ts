/**
 * dsh-workflow-lite — 触发记录怎么看：一条记录算哪一类结果、时刻怎么写、按天分组和每天的小标题、各类有几条。
 *
 * 纯计算，面板、工作流中心「触发」页和记录详情共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/fireView
 */

import type { FireRecord } from '../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { fallbackNote } from './sessionChoice.ts'
import { weekdayText } from './triggerText.ts'

/**
 * 结果的几类：发出去了但模型判断不需要的，从「已发出」里单独拿出来；排队中的还没有结果。
 */
export type FireKind = 'queued' | 'sent' | 'skipped' | 'failed' | 'declined'

/** 有了结果的几类（近况、筛选只数这些）。 */
export type SettledKind = Exclude<FireKind, 'queued'>

export const FIRE_KIND_TEXT: Record<FireKind, LocaleKey> = {
  queued: 'trigger.outcome.queued',
  sent: 'trigger.outcome.sent',
  skipped: 'trigger.outcome.skipped',
  failed: 'trigger.outcome.failed',
  declined: 'trigger.outcome.declined',
}

/** 结果的短名（列表里用；「模型判断不需要」写「不需要」）。 */
export const FIRE_KIND_SHORT: Record<FireKind, LocaleKey> = {
  queued: 'trigger.outcome.queued',
  sent: 'trigger.outcome.sent',
  declined: 'trigger.fire.declinedShort',
  skipped: 'trigger.outcome.skipped',
  failed: 'trigger.outcome.failed',
}

export const FIRE_CHANNEL_TEXT: Record<FireRecord['channel'], LocaleKey> = {
  schedule: 'trigger.channel.schedule',
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

/** 发出去了、但设的预设或模型没用上（回退了默认）时的那句；其余没有。 */
export function fireFallback(
  t: T,
  record: Pick<FireRecord, 'outcome' | 'agent'>,
): string | undefined {
  const fallbacks = record.agent?.fallbacks ?? []
  return record.outcome === 'sent' && fallbacks.length > 0
    ? fallbackNote(t, null, fallbacks)
    : undefined
}

/** 那一天零点（本地时间）。 */
export function dayOf(at: number): number {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** `at` 那天在 `now` 的几天前（0 今天、1 昨天、-1 明天；按日历日算，不按 24 小时）。 */
function daysAgo(at: number, now: number): number {
  return Math.round((dayOf(now) - dayOf(at)) / 86_400_000)
}

/** 「11月14日」。 */
function monthDayText(t: T, day: number): string {
  const date = new Date(day)
  return t('trigger.fire.monthDay')
    .replace('{m}', String(date.getMonth() + 1))
    .replace('{d}', String(date.getDate()))
}

/** 「周六」。 */
function weekText(t: T, day: number): string {
  const week = new Date(day).getDay()
  return t('trigger.fire.weekday').replace('{d}', weekdayText(t, week === 0 ? 7 : week))
}

/**
 * 一天的小标题：叫什么、旁边补一句。今天 / 昨天 / 明天旁边写日期和周几；前后六天里的叫周几、旁边写日期；
 * 再远的叫日期、旁边写周几（不是今年的再带上年份）。名字不带年份，放得进时间轴的时刻那一列。
 */
export function dayHead(t: T, day: number, now: number): { name: string; date: string } {
  const ago = daysAgo(day, now)
  const named: Partial<Record<number, LocaleKey>> = {
    0: 'trigger.fire.today',
    1: 'trigger.fire.yesterday',
    [-1]: 'trigger.fire.tomorrow',
  }
  const key = named[ago]
  if (key !== undefined)
    return { name: t(key), date: `${monthDayText(t, day)} ${weekText(t, day)}` }
  if (Math.abs(ago) < 7) return { name: weekText(t, day), date: monthDayText(t, day) }
  const year = new Date(day).getFullYear()
  const week = weekText(t, day)
  return {
    name: monthDayText(t, day),
    date:
      year === new Date(now).getFullYear()
        ? week
        : `${t('trigger.fire.year').replace('{y}', String(year))} ${week}`,
  }
}

/** 各类结果几条（模型判断不需要的单算一类；排队中的还没有结果，不数）。 */
export function countKinds(
  records: readonly Pick<FireRecord, 'outcome' | 'declined'>[],
): Record<SettledKind, number> {
  const counts: Record<SettledKind, number> = { sent: 0, declined: 0, skipped: 0, failed: 0 }
  for (const record of records) {
    const kind = fireKind(record)
    if (kind !== 'queued') counts[kind] += 1
  }
  return counts
}

/** 排队等了多久才发出去（毫秒）；没排过队的 `undefined`。 */
export function waited(record: Pick<FireRecord, 'at' | 'sentAt'>): number | undefined {
  return record.sentAt === undefined ? undefined : Math.max(0, record.sentAt - record.at)
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

/** 排着的（记录本来新的在前，这里倒过来：先收到的在前，就是轮到的先后）。 */
export function queuedFires(fires: readonly FireRecord[]): FireRecord[] {
  return fires.filter((record) => record.outcome === 'queued').reverse()
}

/** 有了结果的（排着的不算），保持原来的先后。 */
export function settledFires(fires: readonly FireRecord[]): FireRecord[] {
  return fires.filter((record) => record.outcome !== 'queued')
}

/** 排着的这一次排第几个（从 1 数）；不是排着的 `undefined`。 */
export function queuePlace(fires: readonly FireRecord[], id: string): number | undefined {
  const at = queuedFires(fires).findIndex((record) => record.id === id)
  return at < 0 ? undefined : at + 1
}
