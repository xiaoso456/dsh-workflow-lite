/**
 * dsh-workflow-lite — 日志、纯文本按行读（`run/lines`）：画布上只拿要显示的那几十行，不整份读进来。
 *
 * 三种读法：
 * - `tail`：从末尾（或 `before`，往上翻页时上一回的开头）往前一块一块读，凑够 `limit` 行就停；
 * - `head`：从 `from` 往后读，凑够就停（从头看、往下翻页）；
 * - `follow`：接着上一回的末尾（`from` + `tag`）往后读新追加的；文件被重写、截短过（`tag` 对不上）
 *   或者一下子多出太多，就退回 `tail` 重读。
 *
 * 带 `filter` 时只要匹配的行（可带上下文），扫到 `maxBytes` / `maxMs` 就停，说清楚只扫了多少。
 * 正则是用户写的，可能写出要回溯到天荒地老的那种：带筛选的扫描放在单独的工作线程里跑（{@link LineScanner}），
 * 超时就终止那个线程，主机不会被卡住。不带筛选的只是切行，直接在这里跑。
 *
 * {@link scanLines} 要原样搬进工作线程（`toString()` 拼成线程的源码），所以它**不能引用这个模块里的任何东西**：
 * 常量、小工具都写在函数里面，文件系统从参数传进来。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/lines
 */

import type { open as openFile } from 'node:fs/promises'
import { open, stat } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import {
  type LineFilter,
  RUN_LINES_FILTER_BYTES,
  RUN_LINES_FILTER_MS,
  RUN_LINES_MAX,
  RUN_LINES_PLAIN_BYTES,
  type RunLine,
  type RunLinesResponse,
} from '../../shared/wire.ts'

/** 一次扫描要做什么（主线程、工作线程共用，只有能结构化克隆的字段）。 */
export interface LineScanJob {
  full: string
  mode: 'tail' | 'head' | 'follow'
  /** 不筛时是行数，筛的时候是匹配的行数（上下文另算）。 */
  limit: number
  /** `tail`：读到这里为止（不含，是行首）；缺省 = 末尾。 */
  before?: number
  /** `head` / `follow`：从这里读起（行首）。 */
  from?: number
  /** `follow`：上一回末尾那几个字节的指纹。 */
  tag?: string
  /** `follow`：上一回最后一处匹配还欠几行下文。 */
  owed?: number
  filter?: LineFilter
  maxBytes: number
  maxMs: number
}

/** 扫描结果：{@link RunLinesResponse} 里和文件内容有关的那部分。 */
export type LineScanResult = Omit<
  RunLinesResponse,
  'path' | 'display' | 'exists' | 'mtime' | 'kind'
>

/**
 * 读一段、切成行、（筛的话）挑出匹配的。自成一体：见模块说明。
 * @param fs - 只用到 `open`（主线程传 `node:fs/promises`，工作线程自己 require 一份）。
 */
export async function scanLines(
  job: LineScanJob,
  fs: { open: typeof openFile },
): Promise<LineScanResult> {
  /** 一次读多少字节。 */
  const CHUNK = 64 * 1024
  /** 一行最多留多少字（再长截掉，`long` 标上；匹配也只看这么多）。 */
  const LINE_MAX = 4096
  /** 一行没有换行、长过这么多字节：不再往外找它的头尾，读到的这截当一行。 */
  const LONG_BYTES = 1024 * 1024
  /** 一行最多标几处命中。 */
  const HITS_MAX = 32
  /** 指纹取末尾多少字节。 */
  const TAG_BYTES = 64
  const ANSI =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 要去掉的就是终端转义序列
    /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/gu
  const started = Date.now()
  const handle = await fs.open(job.full, 'r')
  try {
    const size = (await handle.stat()).size
    const read = async (start: number, end: number): Promise<Buffer> => {
      const bytes = Buffer.alloc(Math.max(0, end - start))
      if (bytes.length === 0) return bytes
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, start)
      return bytes.subarray(0, bytesRead)
    }
    /** 指纹：`end` 前面那几个字节的 FNV-1a（连同 `end` 本身），续读时用来认「还是那份文件」。 */
    const tagAt = async (end: number): Promise<string> => {
      const bytes = await read(Math.max(0, end - TAG_BYTES), end)
      let hash = 0x811c9dc5
      for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0
      return `${end.toString(36)}.${hash.toString(36)}`
    }
    const utf8 = new TextDecoder('utf-8', { fatal: true })
    let gb: TextDecoder | null | undefined
    /** 先按 UTF-8 严格解，解不通退到 GB18030（和 `run/file` 一样）；换行字节在这两种编码里都不会出现在字的中间。 */
    const decode = (bytes: Uint8Array): string => {
      try {
        return utf8.decode(bytes)
      } catch {
        if (gb === undefined) {
          try {
            gb = new TextDecoder('gb18030')
          } catch {
            gb = null
          }
        }
        return (gb ?? new TextDecoder('utf-8')).decode(bytes)
      }
    }
    /** 从行首开始的一段切成行，带上各自的字节位置（末尾的换行之后不再算一行）。 */
    const split = (bytes: Buffer, at: number): { at: number; text: string }[] => {
      if (bytes.length === 0) return []
      const starts: number[] = [0]
      for (let index = bytes.indexOf(0x0a); index >= 0; index = bytes.indexOf(0x0a, index + 1)) {
        if (index + 1 < bytes.length) starts.push(index + 1)
      }
      const texts = decode(bytes).split('\n')
      return starts.map((start, index) => ({ at: at + start, text: texts[index] ?? '' }))
    }

    // 筛选：普通文字转义成正则；都按 Unicode，缺省不分大小写。
    const filter = job.filter
    let pattern: RegExp | null = null
    if (filter !== undefined && filter.pattern !== '') {
      const source = filter.regex
        ? filter.pattern
        : filter.pattern.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
      pattern = new RegExp(source, filter.caseSensitive ? 'gu' : 'giu')
    }
    // 10 = LINE_CONTEXT_MAX（这个函数要原样搬进工作线程，不能 import）。
    const context = pattern === null ? 0 : Math.max(0, Math.min(10, filter?.context ?? 0))
    /** 整理一行：去掉行尾回车与终端颜色码，太长的截掉；筛的话标出命中的几段，`hit` = 这行要不要。 */
    const shape = (raw: string, at: number): { line: RunLine; hit: boolean } => {
      let text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
      if (text.includes('\u001b')) text = text.replace(ANSI, '')
      const line: RunLine = { at, text }
      if (text.length > LINE_MAX) {
        line.text = text.slice(0, LINE_MAX)
        line.long = true
      }
      if (pattern === null) return { line, hit: true }
      pattern.lastIndex = 0
      const hits: number[] = []
      let found = false
      for (let match = pattern.exec(line.text); match !== null; match = pattern.exec(line.text)) {
        found = true
        if (match[0] === '') {
          // 空匹配（`^`、`x*`）：算这行匹配，但没有能标的一段；往前挪一格免得原地打转。
          pattern.lastIndex += 1
          if (pattern.lastIndex > line.text.length) break
          continue
        }
        hits.push(match.index, match.index + match[0].length)
        if (hits.length >= HITS_MAX * 2) break
      }
      if (filter?.invert === true) return { line, hit: !found }
      if (hits.length > 0) line.hits = hits
      return { line, hit: found }
    }
    const overBudget = (scanned: number): 'bytes' | 'time' | null =>
      scanned >= job.maxBytes ? 'bytes' : Date.now() - started >= job.maxMs ? 'time' : null
    /** 收行：`seq` 是扫到的第几行（往后读从 0 往上数；往前读也从 0 数，越早的号越大）。 */
    type Entry = { line: RunLine; seq: number }

    // ── 往后读（head / follow）─────────────────────────────
    const forward = async (
      from: number,
      owedIn: number,
      toEnd: boolean,
    ): Promise<LineScanResult> => {
      const out: Entry[] = []
      /** 上文：最近几行没收进去的（遇到匹配时补上）。 */
      const recent: Entry[] = []
      let matched = 0
      let seq = 0
      let owed = owedIn
      let pos = from
      let end = from
      let pending: RunLine | undefined
      let stopped: 'bytes' | 'time' | undefined
      let full = false
      while (pos < size && !full) {
        let bytes = await read(pos, Math.min(size, pos + CHUNK))
        let last = bytes.lastIndexOf(0x0a)
        // 一块里一个换行都没有：往后多读几块凑出整行（太长的读到上限为止当一行）。
        while (last < 0 && pos + bytes.length < size && bytes.length < LONG_BYTES) {
          const more = await read(pos + bytes.length, Math.min(size, pos + bytes.length + CHUNK))
          if (more.length === 0) break
          bytes = Buffer.concat([bytes, more])
          last = bytes.lastIndexOf(0x0a)
        }
        const eof = pos + bytes.length >= size
        const whole = last >= 0 ? last + 1 : eof ? 0 : bytes.length
        if (eof && whole < bytes.length) {
          // 最后一行还没写完（没有换行）：单放，不算进游标，下回续读时它写完了再算。
          const shaped = shape(decode(bytes.subarray(whole)), pos + whole)
          if (shaped.hit) pending = shaped.line
        }
        const lines = split(bytes.subarray(0, whole), pos)
        for (const [index, raw] of lines.entries()) {
          const { line, hit } = shape(raw.text, raw.at)
          if (hit) {
            out.push(
              ...recent.map((entry) => ({
                line: { ...entry.line, ctx: true as const },
                seq: entry.seq,
              })),
            )
            recent.length = 0
            out.push({ line, seq })
            matched += 1
            owed = context
          } else if (owed > 0) {
            out.push({ line: { ...line, ctx: true }, seq })
            owed -= 1
          } else if (context > 0) {
            recent.push({ line, seq })
            if (recent.length > context) recent.shift()
          }
          seq += 1
          if (!toEnd && matched >= job.limit && owed === 0) {
            end = lines[index + 1]?.at ?? pos + whole
            full = true
            pending = undefined
            break
          }
        }
        if (full) break
        end = pos + whole
        if (whole === 0) break
        pos += whole
        const over = toEnd ? null : overBudget(pos - from)
        if (over !== null && pos < size) {
          stopped = over
          pending = undefined
          break
        }
      }
      // 续读时一下子多出太多：只留最后那些，中间断开了（`gap`），前端别和上一回的接上。
      const cap = job.limit * (1 + 2 * context)
      const gap = out.length > cap
      const kept = gap ? out.slice(out.length - cap) : out
      const lines = kept.map((entry, index) => {
        const previous = index === 0 ? -1 : (kept[index - 1] as Entry).seq
        const skip = entry.seq - previous - 1
        return skip > 0 && !(gap && index === 0) ? { ...entry.line, skip } : entry.line
      })
      return {
        size,
        lines,
        ...(pending === undefined ? {} : { pending }),
        start: gap ? (lines[0]?.at ?? from) : from,
        end,
        tag: await tagAt(end),
        trail: seq - (kept.at(-1)?.seq ?? -1) - 1,
        matched,
        more: pending === undefined && end < size,
        ...(owed > 0 ? { owed } : {}),
        ...(stopped === undefined ? {} : { stopped }),
        ...(gap ? { gap: true } : {}),
      }
    }

    // ── 往前读（tail）──────────────────────────────────────
    const backward = async (before: number): Promise<LineScanResult> => {
      let hi = before
      let pending: RunLine | undefined
      if (before === size && size > 0) {
        // 从末尾读：最后一行没写完（还没换行）的单放，不算进游标。
        const tail = await read(Math.max(0, size - CHUNK), size)
        const last = tail.lastIndexOf(0x0a)
        const cut = last >= 0 ? size - tail.length + last + 1 : size - tail.length
        if (cut < size) {
          const shaped = shape(decode(tail.subarray(cut - (size - tail.length))), cut)
          if (last < 0 && cut > 0) shaped.line.long = true
          if (shaped.hit) pending = shaped.line
          // 一整块都没有换行（一行几百 KB 的那种）：就看这一截，不再往前找。
          hi = last >= 0 ? cut : 0
        }
      }
      const end = hi
      /** 倒着收（新的在前），最后翻过来。 */
      const out: Entry[] = []
      /** 下文：最近几行没收进去的（倒着读时它们在后面；遇到匹配时补上）。 */
      const recent: Entry[] = []
      let matched = 0
      let seq = 0
      let wantBefore = 0
      /** 最新那处匹配的号（= 它后面还有几行）：从末尾读时它的下文可能还没写出来。 */
      let newest = -1
      let start = hi
      let stopped: 'bytes' | 'time' | undefined
      let done = false
      while (hi > 0 && !done) {
        let lo = Math.max(0, hi - CHUNK)
        let chunk = await read(lo, hi)
        // 这一块的第一行多半只读到后半截：从第一个换行之后算起，前半截留给下一块。
        // 末尾那个换行不算（那是最后一行的结尾）；一整块里没有别的换行就再往前读，太长了就把读到的当一行。
        const firstBreak = (bytes: Buffer): number => {
          const index = bytes.indexOf(0x0a)
          return index >= 0 && index < bytes.length - 1 ? index : -1
        }
        let k = lo > 0 ? firstBreak(chunk) : -1
        while (lo > 0 && k < 0 && hi - lo < LONG_BYTES) {
          const next = Math.max(0, lo - CHUNK)
          chunk = Buffer.concat([await read(next, lo), chunk])
          lo = next
          k = lo > 0 ? firstBreak(chunk) : -1
        }
        const first = lo > 0 && k >= 0 ? k + 1 : 0
        const lines = split(chunk.subarray(first), lo + first)
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          const raw = lines[index] as { at: number; text: string }
          const { line, hit } = shape(raw.text, raw.at)
          if (lo > 0 && k < 0 && index === 0) line.long = true
          start = raw.at
          if (hit) {
            out.push(
              ...recent.map((entry) => ({
                line: { ...entry.line, ctx: true as const },
                seq: entry.seq,
              })),
            )
            recent.length = 0
            out.push({ line, seq })
            if (matched === 0) newest = seq
            matched += 1
            wantBefore = context
          } else if (wantBefore > 0) {
            out.push({ line: { ...line, ctx: true }, seq })
            wantBefore -= 1
          } else if (context > 0) {
            recent.push({ line, seq })
            if (recent.length > context) recent.shift()
          }
          seq += 1
          if (matched >= job.limit && wantBefore === 0) {
            done = true
            break
          }
        }
        if (done) break
        hi = lo + first
        start = hi
        const over = overBudget(end - hi)
        if (over !== null && hi > 0) {
          stopped = over
          break
        }
      }
      out.reverse()
      const lines = out.map((entry, index) => {
        // 和前一条（更早的那条；第一条是扫到的最早那行之前）之间隔了几行。
        const previous = index === 0 ? seq : (out[index - 1] as Entry).seq
        const skip = previous - entry.seq - 1
        return skip > 0 ? { ...entry.line, skip } : entry.line
      })
      return {
        size,
        lines,
        ...(pending === undefined ? {} : { pending }),
        start,
        end,
        tag: await tagAt(end),
        trail: out.at(-1)?.seq ?? seq,
        matched,
        more: start > 0,
        ...(before === size && newest >= 0 && newest < context ? { owed: context - newest } : {}),
        ...(stopped === undefined ? {} : { stopped }),
      }
    }

    if (job.mode === 'follow') {
      const from = job.from ?? 0
      const same =
        job.tag !== undefined &&
        from <= size &&
        size - from <= job.maxBytes &&
        (await tagAt(from)) === job.tag
      if (same) return { ...(await forward(from, job.owed ?? 0, true)), appended: true }
      return await backward(size)
    }
    // 要等扫完再关文件（下面 finally 里关）。
    if (job.mode === 'head') return await forward(Math.min(job.from ?? 0, size), 0, false)
    return await backward(Math.min(job.before ?? size, size))
  } finally {
    await handle.close()
  }
}

/** 正则写得对不对（只编译，不跑）：不对回原因。 */
export function patternError(filter: LineFilter | undefined): string | null {
  if (filter === undefined || filter.pattern === '' || !filter.regex) return null
  try {
    new RegExp(filter.pattern, filter.caseSensitive ? 'gu' : 'giu')
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

/** 工作线程的源码：收一个任务、扫完回去（任务之间互不等）。 */
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads')
const fs = require('node:fs/promises')
const scanLines = (${scanLines.toString()})
parentPort.on('message', ({ id, job }) => {
  scanLines(job, fs).then(
    (result) => parentPort.postMessage({ id, ok: true, result }),
    (error) => parentPort.postMessage({ id, ok: false, message: String((error && error.message) || error) }),
  )
})
`

/** 一个任务在工作线程里最多跑多久（比扫描自己的时间预算宽：那个预算只在块之间查，一条正则卡在一行里查不到）。 */
export const LINE_WORKER_TIMEOUT = 1500

/** 空闲这么久就把线程收掉。 */
const WORKER_IDLE_MS = 60_000

/** 正则太慢、被终止了。 */
export class SlowPatternError extends Error {
  constructor() {
    super('这条正则太慢，已停下')
  }
}

interface Pending {
  job: LineScanJob
  resolve(result: LineScanResult): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  /** 被别人连累（同线程的任务超时、线程被终止）重来过一次了。 */
  retried: boolean
}

/**
 * 带筛选的扫描放在一个工作线程里跑：一个任务超时就终止整个线程，那个任务回 {@link SlowPatternError}，
 * 同线程里被连累的任务换个新线程重来一次。线程不拖住主机退出，空闲一会儿就收掉。
 */
export class LineScanner {
  private worker: Worker | null = null
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private idle: ReturnType<typeof setTimeout> | null = null

  private readonly timeout: number

  constructor(timeout = LINE_WORKER_TIMEOUT) {
    this.timeout = timeout
  }

  scan(job: LineScanJob): Promise<LineScanResult> {
    return new Promise((resolve, reject) => {
      this.post({ job, resolve, reject, retried: false })
    })
  }

  /** 收掉线程（插件卸载时）。 */
  dispose(): void {
    if (this.idle !== null) clearTimeout(this.idle)
    void this.worker?.terminate()
    this.worker = null
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(new Error('扫描已取消'))
    }
    this.pending.clear()
  }

  private post(entry: Omit<Pending, 'timer'>): void {
    const worker = this.ensure()
    const id = this.nextId
    this.nextId += 1
    const timer = setTimeout(() => this.timedOut(id), this.timeout)
    this.pending.set(id, { ...entry, timer })
    if (this.idle !== null) clearTimeout(this.idle)
    worker.postMessage({ id, job: entry.job })
  }

  private ensure(): Worker {
    if (this.worker !== null) return this.worker
    const worker = new Worker(WORKER_SOURCE, { eval: true })
    worker.unref()
    worker.on(
      'message',
      (message: { id: number; ok: boolean; result?: LineScanResult; message?: string }) => {
        const entry = this.pending.get(message.id)
        if (entry === undefined) return
        clearTimeout(entry.timer)
        this.pending.delete(message.id)
        if (message.ok) entry.resolve(message.result as LineScanResult)
        else entry.reject(new Error(message.message ?? '扫描失败'))
        this.settle()
      },
    )
    worker.on('error', (error) => this.crashed(worker, error))
    worker.on('exit', () => {
      if (this.worker === worker) this.crashed(worker, new Error('扫描线程退出了'))
    })
    this.worker = worker
    return worker
  }

  private timedOut(id: number): void {
    const entry = this.pending.get(id)
    if (entry === undefined) return
    this.pending.delete(id)
    entry.reject(new SlowPatternError())
    const worker = this.worker
    if (worker !== null) this.crashed(worker, new SlowPatternError())
  }

  /** 线程没了（终止、出错）：还在等的任务换个新线程重来一次，再不行就报错。 */
  private crashed(worker: Worker, error: Error): void {
    if (this.worker !== worker) return
    this.worker = null
    void worker.terminate()
    const waiting = [...this.pending.values()]
    this.pending.clear()
    for (const entry of waiting) {
      clearTimeout(entry.timer)
      if (entry.retried) entry.reject(error)
      else
        this.post({ job: entry.job, resolve: entry.resolve, reject: entry.reject, retried: true })
    }
    this.settle()
  }

  private settle(): void {
    if (this.pending.size > 0 || this.worker === null) return
    if (this.idle !== null) clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      if (this.pending.size === 0) {
        void this.worker?.terminate()
        this.worker = null
      }
    }, WORKER_IDLE_MS)
    this.idle.unref?.()
  }
}

/** 开头这么多字节里有 NUL 就当二进制（和 `run/file` 一样）。 */
const SNIFF_BYTES = 8192

/** 读几行给画布：先看在不在、是不是二进制或 UTF-16（这两种不按行读），再扫。 */
export async function readRunLines(
  full: string,
  display: string,
  request: {
    mode: LineScanJob['mode']
    limit: number
    before?: number
    from?: number
    tag?: string
    owed?: number
    filter?: LineFilter
  },
  scanner: LineScanner,
): Promise<RunLinesResponse> {
  const base = { path: full, display }
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(full)
  } catch {
    return { ...base, ...emptyLines, lines: [], exists: false, mtime: 0, kind: 'missing' }
  }
  if (!info.isFile())
    return { ...base, ...emptyLines, lines: [], exists: false, mtime: 0, kind: 'missing' }
  const meta = { ...base, exists: true, mtime: info.mtimeMs }
  const handle = await open(full, 'r')
  try {
    const sniff = Buffer.alloc(Math.min(SNIFF_BYTES, info.size))
    await handle.read(sniff, 0, sniff.length, 0)
    const utf16 =
      (sniff[0] === 0xff && sniff[1] === 0xfe) || (sniff[0] === 0xfe && sniff[1] === 0xff)
    if (utf16) return { ...meta, ...emptyLines, lines: [], size: info.size, kind: 'utf16' }
    if (sniff.includes(0))
      return { ...meta, ...emptyLines, lines: [], size: info.size, kind: 'binary' }
  } finally {
    await handle.close()
  }
  const filtered = request.filter !== undefined && request.filter.pattern !== ''
  const job: LineScanJob = {
    full,
    mode: request.mode,
    limit: Math.max(1, Math.min(RUN_LINES_MAX, Math.round(request.limit))),
    ...(request.before === undefined ? {} : { before: request.before }),
    ...(request.from === undefined ? {} : { from: request.from }),
    ...(request.tag === undefined ? {} : { tag: request.tag }),
    ...(request.owed === undefined ? {} : { owed: request.owed }),
    ...(filtered ? { filter: request.filter } : {}),
    maxBytes: filtered ? RUN_LINES_FILTER_BYTES : RUN_LINES_PLAIN_BYTES,
    maxMs: filtered ? RUN_LINES_FILTER_MS : 10_000,
  }
  const result = filtered ? await scanner.scan(job) : await scanLines(job, { open })
  return { ...meta, ...result, kind: 'lines' }
}

const emptyLines: Omit<LineScanResult, 'size' | 'lines'> & { size: number; lines: RunLine[] } = {
  size: 0,
  lines: [],
  start: 0,
  end: 0,
  tag: '',
  trail: 0,
  matched: 0,
  more: false,
}
