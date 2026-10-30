/**
 * dsh-workflow-lite — 日志、纯文本按行看（`run/lines`）的前端这一半：读回来的几段怎么拼成一个窗口、
 * 哪些行是错误 / 警告、筛选写得对不对、几个现成的筛选。纯函数，展示卡和查看框共用。
 *
 * 窗口是文件里连续的一段（`start`–`end` 字节），筛的时候只留匹配的行和上下文，`skip` 记着中间跳过了几行。
 * 往下续（新追加的）接在后面，往上翻接在前面；超过上限就从另一头扔掉，那一头变成「还有」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/logLines
 */

import type { LineFilter, ViewFrom } from '../../shared/types.ts'
import type { RunLine, RunLinesResponse } from '../../shared/wire.ts'

export interface LineWindow {
  lines: RunLine[]
  /** 末尾还没写完的那一行。 */
  pending?: RunLine | undefined
  /** 窗口在文件里的范围（字节）。 */
  start: number
  end: number
  /** `end` 处的指纹（往下续读带上；窗口没到末尾时没用）。 */
  tag: string
  /** 最后一行之后、`end` 之前筛掉了几行。 */
  trail: number
  /** 最后一处匹配还欠几行下文。 */
  owed: number
  /** 窗口里匹配了几行（不筛时 = 行数）。 */
  matched: number
  /** `start` 前面还有没读的。 */
  before: boolean
  /** `end` 后面还有没读的（不是一直读到末尾的）。 */
  after: boolean
  /** 往前扫到上限停下了（筛的时候）。 */
  stopped?: 'bytes' | 'time' | undefined
  size: number
  mtime: number
  /** 这一回新来的行（行首位置）：亮一下再淡下去；`parity` 每次换一个，同一行又是新的也从头亮。 */
  fresh: ReadonlySet<number> | null
  parity: 0 | 1
}

/** 一回读到的当成一个新窗口。 */
export function windowOf(response: RunLinesResponse, mode: 'tail' | 'head' | 'follow'): LineWindow {
  return {
    lines: response.lines,
    pending: response.pending,
    start: response.start,
    end: response.end,
    tag: response.tag,
    trail: response.trail,
    owed: response.owed ?? 0,
    matched: response.matched,
    before: mode === 'head' ? response.start > 0 : response.more,
    after: mode === 'head' ? response.more : false,
    stopped: response.stopped,
    size: response.size,
    mtime: response.mtime,
    fresh: null,
    parity: 0,
  }
}

/** 续读回来的（`follow`）：接上就接在后面（只留最后 `cap` 行），接不上（文件被重写、中间断开）就整个换掉。 */
export function appendWindow(win: LineWindow, response: RunLinesResponse, cap: number): LineWindow {
  if (response.appended !== true || response.gap === true) {
    const next = windowOf(response, 'tail')
    // 整个换掉的不标新（标了就满屏都是）；只是中间断开的，标后来的那些。
    return response.gap === true ? { ...next, fresh: atsOf(next.lines), parity: flip(win) } : next
  }
  const added = response.lines.map((line, index) =>
    index === 0 && win.trail > 0 ? { ...line, skip: (line.skip ?? 0) + win.trail } : line,
  )
  const merged = [...win.lines, ...added]
  const dropped = Math.max(0, merged.length - cap)
  const lines = dropped > 0 ? merged.slice(dropped) : merged
  const changedPending =
    response.pending !== undefined && response.pending.text !== win.pending?.text
  const fresh = new Set(added.map((line) => line.at))
  // 上一回没写完的那行这回写完了：它也算新的（位置没变，内容长了）。
  if (changedPending && response.pending !== undefined) fresh.add(response.pending.at)
  return {
    ...win,
    lines,
    pending: response.pending,
    start: dropped > 0 ? (lines[0]?.at ?? win.start) : win.start,
    end: response.end,
    tag: response.tag,
    trail: added.length === 0 ? win.trail + response.trail : response.trail,
    owed: response.owed ?? 0,
    matched: win.matched + response.matched,
    before: win.before || dropped > 0,
    size: response.size,
    mtime: response.mtime,
    fresh: fresh.size === 0 ? null : fresh,
    parity: fresh.size === 0 ? win.parity : flip(win),
  }
}

/** 往上翻读回来的（`tail` + `before`）：接在前面，超过 `cap` 行从后面扔（后面就变成「还有」）。 */
export function prependWindow(
  win: LineWindow,
  response: RunLinesResponse,
  cap: number,
): LineWindow {
  const first = win.lines[0]
  const ours =
    first === undefined || response.trail === 0
      ? win.lines
      : [{ ...first, skip: (first.skip ?? 0) + response.trail }, ...win.lines.slice(1)]
  const merged = [...response.lines, ...ours]
  const dropped = Math.max(0, merged.length - cap)
  const lines = dropped > 0 ? merged.slice(0, merged.length - dropped) : merged
  const cut = dropped > 0 ? merged[merged.length - dropped] : undefined
  return {
    ...win,
    lines,
    ...(cut === undefined ? {} : { pending: undefined, end: cut.at, after: true, trail: 0 }),
    start: response.start,
    before: response.more,
    stopped: response.stopped,
    matched: win.matched + response.matched,
    fresh: null,
  }
}

/** 往下翻读回来的（`head` + `from`）：接在后面，超过 `cap` 行从前面扔（前面就变成「还有」）。 */
export function extendWindow(win: LineWindow, response: RunLinesResponse, cap: number): LineWindow {
  const added = response.lines.map((line, index) =>
    index === 0 && win.trail > 0 ? { ...line, skip: (line.skip ?? 0) + win.trail } : line,
  )
  const merged = [...win.lines, ...added]
  const dropped = Math.max(0, merged.length - cap)
  const lines = dropped > 0 ? merged.slice(dropped) : merged
  return {
    ...win,
    lines,
    pending: response.pending,
    start: dropped > 0 ? (lines[0]?.at ?? win.start) : win.start,
    before: win.before || dropped > 0,
    end: response.end,
    tag: response.tag,
    trail: added.length === 0 ? win.trail + response.trail : response.trail,
    owed: response.owed ?? 0,
    after: response.more,
    matched: win.matched + response.matched,
    size: response.size,
    mtime: response.mtime,
    fresh: null,
  }
}

const flip = (win: LineWindow): 0 | 1 => (win.parity === 0 ? 1 : 0)
const atsOf = (lines: readonly RunLine[]): Set<number> => new Set(lines.map((line) => line.at))

// ── 级别 ────────────────────────────────────────────────────

/**
 * 错误行：全大写的级别词（`ERROR`、`FATAL`……）、小写首字母的后面跟冒号或右方括号（`error:`、`[Error]`）、
 * logfmt 的 `level=error`、打叉的符号。只认这些常见写法，句子里随口说的「no error」不算。
 */
const ERROR_LINE =
  /\b(?:FATAL|ERROR|ERR|CRITICAL|CRIT|PANIC|SEVERE)\b|\b(?:[Ee]rror|[Ff]atal|[Pp]anic|[Cc]ritical)(?=[:\]])|\blevel=(?:error|fatal|critical)\b|[✗✘❌]/u
const WARN_LINE = /\b(?:WARN|WARNING)\b|\b[Ww]arn(?:ing)?(?=[:\]])|\blevel=warn(?:ing)?\b|⚠/u

export type LineLevel = 'error' | 'warn'

export function lineLevel(text: string): LineLevel | null {
  if (ERROR_LINE.test(text)) return 'error'
  return WARN_LINE.test(text) ? 'warn' : null
}

// ── 筛选 ────────────────────────────────────────────────────

/** 现成的几个筛选（填进去的就是一条正则，还能改）。 */
export const FILTER_PRESETS = {
  errors: '\\b(?:fatal|error|err|critical|panic)\\b|[✗✘❌]',
  problems: '\\b(?:fatal|error|err|critical|panic|warn|warning)\\b|[✗✘❌⚠]',
} as const
export type FilterPreset = keyof typeof FILTER_PRESETS

/** 筛选写得不对的原因（V8 的原话去掉前缀）；对的、没写字、不是正则的是 `null`。 */
export function filterProblem(filter: LineFilter | undefined): string | null {
  if (filter === undefined || filter.pattern === '' || filter.regex !== true) return null
  try {
    new RegExp(filter.pattern, filter.caseSensitive === true ? 'gu' : 'giu')
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return message.replace(/^Invalid regular expression: \/.*\/[a-z]*: /su, '')
  }
}

/** 真的在筛：写了字、而且写得对。 */
export function activeFilter(filter: LineFilter | undefined): LineFilter | undefined {
  return filter !== undefined && filter.pattern !== '' && filterProblem(filter) === null
    ? filter
    : undefined
}

/** 筛选的身份串（换了筛选就重读）。 */
export function filterKey(filter: LineFilter | undefined): string {
  if (filter === undefined) return ''
  return [
    filter.regex ? 'r' : 's',
    filter.caseSensitive ? 'c' : 'i',
    filter.invert ? 'v' : '',
    filter.context ?? 0,
    filter.pattern,
  ].join('|')
}

/** 卡片里文件超过这么大时，「自动」停在末尾（再大从头看的多半看不到要看的）。 */
const BIG_TEXT = 1024 * 1024

/**
 * 「看哪一段」落到实处（日志和表格共用）：写了就按写的；自动 = `.log`、写它的步骤正在跑、文件超过 1 MB 时看末尾，别的从头。
 */
export function linesFrom(
  view: { from?: ViewFrom | undefined },
  context: { log: boolean; writing: boolean; size: number },
): ViewFrom {
  if (view.from !== undefined) return view.from
  return context.log || context.writing || context.size > BIG_TEXT ? 'end' : 'start'
}

/** 一行里命中的几段切开：`[文字, 是不是命中]`。 */
export function splitHits(text: string, hits: readonly number[] | undefined): [string, boolean][] {
  if (hits === undefined || hits.length === 0) return [[text, false]]
  const parts: [string, boolean][] = []
  let at = 0
  for (let index = 0; index + 1 < hits.length; index += 2) {
    const from = Math.max(at, hits[index] as number)
    const to = Math.min(text.length, hits[index + 1] as number)
    if (to <= from) continue
    if (from > at) parts.push([text.slice(at, from), false])
    parts.push([text.slice(from, to), true])
    at = to
  }
  if (at < text.length) parts.push([text.slice(at), false])
  return parts
}
