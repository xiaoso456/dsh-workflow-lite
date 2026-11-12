/**
 * dsh-workflow-lite — 条件轮询：每隔一段时间跑一次命令，按判定方式决定这一次触不触发。
 *
 * - 命令成功时触发（退出码 0）：只在「上一次不成功、这一次成功」时触发，条件一直成立不反复触发；
 * - 输出变了时触发：和上一次的输出不一样就触发，第一次只记下不触发；命令返回非零的那次不拿来比。
 *
 * 上一次的结果（{@link Probe}）由调用方存进本机状态，DSH 重启、换了负责的进程也接得上，不会因为重启多触发一次。
 * 命令跑不起来（找不到、启动不了、超时）算一次失败，交给调用方计数；条件不满足不算失败。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/poller
 */

import { createHash } from 'node:crypto'
import type { PollWhen } from '../../shared/types.ts'
import { INFO_MAX_CHARS } from './intake.ts'
import { type CommandSpec, type RunResult, runCommand } from './processes.ts'

/** 一次检查最长跑多久（再长按超时算失败）。 */
export const POLL_TIMEOUT_MAX_MS = 5 * 60_000

/** 上一次检查的结果。 */
export interface Probe {
  /** 成功时触发：上一次是不是成功。 */
  ok?: boolean
  /** 输出变了时触发：上一次输出的摘要。 */
  digest?: string
}

/** 一次检查之后的情况。 */
export interface PollCheck {
  at: number
  /** 这一次触发了没有。 */
  met: boolean
  /** 下一次检查的时刻。 */
  next: number
  probe: Probe
  /** 给人看的一句（「命令返回 1」）。 */
  note?: string
  /** 命令没跑成的原因（算一次失败）。 */
  failure?: string
  /** 这次的输出（标准输出 + 错误输出，只留最后一截），给人看最近的输出用。 */
  output?: string
}

/** 最近的输出里一次检查留多少字符。 */
const CHECK_OUTPUT_CHARS = 4000

function outputOf(result: RunResult): string | undefined {
  const text = [result.output.trim(), result.errors].filter((part) => part !== '').join('\n')
  return text === '' ? undefined : `${text.slice(-CHECK_OUTPUT_CHARS)}\n`
}

export interface PollHandlers {
  /** 这一次触发了：命令的输出作为背景信息。 */
  fire(output: string): void
  /** 命令跑不起来。 */
  fail(reason: string): void
  checked(check: PollCheck): void
}

export interface PollSpec extends CommandSpec {
  seconds: number
  when: PollWhen
  probe?: Probe
}

type Run = (
  spec: CommandSpec,
  limits: { timeoutMs: number; maxBytes: number },
) => Promise<RunResult>

/** 一次检查的判定：纯函数（便于单测）。 */
export function judge(
  when: PollWhen,
  previous: Probe,
  result: RunResult,
): { met: boolean; probe: Probe; note?: string } {
  if (when === 'success') {
    const ok = result.code === 0
    return {
      met: ok && previous.ok !== true,
      probe: { ok },
      ...(ok ? {} : { note: `命令返回 ${String(result.code)}` }),
    }
  }
  if (result.code !== 0) {
    return { met: false, probe: previous, note: `命令返回 ${String(result.code)}，这次不比较` }
  }
  const digest = createHash('sha256').update(result.output.trim()).digest('hex')
  if (previous.digest === undefined) {
    return { met: false, probe: { digest }, note: '第一次检查，只记下输出' }
  }
  return { met: digest !== previous.digest, probe: { digest } }
}

export class Poller {
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private probe: Probe

  constructor(
    private readonly spec: PollSpec,
    private readonly handlers: PollHandlers,
    private readonly run: Run = runCommand,
    private readonly now: () => number = Date.now,
  ) {
    this.probe = spec.probe ?? {}
  }

  /** 开始：马上检查一次，之后每次跑完隔一个间隔再跑。 */
  start(): void {
    this.queue(0)
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  private queue(delay: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.check()
    }, delay)
  }

  private async check(): Promise<void> {
    const result = await this.run(this.spec, {
      timeoutMs: Math.min(this.spec.seconds * 1000, POLL_TIMEOUT_MAX_MS),
      maxBytes: INFO_MAX_CHARS,
    })
    // 跑的时候被停了：结果不作数。
    if (this.stopped) return
    const at = this.now()
    const next = at + this.spec.seconds * 1000
    const output = outputOf(result)
    const shown = output === undefined ? {} : { output }
    if (result.failure !== undefined) {
      this.handlers.fail(result.failure)
      this.handlers.checked({
        at,
        met: false,
        next,
        probe: this.probe,
        note: result.failure,
        failure: result.failure,
        ...shown,
      })
    } else {
      const verdict = judge(this.spec.when, this.probe, result)
      this.probe = verdict.probe
      if (verdict.met) this.handlers.fire(result.output)
      this.handlers.checked({
        at,
        met: verdict.met,
        next,
        probe: verdict.probe,
        ...(verdict.note === undefined ? {} : { note: verdict.note }),
        ...shown,
      })
    }
    this.queue(this.spec.seconds * 1000)
  }
}
