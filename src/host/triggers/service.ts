/**
 * dsh-workflow-lite — 触发器的业务面：到点触发、常驻的触发源、开关与本机设置、「立即触发一次」、状态与触发记录。
 *
 * 触发只由负责的那个 DSH 进程做（见 `owner.ts`）：每隔几秒报到一次、对一遍账（`reconcile.ts`），
 * 到点的交给 `launcher.ts` 发进会话；条件轮询、监听程序、HTTP 地址按本机状态开着或停下（`runtime.ts`），
 * 它们进来的内容过了过滤也交给 `launcher.ts`；接续触发每一轮看一眼等的那个工作流有没有实例刚结束（`after.ts`）。
 * 开关、设置、「立即触发一次」「全部暂停」哪个进程都能做，都落在 `<dataDir>/triggers/` 里，负责的进程下一轮就看到。
 *
 * 「全部暂停」不动各卡片的开关：暂停着时定时照样往后排、接续触发照样记下处理过的实例，只是都不触发，
 * 常驻的全停下；恢复后接着跑，暂停期间错过的不补。
 *
 * 要在本机跑命令的（轮询、监听程序）打开前要用户确认那条命令，记下命令与工作区的记号；
 * 两样有一样改了就停下、等重新确认（`confirm`）。模型能建、改触发卡片，但开关只在用户手里。
 *
 * 「连续几次失败就自动停用」里的「失败」只指触发器自己干不了活：工作区或会话不在了、会话建不出来、
 * 图编译不出计划、监听程序一启动就退出、轮询的命令跑不起来。跳过（上一次还在跑、超过每小时上限、错过了）、
 * 条件不满足、过滤掉的都不算，消息发进去之后工作流执行得怎么样更不算。
 * 端口被占用也不算：那是「出错」，端口空出来或换一个就恢复。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/service
 */

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { bindWorkflowVar } from '../../shared/pathVars.ts'
import {
  commandOf,
  filterOf,
  isFilterKind,
  launchMissing,
  launchOf,
  sourceProblem,
} from '../../shared/trigger.ts'
import {
  HOOK_MAX_LENGTH,
  type HookIssue,
  hookFromName,
  hookIssue,
  LOCAL_HOST,
  TOKEN_MAX_LENGTH,
  TOKEN_MIN_LENGTH,
  type TokenIssue,
  tokenIssue,
} from '../../shared/triggerHttp.ts'
import type { TriggerSource } from '../../shared/types.ts'
import type {
  FireRecord,
  TriggerAllResponse,
  TriggerEntry,
  TriggerFireRequest,
  TriggerHttpStatus,
  TriggerListResponse,
  TriggerOwner,
  TriggerPauseResponse,
  TriggerSetRequest,
  TriggerView,
} from '../../shared/wire/trigger.ts'
import { assetsDir } from '../store/paths.ts'
import { fail, type Outcome, ok } from '../store/repoResult.ts'
import { afterInfo, afterMatches, afterProblem, type RunWatch } from './after.ts'
import type { TriggerDefinition, TriggerGraphs } from './graphs.ts'
import { type HookBind, hookUrl, newHookId, newHookToken } from './hooks.ts'
import type { IntakeBatch } from './intake.ts'
import { type FireInput, Launcher } from './launcher.ts'
import { advertisedHost } from './netAddress.ts'
import { OwnerLock } from './owner.ts'
import { FRESH_PROBE } from './poller.ts'
import { type DueFire, planRound, upcoming } from './reconcile.ts'
import {
  type LiveRef,
  type LiveRuntime,
  type LiveSpec,
  type RuntimeEvents,
  TriggerRuntime,
} from './runtime.ts'
import type { SessionPort } from './sessions.ts'
import {
  approvalOf,
  type LiveFile,
  ownerFile,
  type TriggerLocal,
  type TriggerLocals,
  type TriggerStore,
} from './store.ts'

/** 多久报到、对一次账。 */
export const BEAT_MS = 5_000
/** 晚了这么久还没触发，就算「错过了」（DSH 当时没在运行）。 */
export const LATE_MS = 2 * 60_000
/** 触发记录一次最多给画布多少条。 */
const HISTORY_PAGE = 50
const HOUR_MS = 60 * 60_000
/** 超过每小时上限的常驻触发源，隔多久才再记一条「跳过」（日志刷屏时别把记录也刷满）。 */
const CAP_NOTE_MS = 10 * 60_000

export interface TriggerServiceDeps {
  dataDir: () => string
  store: TriggerStore
  graphs: TriggerGraphs
  sessions: SessionPort
  /** HTTP 触发的监听地址与端口（插件设置）。 */
  listen: () => HookBind
  /** 实例那边：接续触发看别的工作流有没有实例结束。不给就当没有这种触发源。 */
  runs?: RunWatch
  now?: () => number
  /** 测试里换掉（假的进程号、假的存活判断）。 */
  lock?: OwnerLock
  /** 测试里换掉（不真的跑命令、开端口；拿到事件口自己喂）。 */
  runtime?: (events: RuntimeEvents) => LiveRuntime
  warn?: (message: string) => void
}

export class TriggerService {
  private readonly store: TriggerStore
  private readonly graphs: TriggerGraphs
  private readonly sessions: SessionPort
  private readonly runs: RunWatch | undefined
  private readonly launcher: Launcher
  private readonly lock: OwnerLock
  private readonly runtime: LiveRuntime
  private readonly dataDir: () => string
  private readonly listen: () => HookBind
  private readonly now: () => number
  private readonly warn: (message: string) => void
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  /** 正在进行的那一轮（一轮一轮来，不重叠）。 */
  private round: Promise<void> = Promise.resolve()
  /** 开着的卡片里最早的下一次时刻（决定下一轮什么时候来）。 */
  private nextDue: number | undefined
  /** 常驻触发源进来的事一件一件办（连着来的不会抢着建会话、抢着写记录）。 */
  private delivering: Promise<void> = Promise.resolve()
  /** 每张卡片上一次记「到上限了」的时刻。 */
  private readonly capNoted = new Map<string, number>()

  constructor(deps: TriggerServiceDeps) {
    this.store = deps.store
    this.graphs = deps.graphs
    this.sessions = deps.sessions
    this.runs = deps.runs
    this.dataDir = deps.dataDir
    this.listen = deps.listen
    this.now = deps.now ?? Date.now
    this.warn = deps.warn ?? (() => {})
    this.launcher = new Launcher(deps.sessions, deps.store)
    this.lock = deps.lock ?? new OwnerLock({ file: () => ownerFile(deps.dataDir()), now: this.now })
    const events: RuntimeEvents = {
      deliver: (ref, batch) => this.enqueue(() => this.deliver(ref, batch)),
      failed: (ref, reason) => this.enqueue(() => this.sourceFailed(ref, reason)),
      healthy: (ref) => this.enqueue(() => this.clearFailures(ref)),
      probed: (ref, probe) =>
        this.enqueue(() =>
          this.store.update((locals) => {
            const local = locals[ref.workflow]?.[ref.node]
            if (local?.enabled === true) local.probe = probe
          }),
        ),
    }
    this.runtime =
      deps.runtime?.(events) ??
      new TriggerRuntime({
        store: deps.store,
        listen: deps.listen,
        pid: this.lock.pid,
        now: this.now,
        events,
      })
  }

  // ── 一轮一轮 ───────────────────────────────────────────────

  /** 开始一轮一轮地跑；返回的函数停下来并让出负责权。 */
  start(): () => void {
    this.running = true
    this.schedule(0)
    return () => {
      void this.stop()
    }
  }

  async stop(): Promise<void> {
    this.running = false
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await this.round.catch(() => {})
    await this.runtime.stopAll().catch(() => {})
    await this.delivering
    await this.lock.release().catch(() => {})
  }

  private schedule(delay: number): void {
    if (!this.running) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.tick()
        .catch((error: unknown) => {
          this.warn(`触发器这一轮出错：${messageOf(error)}`)
        })
        .then(() => {
          // 下一轮：最迟一个报到间隔之后；有卡片更早到点就提前到那一刻。
          const wait = this.nextDue === undefined ? BEAT_MS : this.nextDue - this.now()
          this.schedule(Math.min(BEAT_MS, Math.max(200, wait)))
        })
    }, delay)
  }

  /** 跑一轮：报到；负责触发的是本进程就对账、触发到点的卡片、开好该开着的常驻触发源。 */
  tick(): Promise<void> {
    const run = this.round.catch(() => {}).then(() => this.runRound())
    this.round = run
    return run
  }

  private async runRound(): Promise<void> {
    this.nextDue = undefined
    // 这个进程发不了会话：不争负责权，留给发得了的。
    if (this.sessions.unavailable() !== null) {
      await this.runtime.stopAll()
      await this.lock.release()
      return
    }
    // 不归这个进程负责（或刚被别人接手）：常驻的都停下。
    if (!(await this.lock.beat())) {
      await this.runtime.stopAll()
      return
    }
    const now = this.now()
    const paused = (await this.store.paused()) !== undefined
    const plan = await planRound(await this.store.locals(), this.graphs, now)
    const fresh = await this.store.update((locals) => {
      plan.apply(locals)
      return structuredClone(locals)
    })
    this.nextDue = plan.next
    // 暂停着：定时照样往后排（上面已经写回），到点的不触发。
    for (const due of paused ? [] : plan.fires) {
      // 写回之前别的进程把开关关了：不触发。
      const local = fresh[due.workflow]?.[due.trigger.node]
      if (local?.enabled !== true) continue
      await this.fireDue({ ...due, local }, now)
    }
    await this.fireAfter(fresh, now, paused)
    await this.runtime.sync(paused ? [] : await this.liveSpecs(fresh))
  }

  // ── 定时 ───────────────────────────────────────────────────

  private async fireDue(due: DueFire, now: number): Promise<void> {
    const launch = launchOf(due.trigger.data)
    const input: FireInput = {
      workflow: due.workflow,
      trigger: due.trigger,
      local: due.local,
      channel: 'schedule',
      at: now,
    }
    let record: FireRecord
    if (due.late > LATE_MS && !launch.catchUp) {
      record = await this.launcher.skip(input, '到点时 DSH 没在运行，错过了')
    } else if (due.blocked !== undefined) {
      record = await this.launcher.fail(input, `工作流现在执行不了：${due.blocked}`)
    } else if (
      (await this.sentWithinHour(due.workflow, due.trigger.node, now)) >= launch.maxPerHour
    ) {
      record = await this.launcher.skip(
        input,
        `这一小时已经触发了 ${String(launch.maxPerHour)} 次，到上限了`,
      )
    } else {
      record = await this.launcher.fire(input)
    }
    await this.settle(record, launch.maxFailures)
  }

  // ── 接续触发 ───────────────────────────────────────────────

  /**
   * 接续触发：等的那个工作流有实例新近结束了就触发。结束了的实例不论触发没有都记进 `seen`；
   * 暂停着时只记、不触发（恢复后不补）。
   */
  private async fireAfter(locals: TriggerLocals, now: number, paused: boolean): Promise<void> {
    const runs = this.runs
    if (runs === undefined) return
    for (const [workflow, nodes] of Object.entries(locals)) {
      const cards = Object.entries(nodes).filter(([, local]) => local.enabled)
      if (cards.length === 0) continue
      const graph = await this.graphs.read(workflow)
      if (graph.kind !== 'ok') continue
      for (const [node, local] of cards) {
        const trigger = graph.triggers.find((candidate) => candidate.node === node)
        const source = trigger?.data.source
        if (trigger === undefined || source?.kind !== 'after') continue
        if (sourceProblem(source) !== null) continue
        if (afterProblem(workflow, source, await this.graphs.read(source.workflow)) !== null)
          continue
        const seen = local.seen ?? []
        const found = await runs.finished(source.workflow, local.since ?? now, new Set(seen))
        const present = new Set(found.ids)
        const kept = seen.filter((id) => present.has(id))
        if (found.runs.length === 0 && kept.length === seen.length) continue
        const next = [...kept, ...found.runs.map((run) => run.id)]
        const still = await this.store.update((current) => {
          const entry = current[workflow]?.[node]
          if (entry?.enabled !== true) return false
          if (next.length > 0) entry.seen = next
          else delete entry.seen
          return true
        })
        if (!still || paused) continue
        for (const run of found.runs) {
          if (!afterMatches(source, run.status)) continue
          // 一次一次地发：每次都按现读的本机状态（上一次的会话、开关）。
          const current = (await this.store.locals())[workflow]?.[node]
          if (current?.enabled !== true) break
          await this.launchCounted(
            {
              workflow,
              trigger,
              local: current,
              channel: 'after',
              at: now,
              info: afterInfo(source.workflow, run),
            },
            graph.blocked,
          )
        }
      }
    }
  }

  // ── 常驻触发源 ─────────────────────────────────────────────

  /** 本机状态里开着、确认过、设置得对的常驻触发源（轮询、监听程序、HTTP）。 */
  private async liveSpecs(locals: TriggerLocals): Promise<LiveSpec[]> {
    const specs: LiveSpec[] = []
    for (const [workflow, nodes] of Object.entries(locals)) {
      const enabled = Object.entries(nodes).filter(([, local]) => local.enabled)
      if (enabled.length === 0) continue
      const graph = await this.graphs.read(workflow)
      if (graph.kind !== 'ok') continue
      for (const [node, local] of enabled) {
        const trigger = graph.triggers.find((candidate) => candidate.node === node)
        if (trigger === undefined) continue
        const { source } = trigger.data
        if (!isFilterKind(source.kind) || sourceProblem(source) !== null) continue
        if (pendingApproval(trigger, local) !== null) continue
        const base = { workflow, node, filter: filterOf(trigger.data), cwd: local.workspace ?? '' }
        if (source.kind === 'http') {
          if (local.hook === undefined || local.token === undefined) continue
          specs.push({ ...base, source, hook: { id: local.hook, token: local.token } })
          continue
        }
        if (source.kind !== 'poll' && source.kind !== 'listen') continue
        const dir = assetsDir(this.dataDir(), workflow)
        specs.push({
          ...base,
          source,
          command: bindWorkflowVar(source.command, dir),
          env: { WORKFLOW_DIR: dir },
          ...(local.probe === undefined ? {} : { probe: local.probe }),
        })
      }
    }
    return specs
  }

  /** 等常驻触发源交来的事都办完（测试用）。 */
  settled(): Promise<void> {
    return this.delivering
  }

  private enqueue(task: () => Promise<unknown>): void {
    this.delivering = this.delivering.then(task).then(
      () => {},
      (error: unknown) => this.warn(`触发器出错：${messageOf(error)}`),
    )
  }

  /** 一张常驻的卡片现在的定义与本机设置；关掉了、删掉了是 `null`。 */
  private async liveInput(ref: LiveRef): Promise<{ input: FireInput; blocked?: string } | null> {
    const found = await this.definition(ref.workflow, ref.node)
    if (!found.ok) return null
    const local = (await this.store.locals())[ref.workflow]?.[ref.node]
    if (local?.enabled !== true) return null
    const { trigger, blocked } = found.result
    return {
      input: { workflow: ref.workflow, trigger, local, channel: ref.kind, at: this.now() },
      ...(blocked === undefined ? {} : { blocked }),
    }
  }

  /** 过了过滤的一批：发进会话（工作流有错、到了每小时上限时不发）。 */
  private async deliver(ref: LiveRef, batch: IntakeBatch): Promise<void> {
    const found = await this.liveInput(ref)
    if (found === null) return
    const input: FireInput = {
      ...found.input,
      ...(batch.info === undefined ? {} : { info: batch.info }),
      merged: batch.count,
    }
    await this.launchCounted(input, found.blocked)
  }

  /**
   * 常驻触发源、接续触发的一次：工作流有错时记失败，到了每小时上限丢掉（隔一会儿才记一条跳过），
   * 否则发进会话；然后记账。
   */
  private async launchCounted(input: FireInput, blocked: string | undefined): Promise<void> {
    const launch = launchOf(input.trigger.data)
    let record: FireRecord
    if (blocked !== undefined) {
      record = await this.launcher.fail(input, `工作流现在执行不了：${blocked}`)
    } else if (
      (await this.sentWithinHour(input.workflow, input.trigger.node, input.at)) >= launch.maxPerHour
    ) {
      const key = `${input.workflow}\u0000${input.trigger.node}`
      const noted = this.capNoted.get(key)
      if (noted !== undefined && input.at - noted < CAP_NOTE_MS) return
      this.capNoted.set(key, input.at)
      record = await this.launcher.skip(
        input,
        `这一小时已经触发了 ${String(launch.maxPerHour)} 次，到上限了（之后十分钟里超出的不再逐条记录）`,
      )
    } else {
      record = await this.launcher.fire(input)
    }
    await this.settle(record, launch.maxFailures)
  }

  /** 触发源自己出了问题（程序一启动就退出、命令跑不起来）：记一条、计一次失败。 */
  private async sourceFailed(ref: LiveRef, reason: string): Promise<void> {
    const found = await this.liveInput(ref)
    if (found === null) return
    const record = await this.launcher.fail(found.input, reason)
    await this.settle(record, launchOf(found.input.trigger.data).maxFailures)
    // 可能刚被自动停用：马上对一遍账，把它停下。
    if (this.running) this.schedule(0)
  }

  private clearFailures(ref: LiveRef): Promise<void> {
    return this.store.update((locals) => {
      const local = locals[ref.workflow]?.[ref.node]
      if (local?.failures !== undefined) delete local.failures
    })
  }

  // ── 共用 ───────────────────────────────────────────────────

  private async sentWithinHour(workflow: string, node: string, now: number): Promise<number> {
    const fires = await this.store.fires()
    return fires.filter(
      (fire) =>
        fire.workflow === workflow &&
        fire.node === node &&
        fire.outcome === 'sent' &&
        now - fire.at < HOUR_MS,
    ).length
  }

  /** 一次触发之后：发出去了清掉失败计数、记下会话；连续失败到了次数就自动停用。 */
  private settle(record: FireRecord, maxFailures: number): Promise<void> {
    return this.store.update((locals) => {
      const local = locals[record.workflow]?.[record.node]
      if (local === undefined) return
      if (record.outcome === 'sent') {
        delete local.failures
        if (record.session !== undefined) local.lastSession = record.session
        return
      }
      if (record.outcome !== 'failed') return
      const failures = (local.failures ?? 0) + 1
      local.failures = failures
      if (failures < maxFailures) return
      local.enabled = false
      local.stopped = `连续 ${String(failures)} 次失败：${record.reason ?? '原因不明'}`
      delete local.due
      delete local.failures
    })
  }

  // ── 画布 ───────────────────────────────────────────────────

  /** 一个工作流里每张触发卡片现在的样子。 */
  async list(workflow: string): Promise<TriggerListResponse> {
    const scene = await this.scene()
    const cards = await this.views(workflow, scene)
    return { triggers: cards.map((card) => card.view), ...sceneHead(scene) }
  }

  /** 这台机器上所有工作流里的触发卡片（工作流中心「触发」页）。 */
  async all(): Promise<TriggerAllResponse> {
    const scene = await this.scene()
    const triggers: TriggerEntry[] = []
    const names = [...(await this.graphs.names())].sort((a, b) => a.localeCompare(b))
    for (const workflow of names) {
      for (const { trigger, view } of await this.views(workflow, scene)) {
        triggers.push({ workflow, name: trigger.name, data: trigger.data, view })
      }
    }
    return { triggers, ...sceneHead(scene) }
  }

  /** HTTP 触发的端口现在的样子（设置页「监听状态」）。 */
  async httpStatus(): Promise<TriggerHttpStatus> {
    const owner = await this.lock.current()
    if (owner === undefined) return { state: 'away' }
    const port = (await this.ownerLive(owner))?.port
    if (port === undefined || port.kind === 'closed') return { state: 'idle' }
    if (port.kind === 'error') return { state: 'error', problem: port.problem }
    // 早先写下的运行情况没有监听地址：那时只监听本机。
    const host = port.host ?? LOCAL_HOST
    return {
      state: 'open',
      host,
      port: port.port,
      url: `http://${advertisedHost(host)}:${String(port.port)}`,
    }
  }

  /** 负责的进程写下的运行情况；写它的不是现在负责的进程就不作数。 */
  private async ownerLive(owner: TriggerOwner | undefined): Promise<LiveFile | null> {
    if (owner === undefined) return null
    const liveFile = await this.store.live()
    return liveFile?.pid === owner.pid ? liveFile : null
  }

  /** 全部暂停（`true`）或恢复（`false`）。各卡片的开关不动；恢复后暂停期间的变化不补。 */
  async pause(paused: boolean): Promise<TriggerPauseResponse> {
    if (!paused && (await this.store.paused()) !== undefined) await this.freshPolls()
    await this.store.setPaused(paused ? this.now() : null)
    if (this.running) this.schedule(0)
    const since = await this.store.paused()
    return since === undefined ? {} : { paused: since }
  }

  /** 开着的条件轮询从现在起算：恢复后第一次检查只记下，暂停期间条件变了不算一次触发。 */
  private async freshPolls(): Promise<void> {
    const polls: { workflow: string; node: string }[] = []
    for (const [workflow, nodes] of Object.entries(await this.store.locals())) {
      if (!Object.values(nodes).some((local) => local.enabled)) continue
      const graph = await this.graphs.read(workflow)
      if (graph.kind !== 'ok') continue
      for (const trigger of graph.triggers) {
        if (trigger.data.source.kind === 'poll' && nodes[trigger.node]?.enabled === true) {
          polls.push({ workflow, node: trigger.node })
        }
      }
    }
    if (polls.length === 0) return
    await this.store.update((locals) => {
      for (const { workflow, node } of polls) {
        const local = locals[workflow]?.[node]
        if (local !== undefined) local.probe = { ...FRESH_PROBE }
      }
    })
  }

  /** 列卡片要用的、与具体工作流无关的那些（一次读好，「触发」页列很多工作流时不重复读）。 */
  private async scene(): Promise<Scene> {
    const owner = await this.lock.current()
    const last = new Map<string, FireRecord>()
    for (const fire of await this.store.fires())
      last.set(`${fire.workflow}\u0000${fire.node}`, fire)
    return {
      owner,
      locals: await this.store.locals(),
      last,
      live: await this.ownerLive(owner),
      unavailable: this.sessions.unavailable(),
      paused: await this.store.paused(),
      listen: this.listen(),
      now: this.now(),
    }
  }

  private async views(
    workflow: string,
    scene: Scene,
  ): Promise<{ trigger: TriggerDefinition; view: TriggerView }[]> {
    const graph = await this.graphs.read(workflow)
    if (graph.kind !== 'ok') return []
    const locals = scene.locals[workflow] ?? {}
    const { owner, live, unavailable, paused, listen, now } = scene
    const host = advertisedHost(listen.host)
    const cards: { trigger: TriggerDefinition; view: TriggerView }[] = []
    for (const trigger of graph.triggers) {
      const local = locals[trigger.node] ?? { enabled: false }
      const recent = scene.last.get(`${workflow}\u0000${trigger.node}`)
      const { source } = trigger.data
      const command = commandOf(source)
      const base = {
        node: trigger.node,
        enabled: local.enabled,
        ...(local.workspace === undefined ? {} : { workspace: local.workspace }),
        ...(local.session === undefined ? {} : { session: local.session }),
        ...(recent === undefined ? {} : { last: recent }),
        ...(command === undefined
          ? {}
          : { approved: local.approved === approvalOf(command, local.workspace) }),
        ...(source.kind === 'http' && local.hook !== undefined && local.token !== undefined
          ? {
              endpoint: {
                url: hookUrl(host, listen.port, local.hook),
                hook: local.hook,
                token: local.token,
              },
            }
          : {}),
      }
      const view = await (async (): Promise<TriggerView> => {
        if (!local.enabled) {
          return local.stopped === undefined
            ? { ...base, state: 'off' }
            : { ...base, state: 'stopped', problem: local.stopped }
        }
        const problem =
          sourceProblem(source) ??
          (source.kind === 'after'
            ? afterProblem(workflow, source, await this.graphs.read(source.workflow))
            : null)
        if (problem !== null) return { ...base, state: 'invalid', problem }
        const pending = pendingApproval(trigger, local)
        if (pending !== null) return { ...base, state: 'confirm', problem: pending }
        if (paused !== undefined) return { ...base, state: 'paused' }
        if (source.kind === 'schedule') {
          const next = upcoming(local, source.schedule, now)
          const when = next === undefined ? {} : { next }
          if (owner !== undefined && !owner.mine) return { ...base, ...when, state: 'elsewhere' }
          if (unavailable !== null) return { ...base, state: 'unavailable', problem: unavailable }
          return { ...base, ...when, state: 'waiting' }
        }
        if (owner !== undefined && !owner.mine) return { ...base, state: 'elsewhere' }
        if (unavailable !== null) return { ...base, state: 'unavailable', problem: unavailable }
        if (source.kind === 'after') return { ...base, state: 'waiting' }
        return {
          ...base,
          ...liveView(source.kind, live?.sources[workflow]?.[trigger.node], live),
        }
      })()
      cards.push({ trigger, view })
    }
    return cards
  }

  private async definition(
    workflow: string,
    node: string,
  ): Promise<Outcome<{ trigger: TriggerDefinition; blocked?: string }>> {
    const graph = await this.graphs.read(workflow)
    if (graph.kind === 'missing') return fail('not_found', `工作流 ${workflow} 不存在`)
    if (graph.kind === 'broken') return fail('blocked', graph.reason)
    const trigger = graph.triggers.find((candidate) => candidate.node === node)
    if (trigger === undefined) {
      return fail('not_found', `工作流 ${workflow} 里没有触发卡片 ${node}（刚加的卡片要先保存）`)
    }
    return ok({ trigger, ...(graph.blocked === undefined ? {} : { blocked: graph.blocked }) })
  }

  /**
   * 改一张卡片的本机设置：开关、工作区、固定会话、确认命令、换令牌；给了哪项改哪项。
   * 回这个工作流各卡片的新样子。
   */
  async set(request: TriggerSetRequest): Promise<Outcome<TriggerListResponse>> {
    const found = await this.definition(request.workflow, request.node)
    if (!found.ok) return found
    const { trigger } = found.result
    const { source } = trigger.data
    if (request.workspace !== undefined && request.workspace !== '') {
      const directory = await workspaceProblem(request.workspace)
      if (directory !== null) return fail('invalid_args', directory)
    }
    const now = this.now()
    // 接续触发等的那个工作流要在、要记运行状态、不能是自己（要看别的图，在写锁外面查好）。
    const after =
      source.kind === 'after' && request.enabled === true
        ? afterProblem(request.workflow, source, await this.graphs.read(source.workflow))
        : null
    const refused = await this.store.update((locals): string | null => {
      const group = locals[request.workflow] ?? {}
      const local: TriggerLocal = group[request.node] ?? { enabled: false }
      if (request.workspace !== undefined) {
        if (request.workspace === '') delete local.workspace
        else local.workspace = request.workspace
      }
      if (request.session !== undefined) {
        if (request.session === '') delete local.session
        else local.session = request.session
      }
      // 确认命令记在工作区改完之后：确认的是「这条命令在这个工作区里跑」。
      if (request.approve !== undefined) {
        const command = commandOf(source)
        if (command === undefined) return '这张触发卡片不用运行命令'
        // 用户看到的和图里现在的不一样（刚被改过）：不算确认。
        if (request.approve !== command) return '要运行的命令刚改过，请重新查看后再确认'
        if (local.workspace === undefined) return '先选命令在哪个工作区里运行'
        local.approved = approvalOf(command, local.workspace)
      }
      const endpoint = setEndpoint(request, source, local, locals)
      if (endpoint !== null) return endpoint
      if (request.enabled === true && !local.enabled) {
        const missing = after ?? enableProblem(trigger, local)
        if (missing !== null) return missing
        local.enabled = true
        local.since = now
        delete local.due
        delete local.rule
        delete local.failures
        delete local.stopped
        delete local.seen
      }
      if (request.enabled === false) {
        local.enabled = false
        delete local.due
        delete local.stopped
        delete local.failures
      }
      group[request.node] = local
      locals[request.workflow] = group
      return null
    })
    if (refused !== null) return fail('blocked', refused)
    // 负责触发的是本进程时马上对一遍账（新打开的卡片立刻有「下一次」、程序马上起来）。
    if (this.running) this.schedule(0)
    return ok(await this.list(request.workflow))
  }

  /** 「立即触发一次」：不看开关、不占每小时的次数，在收到请求的这个进程里发。 */
  async fireNow(request: TriggerFireRequest): Promise<Outcome<FireRecord>> {
    const found = await this.definition(request.workflow, request.node)
    if (!found.ok) return found
    const { trigger, blocked } = found.result
    const local = (await this.store.locals())[request.workflow]?.[request.node] ?? {
      enabled: false,
    }
    const input: FireInput = {
      workflow: request.workflow,
      trigger,
      local,
      channel: 'now',
      at: this.now(),
      ...(request.info === undefined ? {} : { info: request.info }),
    }
    const record =
      blocked === undefined
        ? await this.launcher.fire(input)
        : await this.launcher.fail(input, `工作流现在执行不了：${blocked}`)
    if (record.outcome === 'sent' && record.session !== undefined) {
      const { session } = record
      await this.store.update((locals) => {
        const current = locals[request.workflow]?.[request.node]
        if (current !== undefined) current.lastSession = session
      })
    }
    return ok(record)
  }

  /**
   * 模型按触发条件判断这一次不需要执行：记下原因（触发记录里显示「模型判断不需要」）。
   * 已经开始执行（建出了实例）的不能再说不需要。
   */
  async decline(fire: string, reason: string): Promise<Outcome<FireRecord>> {
    const detail = await this.store.detail(fire)
    if (detail === null) return fail('not_found', `没有这次触发：${fire}`)
    if (detail.record.instance !== undefined) {
      return fail(
        'blocked',
        `这次触发已经开始执行了（实例 ${detail.record.instance}），不能再判断为不需要`,
      )
    }
    const text = reason.trim() === '' ? '没有说明原因' : reason.trim()
    await this.store.decline(fire, text)
    return ok({ ...detail.record, declined: text })
  }

  /** 轮询命令、监听程序最近的输出。 */
  async output(workflow: string, node: string): Promise<string> {
    return (await this.store.output(workflow, node)) ?? ''
  }

  /** 触发记录，新的在前；给了卡片就只看它的。 */
  async history(workflow: string, node?: string): Promise<FireRecord[]> {
    const fires = await this.store.fires()
    return fires
      .filter((fire) => fire.workflow === workflow && (node === undefined || fire.node === node))
      .reverse()
      .slice(0, HISTORY_PAGE)
  }
}

/** 列卡片时一次读好的东西。 */
interface Scene {
  owner: TriggerOwner | undefined
  locals: TriggerLocals
  /** 工作流 + 卡片 → 最近一次触发。 */
  last: Map<string, FireRecord>
  live: LiveFile | null
  unavailable: string | null
  paused: number | undefined
  /** HTTP 触发的监听地址与端口。 */
  listen: HookBind
  now: number
}

/** 列表回答里与具体卡片无关的那两样。 */
function sceneHead(scene: Scene): { owner?: TriggerOwner; paused?: number } {
  return {
    ...(scene.owner === undefined ? {} : { owner: scene.owner }),
    ...(scene.paused === undefined ? {} : { paused: scene.paused }),
  }
}

/**
 * HTTP 触发的地址与令牌：自己写的先核对（地址不能和别的卡片重），没有的补上缺省
 * （地址用工作流名、令牌随机）。打开开关、换令牌、改地址或令牌时才补。
 * @returns 改不成的原因；改成了（或这次不涉及）是 `null`。
 */
function setEndpoint(
  request: TriggerSetRequest,
  source: TriggerSource,
  local: TriggerLocal,
  locals: TriggerLocals,
): string | null {
  const touched = request.hook !== undefined || request.token !== undefined
  if (source.kind !== 'http') {
    if (touched || request.resetToken === true) return '只有 HTTP 触发有地址和令牌'
    return null
  }
  if (!touched && request.resetToken !== true && request.enabled !== true) return null
  if (request.token !== undefined && request.resetToken === true)
    return '自己写令牌和换一个令牌只能选一样'
  const taken = new Set<string>()
  for (const [workflow, group] of Object.entries(locals)) {
    for (const [node, other] of Object.entries(group)) {
      if (workflow === request.workflow && node === request.node) continue
      if (other.hook !== undefined) taken.add(other.hook)
    }
  }
  if (request.hook !== undefined) {
    const hook = request.hook.normalize('NFC')
    const issue = hookIssue(hook)
    if (issue !== null) return HOOK_ISSUE[issue]
    if (taken.has(hook)) return `地址「${hook}」已经被别的 HTTP 触发卡片用了`
    local.hook = hook
  }
  local.hook ??= hookFromName(request.workflow, taken) ?? newHookId()
  if (request.token !== undefined) {
    const issue = tokenIssue(request.token)
    if (issue !== null) return TOKEN_ISSUE[issue]
    local.token = request.token
  } else if (request.resetToken === true || local.token === undefined) {
    local.token = newHookToken()
  }
  return null
}

const HOOK_ISSUE: Record<HookIssue, string> = {
  empty: '地址不能为空',
  chars: '地址只能用字母、数字、中文和 - _',
  long: `地址最长 ${String(HOOK_MAX_LENGTH)} 个字`,
}

const TOKEN_ISSUE: Record<TokenIssue, string> = {
  short: `令牌至少 ${String(TOKEN_MIN_LENGTH)} 个字`,
  chars: '令牌只能用字母、数字和 - _ . ~',
  long: `令牌最长 ${String(TOKEN_MAX_LENGTH)} 个字`,
}

/** 要在本机跑的命令还没确认、或确认之后命令和工作区改过：一句原因；不用确认或确认过是 `null`。 */
function pendingApproval(trigger: TriggerDefinition, local: TriggerLocal): string | null {
  const command = commandOf(trigger.data.source)
  if (command === undefined) return null
  if (local.workspace === undefined) return '先选命令在哪个工作区里运行'
  if (local.approved === undefined) return '要先确认将要运行的命令'
  return local.approved === approvalOf(command, local.workspace)
    ? null
    : '要运行的命令或工作区改过了，要重新确认'
}

/** 常驻触发源开着、确认过时的状态：按负责的进程写下的运行情况说。 */
function liveView(
  kind: 'poll' | 'listen' | 'http',
  status: LiveFile['sources'][string][string] | undefined,
  live: LiveFile | null,
): Pick<TriggerView, 'state' | 'next' | 'problem' | 'checked' | 'since' | 'line'> {
  if (kind === 'http') {
    const port = live?.port
    return port?.kind === 'error'
      ? { state: 'error', problem: port.problem }
      : { state: 'listening' }
  }
  // 负责的进程还没开起来（刚打开开关、刚接手）。
  if (status === undefined) return { state: 'waiting' }
  if (kind === 'poll') {
    return {
      state: 'waiting',
      ...(status.next === undefined ? {} : { next: status.next }),
      ...(status.checked === undefined ? {} : { checked: status.checked }),
      ...(status.note === undefined ? {} : { problem: status.note }),
    }
  }
  const line = status.line === undefined ? {} : { line: status.line }
  if (status.state === 'restarting') {
    return {
      state: 'restarting',
      ...(status.next === undefined ? {} : { next: status.next }),
      ...(status.note === undefined ? {} : { problem: status.note }),
      ...line,
    }
  }
  return {
    state: 'listening',
    ...(status.since === undefined ? {} : { since: status.since }),
    ...line,
  }
}

/** 打开开关之前要先配好的东西；都齐了是 `null`。 */
function enableProblem(trigger: TriggerDefinition, local: TriggerLocal): string | null {
  const { source } = trigger.data
  const problem = sourceProblem(source)
  if (problem !== null) {
    return source.kind === 'schedule' ? `定时规则不对：${problem}` : `触发设置不对：${problem}`
  }
  const pending = pendingApproval(trigger, local)
  if (pending !== null) return pending
  const missing = launchMissing(trigger.data, local)
  if (missing === 'session') return '先选定发进哪个会话'
  return missing === 'workspace' ? '先选在哪个工作区里新建会话' : null
}

/** 工作区要是一个已有目录的绝对路径；没问题是 `null`。 */
async function workspaceProblem(path: string): Promise<string | null> {
  if (!isAbsolute(path)) return `工作区要写绝对路径：${path}`
  try {
    return (await stat(path)).isDirectory() ? null : `工作区不是文件夹：${path}`
  } catch {
    return `工作区目录不存在：${path}`
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
