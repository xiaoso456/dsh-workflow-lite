/**
 * dsh-workflow-lite — 触发节点：条件满足时由插件在会话里发起一次执行（见 `docs/触发器设计.md`）。
 *
 * 这里是触发节点 `data` 的解释：读入的规范化、规范写法、缺省值，以及定时规则「下一次是什么时候」。
 * 开关、选定的工作区和会话、触发记录都是本机状态，不在图里（见 `host/triggers`）。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。时间一律按本机时区。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/trigger
 */

import type {
  TriggerData,
  TriggerLaunch,
  TriggerNode,
  TriggerOverlap,
  TriggerSchedule,
  TriggerSessionMode,
} from './types.ts'

/** 一次触发是怎么来的：定时到点 / 用户点了「立即触发一次」。 */
export type FireChannel = 'schedule' | 'now'

/** 触发编号的形状（拿去拼路径之前先过这一道）。 */
export function isFireId(value: unknown): value is string {
  return typeof value === 'string' && /^f-\d{8}-\d{6}-[0-9a-f]{4}$/u.test(value)
}

/** 触发卡片的名字：没起名就用它的 id。 */
export function triggerName(node: Pick<TriggerNode, 'id' | 'data'>): string {
  return node.data.label ?? node.id
}

/** 新拖出来的触发卡片：每天 9 点。 */
export const DEFAULT_TRIGGER: TriggerData = {
  source: { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } },
}

/** 保护的缺省值：每小时最多触发几次、连续失败几次后自动停用。 */
export const DEFAULT_MAX_PER_HOUR = 12
export const DEFAULT_MAX_FAILURES = 3

/** 「每隔多久」的上下限（分钟）。 */
export const EVERY_MIN = 1
export const EVERY_MAX = 7 * 24 * 60

const SESSION_MODES: readonly TriggerSessionMode[] = ['new', 'last', 'fixed']
const OVERLAPS: readonly TriggerOverlap[] = ['skip', 'parallel']

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function filled(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

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

/** 定时规则按形状读入；读不出来回落到缺省（每天 9 点），规则写得不对由 {@link scheduleProblem} 报。 */
function readSchedule(raw: unknown): TriggerSchedule {
  if (isPlainObject(raw)) {
    if (raw.kind === 'every') {
      return { kind: 'every', minutes: typeof raw.minutes === 'number' ? raw.minutes : 60 }
    }
    if (raw.kind === 'cron') {
      return { kind: 'cron', expression: typeof raw.expression === 'string' ? raw.expression : '' }
    }
    if (raw.kind === 'daily') {
      const days = Array.isArray(raw.weekdays)
        ? [...new Set(raw.weekdays.filter((day) => wholeIn(day, 1, 7) !== undefined))].sort()
        : []
      return {
        kind: 'daily',
        time: typeof raw.time === 'string' ? raw.time : '09:00',
        // 七天全选和不写是一回事：不写。
        ...(days.length > 0 && days.length < 7 ? { weekdays: days as number[] } : {}),
      }
    }
  }
  return { kind: 'daily', time: '09:00' }
}

function readLaunch(raw: unknown): TriggerLaunch | undefined {
  if (!isPlainObject(raw)) return undefined
  const launch: TriggerLaunch = {}
  const session = SESSION_MODES.find((mode) => mode === raw.session)
  if (session !== undefined && session !== 'new') launch.session = session
  const overlap = OVERLAPS.find((mode) => mode === raw.overlap)
  if (overlap !== undefined && overlap !== 'skip') launch.overlap = overlap
  if (raw.catchUp === false) launch.catchUp = false
  const perHour = wholeIn(raw.maxPerHour, 1, 3600)
  if (perHour !== undefined && perHour !== DEFAULT_MAX_PER_HOUR) launch.maxPerHour = perHour
  const failures = wholeIn(raw.maxFailures, 1, 100)
  if (failures !== undefined && failures !== DEFAULT_MAX_FAILURES) launch.maxFailures = failures
  return Object.keys(launch).length > 0 ? launch : undefined
}

/** 读入触发节点的 `data`：缺省值不留在对象里，形状不对的字段丢掉。 */
export function readTriggerData(raw: unknown): TriggerData {
  const input = isPlainObject(raw) ? raw : {}
  const source = isPlainObject(input.source) ? input.source : {}
  const data: TriggerData = {
    source: { kind: 'schedule', schedule: readSchedule(source.schedule) },
  }
  const label = filled(input.label)
  if (label !== undefined) data.label = label
  const note = filled(input.note)
  if (note !== undefined) data.note = note
  const launch = readLaunch(input.launch)
  if (launch !== undefined) data.launch = launch
  return data
}

/** 规范写法（读入的规范化 + 固定键序），写盘与比较都用它。 */
export function canonicalTrigger(data: TriggerData): TriggerData {
  const normalized = readTriggerData(data)
  const schedule = normalized.source.schedule
  const out: TriggerData = {
    ...(normalized.label === undefined ? {} : { label: normalized.label }),
    source: {
      kind: 'schedule',
      schedule:
        schedule.kind === 'every'
          ? { kind: 'every', minutes: schedule.minutes }
          : schedule.kind === 'cron'
            ? { kind: 'cron', expression: schedule.expression }
            : {
                kind: 'daily',
                time: schedule.time,
                ...(schedule.weekdays === undefined ? {} : { weekdays: [...schedule.weekdays] }),
              },
    },
    ...(normalized.note === undefined ? {} : { note: normalized.note }),
  }
  const launch = normalized.launch
  if (launch !== undefined) {
    out.launch = {
      ...(launch.session === undefined ? {} : { session: launch.session }),
      ...(launch.overlap === undefined ? {} : { overlap: launch.overlap }),
      ...(launch.catchUp === undefined ? {} : { catchUp: launch.catchUp }),
      ...(launch.maxPerHour === undefined ? {} : { maxPerHour: launch.maxPerHour }),
      ...(launch.maxFailures === undefined ? {} : { maxFailures: launch.maxFailures }),
    }
  }
  return out
}

export function cloneTriggerData(data: TriggerData): TriggerData {
  return canonicalTrigger(data)
}

/** 启动方式里的各项，缺省值都补上了。 */
export interface LaunchSettings {
  session: TriggerSessionMode
  overlap: TriggerOverlap
  catchUp: boolean
  maxPerHour: number
  maxFailures: number
}

/** 启动方式里的各项，补上缺省值。 */
export function launchOf(data: TriggerData): LaunchSettings {
  return {
    session: data.launch?.session ?? 'new',
    overlap: data.launch?.overlap ?? 'skip',
    catchUp: data.launch?.catchUp ?? true,
    maxPerHour: data.launch?.maxPerHour ?? DEFAULT_MAX_PER_HOUR,
    maxFailures: data.launch?.maxFailures ?? DEFAULT_MAX_FAILURES,
  }
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
