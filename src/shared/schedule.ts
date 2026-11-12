/**
 * dsh-workflow-lite — 定时规则：每隔多久、每天（或每周几）几点、五段 cron。
 *
 * 解析、写得对不对、「严格晚于某一刻的下一次」、一句话的说法。纯函数，时间一律按本机时区。
 * 触发卡片数据的形状在 `trigger.ts`。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/schedule
 */

import type { TriggerSchedule } from './types.ts'

/** 「每隔多久」的上下限（分钟）。 */
export const EVERY_MIN = 1
export const EVERY_MAX = 7 * 24 * 60

function wholeIn(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined
}

/** `HH:mm`（24 小时制）→ 分钟数；写得不对是 `null`。 */
export function parseClock(text: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/u.exec(text.trim())
  if (match === null) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** 分钟数 → `HH:mm`。 */
export function formatClock(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

// ─────────────────────────────────────────────────────────────
// cron（五段：分 时 日 月 周）
// ─────────────────────────────────────────────────────────────

interface CronField {
  /** 这一段允许的取值。 */
  values: Set<number>
  /** 这一段以星号开头（星号，或星号加步长）：日和周都不是星号时，两者满足其一即可。 */
  star: boolean
}

export interface Cron {
  minute: CronField
  hour: CronField
  day: CronField
  month: CronField
  weekday: CronField
}

const CRON_RANGES: readonly [name: string, min: number, max: number][] = [
  ['分', 0, 59],
  ['时', 0, 23],
  ['日', 1, 31],
  ['月', 1, 12],
  ['周', 0, 7],
]

function parseCronField(text: string, name: string, min: number, max: number): CronField | string {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/u.exec(part)
    if (match === null) return `「${name}」这一段写得不对：${part === '' ? '空的' : part}`
    const [, range, stepText] = match
    const step = stepText === undefined ? 1 : Number(stepText)
    if (step < 1) return `「${name}」这一段的步长要大于 0：${part}`
    let from = min
    let to = max
    if (range !== '*') {
      const [low, high] = (range as string).split('-').map(Number) as [number, number | undefined]
      from = low
      // 「5/15」这种写法 = 从 5 起每隔 15。
      to = high ?? (stepText === undefined ? low : max)
    }
    if (from < min || to > max || from > to) {
      return `「${name}」这一段超出范围（${String(min)}–${String(max)}）：${part}`
    }
    for (let value = from; value <= to; value += step) values.add(value)
  }
  return { values, star: text.startsWith('*') }
}

/** 解析五段 cron；写得不对时回一句原因。周的 0 和 7 都是周日。 */
export function parseCron(expression: string): Cron | string {
  const parts = expression.trim().split(/\s+/u)
  if (expression.trim() === '') return 'cron 表达式是空的'
  if (parts.length !== 5)
    return `cron 表达式要写五段（分 时 日 月 周），现在是 ${String(parts.length)} 段`
  const fields: CronField[] = []
  for (const [index, part] of parts.entries()) {
    const [name, min, max] = CRON_RANGES[index] as [string, number, number]
    const field = parseCronField(part, name, min, max)
    if (typeof field === 'string') return field
    fields.push(field)
  }
  const [minute, hour, day, month, weekday] = fields as [
    CronField,
    CronField,
    CronField,
    CronField,
    CronField,
  ]
  if (weekday.values.delete(7)) weekday.values.add(0)
  return { minute, hour, day, month, weekday }
}

function cronDayMatches(cron: Cron, date: Date): boolean {
  if (!cron.month.values.has(date.getMonth() + 1)) return false
  const day = cron.day.values.has(date.getDate())
  const weekday = cron.weekday.values.has(date.getDay())
  // 日和周都限定了：满足其一即可（Vixie cron 的规矩）；否则两个都要满足。
  return !cron.day.star && !cron.weekday.star ? day || weekday : day && weekday
}

/** 最多往后找这么多天（一条规则四年都轮不到一次，当它永远不触发）。 */
const CRON_HORIZON_DAYS = 366 * 4 + 1

function nextCron(cron: Cron, after: Date): Date | null {
  const minutes = [...cron.minute.values].sort((a, b) => a - b)
  const hours = [...cron.hour.values].sort((a, b) => a - b)
  const day = new Date(after.getFullYear(), after.getMonth(), after.getDate())
  for (let offset = 0; offset < CRON_HORIZON_DAYS; offset += 1) {
    if (cronDayMatches(cron, day)) {
      for (const hour of hours) {
        for (const minute of minutes) {
          const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute)
          // 夏令时跳过去的时刻（那一天没有这个钟点）会被 Date 挪到别处：不算。
          if (at.getHours() !== hour || at.getMinutes() !== minute) continue
          if (at.getTime() > after.getTime()) return at
        }
      }
    }
    day.setDate(day.getDate() + 1)
  }
  return null
}

// ─────────────────────────────────────────────────────────────
// 定时规则
// ─────────────────────────────────────────────────────────────

const WEEKDAY_TEXT = ['一', '二', '三', '四', '五', '六', '日']

/** 定时规则的一句话说法（写进发给模型的话、触发记录里）。 */
export function scheduleText(schedule: TriggerSchedule): string {
  if (schedule.kind === 'every') {
    const { minutes } = schedule
    if (minutes % 1440 === 0) return `每 ${String(minutes / 1440)} 天`
    if (minutes % 60 === 0) return `每 ${String(minutes / 60)} 小时`
    return `每 ${String(minutes)} 分钟`
  }
  if (schedule.kind === 'cron') return `cron ${schedule.expression.trim()}`
  if (schedule.weekdays === undefined) return `每天 ${schedule.time}`
  const days = schedule.weekdays.map((day) => WEEKDAY_TEXT[day - 1]).join('、')
  return `每周${days} ${schedule.time}`
}

/** 规则写得不对时的一句原因；没问题是 `null`。 */
export function scheduleProblem(schedule: TriggerSchedule): string | null {
  if (schedule.kind === 'every') {
    return wholeIn(schedule.minutes, EVERY_MIN, EVERY_MAX) === undefined
      ? `间隔要是 ${String(EVERY_MIN)}–${String(EVERY_MAX)} 之间的整数分钟`
      : null
  }
  if (schedule.kind === 'daily') {
    return parseClock(schedule.time) === null ? `时间要写成 HH:mm：${schedule.time}` : null
  }
  const cron = parseCron(schedule.expression)
  if (typeof cron === 'string') return cron
  return nextCron(cron, new Date()) === null ? '这条 cron 规则永远不会触发' : null
}

/**
 * 严格晚于 `after` 的下一次触发时刻；规则写得不对、或永远轮不到时 `null`。
 * @param anchor - 「每隔多久」从哪一刻起算（打开开关的时刻、或上一次触发的时刻）；别的规则不看它。
 */
export function nextFire(
  schedule: TriggerSchedule,
  after: Date,
  anchor: Date = after,
): Date | null {
  if (scheduleProblem(schedule) !== null) return null
  if (schedule.kind === 'every') {
    const step = schedule.minutes * 60_000
    const start = anchor.getTime()
    if (after.getTime() < start) return new Date(start + step)
    const passed = Math.floor((after.getTime() - start) / step)
    return new Date(start + (passed + 1) * step)
  }
  if (schedule.kind === 'cron') {
    return nextCron(parseCron(schedule.expression) as Cron, after)
  }
  const clock = parseClock(schedule.time) as number
  const day = new Date(after.getFullYear(), after.getMonth(), after.getDate())
  for (let offset = 0; offset < 8; offset += 1) {
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, clock)
    // ISO 星期：周一 1 … 周日 7。
    const weekday = at.getDay() === 0 ? 7 : at.getDay()
    const allowed = schedule.weekdays === undefined || schedule.weekdays.includes(weekday)
    if (allowed && at.getTime() > after.getTime()) return at
    day.setDate(day.getDate() + 1)
  }
  return null
}
