/**
 * dsh-workflow-lite — 模型试一张触发卡片（`workflow_lite` 的 `test_trigger`）：脚本能不能正确跑、这样会不会触发。
 *
 * 按图里存着的定义试，跑法和真打开后一样（工作区、shell、`{workflow}`、环境变量），只是脚本的数据目录换成试运行那份。
 * 不动开关、不记触发记录、不发进会话、不改真的检查结果；过滤按卡片上的关键字、去重、合并原样过一遍。
 *
 * - 定时：接下来几次的时刻；带检查命令的跑一次，按判定（对照真的上一次结果）和关键字说这次触不触发；
 * - 监听：跑几秒，可在启动后跑一条命令制造事件；收到的每一行过不过得了过滤、合并后算几次；提前退出的标出来；
 * - HTTP：拿一段请求体过一遍过滤（不真的发请求）；
 * - 接续：等的那个工作流能不能等、它最近结束的几个实例各会不会触发。
 *
 * 会触发时附上对面会话会收到的那条消息。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/cardTest
 */

import { upcomingFires } from '../../shared/schedule.ts'
import type { FireChannel } from '../../shared/trigger.ts'
import {
  afterMatches,
  type FilterSettings,
  filterOf,
  keywordMiss,
  scheduleJudge,
  sourceText,
} from '../../shared/trigger.ts'
import type { TriggerSource } from '../../shared/types.ts'
import { afterInfo, type FinishedRun } from './after.ts'
import type { TriggerDefinition } from './graphs.ts'
import { INFO_MAX_CHARS, Intake, type IntakeBatch, type IntakeClock, joinerOf } from './intake.ts'
import { HEALTHY_MS } from './listener.ts'
import { fireMessage, INFO_HEAD_CHARS } from './message.ts'
import { checkTimeoutOf, judge, type Probe } from './poller.ts'
import { type CommandSpec, runCommand, startProcess } from './processes.ts'
import { INFO_INLINE_CHARS } from './store.ts'

/** 监听缺省试几秒、最多几秒。 */
export const LISTEN_TEST_SECONDS = 10
export const LISTEN_TEST_MAX = 60
/** 监听启动后多久跑制造事件的那条命令。 */
const POKE_DELAY_MS = 1000
/** 制造事件的命令最长等多久。 */
const POKE_TIMEOUT_MS = 30_000
/** 定时给接下来几次。 */
const UPCOMING = 5
/** 输出、每一行留多少字；最多列几行。 */
const OUTPUT_CHARS = 4000
const LINE_CHARS = 300
const LINES_MAX = 50
/** 接续看等的那个工作流最近几个结束的实例。 */
const AFTER_RUNS = 5

export interface CardTestOptions {
  /** 监听：跑几秒（缺省 {@link LISTEN_TEST_SECONDS}，最多 {@link LISTEN_TEST_MAX}）。 */
  seconds?: number
  /** 监听：启动 1 秒后在同一个工作区里跑这条命令，制造一次事件。 */
  poke?: string
  /** HTTP：拿来试的请求体。 */
  body?: string
}

export interface CardTestInput {
  workflow: string
  trigger: TriggerDefinition
  now: number
  /** 跑命令的样子（定时检查、监听才有）；没有工作区时不给，由调用方先报错。 */
  spec?: CommandSpec
  /** 真的上一次检查结果（「由失败变为成功」「输出变了」要对照它）。 */
  probe?: Probe
  /** 接续：等的那个工作流能不能等（不能是一句原因），以及它最近结束的实例。 */
  after?: { problem: string | null; runs: FinishedRun[] }
  /** 背景信息太长时全文存到哪（消息预览里写这个路径）。 */
  infoFile: string
  options: CardTestOptions
}

/** 一行收到的输出过过滤的结果。 */
export type LineResult = 'pass' | 'duplicate' | `keyword: ${string}`

export interface CardTestResult {
  /** fire = 这样会触发；skip = 这次不会触发（不算失败）；error = 跑不起来、会算失败或卡片打不开。 */
  verdict: 'fire' | 'skip' | 'error'
  /** 一句话结论。 */
  summary: string
  /** 定时：接下来几次的时刻。 */
  next?: number[]
  /** 跑出来的样子（检查命令、监听程序）。 */
  run?: {
    code: number | null
    ms: number
    /** 检查命令的标准输出（就是背景信息）；监听的看 `lines`。 */
    stdout?: string
    stderr: string
    failure?: string
    /** 监听：自己退出了（真打开后一分钟内退出算一次失败）。 */
    exited?: boolean
  }
  /** 监听：制造事件的那条命令跑得怎样。 */
  poke?: { code: number | null; output: string; failure?: string }
  /** 监听：收到的每一行（`at` 是启动后多少毫秒）和过滤结果。 */
  lines?: { at: number; text: string; result: LineResult }[]
  /** 监听：合并之后算几次触发。 */
  fires?: number
  /** 接续：等的那个工作流最近结束的实例各会不会触发。 */
  runs?: { id: string; status: string; at: number; fires: boolean }[]
  /** 会触发时对面会话收到的消息（第一次的）。 */
  message?: string
  /** 这条消息里背景信息有多少个字符（没有背景信息时不给）。 */
  infoChars?: number
  notes?: string[]
}

/** 按卡片的触发方式试一次。 */
export async function testCard(input: CardTestInput): Promise<CardTestResult> {
  return withSizeNote(await testSource(input))
}

async function testSource(input: CardTestInput): Promise<CardTestResult> {
  const { source } = input.trigger.data
  switch (source.kind) {
    case 'schedule':
      return source.check === undefined ? testPlain(input, source) : await testCheck(input, source)
    case 'listen':
      return await testListen(input)
    case 'http':
      return testHttp(input)
    case 'after':
      return testAfter(input, source)
  }
}

/** 背景信息长到消息里放不下全文时，在 notes 里说一句：执行的模型只看得到开头，要另去读文件。 */
function withSizeNote(result: CardTestResult): CardTestResult {
  const chars = result.infoChars
  if (chars === undefined || chars <= INFO_INLINE_CHARS) return result
  const note = `背景信息有 ${String(chars)} 个字符，超过 ${String(INFO_INLINE_CHARS)}：消息里只放开头 ${String(INFO_HEAD_CHARS)} 个，执行的模型要另去读全文。能精简就让脚本或发送方只给要用的字段。`
  return { ...result, notes: [...(result.notes ?? []), note] }
}

// ── 定时 ───────────────────────────────────────────────────────

type ScheduleSource = Extract<TriggerSource, { kind: 'schedule' }>

function upcomingOf(source: ScheduleSource, now: number): number[] {
  return upcomingFires(source.schedule, new Date(now), UPCOMING).map((date) => date.getTime())
}

function testPlain(input: CardTestInput, source: ScheduleSource): CardTestResult {
  return {
    verdict: 'fire',
    summary: `${sourceText(source)}：到点直接执行，不跑命令。`,
    next: upcomingOf(source, input.now),
    ...preview(input, 'schedule'),
  }
}

async function testCheck(input: CardTestInput, source: ScheduleSource): Promise<CardTestResult> {
  const next = upcomingOf(source, input.now)
  const spec = input.spec as CommandSpec
  const started = Date.now()
  const result = await runCommand(spec, {
    timeoutMs: checkTimeoutOf(source.schedule),
    maxBytes: INFO_MAX_CHARS,
  })
  const run = {
    code: result.code,
    ms: Date.now() - started,
    stdout: clip(result.output.trim(), OUTPUT_CHARS),
    stderr: clip((result.stderr ?? result.errors).trim(), OUTPUT_CHARS),
    ...(result.failure === undefined ? {} : { failure: result.failure }),
  }
  if (result.failure !== undefined) {
    return {
      verdict: 'error',
      summary: `命令没跑成：${result.failure}。真打开后这算一次失败，连续几次会自动停用。`,
      next,
      run,
    }
  }
  const when = scheduleJudge(source)
  const judged = judge(when === 'always' ? 'every' : when, input.probe ?? {}, result)
  if (result.code !== 0) {
    return {
      verdict: 'skip',
      summary: `命令返回 ${String(result.code)}：条件不满足，这次不触发（不算失败）。`,
      next,
      run,
    }
  }
  const info = result.output.trim()
  const filter = filterOf(input.trigger.data)
  const blocked = filterMiss(filter, info)
  const base = { next, run, ...(blocked === null ? preview(input, 'schedule', info) : {}) }
  if (blocked !== null) {
    return { ...base, verdict: 'skip', summary: `命令成功，但输出被过滤挡掉：${blocked}。` }
  }
  if (judged.met) {
    return {
      ...base,
      verdict: 'fire',
      summary:
        when === 'success'
          ? '命令成功，上一次不成功（或还没查过）：这次会触发。'
          : when === 'change'
            ? '命令成功，输出和上一次不一样：这次会触发。'
            : '命令成功：这次会触发。',
    }
  }
  return {
    ...base,
    verdict: 'skip',
    summary:
      when === 'success'
        ? '命令成功，但上一次也成功：「由失败变为成功」这次不触发。命令先返回非 0、再返回 0 才会触发。'
        : input.probe?.digest === undefined
          ? '命令成功。「输出变了」第一次只记下输出、不触发；之后输出和这次不一样才触发。'
          : '命令成功，但输出和上一次一样：这次不触发。',
  }
}

// ── 监听 ───────────────────────────────────────────────────────

async function testListen(input: CardTestInput): Promise<CardTestResult> {
  const spec = input.spec as CommandSpec
  const seconds = clampSeconds(input.options.seconds)
  const started = Date.now()
  const received: { at: number; text: string }[] = []
  let stderr = ''
  const ran = await new Promise<{
    code: number | null
    failure?: string
    exited: boolean
    poke?: CardTestResult['poke']
  }>((resolve) => {
    let done = false
    let poke: CardTestResult['poke'] | undefined
    let poking: Promise<void> = Promise.resolve()
    const finish = (result: { code: number | null; failure?: string; exited: boolean }): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      clearTimeout(pokeTimer)
      // 制造事件的命令还在跑就等它跑完（它的结果也要交）。
      void poking.then(() => resolve({ ...result, ...(poke === undefined ? {} : { poke }) }))
    }
    const live = startProcess(spec, {
      onLine: (line) => {
        received.push({ at: Date.now() - started, text: line })
      },
      onOutput: (line, stream) => {
        if (stream === 'err') stderr = clip(`${stderr}${line}\n`, OUTPUT_CHARS, true)
      },
      onExit: (info) => {
        stderr ||= info.errors
        finish({
          code: info.code,
          exited: true,
          ...(info.failure === undefined ? {} : { failure: info.failure }),
        })
      },
    })
    const pokeCommand = input.options.poke?.trim()
    const pokeTimer = setTimeout(() => {
      if (pokeCommand === undefined || pokeCommand === '' || done) return
      poking = runCommand(
        { ...spec, command: pokeCommand },
        { timeoutMs: POKE_TIMEOUT_MS, maxBytes: OUTPUT_CHARS * 4 },
      ).then((result) => {
        poke = {
          code: result.code,
          output: clip(
            [result.output.trim(), result.errors.trim()].filter(Boolean).join('\n'),
            OUTPUT_CHARS,
          ),
          ...(result.failure === undefined ? {} : { failure: result.failure }),
        }
      })
    }, POKE_DELAY_MS)
    const timer = setTimeout(() => {
      void live.stop().then(() => finish({ code: null, exited: false }))
    }, seconds * 1000)
  })
  const filter = filterOf(input.trigger.data)
  const lines = judgeLines(filter, received)
  const batches = mergeLines(filter, received)
  const run = {
    code: ran.code,
    ms: Date.now() - started,
    stderr: clip(stderr.trim(), OUTPUT_CHARS, true),
    ...(ran.failure === undefined ? {} : { failure: ran.failure }),
    ...(ran.exited ? { exited: true } : {}),
  }
  const first = batches[0]
  const base: Omit<CardTestResult, 'verdict' | 'summary'> = {
    run,
    ...(ran.poke === undefined ? {} : { poke: ran.poke }),
    lines: lines.slice(0, LINES_MAX),
    fires: batches.length,
    ...(first === undefined ? {} : preview(input, 'listen', first.info, first.count)),
    ...(lines.length > LINES_MAX
      ? { notes: [`共收到 ${String(lines.length)} 行，只列前 ${String(LINES_MAX)} 行。`] }
      : {}),
  }
  if (ran.exited) {
    const why = ran.failure ?? `退出码 ${String(ran.code)}`
    return {
      ...base,
      verdict: 'error',
      summary: `程序 ${secondsOf(run.ms)} 秒就自己退出了（${why}）。监视程序要一直运行；真打开后启动 ${String(HEALTHY_MS / 1000)} 秒内退出算一次失败。`,
    }
  }
  if (received.length === 0) {
    return {
      ...base,
      verdict: 'skip',
      summary: `${String(seconds)} 秒里标准输出没有打出一行。${input.options.poke === undefined ? '可以带 poke 在运行中制造一次事件。' : '看看 poke 有没有真的制造出事件、脚本有没有及时刷新输出。'}`,
    }
  }
  if (batches.length === 0) {
    return {
      ...base,
      verdict: 'skip',
      summary: `收到 ${String(received.length)} 行，都被过滤挡掉了。`,
    }
  }
  return {
    ...base,
    verdict: 'fire',
    summary: `收到 ${String(received.length)} 行，过滤、合并之后会触发 ${String(batches.length)} 次。`,
  }
}

function clampSeconds(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return LISTEN_TEST_SECONDS
  return Math.min(Math.max(Math.round(value), 1), LISTEN_TEST_MAX)
}

/** 每一行过关键字、去重的结果（试运行只有几十秒，去重时长内见过的就是重复）。 */
function judgeLines(
  filter: FilterSettings,
  received: readonly { at: number; text: string }[],
): NonNullable<CardTestResult['lines']> {
  const seen = new Set<string>()
  return received.map(({ at, text }) => {
    const trimmed = text.trim()
    const blocked = filterMiss(filter, trimmed)
    let result: LineResult = 'pass'
    if (blocked !== null) result = `keyword: ${blocked}`
    else if (filter.dedupe > 0 && seen.has(trimmed)) result = 'duplicate'
    if (result === 'pass') seen.add(trimmed)
    return { at, text: clip(text, LINE_CHARS), result }
  })
}

/** 按收到的先后把这些行喂给真的过滤（时钟换成假的），看合并之后交出去几次。 */
function mergeLines(
  filter: FilterSettings,
  received: readonly { at: number; text: string }[],
): IntakeBatch[] {
  let now = 0
  const timers = new Set<{ at: number; run: () => void }>()
  const clock: IntakeClock = {
    now: () => now,
    setTimeout: (run, ms) => {
      const timer = { at: now + ms, run }
      timers.add(timer)
      return timer
    },
    clearTimeout: (handle) => {
      timers.delete(handle as { at: number; run: () => void })
    },
  }
  const advance = (to: number): void => {
    for (;;) {
      const due = [...timers].filter((timer) => timer.at <= to).sort((a, b) => a.at - b.at)[0]
      if (due === undefined) break
      timers.delete(due)
      now = due.at
      due.run()
    }
    now = to
  }
  const batches: IntakeBatch[] = []
  const intake = new Intake(filter, joinerOf('listen'), (batch) => batches.push(batch), clock)
  for (const line of received) {
    advance(line.at)
    intake.push(line.text)
  }
  intake.flush()
  return batches
}

// ── HTTP ───────────────────────────────────────────────────────

function testHttp(input: CardTestInput): CardTestResult {
  const body = (input.options.body ?? '').trim()
  const filter = filterOf(input.trigger.data)
  const blocked = filterMiss(filter, body)
  const notes = ['没有真的发请求；打开开关后卡片上有地址和令牌。']
  if (blocked !== null) {
    return { verdict: 'skip', summary: `这段请求体会被过滤挡掉：${blocked}。`, notes }
  }
  return {
    verdict: 'fire',
    summary:
      body === ''
        ? '空请求体会触发（没有背景信息）。带 body 可以试一段真实的请求体。'
        : '这段请求体会触发。',
    ...preview(input, 'http', body === '' ? undefined : body),
    notes,
  }
}

// ── 接续 ───────────────────────────────────────────────────────

function testAfter(
  input: CardTestInput,
  source: Extract<TriggerSource, { kind: 'after' }>,
): CardTestResult {
  const after = input.after ?? { problem: null, runs: [] }
  if (after.problem !== null) return { verdict: 'error', summary: `${after.problem}。` }
  const recent = after.runs.slice(-AFTER_RUNS).reverse()
  const runs = recent.map((run) => ({
    id: run.id,
    status: run.status,
    at: run.at,
    fires: afterMatches(source, run.status),
  }))
  const hit = recent.find((run) => afterMatches(source, run.status))
  const shown = hit === undefined ? {} : preview(input, 'after', afterInfo(source.workflow, hit))
  if (recent.length === 0) {
    return {
      verdict: 'skip',
      summary: `「${source.workflow}」还没有结束过的实例；它有实例结束、结果对得上时会触发。`,
      runs,
    }
  }
  return {
    verdict: hit === undefined ? 'skip' : 'fire',
    summary:
      hit === undefined
        ? `「${source.workflow}」最近结束的实例结果都对不上，不会触发。`
        : `「${source.workflow}」的实例 ${hit.id} 这样结束时会触发（打开开关之后结束的才算，之前的不补）。`,
    runs,
    ...shown,
  }
}

// ── 共用 ───────────────────────────────────────────────────────

/** 关键字（以及有关键字时的空内容）挡不挡；不挡是 `null`。 */
function filterMiss(filter: FilterSettings, text: string): string | null {
  if (text === '' && filter.include.length > 0) return '内容是空的，而卡片要求包含关键字'
  return text === '' ? null : keywordMiss(filter, text)
}

/** 对面会话会收到的消息（触发编号写成占位），连同背景信息的长度。 */
function preview(
  input: CardTestInput,
  channel: FireChannel,
  info?: string,
  merged?: number,
): Pick<CardTestResult, 'message' | 'infoChars'> {
  const { trigger } = input
  const text = info?.trim()
  const message = fireMessage(
    {
      record: {
        id: 'f-<触发编号>',
        workflow: input.workflow,
        node: trigger.node,
        name: trigger.name,
        channel,
        at: input.now,
        outcome: 'sent',
      },
      ...(trigger.data.note === undefined ? {} : { note: trigger.data.note }),
      ...(trigger.data.condition === undefined ? {} : { condition: trigger.data.condition }),
      ...(text === undefined || text === '' ? {} : { info: text }),
      ...(merged === undefined || merged < 2 ? {} : { merged }),
    },
    trigger.data,
    text !== undefined && text.length > INFO_INLINE_CHARS ? input.infoFile : undefined,
  )
  return text === undefined || text === '' ? { message } : { message, infoChars: text.length }
}

/** 留开头（或末尾）`max` 个字。 */
function clip(text: string, max: number, tail = false): string {
  if (text.length <= max) return text
  return tail ? `…${text.slice(-max)}` : `${text.slice(0, max)}…`
}

function secondsOf(ms: number): string {
  return (ms / 1000).toFixed(1)
}
