/**
 * dsh-workflow-lite — 触发卡片上的字：定时规则的一句话、下一次的时刻、状态。纯函数，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerText
 */

import type { TriggerSchedule } from '../../shared/types.ts'
import type { TriggerState, TriggerView } from '../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { shortTime } from './time.ts'

const DAY_KEYS: readonly LocaleKey[] = [
  'trigger.day.1',
  'trigger.day.2',
  'trigger.day.3',
  'trigger.day.4',
  'trigger.day.5',
  'trigger.day.6',
  'trigger.day.7',
]

/** 星期几的字（ISO：1 = 周一 … 7 = 周日）。 */
export function weekdayText(t: T, day: number): string {
  return t(DAY_KEYS[day - 1] ?? 'trigger.day.1')
}

/** 星期几的一组是不是正好这几天。 */
function sameDays(days: readonly number[], wanted: readonly number[]): boolean {
  return days.length === wanted.length && wanted.every((day) => days.includes(day))
}

/** 定时规则的一句话：「每 30 分钟」「每天 09:00」「工作日 09:00」「每周一、五 09:00」「cron 0 9 * * *」。 */
export function ruleText(t: T, schedule: TriggerSchedule): string {
  if (schedule.kind === 'every') {
    const { minutes } = schedule
    if (minutes > 0 && minutes % 1440 === 0) {
      return t('trigger.rule.days').replace('{n}', String(minutes / 1440))
    }
    if (minutes > 0 && minutes % 60 === 0) {
      return t('trigger.rule.hours').replace('{n}', String(minutes / 60))
    }
    return t('trigger.rule.minutes').replace('{n}', String(minutes))
  }
  if (schedule.kind === 'cron') {
    return t('trigger.rule.cron').replace('{expr}', schedule.expression.trim())
  }
  if (schedule.weekdays === undefined)
    return t('trigger.rule.daily').replace('{time}', schedule.time)
  // 最常见的两组有自己的说法（卡片上放得下）。
  if (sameDays(schedule.weekdays, [1, 2, 3, 4, 5])) {
    return t('trigger.rule.workdays').replace('{time}', schedule.time)
  }
  if (sameDays(schedule.weekdays, [6, 7])) {
    return t('trigger.rule.weekend').replace('{time}', schedule.time)
  }
  const days = schedule.weekdays.map((day) => weekdayText(t, day)).join(t('trigger.rule.sep'))
  return t('trigger.rule.weekly').replace('{days}', days).replace('{time}', schedule.time)
}

/** 一个时刻怎么说：今天、明天只说钟点，再远的带上月日。 */
export function momentText(t: T, at: number, now: number = Date.now()): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const today = new Date(now)
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const days = Math.floor((at - dayStart) / 86_400_000)
  if (days === 0) return t('trigger.today').replace('{time}', clock)
  if (days === 1) return t('trigger.tomorrow').replace('{time}', clock)
  return shortTime(at)
}

const STATE_TEXT: Record<TriggerState, LocaleKey> = {
  off: 'trigger.state.off',
  waiting: 'trigger.state.waiting',
  invalid: 'trigger.state.invalid',
  stopped: 'trigger.state.stopped',
  elsewhere: 'trigger.state.elsewhere',
  unavailable: 'trigger.state.unavailable',
}

/** 卡片、面板上的那一行状态：「等待中 · 下一次 明天 09:00」。还没读到状态时按关着算。 */
export function stateText(t: T, view: TriggerView | undefined, now: number = Date.now()): string {
  const state = view?.state ?? 'off'
  const label = t(STATE_TEXT[state])
  if (view?.next === undefined || (state !== 'waiting' && state !== 'elsewhere')) return label
  return `${label} · ${t('trigger.next').replace('{time}', momentText(t, view.next, now))}`
}
