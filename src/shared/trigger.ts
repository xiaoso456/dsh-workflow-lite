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

import {
  type ScheduleIssue,
  scheduleIssue,
  scheduleProblem,
  scheduleText,
  secondsText,
  tidyTimes,
} from './schedule.ts'
import type {
  AfterWhen,
  CheckWhen,
  TriggerCheck,
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

export const SOURCE_KINDS: readonly TriggerSourceKind[] = ['schedule', 'listen', 'http', 'after']
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
/** 上限写成这个数就是不限制（每小时不限次数 / 失败多少次都不自动停用）。 */
export const NO_LIMIT = 0

/** `count` 到没到上限 `limit`；不限制的永远没到。 */
export function reachedLimit(count: number, limit: number): boolean {
  return limit !== NO_LIMIT && count >= limit
}

/** 到点直接执行的「每隔」最短多少秒（带检查命令的按规则本身的下限，见 schedule.ts 的 `EVERY_MIN`）。 */
export const PLAIN_EVERY_MIN = 60

/** 定时的判定：到点就执行（不跑命令），或带命令的三种。 */
export type ScheduleJudge = 'always' | CheckWhen

/** 换到带命令的判定时给的检查（命令还空着，由用户写）。 */
export const NEW_CHECK: TriggerCheck = { command: '', when: 'every' }

/** 合并窗口（秒）、去重时长（分钟）的上限；关键字最多几个。 */
export const MERGE_MAX_SECONDS = 3600
export const DEDUPE_MAX_MINUTES = 7 * 24 * 60
export const KEYWORDS_MAX = 20

/** 合并窗口的缺省（秒）：一下子来一串的（监听、HTTP）并成一次；定时的检查本来就隔一段才跑一次。 */
const DEFAULT_MERGE: Record<FilterKind, number> = {
  schedule: 0,
  listen: 5,
  http: 5,
}

/** 有过滤的触发源：带来外面的内容（检查命令的输出、程序打出的行、请求体）。 */
export type FilterKind = Extract<TriggerSourceKind, 'schedule' | 'listen' | 'http'>

/** 带检查命令的定时。 */
export type CheckedSchedule = Extract<TriggerSource, { kind: 'schedule' }> & { check: TriggerCheck }

/** 常驻在负责的进程里跑的触发源：带检查命令的定时、监听程序、HTTP（到点直接执行的定时由对账排）。 */
export type LiveSource = CheckedSchedule | Extract<TriggerSource, { kind: 'listen' | 'http' }>

/** 这个触发源带不带外来内容（有就有过滤、常驻着跑）；带的话是哪一种。 */
export function filterKindOf(source: TriggerSource): FilterKind | null {
  if (source.kind === 'schedule') return source.check === undefined ? null : 'schedule'
  return source.kind === 'listen' || source.kind === 'http' ? source.kind : null
}

/** 常驻着跑的触发源（见 {@link LiveSource}）。 */
export function isLiveSource(source: TriggerSource): source is LiveSource {
  return filterKindOf(source) !== null
}

/** 定时的判定（没有检查命令就是到点就执行）。 */
export function scheduleJudge(source: Extract<TriggerSource, { kind: 'schedule' }>): ScheduleJudge {
  return source.check?.when ?? 'always'
}

/**
 * 换定时的判定：到点就执行去掉检查；换到带命令的保留已写的命令。
 * 去掉检查时「每隔」短于 {@link PLAIN_EVERY_MIN} 的拉到 1 分钟（到点直接执行不能更密）。
 */
export function withScheduleJudge(
  source: Extract<TriggerSource, { kind: 'schedule' }>,
  judge: ScheduleJudge,
): Extract<TriggerSource, { kind: 'schedule' }> {
  if (judge === 'always') {
    const { check: _check, ...rest } = source
    const { schedule } = rest
    return schedule.kind === 'every' && schedule.seconds < PLAIN_EVERY_MIN
      ? { ...rest, schedule: { kind: 'every', seconds: PLAIN_EVERY_MIN } }
      : rest
  }
  return { ...source, check: { command: source.check?.command ?? NEW_CHECK.command, when: judge } }
}

/** 换一种触发源时给的常用值。 */
export const SOURCE_SEED: Record<TriggerSourceKind, TriggerSource> = {
  schedule: DEFAULT_TRIGGER.source,
  listen: { kind: 'listen', command: '' },
  http: { kind: 'http' },
  after: { kind: 'after', workflow: '' },
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
      return { kind: 'every', seconds: typeof raw.seconds === 'number' ? raw.seconds : 3600 }
    }
    if (raw.kind === 'cron') {
      return { kind: 'cron', expression: typeof raw.expression === 'string' ? raw.expression : '' }
    }
    if (raw.kind === 'daily') {
      const days = Array.isArray(raw.weekdays)
        ? [...new Set(raw.weekdays.filter((day) => wholeIn(day, 1, 7) !== undefined))].sort()
        : []
      const more = Array.isArray(raw.moreTimes)
        ? raw.moreTimes.filter((time): time is string => typeof time === 'string')
        : []
      const [time = '09:00', ...moreTimes] = tidyTimes([
        typeof raw.time === 'string' ? raw.time : '09:00',
        ...more,
      ])
      return {
        kind: 'daily',
        time,
        ...(moreTimes.length === 0 ? {} : { moreTimes }),
        // 七天全选和不写是一回事：不写。
        ...(days.length > 0 && days.length < 7 ? { weekdays: days as number[] } : {}),
      }
    }
  }
  return { kind: 'daily', time: '09:00' }
}

const CHECK_WHENS: readonly CheckWhen[] = ['every', 'success', 'change']

/** 定时的检查按形状读入：不是对象就是没有检查；判定认不出时按每次成功。 */
function readCheck(raw: unknown): TriggerCheck | undefined {
  if (!isPlainObject(raw)) return undefined
  return {
    command: typeof raw.command === 'string' ? raw.command : '',
    when: CHECK_WHENS.find((when) => when === raw.when) ?? NEW_CHECK.when,
  }
}

/** 触发源按形状读入；命令原样保留（空的由 {@link sourceProblem} 报），认不出的回落到定时。 */
function readSource(raw: unknown): TriggerSource {
  const input = isPlainObject(raw) ? raw : {}
  const command = typeof input.command === 'string' ? input.command : ''
  if (input.kind === 'listen') return { kind: 'listen', command }
  if (input.kind === 'http') return { kind: 'http' }
  if (input.kind === 'after') {
    return {
      kind: 'after',
      workflow: typeof input.workflow === 'string' ? input.workflow.trim() : '',
      ...(input.when === 'failed' || input.when === 'any' ? { when: input.when } : {}),
    }
  }
  const check = readCheck(input.check)
  return {
    kind: 'schedule',
    schedule: readSchedule(input.schedule),
    ...(check === undefined ? {} : { check }),
  }
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

/** 过滤按形状读入：等于这种触发源的缺省值的项不留；没有外来内容的（到点直接执行、接续）整个不要。 */
function readFilter(raw: unknown, source: TriggerSource): TriggerFilter | undefined {
  const kind = filterKindOf(source)
  if (!isPlainObject(raw) || kind === null) return undefined
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
  const perHour = wholeIn(raw.maxPerHour, NO_LIMIT, Number.MAX_SAFE_INTEGER)
  if (perHour !== undefined && perHour !== DEFAULT_MAX_PER_HOUR) launch.maxPerHour = perHour
  const failures = wholeIn(raw.maxFailures, NO_LIMIT, Number.MAX_SAFE_INTEGER)
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
  const filter = readFilter(input.filter, source)
  if (filter !== undefined) data.filter = filter
  const launch = readLaunch(input.launch)
  if (launch !== undefined) data.launch = launch
  return data
}

function canonicalSource(source: TriggerSource): TriggerSource {
  if (source.kind === 'listen') return { kind: 'listen', command: source.command }
  if (source.kind === 'http') return { kind: 'http' }
  if (source.kind === 'after') {
    return {
      kind: 'after',
      workflow: source.workflow,
      ...(source.when === undefined ? {} : { when: source.when }),
    }
  }
  const { schedule, check } = source
  return {
    kind: 'schedule',
    schedule:
      schedule.kind === 'every'
        ? { kind: 'every', seconds: schedule.seconds }
        : schedule.kind === 'cron'
          ? { kind: 'cron', expression: schedule.expression }
          : {
              kind: 'daily',
              time: schedule.time,
              ...(schedule.moreTimes === undefined ? {} : { moreTimes: [...schedule.moreTimes] }),
              ...(schedule.weekdays === undefined ? {} : { weekdays: [...schedule.weekdays] }),
            },
    ...(check === undefined ? {} : { check: { command: check.command, when: check.when } }),
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

/**
 * 改触发卡片的几项：给了的键换掉，值为 `undefined` 的键清掉；改完和原来一样回 `null`。
 * 不在这里规范化（正在打的名称、说明里的空格要留着），写盘时再取形。画布的编辑、工作流中心「触发」页的改动共用。
 */
export function patchTriggerData(
  data: TriggerData,
  patch: Partial<TriggerData>,
): TriggerData | null {
  const merged: Record<string, unknown> = { ...data, ...patch }
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key]
  }
  const next = merged as unknown as TriggerData
  return JSON.stringify(next) === JSON.stringify(data) ? null : next
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

/**
 * 打开开关之前，这张卡片在本机还缺哪一样：要跑命令的（带检查的定时、监听）和新建 / 接着上一次会话的要工作区，
 * 发进固定会话的要选会话；都齐了是 `null`。
 */
export function launchMissing(
  data: TriggerData,
  local: { workspace?: string | undefined; session?: string | undefined },
): 'workspace' | 'session' | null {
  const needsWorkspace = commandOf(data.source) !== undefined || launchOf(data).session !== 'fixed'
  if (needsWorkspace && local.workspace === undefined) return 'workspace'
  if (launchOf(data).session === 'fixed' && local.session === undefined) return 'session'
  return null
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

/** 过滤里的各项，按触发源补上缺省值（到点直接执行的定时、接续全是关的）。 */
export function filterOf(data: TriggerData): FilterSettings {
  const kind = filterKindOf(data.source)
  if (kind === null) return { merge: 0, dedupe: 0, include: [], exclude: [] }
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

/** 要在本机跑的命令（定时的检查、监听）；别的触发源没有。 */
export function commandOf(source: TriggerSource): string | undefined {
  if (source.kind === 'schedule') return source.check?.command
  return source.kind === 'listen' ? source.command : undefined
}

/** 接续触发的结果条件，补上缺省（成功时）。 */
export function afterWhen(source: Extract<TriggerSource, { kind: 'after' }>): AfterWhen {
  return source.when ?? 'done'
}

/** 一次执行结束时的结果（状态文件里的 done / failed / cancelled）。 */
export type FinishedStatus = 'done' | 'failed' | 'cancelled'

/** 那个工作流的一次执行以这个结果结束时，接续触发要不要触发（「不论结果」连取消的也算）。 */
export function afterMatches(
  source: Extract<TriggerSource, { kind: 'after' }>,
  status: FinishedStatus,
): boolean {
  const when = afterWhen(source)
  return when === 'any' || when === status
}

/** 触发源哪里写得不对。结构化的：界面按语言说，校验结果、发给模型的话用 {@link sourceProblem} 的中文。 */
export type SourceIssue =
  | { code: 'schedule'; issue: ScheduleIssue }
  | { code: 'noWorkflow' }
  | { code: 'noCommand' }
  /** 到点直接执行的「每隔」太密（要带检查命令才能更短）。 */
  | { code: 'tooOften'; min: number }

/**
 * 触发源哪里写得不对；没问题是 `null`。
 * 只看卡片本身：接续触发「不能等自己」「那个工作流在不在、记不记运行状态」要看图名和别的图，由调用方查。
 */
export function sourceIssue(source: TriggerSource): SourceIssue | null {
  if (source.kind === 'schedule') {
    const issue = scheduleIssue(source.schedule)
    if (issue !== null) return { code: 'schedule', issue }
    const { schedule, check } = source
    if (check === undefined) {
      return schedule.kind === 'every' && schedule.seconds < PLAIN_EVERY_MIN
        ? { code: 'tooOften', min: PLAIN_EVERY_MIN }
        : null
    }
    return check.command.trim() === '' ? { code: 'noCommand' } : null
  }
  if (source.kind === 'http') return null
  if (source.kind === 'after') return source.workflow === '' ? { code: 'noWorkflow' } : null
  return source.command.trim() === '' ? { code: 'noCommand' } : null
}

/** 触发源写得不对时的一句原因（中文）；没问题是 `null`。 */
export function sourceProblem(source: TriggerSource): string | null {
  const issue = sourceIssue(source)
  if (issue === null) return null
  if (issue.code === 'schedule' && source.kind === 'schedule') {
    return scheduleProblem(source.schedule)
  }
  if (issue.code === 'noWorkflow') return '还没选等哪个工作流跑完'
  if (issue.code === 'noCommand') return '还没写要运行的命令'
  if (issue.code === 'tooOften') {
    return `到点直接执行的间隔最短 ${secondsText(issue.min)}；要更密得先跑命令检查`
  }
  return null
}

/** 检查命令的判定的一句话说法。 */
const CHECK_WHEN_TEXT: Record<CheckWhen, string> = {
  every: '命令成功',
  success: '命令由失败变为成功',
  change: '命令的输出变了',
}

/** 触发源的一句话说法（写进发给模型的话里）。 */
export function sourceText(source: TriggerSource): string {
  if (source.kind === 'schedule') {
    const when = scheduleText(source.schedule)
    return source.check === undefined
      ? `定时（${when}）`
      : `定时检查（${when}跑一次命令，${CHECK_WHEN_TEXT[source.check.when]}时触发）`
  }
  if (source.kind === 'listen') return '监视程序打出了一行'
  if (source.kind === 'after') {
    const when = { done: '成功', failed: '失败', any: '结束' }[afterWhen(source)]
    return `工作流「${source.workflow}」的一次执行${when}了`
  }
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
