/**
 * dsh-workflow-lite — 触发器的业务面：到点触发、常驻的触发源、开关与本机设置、「立即触发一次」、状态与触发记录。
 *
 * 触发只由负责的那个 DSH 进程做（见 `owner.ts`）：每隔几秒报到一次、对一遍账（`reconcile.ts`），
 * 到点的交给 `launcher.ts` 发进会话；定时检查、监听程序、HTTP 地址按本机状态开着或停下（`runtime.ts`），
 * 它们进来的内容过了过滤也交给 `launcher.ts`；接续触发每一轮看一眼等的那个工作流有没有实例刚结束（`after.ts`）。
 * 开关、设置、「立即触发一次」「全部暂停」哪个进程都能做，都落在 `<dataDir>/triggers/` 里，负责的进程下一轮就看到。
 *
 * 「全部暂停」不动各卡片的开关：暂停着时定时照样往后排、接续触发照样记下处理过的实例，只是都不触发，
 * 常驻的全停下；恢复后接着跑，暂停期间错过的不补。
 *
 * 要在本机跑命令的（定时检查、监听程序）打开前要确认那条命令（用户在画布上，或模型经 `write_trigger` 打开时），
 * 记下命令、工作区与 shell 的记号；有一样改了就停下、等重新确认（`confirm`）。
 *
 * 「连续几次失败就自动停用」里的「失败」只指触发器自己干不了活：工作区或会话不在了、会话建不出来、
 * 图编译不出计划、监听程序一启动就退出、检查的命令跑不起来。跳过（上一次还在跑、超过每小时上限、错过了）、
 * 条件不满足、过滤掉的都不算，消息发进去之后工作流执行得怎么样更不算。
 * 端口被占用也不算：那是「出错」，端口空出来或换一个就恢复。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/service
 */

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { bindWorkflowVar } from '../../shared/pathVars.ts'
import { hasSessionChoice } from '../../shared/sessionChoice.ts'
import {
  afterMatches,
  commandOf,
  type FilterKind,
  filterOf,
  isLiveSource,
  launchMissing,
  launchOf,
  reachedLimit,
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
import { OUTPUT_LINES } from '../../shared/wire/config.ts'
import type {
  FireRecord,
  OutputFilter,
  ShellChoice,
  TriggerActivitySlot,
  TriggerAllResponse,
  TriggerDetailResponse,
  TriggerEntry,
  TriggerFireRequest,
  TriggerHttpStatus,
  TriggerListResponse,
  TriggerOutputLinesResponse,
  TriggerOutputResponse,
  TriggerOwner,
  TriggerPauseResponse,
  TriggerPingRequest,
  TriggerPingResponse,
  TriggerSetRequest,
  TriggerShellsResponse,
  TriggerTryRequest,
  TriggerTryResponse,
  TriggerUpstream,
  TriggerView,
} from '../../shared/wire/trigger.ts'
import { ensureDir } from '../store/atomic.ts'
import { assetsDir } from '../store/paths.ts'
import { fail, type Outcome, ok } from '../store/repoResult.ts'
import { afterInfo, afterProblem, type RunWatch } from './after.ts'
import { type CardTestOptions, type CardTestResult, testCard } from './cardTest.ts'
import type { TriggerDefinition, TriggerGraphs } from './graphs.ts'
import { type HookBind, hookUrl, newHookId, newHookToken } from './hooks.ts'
import type { IntakeBatch } from './intake.ts'
import { placeKit } from './kit.ts'
import { type FireInput, Launcher, SKIP_UNFINISHED } from './launcher.ts'
import { advertisedHost } from './netAddress.ts'
import { OwnerLock } from './owner.ts'
import { FRESH_PROBE } from './poller.ts'
import type { CommandSpec } from './processes.ts'
import { type DueFire, planRound, upcoming } from './reconcile.ts'
import { endProblem, RunEnds } from './runEnd.ts'
import {
  type LiveRef,
  type LiveRuntime,
  type LiveSpec,
  type RuntimeEvents,
  TriggerRuntime,
} from './runtime.ts'
import { changedScripts, SCRIPTS_DIR } from './scriptAge.ts'
import type { SessionPort } from './sessions.ts'
import { checkShell, detectShells, familyOf, shellLabel, shellName, systemShell } from './shells.ts'
import {
  approvalOf,
  CARD_DATA_ENV,
  CARD_SECRETS_ENV,
  cardDataDir,
  cardSecretsDir,
  type LiveFile,
  ownerFile,
  type TriggerLocal,
  type TriggerLocals,
  type TriggerStore,
} from './store.ts'
import { pingHook, tryCheck, tryListen } from './trial.ts'

/** 多久报到、对一次账。 */
export const BEAT_MS = 5_000
/** 卡片关掉（含连续失败被停用）时排着的记成跳过的原因。 */
const DROPPED_OFF = '触发器停用了，排着的不再执行'
/** 晚了这么久还没触发，就算「错过了」（DSH 当时没在运行）。 */
export const LATE_MS = 2 * 60_000
/** 触发记录一次缺省给画布多少条、最多给多少条。 */
const HISTORY_PAGE = 50
const HISTORY_MAX = 200
/** 近况最多往前看几天。 */
const ACTIVITY_DAYS = 31
/** 详情里背景信息最多给界面多少字。 */
const DETAIL_INFO_CHARS = 20_000
const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS
/** 最近的输出一次缺省给多少条、最多给多少条。 */
const OUTPUT_PAGE = 200
const OUTPUT_PAGE_MAX = 1000
/** 超过每小时上限的常驻触发源，隔多久才再记一条「跳过」（日志刷屏时别把记录也刷满）。 */
const CAP_NOTE_MS = 10 * 60_000

export interface TriggerServiceDeps {
  dataDir: () => string
  store: TriggerStore
  graphs: TriggerGraphs
  sessions: SessionPort
  /** HTTP 触发的监听地址与端口（插件设置）。 */
  listen: () => HookBind
  /** 定时检查、监听没单独选 shell 时用哪个（插件设置，程序的完整路径）；空串或不给 = 系统的。 */
  defaultShell?: () => string
  /** 每张定时检查、监听卡片最近的输出留多少行（插件设置）；不给是 {@link OUTPUT_LINES} 的缺省值。 */
  outputLines?: () => number
  /** 实例那边：接续触发看别的工作流有没有实例结束，跳过、排队看上一次跑完没有。 */
  runs: RunWatch
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
  private readonly runs: RunWatch
  private readonly launcher: Launcher
  /** 上一次触发发起的执行结束了没有（跳过、排队、放行排着的都按它）。 */
  private readonly ends: RunEnds
  private readonly lock: OwnerLock
  private readonly runtime: LiveRuntime
  private readonly dataDir: () => string
  private readonly listen: () => HookBind
  private readonly defaultShell: () => string
  private readonly outputLines: () => number
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
  /** 建过的数据目录（每一轮都要组一遍命令，别每次都去碰磁盘）。 */
  private readonly madeDirs = new Set<string>()

  constructor(deps: TriggerServiceDeps) {
    this.store = deps.store
    this.graphs = deps.graphs
    this.sessions = deps.sessions
    this.runs = deps.runs
    this.dataDir = deps.dataDir
    this.listen = deps.listen
    this.defaultShell = deps.defaultShell ?? (() => '')
    this.outputLines = deps.outputLines ?? (() => OUTPUT_LINES.fallback)
    this.now = deps.now ?? Date.now
    this.warn = deps.warn ?? (() => {})
    this.ends = new RunEnds(deps.store, deps.runs)
    this.launcher = new Launcher(deps.sessions, deps.store, this.ends)
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
        outputs: deps.store.outputs,
        keep: this.outputLines,
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
    await this.releaseQueued(fresh, now, paused)
    await this.runtime.sync(paused ? [] : await this.liveSpecs(fresh))
  }

  // ── 排队 ───────────────────────────────────────────────────

  /**
   * 排着的轮到没有：每一轮先问一次「哪些卡片有排着的」（只碰排着的那几行，平时是空的就到此为止），
   * 再一张一张看上一次触发发起的执行结束了没有（按运行状态，见 `runEnd.ts`），结束了发最早的那一个（一轮每张卡片最多一个）。
   * 看不出上一次跑完没有的（工作流没开「记录运行状态」）先留着。
   * 卡片关掉了、删掉了的排着的都记成跳过；全部暂停时留着不发。
   */
  private async releaseQueued(locals: TriggerLocals, now: number, paused: boolean): Promise<void> {
    for (const { workflow, node } of await this.store.queuedCounts()) {
      const local = locals[workflow]?.[node]
      if (local?.enabled !== true) {
        await this.store.drop(workflow, node, DROPPED_OFF)
        continue
      }
      const found = await this.definition(workflow, node)
      if (!found.ok) {
        if (found.error.code === 'not_found') {
          await this.store.drop(workflow, node, '触发器删掉了，排着的不再执行')
        }
        continue
      }
      if (paused) continue
      const { trigger, blocked } = found.result
      if (endProblem(trigger.data, trigger.runState) !== null) continue
      if (!(await this.ends.previous(local)).ended) continue
      const [first] = await this.store.queuedFires(workflow, node)
      const detail = first === undefined ? null : await this.store.detail(first.id)
      if (detail === null) continue
      const record =
        blocked === undefined
          ? await this.launcher.release(detail, trigger, local, now)
          : await this.launcher.releaseFailed(detail, `工作流现在执行不了：${blocked}`, now)
      if (record !== null) await this.settle(record, launchOf(trigger.data).maxFailures)
    }
  }

  /** 取消排着的一次（记成跳过）；已经发出去了、不是排着的回错。 */
  async cancelQueued(fire: string): Promise<Outcome<FireRecord>> {
    if (!(await this.store.cancel(fire, '手动取消'))) {
      return fail('blocked', '这一次已经不在排队了')
    }
    const detail = await this.store.detail(fire)
    return detail === null ? fail('not_found', `没有这次触发：${fire}`) : ok(detail.record)
  }

  /**
   * 视为已结束：把上一次发起的那次执行当作已经结束（模型没把运行状态改成结束、一直卡着时用），
   * 下一轮放行排着的下一个。
   */
  async waive(workflow: string, node: string): Promise<Outcome<Record<string, never>>> {
    const refused = await this.store.update((locals): string | null => {
      const local = locals[workflow]?.[node]
      if (local?.lastFire === undefined) return '这张卡片还没有发出去过'
      local.waived = local.lastFire
      return null
    })
    if (refused !== null) return fail('blocked', refused)
    if (this.running) this.schedule(0)
    return ok({})
  }

  /** 接续触发：等的那个工作流最新的实例（卡片上那颗点）。读不到当没有，不耽误卡片别的部分。 */
  private async upstreamOf(source: TriggerSource): Promise<{ upstream?: TriggerUpstream }> {
    if (source.kind !== 'after' || source.workflow === '') return {}
    try {
      const newest = await this.runs.newest(source.workflow)
      return newest === null ? {} : { upstream: newest }
    } catch {
      return {}
    }
  }

  /**
   * 这张卡片排着几个、在等哪一次跑完。在等的只在有排着的、或选了跳过而最近一次因为上一次没结束被跳过时才看
   * （平时不去读实例的运行状态）。
   */
  private async queuedOf(
    scene: Scene,
    workflow: string,
    trigger: TriggerDefinition,
    local: TriggerLocal,
    recent: FireRecord | undefined,
  ): Promise<Pick<TriggerView, 'queued' | 'waiting'>> {
    const queued = scene.queued.get(`${workflow}\u0000${trigger.node}`)
    const skipping =
      launchOf(trigger.data).overlap === 'skip' &&
      recent?.outcome === 'skipped' &&
      recent.reason === SKIP_UNFINISHED
    const counted = queued === undefined ? {} : { queued }
    if (queued === undefined && !skipping) return counted
    const previous = await this.ends.previous(local)
    return previous.ended ? counted : { ...counted, waiting: previous.waiting }
  }

  /** 清空一张卡片排着的（都记成跳过），回清掉了几个。 */
  async clearQueue(workflow: string, node: string): Promise<Outcome<{ cleared: number }>> {
    return ok({ cleared: await this.store.drop(workflow, node, '手动清空') })
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
      reachedLimit(
        await this.sentWithinHour(due.workflow, due.trigger.node, now),
        launch.maxPerHour,
      )
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

  /** 本机状态里开着、确认过、设置得对的常驻触发源（带检查命令的定时、监听程序、HTTP）。 */
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
        if (!isLiveSource(source) || sourceProblem(source) !== null) continue
        const shell = this.shellFor(local)
        if (pendingApproval(trigger, local, shell) !== null) continue
        const base = { workflow, node, filter: filterOf(trigger.data), cwd: local.workspace ?? '' }
        if (source.kind === 'http') {
          if (local.hook === undefined || local.token === undefined) continue
          const token = local.noToken === true ? null : local.token
          specs.push({ ...base, source, hook: { id: local.hook, token } })
          continue
        }
        const command = commandOf(source)
        if (command === undefined) continue
        const { cwd: _cwd, ...run } = await this.commandSpec(
          workflow,
          node,
          command,
          base.cwd,
          shell,
        )
        specs.push({
          ...base,
          source,
          ...run,
          ...(source.kind === 'schedule'
            ? {
                catchUp: launchOf(trigger.data).catchUp,
                ...(local.probe === undefined ? {} : { probe: local.probe }),
              }
            : {}),
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
      reachedLimit(
        await this.sentWithinHour(input.workflow, input.trigger.node, input.at),
        launch.maxPerHour,
      )
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

  private sentWithinHour(workflow: string, node: string, now: number): Promise<number> {
    return this.store.sentSince(workflow, node, now - HOUR_MS)
  }

  /** 一次触发之后：发出去了清掉失败计数、记下会话；连续失败到了次数就自动停用（不限制的不停用）。 */
  private settle(record: FireRecord, maxFailures: number): Promise<void> {
    return this.store.update((locals) => {
      const local = locals[record.workflow]?.[record.node]
      if (local === undefined) return
      if (record.outcome === 'sent') {
        delete local.failures
        sentOn(local, record)
        return
      }
      if (record.outcome !== 'failed') return
      const failures = (local.failures ?? 0) + 1
      local.failures = failures
      if (!reachedLimit(failures, maxFailures)) return
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
    if (!paused && (await this.store.paused()) !== undefined) await this.freshChecks()
    await this.store.setPaused(paused ? this.now() : null)
    if (this.running) this.schedule(0)
    const since = await this.store.paused()
    return since === undefined ? {} : { paused: since }
  }

  /**
   * 开着的定时检查从现在起算：恢复后第一次检查只记下，暂停期间条件变了不算一次触发；
   * 存着的下一次也丢掉（暂停期间错过的不补，「每隔」恢复就查、别的等下一个钟点）。
   */
  private async freshChecks(): Promise<void> {
    const checks: { workflow: string; node: string }[] = []
    for (const [workflow, nodes] of Object.entries(await this.store.locals())) {
      if (!Object.values(nodes).some((local) => local.enabled)) continue
      const graph = await this.graphs.read(workflow)
      if (graph.kind !== 'ok') continue
      for (const trigger of graph.triggers) {
        const { source } = trigger.data
        if (
          source.kind === 'schedule' &&
          source.check !== undefined &&
          nodes[trigger.node]?.enabled === true
        ) {
          checks.push({ workflow, node: trigger.node })
        }
      }
    }
    if (checks.length === 0) return
    await this.store.update((locals) => {
      for (const { workflow, node } of checks) {
        const local = locals[workflow]?.[node]
        if (local !== undefined) local.probe = { ...FRESH_PROBE }
      }
    })
  }

  /** 列卡片要用的、与具体工作流无关的那些（一次读好，「触发」页列很多工作流时不重复读）。 */
  private async scene(): Promise<Scene> {
    const owner = await this.lock.current()
    return {
      owner,
      locals: await this.store.locals(),
      live: await this.ownerLive(owner),
      unavailable: this.sessions.unavailable(),
      paused: await this.store.paused(),
      queued: new Map(
        (await this.store.queuedCounts()).map((row) => [
          `${row.workflow}\u0000${row.node}`,
          row.count,
        ]),
      ),
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
      const recent = await this.store.last(workflow, trigger.node)
      const lastFailure = await this.store.lastFailure(workflow, trigger.node)
      const { source } = trigger.data
      const command = commandOf(source)
      const base = {
        node: trigger.node,
        enabled: local.enabled,
        ...(local.workspace === undefined ? {} : { workspace: local.workspace }),
        ...(local.shell === undefined ? {} : { shell: local.shell }),
        ...(local.session === undefined ? {} : { session: local.session }),
        ...(recent === undefined ? {} : { last: recent }),
        ...(lastFailure === undefined ? {} : { lastFailure }),
        ...(await this.queuedOf(scene, workflow, trigger, local, recent)),
        ...(trigger.runState ? { runState: true as const } : {}),
        ...(hasSessionChoice(trigger.workflowChoice)
          ? { workflowChoice: trigger.workflowChoice }
          : {}),
        ...(await this.upstreamOf(source)),
        ...(command === undefined
          ? {}
          : {
              approved:
                local.approved === approvalOf(command, local.workspace, this.shellFor(local)),
              runShell: shellLabel(this.shellFor(local)),
            }),
        // 地址、令牌有了就给（打开前先生成的也给）；只在打开了的 HTTP 卡片上收请求（见 specs）。
        ...(local.hook !== undefined && local.token !== undefined
          ? {
              endpoint: {
                url: hookUrl(host, listen.port, local.hook),
                hook: local.hook,
                token: local.token,
                ...(local.noToken === true ? { noToken: true as const } : {}),
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
            : null) ??
          endProblem(trigger.data, trigger.runState)
        if (problem !== null) return { ...base, state: 'invalid', problem }
        const pending = pendingApproval(trigger, local, this.shellFor(local))
        if (pending !== null) return { ...base, state: 'confirm', problem: pending }
        if (paused !== undefined) return { ...base, state: 'paused' }
        if (source.kind === 'schedule' && source.check === undefined) {
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
   * 改一张卡片的本机设置：开关、工作区、shell、固定会话、确认命令、换令牌；给了哪项改哪项。
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
    if (request.shell !== undefined && request.shell !== '') {
      const checked = await checkShell(request.shell)
      if (typeof checked === 'string') return fail('invalid_args', checked)
    }
    const now = this.now()
    // 接续触发等的那个工作流要在、要记运行状态、不能是自己（要看别的图，在写锁外面查好）。
    const after =
      source.kind === 'after' && request.enabled === true
        ? afterProblem(request.workflow, source, await this.graphs.read(source.workflow))
        : null
    const unjudged = request.enabled === true ? endProblem(trigger.data, trigger.runState) : null
    const refused = await this.store.update((locals): string | null => {
      const group = locals[request.workflow] ?? {}
      const local: TriggerLocal = group[request.node] ?? { enabled: false }
      if (request.workspace !== undefined) {
        if (request.workspace === '') delete local.workspace
        else local.workspace = request.workspace
      }
      if (request.shell !== undefined) {
        if (request.shell === '') delete local.shell
        else local.shell = request.shell
      }
      if (request.session !== undefined) {
        if (request.session === '') delete local.session
        else local.session = request.session
      }
      // 确认命令记在工作区、shell 改完之后：确认的是「这条命令在这个工作区里、用这个 shell 跑」。
      if (request.approve !== undefined) {
        const command = commandOf(source)
        if (command === undefined) return '这张触发卡片不用运行命令'
        // 用户看到的和图里现在的不一样（刚被改过）：不算确认。
        if (request.approve !== command) return '要运行的命令刚改过，请重新查看后再确认'
        if (local.workspace === undefined) return '先选命令在哪个工作区里运行'
        local.approved = approvalOf(command, local.workspace, this.shellFor(local))
      }
      const endpoint = setEndpoint(request, source, local, locals)
      if (endpoint !== null) return endpoint
      if (request.enabled === true && !local.enabled) {
        const missing = after ?? unjudged ?? enableProblem(trigger, local, this.shellFor(local))
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
    // 关掉了：排着的当场记成跳过（不等下一轮，界面上马上看得到）。
    if (request.enabled === false)
      await this.store.drop(request.workflow, request.node, DROPPED_OFF)
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
    if (record.outcome === 'sent') {
      await this.store.update((locals) => {
        const current = locals[request.workflow]?.[request.node]
        if (current !== undefined) sentOn(current, record)
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

  /** 这张卡片实际用哪个 shell：自己选的，没选是设置里的默认；空串是系统的。 */
  private shellFor(local: TriggerLocal): string {
    return local.shell ?? this.defaultShell()
  }

  /** 本机的 shell、系统缺省的那个、「跟着默认」现在指的那个（设置页、对话框里的下拉用）。 */
  async shells(): Promise<TriggerShellsResponse> {
    const shells = await detectShells()
    const describe = (path: string): ShellChoice =>
      shells.find((shell) => shell.path.toLowerCase() === path.toLowerCase()) ?? {
        path,
        name: shellName(path),
        family: familyOf(path) ?? (process.platform === 'win32' ? 'cmd' : 'posix'),
      }
    const system = describe(systemShell())
    const chosen = this.defaultShell()
    return { shells, system, fallback: chosen === '' ? system : describe(chosen) }
  }

  /** 认一个自己选的程序能不能当 shell 用。 */
  async checkShell(path: string): Promise<Outcome<ShellChoice>> {
    const checked = await checkShell(path)
    return typeof checked === 'string' ? fail('invalid_args', checked) : ok(checked)
  }

  /**
   * 「试运行」：把对话框里还没保存的命令在 `workspace` 里、用 `shell`（空着跟默认）跑一次（跑法同打开开关之后）。
   * 不看开关、不记触发记录；界面上用户确认过才会发来。
   */
  async tryCommand(request: TriggerTryRequest): Promise<Outcome<TriggerTryResponse>> {
    if (request.command.trim() === '') return fail('invalid_args', '命令是空的')
    const directory = await workspaceProblem(request.workspace)
    if (directory !== null) return fail('invalid_args', directory)
    const shell =
      request.shell === undefined || request.shell === '' ? this.defaultShell() : request.shell
    if (shell !== '') {
      const checked = await checkShell(shell)
      if (typeof checked === 'string') return fail('invalid_args', checked)
    }
    const spec = await this.commandSpec(
      request.workflow,
      request.node,
      request.command,
      request.workspace,
      shell,
      true,
    )
    return ok(request.kind === 'listen' ? await tryListen(spec) : await tryCheck(spec))
  }

  /**
   * 跑一张卡片的命令的样子：`{workflow}` 换成工作流目录，环境变量给工作流目录、这张卡片的数据目录
   * （`trial` = 试运行那份）和密钥目录；这两个目录先建好，监视的底子放进 `triggers/`。
   */
  private async commandSpec(
    workflow: string,
    node: string,
    command: string,
    cwd: string,
    shell: string,
    trial = false,
  ): Promise<CommandSpec> {
    const dir = assetsDir(this.dataDir(), workflow)
    const data = cardDataDir(this.dataDir(), workflow, node, trial)
    const secrets = cardSecretsDir(this.dataDir(), workflow, node)
    for (const made of [data, secrets]) {
      if (this.madeDirs.has(made)) continue
      await ensureDir(made)
      this.madeDirs.add(made)
    }
    await placeKit(dir)
    return {
      command: bindWorkflowVar(command, dir),
      cwd,
      env: { WORKFLOW_DIR: dir, [CARD_DATA_ENV]: data, [CARD_SECRETS_ENV]: secrets },
      ...(shell === '' ? {} : { shell }),
    }
  }

  /**
   * 模型试一张卡片（`test_trigger`，见 `cardTest.ts`）：按图里存着的定义、跑法同打开之后，
   * 数据目录用试运行那份；不动开关、不记触发记录。`workspace` 给了就在它里面跑，没给用卡片上选的。
   */
  async test(request: {
    workflow: string
    node: string
    workspace?: string
    options?: CardTestOptions
  }): Promise<Outcome<CardTestResult>> {
    const found = await this.definition(request.workflow, request.node)
    if (!found.ok) return found
    const { trigger } = found.result
    const { source } = trigger.data
    const problem = sourceProblem(source)
    if (problem !== null) return fail('invalid_args', `触发设置不对：${problem}`)
    const local = (await this.store.locals())[request.workflow]?.[request.node] ?? {
      enabled: false,
    }
    const command = commandOf(source)
    let spec: CommandSpec | undefined
    if (command !== undefined) {
      const workspace = request.workspace ?? local.workspace
      if (workspace === undefined) {
        return fail(
          'invalid_args',
          '这张卡片还没选工作区：给 workspace（命令在哪个目录里跑，绝对路径）',
        )
      }
      const directory = await workspaceProblem(workspace)
      if (directory !== null) return fail('invalid_args', directory)
      spec = await this.commandSpec(
        request.workflow,
        request.node,
        command,
        workspace,
        this.shellFor(local),
        true,
      )
    }
    const after =
      source.kind === 'after'
        ? {
            problem: afterProblem(
              request.workflow,
              source,
              await this.graphs.read(source.workflow),
            ),
            runs:
              source.workflow === ''
                ? []
                : (await this.runs.finished(source.workflow, 0, new Set())).runs,
          }
        : undefined
    // 和脚本文件的修改时刻比，用真的钟（不用注入的 now）；记开始的时刻，试的时候改的也算没试过。
    const started = Date.now()
    const result = await testCard({
      workflow: request.workflow,
      trigger,
      now: this.now(),
      ...(spec === undefined ? {} : { spec }),
      ...(local.probe === undefined ? {} : { probe: local.probe }),
      ...(after === undefined ? {} : { after }),
      infoFile: this.store.infoPath('f-<触发编号>'),
      options: request.options ?? {},
    })
    if (command !== undefined) {
      await this.store.update((locals) => {
        const group = locals[request.workflow] ?? {}
        const current = group[request.node] ?? { enabled: false }
        current.tested = started
        group[request.node] = current
        locals[request.workflow] = group
      })
    }
    return ok(result)
  }

  /**
   * 打开这张卡片之前还差的（都列出来，不只第一样）；都齐了是空的。
   * 开着的卡片也照算：给模型看「用户还要做什么」。
   */
  async readiness(workflow: string, node: string): Promise<string[]> {
    const found = await this.definition(workflow, node)
    if (!found.ok) return [found.error.message]
    const { trigger, blocked } = found.result
    const { source } = trigger.data
    const local = (await this.store.locals())[workflow]?.[node] ?? { enabled: false }
    const missing: string[] = []
    if (blocked !== undefined) {
      missing.push(`工作流现在执行不了（${blocked}）：先改好图，不然每次触发都算失败`)
    }
    if (local.stopped !== undefined) {
      missing.push(
        `已自动停用（${local.stopped}）：修好、用 test_trigger 试过之后用 local.enabled 重新打开`,
      )
    }
    const problem = sourceProblem(source)
    if (problem !== null) missing.push(`触发设置不对：${problem}`)
    if (source.kind === 'after') {
      const after = afterProblem(workflow, source, await this.graphs.read(source.workflow))
      if (after !== null) missing.push(after)
    }
    const unjudged = endProblem(trigger.data, trigger.runState)
    if (unjudged !== null) missing.push(unjudged)
    const pending = pendingApproval(trigger, local, this.shellFor(local))
    if (pending !== null) missing.push(pending)
    const launch = launchMissing(trigger.data, local)
    if (launch === 'session') missing.push('先选定发进哪个会话')
    // 要跑命令的卡片选的工作区也是新建会话的工作区，上面已经说过了。
    if (launch === 'workspace' && commandOf(source) === undefined)
      missing.push('先选在哪个工作区里新建会话')
    return missing
  }

  /**
   * 要跑命令的卡片还没用 `test_trigger` 试过，或 `triggers/` 里的脚本在那之后改过：一句提醒；不用提醒是 `null`。
   * 不算「打开前还差的」（不试也能触发），单给模型看。
   */
  async untested(workflow: string, node: string): Promise<string | null> {
    const found = await this.definition(workflow, node)
    if (!found.ok || commandOf(found.result.trigger.data.source) === undefined) return null
    const local = (await this.store.locals())[workflow]?.[node] ?? { enabled: false }
    if (local.tested === undefined)
      return '还没用 test_trigger 试过：先试一遍，看事件行、背景信息对不对'
    const changed = await changedScripts(assetsDir(this.dataDir(), workflow), local.tested)
    if (changed.length === 0) return null
    return `${SCRIPTS_DIR}/ 里的 ${changed.join('、')} 在上次 test_trigger 之后改过：再试一遍，过了再打开`
  }

  /** 「发一条测试请求」：带上令牌向这张 HTTP 触发卡片的地址发一条 POST，和别的程序发来的一样被收下。 */
  async ping(request: TriggerPingRequest): Promise<Outcome<TriggerPingResponse>> {
    const found = await this.definition(request.workflow, request.node)
    if (!found.ok) return found
    if (found.result.trigger.data.source.kind !== 'http') {
      return fail('invalid_args', '这张触发卡片不是 HTTP 触发')
    }
    const local = (await this.store.locals())[request.workflow]?.[request.node]
    if (local?.enabled !== true || local.hook === undefined || local.token === undefined) {
      return fail('blocked', '先启用这个触发器，地址才收请求')
    }
    const listen = this.listen()
    const url = hookUrl(advertisedHost(listen.host), listen.port, local.hook)
    const result = await pingHook(url, local.noToken === true ? null : local.token)
    return 'failure' in result ? fail('blocked', result.failure) : ok(result)
  }

  /** 检查命令、监听程序最近的输出：按筛选最多 `limit` 条摘要，新的在前（每条的输出另读）。 */
  output(
    workflow: string,
    node: string,
    filter: OutputFilter = 'all',
    limit = OUTPUT_PAGE,
  ): TriggerOutputResponse {
    const count = Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit), 1), OUTPUT_PAGE_MAX)
      : OUTPUT_PAGE
    return {
      ...this.store.outputs.list(workflow, node, filter, count),
      keep: this.outputLines(),
    }
  }

  /** 最近的输出里几条的行；`tail` 给了就每条只要最后几行。 */
  outputLinesOf(
    workflow: string,
    node: string,
    entries: readonly number[],
    tail?: number,
  ): TriggerOutputLinesResponse {
    const last =
      tail === undefined || !Number.isFinite(tail) ? undefined : Math.max(1, Math.trunc(tail))
    return {
      entries: this.store.outputs.lines(workflow, node, entries.slice(0, OUTPUT_PAGE_MAX), last),
    }
  }

  /** 清空一张卡片最近的输出（正在跑的那次留着，接着记）。 */
  clearOutput(workflow: string, node: string): void {
    this.store.outputs.clear(workflow, node)
  }

  /** 触发记录，新的在前；给了卡片就只看它的。`limit` 缺省 {@link HISTORY_PAGE} 条，最多是存下的全部。 */
  async history(workflow: string, node?: string, limit = HISTORY_PAGE): Promise<FireRecord[]> {
    const count = Number.isFinite(limit)
      ? Math.min(Math.max(Math.trunc(limit), 1), HISTORY_MAX)
      : HISTORY_PAGE
    return this.store.history(workflow, node, count)
  }

  /** 记到这个实例上的触发（建出它的那次、接着它做的几次），从早到晚。 */
  ofInstance(instance: string): Promise<FireRecord[]> {
    return this.store.ofInstance(instance)
  }

  /** 一张卡片 `since` 以来（最多往前 {@link ACTIVITY_DAYS} 天）每一小格各种结果几次。 */
  activity(workflow: string, node: string, since: number): Promise<TriggerActivitySlot[]> {
    const now = this.now()
    return this.store.activity(workflow, node, Math.max(since, now - ACTIVITY_DAYS * DAY_MS), now)
  }

  /** 一次触发那一刻带的触发说明、触发条件、背景信息（给界面看；背景信息太长只给开头）。 */
  async detail(fire: string): Promise<TriggerDetailResponse> {
    const detail = await this.store.detail(fire)
    if (detail === null) return {}
    const { note, condition, info, merged } = detail
    const clipped = info !== undefined && info.length > DETAIL_INFO_CHARS
    return {
      ...(note === undefined ? {} : { note }),
      ...(condition === undefined ? {} : { condition }),
      ...(info === undefined ? {} : { info: clipped ? info.slice(0, DETAIL_INFO_CHARS) : info }),
      ...(clipped ? { infoClipped: true as const } : {}),
      ...(merged === undefined ? {} : { merged }),
    }
  }
}

/** 列卡片时一次读好的东西。 */
interface Scene {
  owner: TriggerOwner | undefined
  locals: TriggerLocals
  live: LiveFile | null
  unavailable: string | null
  paused: number | undefined
  /** 各卡片排着几个（「工作流\u0000卡片」→ 个数，没有排着的不在里面）。 */
  queued: Map<string, number>
  /** HTTP 触发的监听地址与端口。 */
  listen: HookBind
  now: number
}

/** 发出去了一次：记下发进去的会话和这次的编号（下一次看它跑完没有），之前点过的「视为已结束」作废。 */
function sentOn(local: TriggerLocal, record: FireRecord): void {
  if (record.session !== undefined) local.lastSession = record.session
  local.lastFire = record.id
  delete local.waived
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
 * （地址用工作流名、令牌随机）。先生成（`prepareEndpoint`）、打开开关、换令牌、改地址或令牌时才补。
 *
 * 先生成的不看图里是不是 HTTP（对话框里刚换到 HTTP、还没保存）；先生成过的卡片之后也能改地址、令牌。
 * 不校验令牌（`noToken`）只是一个记号，令牌照样留着：再打开校验还是原来那个。
 * @returns 改不成的原因；改成了（或这次不涉及）是 `null`。
 */
function setEndpoint(
  request: TriggerSetRequest,
  source: TriggerSource,
  local: TriggerLocal,
  locals: TriggerLocals,
): string | null {
  const touched =
    request.hook !== undefined || request.token !== undefined || request.noToken !== undefined
  const prepare = request.prepareEndpoint === true
  if (source.kind !== 'http' && !prepare && local.hook === undefined) {
    if (touched || request.resetToken === true) return '只有 HTTP 触发有地址和令牌'
    return null
  }
  const enabling = request.enabled === true && source.kind === 'http'
  if (!touched && request.resetToken !== true && !enabling && !prepare) return null
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
    if (taken.has(hook)) return `地址「${hook}」已经被别的 HTTP 触发器用了`
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
  if (request.noToken === true) local.noToken = true
  else if (request.noToken === false) delete local.noToken
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

/**
 * 要在本机跑的命令还没确认、或确认之后命令、工作区、实际用的 shell（`shell`，空串是系统的）改过：一句原因；
 * 不用确认或确认过是 `null`。
 */
function pendingApproval(
  trigger: TriggerDefinition,
  local: TriggerLocal,
  shell: string,
): string | null {
  const command = commandOf(trigger.data.source)
  if (command === undefined) return null
  if (local.workspace === undefined) return '先选命令在哪个工作区里运行'
  if (local.approved === undefined) return '要先确认将要运行的命令'
  return local.approved === approvalOf(command, local.workspace, shell)
    ? null
    : '要运行的命令、工作区或 shell 改过了，要重新确认'
}

/** 常驻触发源开着、确认过时的状态：按负责的进程写下的运行情况说。 */
function liveView(
  kind: FilterKind,
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
  if (kind === 'schedule') {
    return {
      state: 'waiting',
      ...(status.next === undefined ? {} : { next: status.next }),
      ...(status.checked === undefined ? {} : { checked: status.checked }),
      ...(status.note === undefined ? {} : { problem: status.note }),
    }
  }
  const line = {
    ...(status.line === undefined ? {} : { line: status.line }),
    ...(status.output === undefined ? {} : { output: status.output }),
  }
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
function enableProblem(
  trigger: TriggerDefinition,
  local: TriggerLocal,
  shell: string,
): string | null {
  const { source } = trigger.data
  const problem = sourceProblem(source)
  if (problem !== null) {
    return source.kind === 'schedule' ? `定时规则不对：${problem}` : `触发设置不对：${problem}`
  }
  const pending = pendingApproval(trigger, local, shell)
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
