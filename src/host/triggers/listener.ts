/**
 * dsh-workflow-lite — 监视程序：拉起用户的常驻命令，它往标准输出打一行 `::trigger::` 开头的事件就是一次触发
 * （见 `shared/triggerMark.ts`）；别的行都是日志，只进「最近的输出」。
 *
 * 意外退出按退避重启（2 秒起，翻倍，最长 1 分钟；跑满 1 分钟后退避从头算）。
 * 启动后不到 1 分钟就退出算一次失败（脚本有错、命令不存在、依赖没装），交给调用方计数；
 * 跑满 1 分钟再退出的只重启、不计数——跑满 1 分钟同时说明它好了，调用方据此清掉失败计数。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/listener
 */

import { eventOf } from '../../shared/triggerMark.ts'
import {
  type CommandSpec,
  type ExitInfo,
  type LiveProcess,
  type OutputStream,
  startProcess,
} from './processes.ts'

/** 跑满这么久才算「起来了」。 */
export const HEALTHY_MS = 60_000
const BACKOFF_MIN_MS = 2_000
const BACKOFF_MAX_MS = 60_000

/** 第 `attempt` 次重启前等多久（从 1 数起）。 */
export function backoff(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempt - 1))
}

export interface ListenerHandlers {
  /** 打出了一行事件：`info` 是标记后面的背景信息（可以是空串）。 */
  event(info: string): void
  /** 两路输出的每一行（看最近的输出用）。 */
  output(line: string, stream: OutputStream): void
  /** 程序起来了（`restarts` 是这是第几次重启，第一次启动是 0）。 */
  running(info: { since: number; restarts: number }): void
  /** 程序跑满了 {@link HEALTHY_MS}。 */
  healthy(): void
  /**
   * 程序退出了，`retryAt` 时重启；`counted` 表示这次算一次失败。
   * `code` 是退出码（被信号结束、没跑起来是 `null`），`failed` 表示根本没跑起来（启动不了、找不到命令）。
   */
  exited(info: {
    reason: string
    counted: boolean
    retryAt: number
    restarts: number
    code: number | null
    failed: boolean
  }): void
}

type Start = typeof startProcess

/** 退出的一句话说法。 */
export function exitText(info: ExitInfo, ranMs: number): string {
  if (info.failure !== undefined) return info.failure
  const seconds = Math.max(1, Math.round(ranMs / 1000))
  const how =
    info.signal !== null ? `被信号 ${info.signal} 结束` : `退出码 ${String(info.code ?? '未知')}`
  const tail = info.errors === '' ? '' : `：${info.errors.split(/\r?\n/u).slice(-3).join(' ')}`
  return `监视程序运行 ${String(seconds)} 秒后退出了（${how}）${tail}`
}

export class Listener {
  private current: LiveProcess | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private healthyTimer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private restarts = 0

  constructor(
    private readonly spec: CommandSpec,
    private readonly handlers: ListenerHandlers,
    private readonly start_: Start = startProcess,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.launch()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    if (this.healthyTimer !== undefined) clearTimeout(this.healthyTimer)
    this.timer = undefined
    this.healthyTimer = undefined
    const running = this.current
    this.current = undefined
    await running?.stop()
  }

  private launch(): void {
    if (this.stopped) return
    const since = this.now()
    this.current = this.start_(this.spec, {
      onLine: (line) => {
        if (this.stopped) return
        const info = eventOf(line)
        if (info !== null) this.handlers.event(info)
      },
      onOutput: (line, stream) => this.handlers.output(line, stream),
      onExit: (info) => this.onExit(info, since),
    })
    this.handlers.running({ since, restarts: this.restarts })
    this.healthyTimer = setTimeout(() => {
      this.healthyTimer = undefined
      this.restarts = 0
      this.handlers.healthy()
    }, HEALTHY_MS)
  }

  private onExit(info: ExitInfo, since: number): void {
    if (this.stopped) return
    if (this.healthyTimer !== undefined) clearTimeout(this.healthyTimer)
    this.healthyTimer = undefined
    this.current = undefined
    const ran = this.now() - since
    this.restarts += 1
    const wait = backoff(this.restarts)
    this.handlers.exited({
      reason: exitText(info, ran),
      counted: ran < HEALTHY_MS,
      retryAt: this.now() + wait,
      restarts: this.restarts,
      code: info.signal === null ? info.code : null,
      failed: info.failure !== undefined,
    })
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.launch()
    }, wait)
  }
}
