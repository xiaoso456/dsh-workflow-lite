/**
 * dsh-workflow-lite — 常驻的触发源：带检查命令的定时、监听程序、HTTP 地址。只在负责触发的那个进程里跑。
 *
 * `service.ts` 每一轮算出「现在该开着哪些」（{@link LiveSpec}），交给 {@link TriggerRuntime.sync}：
 * 新出现的启动，不再需要的停掉，设置变了（命令、规则、判定、过滤、工作区、令牌）的停掉重来。
 * 进来的内容先过 `intake.ts` 的过滤，剩下的交回 `service.ts` 发进会话。
 *
 * 运行情况（程序在不在跑、上次检查、端口）写进 `live.json`，最近的输出写进插件数据库（`outputLog.ts`），
 * 别的 DSH 进程、画布都读这两处。监听程序的输出攒一会儿成批写。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/runtime
 */

import type { FilterKind, FilterSettings, LiveSource } from '../../shared/trigger.ts'
import { type HookBind, type HookPortState, type HookRoute, HookServer } from './hooks.ts'
import { Intake, type IntakeBatch, joinerOf } from './intake.ts'
import { Listener } from './listener.ts'
import { type LineInput, type OutputLog, type RunEnd, stripAnsi } from './outputLog.ts'
import { type PollCheck, Poller, type Probe } from './poller.ts'
import type { LiveFile, LiveStatus, TriggerStore } from './store.ts'

/** 一张该开着的卡片。 */
export interface LiveSpec {
  workflow: string
  node: string
  source: LiveSource
  filter: FilterSettings
  /** 命令在哪个目录里跑（定时的检查、监听程序）。 */
  cwd: string
  /** 命令里 `{workflow}` 已经换好了的那条（定时的检查、监听程序）。 */
  command?: string
  /** 命令的追加环境变量。 */
  env?: Record<string, string>
  /** 用哪个 shell 跑（程序的完整路径）；不给是系统的。 */
  shell?: string
  /** 定时的检查：上一次检查的结果、下一次该查的时刻。 */
  probe?: Probe
  /** 定时的检查：DSH 关着时错过的那一次补不补（启动方式里的「补」）。 */
  catchUp?: boolean
  /** HTTP：地址（`/trigger/` 后面那一段）与令牌（`null` = 不校验）。 */
  hook?: { id: string; token: string | null }
}

/** 一张卡片是谁（交回 `service.ts` 时用）。 */
export interface LiveRef {
  workflow: string
  node: string
  kind: FilterKind
}

export interface RuntimeEvents {
  /** 过了过滤的一批，发进会话。 */
  deliver(ref: LiveRef, batch: IntakeBatch): void
  /** 触发源自己出了问题（算一次失败）。 */
  failed(ref: LiveRef, reason: string): void
  /** 触发源好好地工作了一次（清掉失败计数）。 */
  healthy(ref: LiveRef): void
  /** 定时的检查查完一次：存下这次的结果和下一次的时刻。 */
  probed(ref: LiveRef, probe: Probe): void
}

export interface RuntimeDeps {
  store: TriggerStore
  /** 最近的输出记在这里。 */
  outputs: OutputLog
  /** 每张卡片最近的输出留多少行（插件设置）。 */
  keep(): number
  events: RuntimeEvents
  /** 插件设置里 HTTP 触发的监听地址与端口。 */
  listen(): HookBind
  /** 写进运行情况的进程号（与负责权里的对得上才作数）。 */
  pid?: number
  now?: () => number
  /** 测试里换掉。 */
  hooks?: HookServer
}

/** `service.ts` 用到的那一面（测试里换成假的）。 */
export interface LiveRuntime {
  sync(specs: readonly LiveSpec[]): Promise<void>
  stopAll(): Promise<void>
}

/** 运行情况、监听程序的输出攒一会儿再写盘。 */
const WRITE_DELAY_MS = 500

interface Running {
  signature: string
  intake: Intake
  stop(): Promise<void>
}

const keyOf = (workflow: string, node: string): string => `${workflow}\u0000${node}`

function refOf(spec: LiveSpec): LiveRef {
  return { workflow: spec.workflow, node: spec.node, kind: spec.source.kind }
}

/** 命令要跑的那条：调用方换好 `{workflow}` 的，没给就是图里写的。 */
function commandText(spec: LiveSpec): string {
  if (spec.command !== undefined) return spec.command
  const { source } = spec
  return source.kind === 'schedule'
    ? source.check.command
    : source.kind === 'listen'
      ? source.command
      : ''
}

/** 设置的记号：变了就停掉重来（上一次检查的结果不算设置）。 */
function signatureOf(spec: LiveSpec): string {
  const { probe: _probe, ...rest } = spec
  return JSON.stringify(rest)
}

/** 卡片上显示的那一行最多几个字。 */
const LINE_MAX_CHARS = 200

/** 一行输出在卡片上怎么显示：去掉终端颜色和首尾空白，太长截短。 */
export function lastLineText(line: string): string {
  const plain = stripAnsi(line).trim()
  const chars = [...plain]
  return chars.length > LINE_MAX_CHARS ? `${chars.slice(0, LINE_MAX_CHARS).join('')}…` : plain
}

export class TriggerRuntime implements LiveRuntime {
  private readonly running = new Map<string, Running>()
  private readonly statuses = new Map<
    string,
    { workflow: string; node: string; status: LiveStatus }
  >()
  /** 监听程序这一次运行在输出里的编号，和还没写下去的行。 */
  private readonly runs = new Map<string, { entry: number; pending: LineInput[] }>()
  /** 监听程序最近打出的一行：写 live.json 时并进它的运行情况（重启时不丢）。 */
  private readonly lines = new Map<string, { at: number; text: string }>()
  /** 监听程序最近一次记下输出的时刻（两路都算）：同样并进运行情况，界面据此重读最近的输出。 */
  private readonly outputAt = new Map<string, number>()
  private readonly hooks: HookServer
  private readonly now: () => number
  private liveDirty = false
  private flushTimer: ReturnType<typeof setTimeout> | undefined
  private writing: Promise<void> = Promise.resolve()

  constructor(private readonly deps: RuntimeDeps) {
    this.now = deps.now ?? Date.now
    this.hooks = deps.hooks ?? new HookServer(() => this.markLive(), this.now)
  }

  /** 换成这一轮该开着的那些。 */
  async sync(specs: readonly LiveSpec[]): Promise<void> {
    const wanted = new Map(specs.map((spec) => [keyOf(spec.workflow, spec.node), spec]))
    const stopping: Promise<void>[] = []
    for (const [key, running] of this.running) {
      const spec = wanted.get(key)
      if (spec !== undefined && signatureOf(spec) === running.signature) continue
      stopping.push(this.stopOne(key, running))
    }
    await Promise.all(stopping)
    const routes = new Map<string, HookRoute>()
    for (const [key, spec] of wanted) {
      let running = this.running.get(key)
      if (running === undefined) {
        running = this.startOne(spec)
        this.running.set(key, running)
      }
      if (spec.source.kind === 'http' && spec.hook !== undefined) {
        const { intake } = running
        routes.set(spec.hook.id, { token: spec.hook.token, accept: (body) => intake.push(body) })
      }
    }
    await this.hooks.sync(this.deps.listen(), routes)
  }

  /** 全部停下（不再负责触发、插件卸载）。运行情况文件留给接手的进程覆盖。 */
  async stopAll(): Promise<void> {
    await Promise.all([...this.running].map(([key, running]) => this.stopOne(key, running)))
    await this.hooks.close()
    if (this.flushTimer !== undefined) clearTimeout(this.flushTimer)
    this.flushTimer = undefined
    this.liveDirty = false
    await this.writing
  }

  /** HTTP 端口现在的情况。 */
  port(): HookPortState {
    return this.hooks.current()
  }

  private async stopOne(key: string, running: Running): Promise<void> {
    this.running.delete(key)
    this.statuses.delete(key)
    this.lines.delete(key)
    this.outputAt.delete(key)
    this.markLive()
    running.intake.dispose()
    await running.stop()
    this.endRun(key, { at: this.now(), verdict: 'stopped', code: null })
  }

  private startOne(spec: LiveSpec): Running {
    const ref = refOf(spec)
    const key = keyOf(spec.workflow, spec.node)
    const joiner = joinerOf(spec.source.kind)
    const intake = new Intake(spec.filter, joiner, (batch) => this.deps.events.deliver(ref, batch))
    const signature = signatureOf(spec)
    const source = spec.source
    if (source.kind === 'http') {
      this.setStatus(spec, { state: 'running', since: this.now() })
      return { signature, intake, stop: async () => {} }
    }
    const command = {
      command: commandText(spec),
      cwd: spec.cwd,
      env: spec.env ?? {},
      ...(spec.shell === undefined ? {} : { shell: spec.shell }),
    }
    if (source.kind === 'schedule') {
      const poller = new Poller(
        {
          ...command,
          schedule: source.schedule,
          when: source.check.when,
          catchUp: spec.catchUp ?? true,
          ...(spec.probe === undefined ? {} : { probe: spec.probe }),
        },
        {
          fire: (output) => intake.push(output),
          fail: (reason) => this.deps.events.failed(ref, reason),
          checked: (check) => this.onChecked(spec, ref, check),
        },
      )
      const first = poller.firstAt()
      this.setStatus(spec, { state: 'running', ...(first === undefined ? {} : { next: first }) })
      poller.start()
      return { signature, intake, stop: async () => poller.stop() }
    }
    const listener = new Listener(command, {
      event: (info) => {
        intake.push(info)
        this.noteLine(key, info)
      },
      output: (line, stream) => this.queueLine(key, { at: this.now(), stream, text: line }),
      running: ({ since, restarts }) => {
        this.startRun(key, spec, since)
        this.setStatus(spec, { state: 'running', since, ...(restarts > 0 ? { restarts } : {}) })
      },
      healthy: () => this.deps.events.healthy(ref),
      exited: ({ reason, counted, retryAt, restarts, code, failed }) => {
        this.endRun(key, {
          at: this.now(),
          verdict: failed ? 'fail' : 'exited',
          code,
          note: reason,
        })
        this.setStatus(spec, { state: 'restarting', note: reason, next: retryAt, restarts })
        if (counted) this.deps.events.failed(ref, reason)
      },
    })
    listener.start()
    return { signature, intake, stop: () => listener.stop() }
  }

  private onChecked(spec: LiveSpec, ref: LiveRef, check: PollCheck): void {
    const key = keyOf(spec.workflow, spec.node)
    if (!this.running.has(key)) return
    this.record(() =>
      this.deps.outputs.check(
        spec.workflow,
        spec.node,
        {
          at: check.at,
          verdict: check.failure !== undefined ? 'fail' : check.met ? 'met' : 'unmet',
          code: check.code,
          ...(check.note === undefined ? {} : { note: check.note }),
          ms: check.ms,
          out: check.out,
          err: check.err,
        },
        this.deps.keep(),
      ),
    )
    this.setStatus(spec, {
      state: 'running',
      ...(check.next === undefined ? {} : { next: check.next }),
      checked: { at: check.at, met: check.met },
      ...(check.note === undefined ? {} : { note: check.note }),
    })
    this.deps.events.probed(ref, check.probe)
    if (check.failure === undefined) this.deps.events.healthy(ref)
  }

  // ── 写盘 ─────────────────────────────────────────────────────

  private setStatus(spec: LiveSpec, status: LiveStatus): void {
    this.statuses.set(keyOf(spec.workflow, spec.node), {
      workflow: spec.workflow,
      node: spec.node,
      status,
    })
    this.markLive()
  }

  private noteLine(key: string, line: string): void {
    const text = lastLineText(line)
    if (text === '') return
    this.lines.set(key, { at: this.now(), text })
    this.markLive()
  }

  // ── 最近的输出 ───────────────────────────────────────────

  /** 写最近的输出：数据库一时写不进（别的进程长时间占着）就丢掉这一笔，不影响触发。 */
  private record(write: () => void): void {
    try {
      write()
    } catch {
      // 只是给人看的输出，丢一笔不要紧。
    }
  }

  /** 程序起来了：上一次运行没写完的行先写下去，再开一条新的。 */
  private startRun(key: string, spec: LiveSpec, since: number): void {
    this.writeLines(key)
    this.runs.delete(key)
    this.record(() => {
      this.runs.set(key, {
        entry: this.deps.outputs.runStart(spec.workflow, spec.node, since),
        pending: [],
      })
    })
  }

  private endRun(key: string, end: RunEnd): void {
    const run = this.runs.get(key)
    if (run === undefined) return
    this.writeLines(key)
    this.runs.delete(key)
    this.record(() => this.deps.outputs.runEnd(run.entry, end))
  }

  private queueLine(key: string, line: LineInput): void {
    const run = this.runs.get(key)
    if (run === undefined) return
    run.pending.push(line)
    this.queueFlush()
  }

  /** 把这张卡片攒着的行写下去。 */
  private writeLines(key: string): void {
    const run = this.runs.get(key)
    if (run === undefined || run.pending.length === 0) return
    const batch = run.pending.splice(0)
    this.record(() => this.deps.outputs.append(run.entry, batch, this.deps.keep()))
    this.outputAt.set(key, batch[batch.length - 1]?.at ?? this.now())
    this.markLive()
  }

  private markLive(): void {
    this.liveDirty = true
    this.queueFlush()
  }

  private queueFlush(): void {
    if (this.flushTimer !== undefined) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      this.writing = this.writing.then(() => this.flush()).catch(() => {})
    }, WRITE_DELAY_MS)
  }

  private async flush(): Promise<void> {
    const { store } = this.deps
    if (this.liveDirty) {
      this.liveDirty = false
      const sources: LiveFile['sources'] = {}
      for (const [key, { workflow, node, status }] of this.statuses) {
        const group = sources[workflow] ?? {}
        const line = this.lines.get(key)
        const output = this.outputAt.get(key)
        group[node] = {
          ...status,
          ...(line === undefined ? {} : { line }),
          ...(output === undefined ? {} : { output }),
        }
        sources[workflow] = group
      }
      await store.writeLive({
        pid: this.deps.pid ?? process.pid,
        sources,
        port: this.hooks.current(),
      })
    }
    for (const key of this.runs.keys()) this.writeLines(key)
  }
}
