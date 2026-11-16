/**
 * dsh-workflow-lite — 定时规则：每隔多久、每天（或每周几）几点、五段 cron。
 *
 * 解析、写得对不对、「严格晚于某一刻的下一次」、一句话的说法。纯函数，时间一律按本机时区。
 * 触发卡片数据的形状在 `trigger.ts`。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/schedule
 */

import type { TriggerSchedule } from './types.ts'

/**
 * 「每隔多久」的上下限（秒）。这是规则本身的界限（带检查命令的定时最短 10 秒）；
 * 到点直接执行的最短 1 分钟，由 shared/trigger.ts 的 `sourceIssue` 另外管。
 */
export const EVERY_MIN = 10
export const EVERY_MAX = 7 * 24 * 3600

function wholeIn(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined
}

/** 秒数的一句话说法（「30 秒」「5 分钟」「2 小时」「1 天」）。 */
export function secondsText(seconds: number): string {
  if (seconds > 0 && seconds % 86_400 === 0) return `${String(seconds / 86_400)} 天`
  if (seconds > 0 && seconds % 3600 === 0) return `${String(seconds / 3600)} 小时`
  if (seconds > 0 && seconds % 60 === 0) return `${String(seconds / 60)} 分钟`
  return `${String(seconds)} 秒`
}

/** `HH:mm`（24 小时制）→ 分钟数；写得不对是 `null`。 */
export function parseClock(text: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/u.exec(text.trim())
  if (match === null) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** 「每天几点」一天里最多几个时刻。 */
export const DAILY_TIMES_MAX = 12

type DailySchedule = Extract<TriggerSchedule, { kind: 'daily' }>

/** 「每天几点」的各个时刻，照写着的顺序（第一个是 `time`，后面是 `moreTimes`）。 */
export function dailyTimes(schedule: DailySchedule): string[] {
  return [schedule.time, ...(schedule.moreTimes ?? [])]
}

/** 把时刻写回去：第一个进 `time`，其余进 `moreTimes`（没有就不写）；一个都没有时给 9 点。超出上限的丢掉。 */
export function withDailyTimes(schedule: DailySchedule, times: readonly string[]): DailySchedule {
  const [first = '09:00', ...rest] = times.slice(0, DAILY_TIMES_MAX)
  return {
    kind: 'daily',
    time: first,
    ...(rest.length === 0 ? {} : { moreTimes: rest }),
    ...(schedule.weekdays === undefined ? {} : { weekdays: schedule.weekdays }),
  }
}

/** 规范的时刻表：写得对的补成 `HH:mm`、去重、按先后排；写得不对的原样留在后面（由 `scheduleIssue` 报）。 */
export function tidyTimes(times: readonly string[]): string[] {
  const good = new Map<number, string>()
  const bad: string[] = []
  for (const time of times) {
    const clock = parseClock(time)
    if (clock === null) bad.push(time)
    else good.set(clock, formatClock(clock))
  }
  const sorted = [...good.entries()].sort((a, b) => a[0] - b[0]).map(([, text]) => text)
  return [...sorted, ...bad].slice(0, DAILY_TIMES_MAX)
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

/** 五段的名字（报错时说是哪一段）。 */
export type CronFieldName = 'minute' | 'hour' | 'day' | 'month' | 'weekday'

const CRON_RANGES: readonly [name: CronFieldName, min: number, max: number][] = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day', 1, 31],
  ['month', 1, 12],
  ['weekday', 0, 7],
]

/**
 * 定时规则哪里写得不对。结构化的：界面按语言说，校验结果、发给模型的话用 {@link scheduleProblem} 的中文。
 * - `every`：间隔不在 `min`–`max` 秒之间；`time`：钟点不是 `HH:mm`；
 * - `cronEmpty` / `cronParts`：cron 是空的、不是五段；
 * - `cronSyntax` / `cronStep` / `cronRange`：某一段写得不对、步长不大于 0、超出范围；
 * - `cronNever`：永远轮不到。
 */
export type ScheduleIssue =
  | { code: 'every'; min: number; max: number }
  | { code: 'time'; time: string }
  | { code: 'cronEmpty' }
  | { code: 'cronParts'; count: number }
  | { code: 'cronSyntax'; field: CronFieldName; part: string }
  | { code: 'cronStep'; field: CronFieldName; part: string }
  | { code: 'cronRange'; field: CronFieldName; part: string; min: number; max: number }
  | { code: 'cronNever' }

type CronIssue = Exclude<ScheduleIssue, { code: 'every' | 'time' | 'cronNever' }>

function parseCronField(
  text: string,
  name: CronFieldName,
  min: number,
  max: number,
): CronField | CronIssue {
  const values = new Set<number>()
  for (const part of text.split(',')) {
    const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/u.exec(part)
    if (match === null) return { code: 'cronSyntax', field: name, part }
    const [, range, stepText] = match
    const step = stepText === undefined ? 1 : Number(stepText)
    if (step < 1) return { code: 'cronStep', field: name, part }
    let from = min
    let to = max
    if (range !== '*') {
      const [low, high] = (range as string).split('-').map(Number) as [number, number | undefined]
      from = low
      // 「5/15」这种写法 = 从 5 起每隔 15。
      to = high ?? (stepText === undefined ? low : max)
    }
    if (from < min || to > max || from > to) {
      return { code: 'cronRange', field: name, part, min, max }
    }
    for (let value = from; value <= to; value += step) values.add(value)
  }
  return { values, star: text.startsWith('*') }
}

/** 解析五段 cron；写得不对时回哪里不对。周的 0 和 7 都是周日。 */
function readCron(expression: string): Cron | CronIssue {
  const parts = expression.trim().split(/\s+/u)
  if (expression.trim() === '') return { code: 'cronEmpty' }
  if (parts.length !== 5) return { code: 'cronParts', count: parts.length }
  const fields: CronField[] = []
  for (const [index, part] of parts.entries()) {
    const [name, min, max] = CRON_RANGES[index] as [CronFieldName, number, number]
    const field = parseCronField(part, name, min, max)
    if ('code' in field) return field
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

/** 解析五段 cron；写得不对时回一句原因（中文）。周的 0 和 7 都是周日。 */
export function parseCron(expression: string): Cron | string {
  const cron = readCron(expression)
  return 'code' in cron ? issueText(cron) : cron
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
  if (schedule.kind === 'every') return `每 ${secondsText(schedule.seconds)}`
  if (schedule.kind === 'cron') return `cron ${schedule.expression.trim()}`
  const times = dailyTimes(schedule).join('、')
  if (schedule.weekdays === undefined) return `每天 ${times}`
  const days = schedule.weekdays.map((day) => WEEKDAY_TEXT[day - 1]).join('、')
  return `每周${days} ${times}`
}

/** 规则哪里写得不对；没问题是 `null`。 */
export function scheduleIssue(schedule: TriggerSchedule): ScheduleIssue | null {
  if (schedule.kind === 'every') {
    return wholeIn(schedule.seconds, EVERY_MIN, EVERY_MAX) === undefined
      ? { code: 'every', min: EVERY_MIN, max: EVERY_MAX }
      : null
  }
  if (schedule.kind === 'daily') {
    const wrong = dailyTimes(schedule).find((time) => parseClock(time) === null)
    return wrong === undefined ? null : { code: 'time', time: wrong }
  }
  const cron = readCron(schedule.expression)
  if ('code' in cron) return cron
  return nextCron(cron, new Date()) === null ? { code: 'cronNever' } : null
}

const CRON_FIELD_TEXT: Record<CronFieldName, string> = {
  minute: '分',
  hour: '时',
  day: '日',
  month: '月',
  weekday: '周',
}

/** 一处毛病的中文说法。 */
function issueText(issue: ScheduleIssue): string {
  switch (issue.code) {
    case 'every':
      return `间隔要是 ${secondsText(issue.min)}到 ${secondsText(issue.max)}之间的整数秒`
    case 'time':
      return `时间要写成 HH:mm：${issue.time}`
    case 'cronEmpty':
      return 'cron 表达式是空的'
    case 'cronParts':
      return `cron 表达式要写五段（分 时 日 月 周），现在是 ${String(issue.count)} 段`
    case 'cronSyntax':
      return `「${CRON_FIELD_TEXT[issue.field]}」这一段写得不对：${issue.part === '' ? '空的' : issue.part}`
    case 'cronStep':
      return `「${CRON_FIELD_TEXT[issue.field]}」这一段的步长要大于 0：${issue.part}`
    case 'cronRange':
      return `「${CRON_FIELD_TEXT[issue.field]}」这一段超出范围（${String(issue.min)}–${String(issue.max)}）：${issue.part}`
    case 'cronNever':
      return '这条 cron 规则永远不会触发'
  }
}

/**
 * 规则写得不对时的一句原因（中文：校验结果、发给模型的话都用它）；没问题是 `null`。
 * 界面按语言说的那句由 {@link scheduleIssue} 给出处，客户端自己翻。
 */
export function scheduleProblem(schedule: TriggerSchedule): string | null {
  const issue = scheduleIssue(schedule)
  return issue === null ? null : issueText(issue)
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
    const step = schedule.seconds * 1000
    const start = anchor.getTime()
    if (after.getTime() < start) return new Date(start + step)
    const passed = Math.floor((after.getTime() - start) / step)
    return new Date(start + (passed + 1) * step)
  }
  if (schedule.kind === 'cron') {
    return nextCron(parseCron(schedule.expression) as Cron, after)
  }
  const clocks = dailyTimes(schedule)
    .map((time) => parseClock(time) as number)
    .sort((a, b) => a - b)
  const day = new Date(after.getFullYear(), after.getMonth(), after.getDate())
  for (let offset = 0; offset < 8; offset += 1) {
    // ISO 星期：周一 1 … 周日 7。
    const weekday = day.getDay() === 0 ? 7 : day.getDay()
    if (schedule.weekdays === undefined || schedule.weekdays.includes(weekday)) {
      for (const clock of clocks) {
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, clock)
        if (at.getTime() > after.getTime()) return at
      }
    }
    day.setDate(day.getDate() + 1)
  }
  return null
}

/** 严格晚于 `after` 的接下来 `count` 次（规则写得不对、轮不到时不足 `count` 个）。`anchor` 同 {@link nextFire}。 */
export function upcomingFires(
  schedule: TriggerSchedule,
  after: Date,
  count: number,
  anchor: Date = after,
): Date[] {
  const fires: Date[] = []
  let from = after
  while (fires.length < count) {
    const next = nextFire(schedule, from, anchor)
    if (next === null) break
    fires.push(next)
    from = next
  }
  return fires
}

/**
 * 一条 cron 能不能换成「每隔多久」或「每天 / 每周几的几点」来说（只用来给人看一句话，不改规则）。
 * 日、月两段都是星号才行；说不成是 `null`。
 */
export function cronAsSimple(expression: string): TriggerSchedule | null {
  const cron = readCron(expression)
  if ('code' in cron) return null
  const [, , dayPart, monthPart] = expression.trim().split(/\s+/u)
  if (dayPart !== '*' || monthPart !== '*') return null
  const minutes = [...cron.minute.values].sort((a, b) => a - b)
  const hours = [...cron.hour.values].sort((a, b) => a - b)
  const everyDay = cron.weekday.values.size === 7
  /** 从 0 起、间隔相等、正好铺满一圈：回间隔。 */
  const stepOf = (values: number[], size: number): number | null => {
    const step = values.length === 1 ? size : (values[1] as number) - (values[0] as number)
    const even = values.every((value, index) => value === index * step)
    return even && step * values.length === size ? step : null
  }
  if (everyDay && hours.length === 24) {
    const step = stepOf(minutes, 60)
    return step === null ? null : { kind: 'every', seconds: step * 60 }
  }
  if (minutes.length !== 1) return null
  const [minute = 0] = minutes
  if (everyDay && minute === 0 && hours.length > 1) {
    const step = stepOf(hours, 24)
    if (step !== null) return { kind: 'every', seconds: step * 3600 }
  }
  if (hours.length > DAILY_TIMES_MAX) return null
  const [first = '09:00', ...rest] = hours.map((hour) => formatClock(hour * 60 + minute))
  // cron 的周日是 0，这里是 7。
  const weekdays = [...cron.weekday.values]
    .map((day) => (day === 0 ? 7 : day))
    .sort((a, b) => a - b)
  return {
    kind: 'daily',
    time: first,
    ...(rest.length === 0 ? {} : { moreTimes: rest }),
    ...(everyDay ? {} : { weekdays }),
  }
}
