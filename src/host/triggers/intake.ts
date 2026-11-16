/**
 * dsh-workflow-lite — 触发信息进来之后、发进会话之前的几道过滤：关键字、去重、合并。都不花模型调用。
 *
 * 定时检查、监听程序、HTTP 进来的每一段内容都先过这里：关键字不对的、去重时长内见过的直接丢掉（不记触发记录，
 * 免得日志刷屏时记录也被刷满）；剩下的在合并窗口里攒着，窗口一到并成一次交出去。
 * 窗口从第一段进来时算起、不随后来的顺延，内容一直不停时也按窗口一次一次地触发。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/intake
 */

import { createHash } from 'node:crypto'
import { type FilterSettings, keywordMiss } from '../../shared/trigger.ts'

/** 一次触发最多带多少背景信息（字符）；合并时超出的段不放进去，只计数。 */
export const INFO_MAX_CHARS = 256 * 1024

/** 交出去的一批。 */
export interface IntakeBatch {
  /** 背景信息（几段按到达顺序拼在一起）；定时、空输出时没有。 */
  info?: string
  /** 并进来了几段。 */
  count: number
}

export interface IntakeClock {
  now(): number
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const realClock: IntakeClock = {
  now: Date.now,
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class Intake {
  private readonly seen = new Map<string, number>()
  private parts: string[] = []
  private count = 0
  private size = 0
  private timer: unknown

  /**
   * @param joiner 几段之间用什么隔开（监听程序的一行一行用换行，HTTP 的请求体用分隔线）。
   */
  constructor(
    private readonly filter: FilterSettings,
    private readonly joiner: string,
    private readonly deliver: (batch: IntakeBatch) => void,
    private readonly clock: IntakeClock = realClock,
  ) {}

  /** 进来一段（空的也算一次：命令成功了但没输出、HTTP 没带请求体）。 */
  push(content: string): void {
    const text = content.trim()
    if (text !== '' && keywordMiss(this.filter, text) !== null) return
    if (text === '' && this.filter.include.length > 0) return
    if (this.duplicate(text)) return
    if (this.filter.merge <= 0) {
      this.deliver({ ...(text === '' ? {} : { info: text.slice(0, INFO_MAX_CHARS) }), count: 1 })
      return
    }
    this.count += 1
    if (text !== '' && this.size + text.length <= INFO_MAX_CHARS) {
      this.parts.push(text)
      this.size += text.length + this.joiner.length
    }
    if (this.timer === undefined) {
      this.timer = this.clock.setTimeout(() => this.flush(), this.filter.merge * 1000)
    }
  }

  /** 去重时长内见过一样的内容：是重复的。见过的记号过期就清掉。 */
  private duplicate(text: string): boolean {
    if (this.filter.dedupe <= 0) return false
    const now = this.clock.now()
    for (const [key, until] of this.seen) if (until <= now) this.seen.delete(key)
    const key = createHash('sha256').update(text).digest('hex')
    if (this.seen.has(key)) return true
    this.seen.set(key, now + this.filter.dedupe * 60_000)
    return false
  }

  /** 合并窗口到了：攒着的并成一次交出去。 */
  flush(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
    if (this.count === 0) return
    const batch: IntakeBatch = {
      count: this.count,
      ...(this.parts.length === 0 ? {} : { info: this.parts.join(this.joiner) }),
    }
    this.parts = []
    this.count = 0
    this.size = 0
    this.deliver(batch)
  }

  /** 停下：攒着的不再交出去。 */
  dispose(): void {
    if (this.timer !== undefined) this.clock.clearTimeout(this.timer)
    this.timer = undefined
    this.parts = []
    this.count = 0
    this.size = 0
  }
}
