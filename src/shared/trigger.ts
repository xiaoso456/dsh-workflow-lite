/**
 * dsh-workflow-lite — 触发节点：条件满足时由插件在会话里发起一次执行（见 `docs/触发器设计.md`）。
 *
 * 这里是触发节点 `data` 的解释：读入的规范化、规范写法、缺省值，触发源写得对不对、怎么说，
 * 以及不花模型调用的过滤（关键字）。定时规则本身在 `schedule.ts`。
 * 开关、选定的工作区和会话、命令的确认、触发记录都是本机状态，不在图里（见 `host/triggers`）。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/trigger
 */

import { scheduleProblem, scheduleText } from './schedule.ts'
import type {
  PollWhen,
  TriggerData,
  TriggerFilter,
  TriggerLaunch,
  TriggerNode,
  TriggerOverlap,
  TriggerSchedule,
  TriggerSessionMode,
  TriggerSource,
  TriggerSourceKind,
} from './types.ts'

/** 一次触发是怎么来的：哪一种触发源，或用户点了「立即触发一次」。 */
export type FireChannel = TriggerSourceKind | 'now'

export const SOURCE_KINDS: readonly TriggerSourceKind[] = ['schedule', 'poll', 'listen', 'http']
export const FIRE_CHANNELS: readonly FireChannel[] = [...SOURCE_KINDS, 'now']

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

/** 条件轮询的间隔（秒）：上下限与缺省。 */
export const POLL_MIN_SECONDS = 10
export const POLL_MAX_SECONDS = 7 * 24 * 3600
export const DEFAULT_POLL_SECONDS = 300

/** 合并窗口（秒）、去重时长（分钟）的上限；关键字最多几个。 */
export const MERGE_MAX_SECONDS = 3600
export const DEDUPE_MAX_MINUTES = 7 * 24 * 60
export const KEYWORDS_MAX = 20

/** 合并窗口的缺省（秒）：一下子来一串的（监听、HTTP）并成一次；轮询本来就隔一段才跑一次。 */
const DEFAULT_MERGE: Record<TriggerSourceKind, number> = {
  schedule: 0,
  poll: 0,
  listen: 5,
  http: 5,
}

/** 换一种触发源时给的常用值。 */
export const SOURCE_SEED: Record<TriggerSourceKind, TriggerSource> = {
  schedule: DEFAULT_TRIGGER.source,
  poll: { kind: 'poll', command: '', seconds: DEFAULT_POLL_SECONDS },
  listen: { kind: 'listen', command: '' },
  http: { kind: 'http' },
}

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

// ─────────────────────────────────────────────────────────────
// 读入
// ─────────────────────────────────────────────────────────────

/** 定时规则按形状读入；读不出来回落到缺省（每天 9 点），规则写得不对由 `scheduleProblem` 报。 */
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

/** 触发源按形状读入；命令原样保留（空的由 {@link sourceProblem} 报），认不出的回落到定时。 */
function readSource(raw: unknown): TriggerSource {
  const input = isPlainObject(raw) ? raw : {}
  const command = typeof input.command === 'string' ? input.command : ''
  if (input.kind === 'poll') {
    return {
      kind: 'poll',
      command,
      seconds: typeof input.seconds === 'number' ? input.seconds : DEFAULT_POLL_SECONDS,
      ...(input.when === 'change' ? { when: 'change' as const } : {}),
    }
  }
  if (input.kind === 'listen') return { kind: 'listen', command }
  if (input.kind === 'http') return { kind: 'http' }
  return { kind: 'schedule', schedule: readSchedule(input.schedule) }
}

/** 一组关键字：去空白、去重、去空，最多 {@link KEYWORDS_MAX} 个。 */
function readKeywords(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const words = [
    ...new Set(
      raw
        .filter((word): word is string => typeof word === 'string')
        .map((word) => word.trim())
        .filter((word) => word !== ''),
    ),
  ].slice(0, KEYWORDS_MAX)
  return words.length > 0 ? words : undefined
}

/** 过滤按形状读入：等于这种触发源的缺省值的项不留；定时没有背景信息，整个不要。 */
function readFilter(raw: unknown, kind: TriggerSourceKind): TriggerFilter | undefined {
  if (!isPlainObject(raw) || kind === 'schedule') return undefined
  const filter: TriggerFilter = {}
  const merge = wholeIn(raw.merge, 0, MERGE_MAX_SECONDS)
  if (merge !== undefined && merge !== DEFAULT_MERGE[kind]) filter.merge = merge
  const dedupe = wholeIn(raw.dedupe, 0, DEDUPE_MAX_MINUTES)
  if (dedupe !== undefined && dedupe > 0) filter.dedupe = dedupe
  const include = readKeywords(raw.include)
  if (include !== undefined) filter.include = include
  const exclude = readKeywords(raw.exclude)
  if (exclude !== undefined) filter.exclude = exclude
  return Object.keys(filter).length > 0 ? filter : undefined
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
  const source = readSource(input.source)
  const data: TriggerData = { source }
  const label = filled(input.label)
  if (label !== undefined) data.label = label
  const note = filled(input.note)
  if (note !== undefined) data.note = note
  const condition = filled(input.condition)
  if (condition !== undefined) data.condition = condition
  const filter = readFilter(input.filter, source.kind)
  if (filter !== undefined) data.filter = filter
  const launch = readLaunch(input.launch)
  if (launch !== undefined) data.launch = launch
  return data
}

function canonicalSource(source: TriggerSource): TriggerSource {
  if (source.kind === 'poll') {
    return {
      kind: 'poll',
      command: source.command,
      seconds: source.seconds,
      ...(source.when === undefined ? {} : { when: source.when }),
    }
  }
  if (source.kind === 'listen') return { kind: 'listen', command: source.command }
  if (source.kind === 'http') return { kind: 'http' }
  const { schedule } = source
  return {
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
  }
}

/** 规范写法（读入的规范化 + 固定键序），写盘与比较都用它。 */
export function canonicalTrigger(data: TriggerData): TriggerData {
  const normalized = readTriggerData(data)
  const out: TriggerData = {
    ...(normalized.label === undefined ? {} : { label: normalized.label }),
    source: canonicalSource(normalized.source),
    ...(normalized.note === undefined ? {} : { note: normalized.note }),
    ...(normalized.condition === undefined ? {} : { condition: normalized.condition }),
  }
  const filter = normalized.filter
  if (filter !== undefined) {
    out.filter = {
      ...(filter.merge === undefined ? {} : { merge: filter.merge }),
      ...(filter.dedupe === undefined ? {} : { dedupe: filter.dedupe }),
      ...(filter.include === undefined ? {} : { include: [...filter.include] }),
      ...(filter.exclude === undefined ? {} : { exclude: [...filter.exclude] }),
    }
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

// ─────────────────────────────────────────────────────────────
// 补上缺省值
// ─────────────────────────────────────────────────────────────

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

/** 过滤里的各项，缺省值都补上了。 */
export interface FilterSettings {
  /** 合并窗口（秒）；0 = 不合并。 */
  merge: number
  /** 去重时长（分钟）；0 = 不去重。 */
  dedupe: number
  include: readonly string[]
  exclude: readonly string[]
}

/** 过滤里的各项，按触发源补上缺省值（定时全是关的）。 */
export function filterOf(data: TriggerData): FilterSettings {
  const kind = data.source.kind
  if (kind === 'schedule') return { merge: 0, dedupe: 0, include: [], exclude: [] }
  return {
    merge: data.filter?.merge ?? DEFAULT_MERGE[kind],
    dedupe: data.filter?.dedupe ?? 0,
    include: data.filter?.include ?? [],
    exclude: data.filter?.exclude ?? [],
  }
}

// ─────────────────────────────────────────────────────────────
// 触发源
// ─────────────────────────────────────────────────────────────

/** 要在本机跑的命令（轮询、监听）；别的触发源没有。 */
export function commandOf(source: TriggerSource): string | undefined {
  return source.kind === 'poll' || source.kind === 'listen' ? source.command : undefined
}

/** 条件轮询的判定方式，补上缺省。 */
export function pollWhen(source: Extract<TriggerSource, { kind: 'poll' }>): PollWhen {
  return source.when ?? 'success'
}

/** 触发源写得不对时的一句原因；没问题是 `null`。 */
export function sourceProblem(source: TriggerSource): string | null {
  if (source.kind === 'schedule') return scheduleProblem(source.schedule)
  if (source.kind === 'http') return null
  if (source.command.trim() === '') return '还没写要运行的命令'
  if (
    source.kind === 'poll' &&
    wholeIn(source.seconds, POLL_MIN_SECONDS, POLL_MAX_SECONDS) === undefined
  ) {
    return `轮询间隔要是 ${String(POLL_MIN_SECONDS)} 秒到 7 天之间的整数秒`
  }
  return null
}

/** 秒数的一句话说法（「30 秒」「5 分钟」「2 小时」）。 */
export function secondsText(seconds: number): string {
  if (seconds % 86_400 === 0) return `${String(seconds / 86_400)} 天`
  if (seconds % 3600 === 0) return `${String(seconds / 3600)} 小时`
  if (seconds % 60 === 0) return `${String(seconds / 60)} 分钟`
  return `${String(seconds)} 秒`
}

/** 触发源的一句话说法（写进发给模型的话里）。 */
export function sourceText(source: TriggerSource): string {
  if (source.kind === 'schedule') return `定时（${scheduleText(source.schedule)}）`
  if (source.kind === 'poll') {
    const when = pollWhen(source) === 'change' ? '输出变了' : '命令成功'
    return `条件轮询（每 ${secondsText(source.seconds)} 跑一次命令，${when}时触发）`
  }
  if (source.kind === 'listen') return '监听程序打出了一行'
  return '收到一个 HTTP 请求'
}

/**
 * 关键字这一关：有「包含」时要命中其中一个，命中任何一个「不包含」就不触发。大小写不敏感。
 * @returns 过不去的原因；过得去是 `null`。
 */
export function keywordMiss(filter: FilterSettings, info: string): string | null {
  const text = info.toLowerCase()
  const hit = (word: string): boolean => text.includes(word.toLowerCase())
  const blocked = filter.exclude.find(hit)
  if (blocked !== undefined) return `含有「${blocked}」`
  if (filter.include.length > 0 && !filter.include.some(hit)) {
    return `不含 ${filter.include.map((word) => `「${word}」`).join('、')} 中的任何一个`
  }
  return null
}
