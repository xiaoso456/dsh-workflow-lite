/**
 * dsh-workflow-lite — 定时的检查：按定时规则到点跑一次命令，按判定决定这一次触不触发。
 *
 * - 每次成功：退出码 0 就触发；
 * - 由失败变为成功：只在「上一次不成功、这一次成功」时触发，条件一直成立不反复触发；
 * - 输出变了：和上一次的输出不一样就触发，第一次只记下不触发；命令返回非零的那次不拿来比。
 *
 * 什么时候检查：「每隔」打开就先查一次，之后每次跑完隔一个间隔（跑得久不会叠着跑）；每天几点、cron 按钟点排。
 * DSH 关着时错过的那一次，启动后补查一次（启动方式里关了「补」就跳到下一次）。
 *
 * 上一次的结果和下一次该查的时刻（{@link Probe}）由调用方存进本机状态，DSH 重启、换了负责的进程也接得上，
 * 不会因为重启多触发一次。命令跑不起来（找不到、启动不了、超时）算一次失败，交给调用方计数；条件不满足不算失败。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/poller
 */

import { createHash } from 'node:crypto'
import { nextFire } from '../../shared/schedule.ts'
import type { CheckWhen, TriggerSchedule } from '../../shared/types.ts'
import { INFO_MAX_CHARS } from './intake.ts'
import { type CommandSpec, type RunResult, runCommand } from './processes.ts'

/** 一次检查最长跑多久（再长按超时算失败）。 */
export const POLL_TIMEOUT_MAX_MS = 5 * 60_000

/** 一次最多等多久（setTimeout 超过约 24.8 天会立刻触发；按钟点排的可能隔很久），再长就分段等。 */
const MAX_WAIT_MS = 24 * 3600_000

/** 上一次检查的结果，和下一次该查的时刻。 */
export interface Probe {
  /** 由失败变为成功：上一次是不是成功。 */
  ok?: boolean
  /** 输出变了：上一次输出的摘要。 */
  digest?: string
  /** 下一次该查的时刻，和排它时用的规则（{@link ruleKey}；规则改过就不作数）。 */
  next?: { at: number; rule: string }
}

/** 一条规则的记号：存下的下一次是按哪条规则排的。 */
export function ruleKey(schedule: TriggerSchedule): string {
  return JSON.stringify(schedule)
}

/** 查完一次之后（`at`）下一次什么时候查：「每隔」从这一次跑完起算，别的按钟点。 */
export function nextCheck(schedule: TriggerSchedule, at: number): number | undefined {
  return nextFire(schedule, new Date(at), new Date(at))?.getTime()
}

/**
 * 开始（打开开关、DSH 启动、接手）时第一次什么时候查：
 * 存着的下一次还没到就等它；已经过了（DSH 关着时错过）补查一次，不补就跳到下一次；
 * 没存过时「每隔」马上查，别的等下一个钟点。
 */
export function firstCheck(
  schedule: TriggerSchedule,
  probe: Probe,
  now: number,
  catchUp: boolean,
): number | undefined {
  const saved = probe.next?.rule === ruleKey(schedule) ? probe.next.at : undefined
  if (saved !== undefined) {
    if (saved > now) return saved
    return catchUp ? now : nextFire(schedule, new Date(now))?.getTime()
  }
  return schedule.kind === 'every' ? now : nextFire(schedule, new Date(now))?.getTime()
}

/**
 * 从现在起算（全部暂停之后恢复时用）：第一次检查不触发、只记下。
 * 成功时触发——当作上次已经成功，现在成功也不算「变成成功」；输出变了时触发——没有摘要，第一次只记下。
 */
export const FRESH_PROBE: Readonly<Probe> = { ok: true }

/** 一次检查之后的情况。 */
export interface PollCheck {
  at: number
  /** 这一次触发了没有。 */
  met: boolean
  /** 下一次检查的时刻（规则再也轮不到时没有）。 */
  next?: number
  probe: Probe
  /** 给人看的一句（「命令返回 1」）。 */
  note?: string
  /** 命令没跑成的原因（算一次失败）。 */
  failure?: string
  /** 退出码；没跑起来、超时被结束时是 `null`。 */
  code: number | null
  /** 这次跑了多久（毫秒）。 */
  ms: number
  /** 这次的标准输出、错误输出（给人看最近的输出用）。 */
  out: string
  err: string
}

export interface PollHandlers {
  /** 这一次触发了：命令的输出作为背景信息。 */
  fire(output: string): void
  /** 命令跑不起来。 */
  fail(reason: string): void
  checked(check: PollCheck): void
}

export interface PollSpec extends CommandSpec {
  schedule: TriggerSchedule
  when: CheckWhen
  probe?: Probe
  /** DSH 关着时错过的那一次要不要补查（启动方式里的「补」）。 */
  catchUp: boolean
}

type Run = (
  spec: CommandSpec,
  limits: { timeoutMs: number; maxBytes: number },
) => Promise<RunResult>

/** 一次检查的判定：纯函数（便于单测）。 */
export function judge(
  when: CheckWhen,
  previous: Probe,
  result: RunResult,
): { met: boolean; probe: Probe; note?: string } {
  if (when === 'success' || when === 'every') {
    const ok = result.code === 0
    return {
      // 由失败变为成功：上一次成功过就不再触发；每次成功：成功就触发。
      met: ok && (when === 'every' || previous.ok !== true),
      probe: { ok },
      ...(ok ? {} : { note: `命令返回 ${String(result.code)}` }),
    }
  }
  if (result.code !== 0) {
    const { next: _next, ...kept } = previous
    return { met: false, probe: kept, note: `命令返回 ${String(result.code)}，这次不比较` }
  }
  const digest = createHash('sha256').update(result.output.trim()).digest('hex')
  if (previous.digest === undefined) {
    return { met: false, probe: { digest }, note: '第一次检查，只记下输出' }
  }
  return { met: digest !== previous.digest, probe: { digest } }
}

/** 一次最长跑多久：「每隔」不超过间隔，都不超过 {@link POLL_TIMEOUT_MAX_MS}。 */
function timeoutOf(schedule: TriggerSchedule): number {
  return schedule.kind === 'every'
    ? Math.min(schedule.seconds * 1000, POLL_TIMEOUT_MAX_MS)
    : POLL_TIMEOUT_MAX_MS
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

  /** 开始：第一次什么时候查见 {@link firstCheck}，之后每次查完按 {@link nextCheck} 排下一次。 */
  start(): void {
    const now = this.now()
    this.queue(firstCheck(this.spec.schedule, this.probe, now, this.spec.catchUp), now)
  }

  /** 第一次检查的时刻（开始之前问，给运行情况写「下一次」）。 */
  firstAt(): number | undefined {
    return firstCheck(this.spec.schedule, this.probe, this.now(), this.spec.catchUp)
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** 排到 `at` 那一刻查（`undefined` = 规则再也轮不到，不排）。setTimeout 等不了太久，远的分段等。 */
  private queue(at: number | undefined, now: number): void {
    if (this.stopped || at === undefined) return
    const wait = Math.max(0, at - now)
    this.timer = setTimeout(
      () => {
        this.timer = undefined
        if (wait > MAX_WAIT_MS) this.queue(at, this.now())
        else void this.check()
      },
      Math.min(wait, MAX_WAIT_MS),
    )
  }

  private async check(): Promise<void> {
    const started = this.now()
    const result = await this.run(this.spec, {
      timeoutMs: timeoutOf(this.spec.schedule),
      maxBytes: INFO_MAX_CHARS,
    })
    // 跑的时候被停了：结果不作数。
    if (this.stopped) return
    const at = this.now()
    const next = nextCheck(this.spec.schedule, at)
    const due = next === undefined ? {} : { next: { at: next, rule: ruleKey(this.spec.schedule) } }
    const shown = {
      code: result.code,
      ms: Math.max(0, at - started),
      out: result.output,
      err: result.stderr ?? result.errors,
    }
    if (result.failure !== undefined) {
      this.handlers.fail(result.failure)
      const { next: _next, ...kept } = this.probe
      this.probe = { ...kept, ...due }
      this.handlers.checked({
        at,
        met: false,
        ...(next === undefined ? {} : { next }),
        probe: this.probe,
        note: result.failure,
        failure: result.failure,
        ...shown,
      })
    } else {
      const verdict = judge(this.spec.when, this.probe, result)
      this.probe = { ...verdict.probe, ...due }
      if (verdict.met) this.handlers.fire(result.output)
      this.handlers.checked({
        at,
        met: verdict.met,
        ...(next === undefined ? {} : { next }),
        probe: this.probe,
        ...(verdict.note === undefined ? {} : { note: verdict.note }),
        ...shown,
      })
    }
    this.queue(next, at)
  }
}
