/**
 * dsh-workflow-lite — 常驻的触发源：条件轮询、监听程序、HTTP 地址。只在负责触发的那个进程里跑。
 *
 * `service.ts` 每一轮算出「现在该开着哪些」（{@link LiveSpec}），交给 {@link TriggerRuntime.sync}：
 * 新出现的启动，不再需要的停掉，设置变了（命令、间隔、过滤、工作区、令牌）的停掉重来。
 * 进来的内容先过 `intake.ts` 的过滤，剩下的交回 `service.ts` 发进会话。
 *
 * 运行情况（程序在不在跑、上次检查、端口）写进 `live.json`，最近的输出写进 `output/`，
 * 别的 DSH 进程、画布都读这两处。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/runtime
 */

import type { FilterKind, FilterSettings } from '../../shared/trigger.ts'
import type { TriggerSource } from '../../shared/types.ts'
import { type HookBind, type HookPortState, type HookRoute, HookServer } from './hooks.ts'
import { Intake, type IntakeBatch } from './intake.ts'
import { Listener } from './listener.ts'
import { type PollCheck, Poller, type Probe } from './poller.ts'
import type { LiveFile, LiveStatus, TriggerStore } from './store.ts'

/** 常驻的那几种触发源（轮询、监听程序、HTTP）。 */
export type LiveSource = Extract<TriggerSource, { kind: FilterKind }>

/** 一张该开着的卡片。 */
export interface LiveSpec {
  workflow: string
  node: string
  source: LiveSource
  filter: FilterSettings
  /** 命令在哪个目录里跑（轮询、监听程序）。 */
  cwd: string
  /** 命令里 `{workflow}` 已经换好了的那条（轮询、监听程序）。 */
  command?: string
  /** 命令的追加环境变量。 */
  env?: Record<string, string>
  /** 条件轮询：上一次检查的结果。 */
  probe?: Probe
  /** HTTP：地址（`/trigger/` 后面那一段）与令牌。 */
  hook?: { id: string; token: string }
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
  /** 条件轮询检查完一次：存下这次的结果。 */
  probed(ref: LiveRef, probe: Probe): void
}

export interface RuntimeDeps {
  store: TriggerStore
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

/** 最近的输出留多少字符。 */
const OUTPUT_MAX_CHARS = 8000
/** 运行情况、最近的输出攒一会儿再写盘。 */
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

/** 设置的记号：变了就停掉重来（上一次检查的结果不算设置）。 */
function signatureOf(spec: LiveSpec): string {
  const { probe: _probe, ...rest } = spec
  return JSON.stringify(rest)
}

/** 卡片上显示的那一行最多几个字。 */
const LINE_MAX_CHARS = 200

/** 一行输出在卡片上怎么显示：去掉终端颜色和首尾空白，太长截短。 */
export function lastLineText(line: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 要去掉的正是终端颜色的转义序列
  const plain = line.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, '').trim()
  const chars = [...plain]
  return chars.length > LINE_MAX_CHARS ? `${chars.slice(0, LINE_MAX_CHARS).join('')}…` : plain
}

function clock(at: number): string {
  const date = new Date(at)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export class TriggerRuntime implements LiveRuntime {
  private readonly running = new Map<string, Running>()
  private readonly statuses = new Map<
    string,
    { workflow: string; node: string; status: LiveStatus }
  >()
  private readonly outputs = new Map<string, { workflow: string; node: string; text: string }>()
  /** 监听程序最近打出的一行：写 live.json 时并进它的运行情况（重启时不丢）。 */
  private readonly lines = new Map<string, { at: number; text: string }>()
  private readonly dirtyOutputs = new Set<string>()
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
    this.markLive()
    running.intake.dispose()
    await running.stop()
  }

  private startOne(spec: LiveSpec): Running {
    const ref = refOf(spec)
    const key = keyOf(spec.workflow, spec.node)
    const joiner = spec.source.kind === 'listen' ? '\n' : '\n\n---\n\n'
    const intake = new Intake(spec.filter, joiner, (batch) => this.deps.events.deliver(ref, batch))
    const signature = signatureOf(spec)
    const source = spec.source
    if (source.kind === 'http') {
      this.setStatus(spec, { state: 'running', since: this.now() })
      return { signature, intake, stop: async () => {} }
    }
    const command = { command: spec.command ?? source.command, cwd: spec.cwd, env: spec.env ?? {} }
    if (source.kind === 'poll') {
      const poller = new Poller(
        {
          ...command,
          seconds: source.seconds,
          when: source.when ?? 'success',
          ...(spec.probe === undefined ? {} : { probe: spec.probe }),
        },
        {
          fire: (output) => intake.push(output),
          fail: (reason) => this.deps.events.failed(ref, reason),
          checked: (check) => this.onChecked(spec, ref, check),
        },
      )
      this.setStatus(spec, { state: 'running', next: this.now() })
      poller.start()
      return { signature, intake, stop: async () => poller.stop() }
    }
    const listener = new Listener(command, {
      line: (line) => {
        intake.push(line)
        this.noteLine(key, line)
      },
      output: (text) => this.appendOutput(key, spec, text),
      running: ({ since, restarts }) => {
        this.appendOutput(key, spec, `[${clock(since)}] 启动监听程序\n`)
        this.setStatus(spec, { state: 'running', since, ...(restarts > 0 ? { restarts } : {}) })
      },
      healthy: () => this.deps.events.healthy(ref),
      exited: ({ reason, counted, retryAt, restarts }) => {
        this.appendOutput(key, spec, `[${clock(this.now())}] ${reason}\n`)
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
    const verdict = check.met ? '触发' : (check.note ?? '条件不满足')
    this.appendOutput(key, spec, `[${clock(check.at)}] ${verdict}\n${check.output ?? ''}`)
    this.setStatus(spec, {
      state: 'running',
      next: check.next,
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

  private appendOutput(key: string, spec: LiveSpec, text: string): void {
    if (text === '') return
    const previous = this.outputs.get(key)?.text ?? ''
    const joined = previous + (text.endsWith('\n') ? text : `${text}\n`)
    this.outputs.set(key, {
      workflow: spec.workflow,
      node: spec.node,
      text: joined.slice(-OUTPUT_MAX_CHARS),
    })
    this.dirtyOutputs.add(key)
    this.queueFlush()
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
        group[node] = line === undefined ? status : { ...status, line }
        sources[workflow] = group
      }
      await store.writeLive({
        pid: this.deps.pid ?? process.pid,
        sources,
        port: this.hooks.current(),
      })
    }
    const keys = [...this.dirtyOutputs]
    this.dirtyOutputs.clear()
    for (const key of keys) {
      const entry = this.outputs.get(key)
      if (entry !== undefined) await store.writeOutput(entry.workflow, entry.node, entry.text)
    }
  }
}
