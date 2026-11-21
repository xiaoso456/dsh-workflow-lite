/**
 * dsh-workflow-lite — 「触发方式」对话框里试一试：把还没保存的命令跑一次（{@link tryCommand}），
 * 或者带上令牌向一张 HTTP 触发卡片的地址发一条请求（{@link pingHook}）。
 *
 * 只给人看结果：不动开关、不记触发记录（测试请求例外——它和别的程序发来的一样被收下、发进会话）。
 * 命令由用户在界面上确认过才跑，跑法和真正打开开关后一样（选定的 shell、工作区、`{workflow}` 换好）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/trial
 */

import { eventOf } from '../../shared/triggerMark.ts'
import type { TriggerPingResponse, TriggerTryResponse, TryLine } from '../../shared/wire/trigger.ts'
import { type CommandSpec, runCommand, startProcess } from './processes.ts'

/** 检查的试运行最长等多久。 */
export const TRIAL_TIMEOUT_MS = 60_000
/** 监听的试运行跑多久。 */
export const TRIAL_LISTEN_MS = 5_000
/** 输出留多少字符（最后一截）。 */
export const TRIAL_OUTPUT_CHARS = 6000
/** 测试请求最长等多久。 */
export const PING_TIMEOUT_MS = 10_000
/** 测试请求的回应留多少字符。 */
const PING_TEXT_CHARS = 500
/** 测试请求带的正文：收到的会话里看得出这是一条测试。 */
export const PING_BODY = '{"test":true,"from":"workflow-lite"}'

/** 只留最后 {@link TRIAL_OUTPUT_CHARS} 个字以内的行。 */
function tail(lines: readonly TryLine[]): TryLine[] {
  let size = 0
  let from = lines.length
  while (from > 0) {
    const next = (lines[from - 1]?.text.length ?? 0) + 1
    if (size + next > TRIAL_OUTPUT_CHARS) break
    size += next
    from -= 1
  }
  return lines.slice(from)
}

/** 一段输出切成行（去掉末尾那个空行）。 */
function split(text: string, stream: TryLine['stream']): TryLine[] {
  const lines = text.replace(/\r?\n$/u, '').split(/\r?\n/u)
  return text === '' ? [] : lines.map((line) => ({ stream, text: line }))
}

/** 标准输出里有几行事件。 */
function eventCount(lines: readonly TryLine[]): number {
  return lines.filter((line) => line.stream === 'out' && eventOf(line.text) !== null).length
}

/** 定时检查：跑一次、等它结束。 */
export async function tryCheck(
  spec: CommandSpec,
  timeoutMs = TRIAL_TIMEOUT_MS,
): Promise<TriggerTryResponse> {
  const started = Date.now()
  const result = await runCommand(spec, { timeoutMs, maxBytes: TRIAL_OUTPUT_CHARS * 4 })
  const lines = [...split(result.output, 'out'), ...split(result.stderr ?? result.errors, 'err')]
  return {
    code: result.code,
    lines: tail(lines),
    events: eventCount(lines),
    ms: Date.now() - started,
    ...(result.failure === undefined ? {} : { failure: result.failure }),
  }
}

/** 监视：跑 `ms` 毫秒，收下这段时间打出的行、数出几行事件；先退出了就记下退出码。 */
export function tryListen(spec: CommandSpec, ms = TRIAL_LISTEN_MS): Promise<TriggerTryResponse> {
  const started = Date.now()
  return new Promise((resolve) => {
    let lines: TryLine[] = []
    let events = 0
    let done = false
    const finish = (result: Omit<TriggerTryResponse, 'lines' | 'events' | 'ms'>): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ...result, lines, events, ms: Date.now() - started })
    }
    const live = startProcess(spec, {
      onLine: (line) => {
        if (eventOf(line) !== null) events += 1
      },
      onOutput: (line, stream) => {
        lines = tail([...lines, { stream, text: line }])
      },
      onExit: (info) => {
        finish({
          code: info.code,
          ...(info.failure === undefined ? {} : { failure: info.failure }),
        })
      },
    })
    const timer = setTimeout(() => {
      // 到点还在跑：结束它，等它真的退出再交结果（输出读全）。
      void live.stop().then(() => finish({ code: null, stopped: true }))
    }, ms)
  })
}

/** 带上令牌向 `url` 发一条 POST。连不上、超时回一句原因。 */
export async function pingHook(
  url: string,
  /** `null` = 地址不校验令牌，不带。 */
  token: string | null,
  timeoutMs = PING_TIMEOUT_MS,
): Promise<TriggerPingResponse | { failure: string }> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
        'content-type': 'application/json',
      },
      body: PING_BODY,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = (await response.text()).slice(0, PING_TEXT_CHARS)
    return { status: response.status, text }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { failure: `连不上 ${url}：${reason}` }
  }
}
