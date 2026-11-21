/**
 * dsh-workflow-lite — 触发器的业务面：到点触发、常驻的触发源、开关与本机设置、「立即触发一次」、状态与触发记录。
 *
 * 触发只由负责的那个 DSH 进程做（见 `owner.ts`）：每隔几秒报到一次、对一遍账（`reconcile.ts`），
 * 到点的交给 `launcher.ts` 发进会话；定时检查、监听程序、HTTP 地址按本机状态开着或停下（`runtime.ts`），
 * 它们进来的内容过了过滤也交给 `launcher.ts`；接续触发每一轮看一眼等的那个工作流有没有实例刚结束（`after.ts`）。
 * 卡片的开关和设置都在图里（画布上直接改，模型经 `write_trigger` 的 `local` 改、先在 `settings.ts` 核对）；
 * 跑起来之后的记录在插件数据库里（`runRecords.ts`）。「立即触发一次」「全部暂停」哪个进程都能做，负责的进程下一轮就看到。
 * 开着的卡片设置有误（触发源写得不对、缺工作区、地址和别的卡片重了…）时不跑，卡片上显示「设置有误」和原因。
 *
 * 「全部暂停」不动各卡片的开关：暂停着时定时照样往后排、接续触发照样记下处理过的实例，只是都不触发，
 * 常驻的全停下；恢复后接着跑，暂停期间错过的不补。
 *
 * 「连续几次失败就自动停用」里的「失败」只指触发器自己干不了活：工作区或会话不在了、会话建不出来、
 * 图编译不出计划、监听程序一启动就退出、检查的命令跑不起来。跳过（上一次还在跑、超过每小时上限、错过了）、
 * 条件不满足、过滤掉的都不算，消息发进去之后工作流执行得怎么样更不算。
 * 端口被占用也不算：那是「出错」，端口空出来或换一个就恢复。
 * 自动停用不动图里的开关，只在运行记录里记下；用户「重新启用」、或关了再开时清掉。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/service
 */

import {
  bindWorkflowPath,
  bindWorkflowVar,
  bindWorkspacePath,
  bindWorkspaceVar,
  isWorkspacePath,
  WORKSPACE_VAR,
} from '../../shared/pathVars.ts'
import { hasSessionChoice } from '../../shared/sessionChoice.ts'
import {
  afterMatches,
  commandOf,
  endpointMissing,
  type FilterKind,
  filterOf,
  isLiveSource,
  launchMissing,
  launchOf,
  reachedLimit,
  settingsOf,
  sourceProblem,
} from '../../shared/trigger.ts'
import { SCRIPTS_DIR } from '../../shared/triggerDirs.ts'
import { hookFromName, LOCAL_HOST } from '../../shared/triggerHttp.ts'
import type { TriggerData, TriggerSource } from '../../shared/types.ts'
import { OUTPUT_LINES } from '../../shared/wire/config.ts'
import type {
  FireRecord,
  OutputFilter,
  ShellChoice,
  TriggerActivitySlot,
  TriggerAllResponse,
  TriggerDetailResponse,
  TriggerEndpointResponse,
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
import {
  CARD_DATA_ENV,
  CARD_SECRETS_ENV,
  CARD_WORKSPACE_ENV,
  cardDataDir,
  cardDir,
  cardSecretsDir,
} from './cardDirs.ts'
import { type CardTestOptions, type CardTestResult, testCard } from './cardTest.ts'
import type { TriggerDefinition, TriggerGraphs } from './graphs.ts'
import { type HookBind, hookUrl, newHookId, newHookToken } from './hooks.ts'
import type { IntakeBatch } from './intake.ts'
import { type FireInput, Launcher, SKIP_UNFINISHED } from './launcher.ts'
import { advertisedHost } from './netAddress.ts'
import type { OwnerLock } from './owner.ts'
import { FRESH_PROBE } from './poller.ts'
import type { CommandSpec } from './processes.ts'
import {
  type ActiveCard,
  type DueFire,
  isActive,
  planRound,
  startRun,
  upcoming,
} from './reconcile.ts'
import { endProblem, RunEnds } from './runEnd.ts'
import type { LiveFile, TriggerRun, TriggerRuns } from './runRecords.ts'
import {
  type LiveRef,
  type LiveRuntime,
  type LiveSpec,
  type RuntimeEvents,
  TriggerRuntime,
} from './runtime.ts'
import { changedScripts } from './scriptAge.ts'
import type { SessionPort } from './sessions.ts'
import { changeSettings, directoryProblem, type SettingsChange } from './settings.ts'
import { checkShell, detectShells, familyOf, shellLabel, shellName, systemShell } from './shells.ts'
import type { TriggerStore } from './store.ts'
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
  /** 定时检查、监听没单独选 shell 时用哪个（插件设置，程序的完整路径）；空串或不给 = 自动。 */
  defaultShell?: () => string
  /** 每张定时检查、监听卡片最近的输出留多少行（插件设置）；不给是 {@link OUTPUT_LINES} 的缺省值。 */
  outputLines?: () => number
  /** 实例那边：接续触发看别的工作流有没有实例结束，跳过、排队看上一次跑完没有。 */
  runs: RunWatch
  now?: () => number
  /** 谁负责触发（插件数据库里的一行）；测试里给假的进程号、假的存活判断。 */
  lock: OwnerLock
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
  /** 本次宿主运行自动选的 shell，避免每轮对账都扫描 Windows 的安装目录。 */
  private automaticWindowsShell?: Promise<string>
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
    this.lock = deps.lock
    const events: RuntimeEvents = {
      deliver: (ref, batch) => this.enqueue(() => this.deliver(ref, batch)),
      failed: (ref, reason) => this.enqueue(() => this.sourceFailed(ref, reason)),
      healthy: (ref) => this.enqueue(() => this.clearFailures(ref)),
      probed: (ref, probe) =>
        this.enqueue(async () =>
          this.store.runs.updateOne(ref.workflow, ref.node, (run) => {
            if (run.since !== undefined) run.probe = probe
          }),
        ),
    }
    this.runtime =
      deps.runtime?.(events) ??
      new TriggerRuntime({
        live: deps.store.runs,
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
    const paused = this.store.runs.paused() !== undefined
    const plan = await planRound(this.store.runs.all(), this.graphs, now)
    const runs = this.store.runs.update((current) => {
      plan.apply(current)
      return structuredClone(current)
    })
    this.nextDue = plan.next
    const clashes = hookClashes(plan.active)
    // 设置有误的不跑（卡片上显示原因）。
    const ready: ActiveCard[] = []
    for (const card of plan.active) {
      if ((await this.cardProblem(card, clashes)) === null) ready.push(card)
    }
    const isReady = new Set(ready.map((card) => cardKey(card.workflow, card.trigger.node)))
    // 暂停着：定时照样往后排（上面已经写回），到点的不触发。
    for (const due of paused ? [] : plan.fires) {
      const run = runs[due.workflow]?.[due.trigger.node]
      // 写回之前被自动停用了、设置有误：不触发。
      if (run === undefined || !isActive(due.trigger.data, run)) continue
      if (!isReady.has(cardKey(due.workflow, due.trigger.node))) continue
      await this.fireDue(due, run, now)
    }
    await this.fireAfter(ready, runs, now, paused)
    await this.releaseQueued(runs, now, paused)
    await this.runtime.sync(paused ? [] : await this.liveSpecs(ready, runs))
  }

  // ── 排队 ───────────────────────────────────────────────────

  /**
   * 排着的轮到没有：每一轮先问一次「哪些卡片有排着的」（只碰排着的那几行，平时是空的就到此为止），
   * 再一张一张看上一次触发发起的执行结束了没有（按运行状态，见 `runEnd.ts`），结束了发最早的那一个（一轮每张卡片最多一个）。
   * 看不出上一次跑完没有的（工作流没开「记录运行状态」）先留着。
   * 卡片关掉了、删掉了的排着的都记成跳过；全部暂停时留着不发。
   */
  private async releaseQueued(runs: TriggerRuns, now: number, paused: boolean): Promise<void> {
    for (const { workflow, node } of await this.store.queuedCounts()) {
      const found = await this.definition(workflow, node)
      if (!found.ok) {
        if (found.error.code === 'not_found') {
          await this.store.drop(workflow, node, '触发器删掉了，排着的不再执行')
        }
        continue
      }
      const { trigger, blocked } = found.result
      const run = runs[workflow]?.[node] ?? {}
      if (!isActive(trigger.data, run)) {
        await this.store.drop(workflow, node, DROPPED_OFF)
        continue
      }
      if (paused) continue
      if (endProblem(trigger.data, trigger.runState) !== null) continue
      if (!(await this.ends.previous(run)).ended) continue
      const [first] = await this.store.queuedFires(workflow, node)
      const detail = first === undefined ? null : await this.store.detail(first.id)
      if (detail === null) continue
      if (!(await this.lock.holds())) return
      const record =
        blocked === undefined
          ? await this.launcher.release(detail, trigger, run, now)
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
    const refused = this.store.runs.updateOne(workflow, node, (run): string | null => {
      if (run.lastFire === undefined) return '这张卡片还没有发出去过'
      run.waived = run.lastFire
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
    run: TriggerRun,
    recent: FireRecord | undefined,
  ): Promise<Pick<TriggerView, 'queued' | 'waiting'>> {
    const queued = scene.queued.get(cardKey(workflow, trigger.node))
    const skipping =
      launchOf(trigger.data).overlap === 'skip' &&
      recent?.outcome === 'skipped' &&
      recent.reason === SKIP_UNFINISHED
    const counted = queued === undefined ? {} : { queued }
    if (queued === undefined && !skipping) return counted
    const previous = await this.ends.previous(run)
    return previous.ended ? counted : { ...counted, waiting: previous.waiting }
  }

  /** 清空一张卡片排着的（都记成跳过），回清掉了几个。 */
  async clearQueue(workflow: string, node: string): Promise<Outcome<{ cleared: number }>> {
    return ok({ cleared: await this.store.drop(workflow, node, '手动清空') })
  }

  // ── 定时 ───────────────────────────────────────────────────

  private async fireDue(due: DueFire, run: TriggerRun, now: number): Promise<void> {
    if (!(await this.lock.holds())) return
    const launch = launchOf(due.trigger.data)
    const input: FireInput = {
      workflow: due.workflow,
      trigger: due.trigger,
      run,
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
  private async fireAfter(
    cards: readonly ActiveCard[],
    runs: TriggerRuns,
    now: number,
    paused: boolean,
  ): Promise<void> {
    for (const { workflow, trigger, blocked } of cards) {
      const { source } = trigger.data
      if (source.kind !== 'after') continue
      const { node } = trigger
      const run = runs[workflow]?.[node] ?? {}
      const seen = run.seen ?? []
      const found = await this.runs.finished(source.workflow, run.since ?? now, new Set(seen))
      const present = new Set(found.ids)
      const kept = seen.filter((id) => present.has(id))
      if (found.runs.length === 0 && kept.length === seen.length) continue
      const next = [...kept, ...found.runs.map((one) => one.id)]
      const still = this.store.runs.updateOne(workflow, node, (current) => {
        if (current.since === undefined || current.stopped !== undefined) return false
        if (next.length > 0) current.seen = next
        else delete current.seen
        return true
      })
      if (!still || paused) continue
      for (const finished of found.runs) {
        if (!afterMatches(source, finished.status)) continue
        // 一次一次地发：每次都按现读的运行记录（上一次的会话、停没停用）。
        const current = this.store.runs.get(workflow, node)
        if (current.since === undefined || current.stopped !== undefined) break
        await this.launchCounted(
          {
            workflow,
            trigger,
            run: current,
            channel: 'after',
            at: now,
            info: afterInfo(source.workflow, finished),
          },
          blocked,
        )
      }
    }
  }

  // ── 常驻触发源 ─────────────────────────────────────────────

  /** 在跑、设置没问题的常驻触发源（带检查命令的定时、监听程序、HTTP）。 */
  private async liveSpecs(cards: readonly ActiveCard[], runs: TriggerRuns): Promise<LiveSpec[]> {
    const specs: LiveSpec[] = []
    for (const { workflow, trigger } of cards) {
      const { node, data } = trigger
      const { source } = data
      if (!isLiveSource(source)) continue
      const base = { workflow, node, filter: filterOf(data) }
      if (source.kind === 'http') {
        if (source.hook === undefined) continue
        const token = source.noToken === true ? null : source.token
        if (token === undefined) continue
        specs.push({ ...base, cwd: '', source, hook: { id: source.hook, token } })
        continue
      }
      const command = commandOf(source)
      if (command === undefined) continue
      const probe = runs[workflow]?.[node]?.probe
      specs.push({
        ...base,
        source,
        ...(await this.commandSpec(
          workflow,
          node,
          command,
          data,
          this.configuredShell(data.shell),
        )),
        ...(source.kind === 'schedule'
          ? { catchUp: launchOf(data).catchUp, ...(probe === undefined ? {} : { probe }) }
          : {}),
      })
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

  /** 一张常驻的卡片现在的定义与运行记录；关掉了、停用了、删掉了是 `null`。 */
  private async liveInput(ref: LiveRef): Promise<{ input: FireInput; blocked?: string } | null> {
    const found = await this.definition(ref.workflow, ref.node)
    if (!found.ok) return null
    const { trigger, blocked } = found.result
    const run = this.store.runs.get(ref.workflow, ref.node)
    if (!isActive(trigger.data, run)) return null
    return {
      input: { workflow: ref.workflow, trigger, run, channel: ref.kind, at: this.now() },
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
    // 常驻触发源的事件可能在负责权刚被接手、还没停下时到：不归自己负责就不发。
    if (!(await this.lock.holds())) return
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
      const key = cardKey(input.workflow, input.trigger.node)
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
    if (!(await this.lock.holds())) return
    const found = await this.liveInput(ref)
    if (found === null) return
    const record = await this.launcher.fail(found.input, reason)
    await this.settle(record, launchOf(found.input.trigger.data).maxFailures)
    // 可能刚被自动停用：马上对一遍账，把它停下。
    if (this.running) this.schedule(0)
  }

  private async clearFailures(ref: LiveRef): Promise<void> {
    this.store.runs.updateOne(ref.workflow, ref.node, (run) => {
      delete run.failures
    })
  }

  // ── 共用 ───────────────────────────────────────────────────

  private sentWithinHour(workflow: string, node: string, now: number): Promise<number> {
    return this.store.sentSince(workflow, node, now - HOUR_MS)
  }

  /**
   * 一次触发之后：发出去了清掉失败计数、记下会话；连续失败到了次数就自动停用（不限制的不停用）。
   * 停用只记在运行记录里，图里的开关不动。
   */
  private async settle(record: FireRecord, maxFailures: number): Promise<void> {
    this.store.runs.updateOne(record.workflow, record.node, (run) => {
      if (record.outcome === 'sent') {
        delete run.failures
        sentOn(run, record)
        return
      }
      if (record.outcome !== 'failed') return
      const failures = (run.failures ?? 0) + 1
      run.failures = failures
      if (!reachedLimit(failures, maxFailures)) return
      run.stopped = `连续 ${String(failures)} 次失败：${record.reason ?? '原因不明'}`
      delete run.due
      delete run.failures
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
    const liveFile = this.store.runs.live()
    return liveFile?.pid === owner.pid ? liveFile : null
  }

  /** 全部暂停（`true`）或恢复（`false`）。各卡片的开关不动；恢复后暂停期间的变化不补。 */
  async pause(paused: boolean): Promise<TriggerPauseResponse> {
    if (!paused && this.store.runs.paused() !== undefined) await this.freshChecks()
    this.store.runs.setPaused(paused ? this.now() : null)
    if (this.running) this.schedule(0)
    const since = this.store.runs.paused()
    return since === undefined ? {} : { paused: since }
  }

  /**
   * 开着的定时检查从现在起算：恢复后第一次检查只记下，暂停期间条件变了不算一次触发；
   * 存着的下一次也丢掉（暂停期间错过的不补，「每隔」恢复就查、别的等下一个钟点）。
   */
  private async freshChecks(): Promise<void> {
    const checks: { workflow: string; node: string }[] = []
    for (const { workflow, trigger } of await this.enabledCards()) {
      const { source } = trigger.data
      if (source.kind === 'schedule' && source.check !== undefined) {
        checks.push({ workflow, node: trigger.node })
      }
    }
    if (checks.length === 0) return
    this.store.runs.update((runs) => {
      for (const { workflow, node } of checks) {
        const run = runs[workflow]?.[node]
        if (run?.since !== undefined) run.probe = { ...FRESH_PROBE }
      }
    })
  }

  /** 所有工作流里图上开着的卡片（不管停没停用、设置对不对）。 */
  private async enabledCards(): Promise<ActiveCard[]> {
    const cards: ActiveCard[] = []
    for (const workflow of await this.graphs.names()) {
      const graph = await this.graphs.read(workflow)
      if (graph.kind !== 'ok') continue
      for (const trigger of graph.triggers) {
        if (trigger.data.enabled === true) cards.push({ workflow, trigger })
      }
    }
    return cards
  }

  /** 列卡片要用的、与具体工作流无关的那些（一次读好，「触发」页列很多工作流时不重复读）。 */
  private async scene(): Promise<Scene> {
    const owner = await this.lock.current()
    return {
      owner,
      runs: this.store.runs.all(),
      clashes: hookClashes(await this.enabledCards()),
      live: await this.ownerLive(owner),
      unavailable: this.sessions.unavailable(),
      paused: this.store.runs.paused(),
      queued: new Map(
        (await this.store.queuedCounts()).map((row) => [
          cardKey(row.workflow, row.node),
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
    const runs = scene.runs[workflow] ?? {}
    const { owner, live, unavailable, paused, now } = scene
    const cards: { trigger: TriggerDefinition; view: TriggerView }[] = []
    for (const trigger of graph.triggers) {
      const { data } = trigger
      const run = runs[trigger.node] ?? {}
      const recent = await this.store.last(workflow, trigger.node)
      const lastFailure = await this.store.lastFailure(workflow, trigger.node)
      const { source } = data
      const base = {
        node: trigger.node,
        enabled: data.enabled === true,
        ...(recent === undefined ? {} : { last: recent }),
        ...(lastFailure === undefined ? {} : { lastFailure }),
        ...(await this.queuedOf(scene, workflow, trigger, run, recent)),
        ...(trigger.runState ? { runState: true as const } : {}),
        ...(hasSessionChoice(trigger.workflowChoice)
          ? { workflowChoice: trigger.workflowChoice }
          : {}),
        ...(await this.upstreamOf(source)),
        ...(commandOf(source) === undefined
          ? {}
          : {
              runShell: shellLabel(
                this.configuredShell(data.shell) || (await this.automaticShell()),
              ),
            }),
        ...(source.kind === 'http' && source.hook !== undefined
          ? { url: hookUrl(advertisedHost(scene.listen.host), scene.listen.port, source.hook) }
          : {}),
      }
      const view = await (async (): Promise<TriggerView> => {
        if (data.enabled !== true) return { ...base, state: 'off' }
        if (run.stopped !== undefined) return { ...base, state: 'stopped', problem: run.stopped }
        const problem = await this.cardProblem({ workflow, trigger }, scene.clashes)
        if (problem !== null) return { ...base, state: 'invalid', problem }
        if (paused !== undefined) return { ...base, state: 'paused' }
        if (source.kind === 'schedule' && source.check === undefined) {
          const next = upcoming(run, source.schedule, now)
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

  /**
   * 开着的卡片哪里设置有误、跑不了（卡片上「设置有误」写的就是它）；没问题是 `null`。
   * 只看图里写的（不碰磁盘）：工作区目录不在了这类，到触发时发不出去、记一次失败。
   */
  private async cardProblem(
    card: Pick<ActiveCard, 'workflow' | 'trigger'>,
    clashes: ReadonlySet<string>,
  ): Promise<string | null> {
    const { workflow, trigger } = card
    const { source } = trigger.data
    const problem = sourceProblem(source)
    if (problem !== null) return problem
    if (source.kind === 'after') {
      const after = afterProblem(workflow, source, await this.graphs.read(source.workflow))
      if (after !== null) return after
    }
    const unjudged = endProblem(trigger.data, trigger.runState)
    if (unjudged !== null) return unjudged
    const missing = launchMissing(trigger.data)
    if (missing === 'session') return '还没选定发进哪个会话'
    if (missing === 'workspace') return '还没选在哪个工作区里新建会话'
    if (endpointMissing(source)) return '还没有地址或令牌：在「触发方式」里打开一次 HTTP 的设置'
    if (source.kind === 'http' && clashes.has(cardKey(workflow, trigger.node))) {
      return `地址「${source.hook ?? ''}」和别的 HTTP 触发器重了，改掉其中一个`
    }
    return null
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
   * 改一张卡片的设置（模型经 `write_trigger` 的 `local`）：核对过写回图里；给了哪项改哪项。
   * HTTP 卡片还没有地址、令牌时顺手生成，所以写了 HTTP 卡片后不带改动也调一次。
   * 打开（原来关着、或被自动停用了）时从现在起算。回这个工作流各卡片的新样子。
   */
  async set(
    workflow: string,
    node: string,
    change: SettingsChange,
  ): Promise<Outcome<TriggerListResponse>> {
    const found = await this.definition(workflow, node)
    if (!found.ok) return found
    const { trigger } = found.result
    const { source } = trigger.data
    const blocked =
      (source.kind === 'after'
        ? afterProblem(workflow, source, await this.graphs.read(source.workflow))
        : null) ?? endProblem(trigger.data, trigger.runState)
    const settings = await changeSettings(change, {
      workflow,
      data: trigger.data,
      taken: await this.hooksTaken(workflow, node),
      blocked,
      shellProblem: async (path) => {
        const checked = await checkShell(path)
        return typeof checked === 'string' ? checked : null
      },
    })
    if (!settings.ok) return settings
    if (JSON.stringify(settings.result) !== JSON.stringify(settingsOf(trigger.data))) {
      const written = await this.graphs.writeSettings(workflow, node, settings.result)
      if (!written.ok) return written
    }
    if (change.enabled === true) this.startNow(workflow, node, trigger.data.enabled !== true)
    if (this.running) this.schedule(0)
    return ok(await this.list(workflow))
  }

  /** 图存下了（画布、工具、导入、切版本）：马上对一遍账，开关和设置当场生效、不用等下一轮。 */
  graphsChanged(): void {
    if (this.running) this.schedule(0)
  }

  /** 「重新启用」自动停用了的卡片：清掉停用，从现在重新开始跑（图里的开关本来就开着）。 */
  async reopen(workflow: string, node: string): Promise<Outcome<TriggerListResponse>> {
    const found = await this.definition(workflow, node)
    if (!found.ok) return found
    this.startNow(workflow, node, false)
    if (this.running) this.schedule(0)
    return ok(await this.list(workflow))
  }

  /**
   * 从现在起重新跑：刚打开的（`wasOff`）、被自动停用了的清掉这一回的记录、从此刻排；本来就开着在跑的不动。
   * 不在这里起算的（画布上直接改了图里的开关），负责的进程下一轮对账时起算。
   */
  private startNow(workflow: string, node: string, wasOff: boolean): void {
    const now = this.now()
    this.store.runs.updateOne(workflow, node, (run) => {
      if (wasOff || run.stopped !== undefined) startRun(run, now)
    })
  }

  /** HTTP 触发：一个没被别的卡片用的地址（缺省用工作流名）和一个随机令牌，连同已经被用了的地址。 */
  async endpoint(workflow: string, node: string): Promise<TriggerEndpointResponse> {
    const taken = await this.hooksTaken(workflow, node)
    return {
      hook: hookFromName(workflow, taken) ?? newHookId(),
      token: newHookToken(),
      taken: [...taken].sort(),
    }
  }

  /** 别的卡片（所有工作流里）已经用了的 HTTP 地址。 */
  private async hooksTaken(workflow: string, node: string): Promise<Set<string>> {
    const taken = new Set<string>()
    for (const name of await this.graphs.names()) {
      const graph = await this.graphs.read(name)
      if (graph.kind !== 'ok') continue
      for (const trigger of graph.triggers) {
        if (name === workflow && trigger.node === node) continue
        const { source } = trigger.data
        if (source.kind === 'http' && source.hook !== undefined) taken.add(source.hook)
      }
    }
    return taken
  }

  /** 「立即触发一次」：不看开关、不占每小时的次数，在收到请求的这个进程里发。 */
  async fireNow(request: TriggerFireRequest): Promise<Outcome<FireRecord>> {
    const found = await this.definition(request.workflow, request.node)
    if (!found.ok) return found
    const { trigger, blocked } = found.result
    const input: FireInput = {
      workflow: request.workflow,
      trigger,
      run: this.store.runs.get(request.workflow, request.node),
      channel: 'now',
      at: this.now(),
      ...(request.info === undefined ? {} : { info: request.info }),
    }
    const record =
      blocked === undefined
        ? await this.launcher.fire(input)
        : await this.launcher.fail(input, `工作流现在执行不了：${blocked}`)
    if (record.outcome === 'sent') {
      this.store.runs.updateOne(request.workflow, request.node, (run) => sentOn(run, record))
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

  private async automaticShell(shells?: readonly ShellChoice[]): Promise<string> {
    if (process.platform !== 'win32') return ''
    this.automaticWindowsShell ??= (
      shells === undefined ? detectShells() : Promise.resolve(shells)
    ).then((choices) => choices[0]?.path ?? systemShell())
    return this.automaticWindowsShell
  }

  /** 卡片指定的优先，其次是插件设置；两处都没设时返回空串。 */
  private configuredShell(override?: string): string {
    return override || this.defaultShell()
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
    const automatic = await this.automaticShell(shells)
    return {
      shells,
      system,
      ...(automatic === '' ? {} : { automatic: describe(automatic) }),
      fallback: describe(this.configuredShell() || automatic || system.path),
    }
  }

  /** 认一个自己选的程序能不能当 shell 用。 */
  async checkShell(path: string): Promise<Outcome<ShellChoice>> {
    const checked = await checkShell(path)
    return typeof checked === 'string' ? fail('invalid_args', checked) : ok(checked)
  }

  /**
   * 「试运行」：把对话框里还没保存的命令照打开之后的跑法跑一次（在 `cwd` 里，没给是卡片目录；
   * 用 `shell`，空着跟默认）。不看开关、不记触发记录。
   */
  async tryCommand(request: TriggerTryRequest): Promise<Outcome<TriggerTryResponse>> {
    if (request.command.trim() === '') return fail('invalid_args', '命令是空的')
    const shell = this.configuredShell(request.shell)
    if (shell !== '') {
      const checked = await checkShell(shell)
      if (typeof checked === 'string') return fail('invalid_args', checked)
    }
    const place = {
      ...(request.cwd === undefined || request.cwd === '' ? {} : { cwd: request.cwd }),
      ...(request.workspace === undefined || request.workspace === ''
        ? {}
        : { workspace: request.workspace }),
    }
    const unbound = workspaceUnbound(request.command, place)
    if (unbound !== null) return fail('invalid_args', unbound)
    const spec = await this.commandSpec(
      request.workflow,
      request.node,
      request.command,
      place,
      shell,
      true,
    )
    const where = await directoryProblem(spec.cwd, '脚本的工作目录')
    if (where !== null) return fail('invalid_args', where)
    return ok(request.kind === 'listen' ? await tryListen(spec) : await tryCheck(spec))
  }

  /**
   * 跑一张卡片的命令的样子：在卡片设的工作目录里跑（没设是卡片目录 `triggers/<卡片>/`）；
   * 命令和工作目录里的 `{workflow}` 换成工作流目录、`{workspace}` 换成会话工作区（没选时由调用方先拦下）；
   * 环境变量给工作流目录、会话工作区（选了的话）、这张卡片的数据目录（`trial` = 试运行那份）和密钥目录。
   * 卡片目录、数据目录、密钥目录先建好。
   */
  private async commandSpec(
    workflow: string,
    node: string,
    command: string,
    place: Pick<TriggerData, 'cwd' | 'workspace'>,
    shell: string,
    trial = false,
  ): Promise<CommandSpec> {
    const dir = assetsDir(this.dataDir(), workflow)
    const { workspace } = place
    const bind = (text: string): string =>
      workspace === undefined ? text : bindWorkspaceVar(text, workspace)
    const home = cardDir(dir, node)
    const cwd =
      place.cwd === undefined
        ? home
        : workspace !== undefined && isWorkspacePath(place.cwd)
          ? bindWorkspacePath(place.cwd, workspace)
          : bindWorkflowPath(place.cwd, dir)
    const data = cardDataDir(dir, node, trial)
    const secrets = cardSecretsDir(dir, node)
    for (const made of [home, data, secrets]) await ensureDir(made)
    const runShell = shell || (await this.automaticShell())
    return {
      command: bind(bindWorkflowVar(command, dir)),
      cwd,
      env: {
        WORKFLOW_DIR: dir,
        ...(workspace === undefined ? {} : { [CARD_WORKSPACE_ENV]: workspace }),
        [CARD_DATA_ENV]: data,
        [CARD_SECRETS_ENV]: secrets,
      },
      ...(runShell === '' ? {} : { shell: runShell }),
    }
  }

  /**
   * 模型试一张卡片（`test_trigger`，见 `cardTest.ts`）：按图里存着的定义、跑法同打开之后，
   * 数据目录用试运行那份；不动开关、不记触发记录。`workspace` 给了就当会话工作区交给脚本，没给用卡片上选的。
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
    const { data } = trigger
    const { source } = data
    const problem = sourceProblem(source)
    if (problem !== null) return fail('invalid_args', `触发设置不对：${problem}`)
    const run = this.store.runs.get(request.workflow, request.node)
    const command = commandOf(source)
    let spec: CommandSpec | undefined
    if (command !== undefined) {
      const workspace = request.workspace ?? data.workspace
      if (workspace !== undefined) {
        const directory = await directoryProblem(workspace, '工作区')
        if (directory !== null) return fail('invalid_args', directory)
      }
      const place = {
        ...(data.cwd === undefined ? {} : { cwd: data.cwd }),
        ...(workspace === undefined ? {} : { workspace }),
      }
      const unbound = workspaceUnbound(command, place)
      if (unbound !== null) return fail('invalid_args', `${unbound}（或用参数 workspace 指定）`)
      spec = await this.commandSpec(
        request.workflow,
        request.node,
        command,
        place,
        this.configuredShell(data.shell),
        true,
      )
      const where = await directoryProblem(spec.cwd, '脚本的工作目录')
      if (where !== null) return fail('invalid_args', where)
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
      ...(run.probe === undefined ? {} : { probe: run.probe }),
      ...(after === undefined ? {} : { after }),
      infoFile: this.store.infoPath('f-<触发编号>'),
      options: request.options ?? {},
    })
    if (command !== undefined) {
      this.store.runs.updateOne(request.workflow, request.node, (current) => {
        current.tested = started
      })
    }
    return ok(result)
  }

  /**
   * 这张卡片要跑起来还差的（都列出来，不只第一样）；都齐了是空的。
   * 开着的卡片也照算：给模型看「用户还要做什么」。
   */
  async readiness(workflow: string, node: string): Promise<string[]> {
    const found = await this.definition(workflow, node)
    if (!found.ok) return [found.error.message]
    const { trigger, blocked } = found.result
    const { data } = trigger
    const { source } = data
    const run = this.store.runs.get(workflow, node)
    const missing: string[] = []
    if (blocked !== undefined) {
      missing.push(`工作流现在执行不了（${blocked}）：先改好图，不然每次触发都算失败`)
    }
    if (run.stopped !== undefined) {
      missing.push(
        `已自动停用（${run.stopped}）：修好、用 test_trigger 试过之后用 local.enabled 重新打开`,
      )
    }
    const problem = sourceProblem(source)
    if (problem !== null) missing.push(`触发设置不对：${problem}`)
    if (source.kind === 'after') {
      const after = afterProblem(workflow, source, await this.graphs.read(source.workflow))
      if (after !== null) missing.push(after)
    }
    const unjudged = endProblem(data, trigger.runState)
    if (unjudged !== null) missing.push(unjudged)
    const launch = launchMissing(data)
    if (launch === 'session') missing.push('先选定发进哪个会话')
    if (launch === 'workspace') missing.push('先选在哪个工作区里新建会话')
    if (source.kind === 'http' && source.hook !== undefined) {
      const clash = (await this.hooksTaken(workflow, node)).has(source.hook)
      if (clash) missing.push(`地址「${source.hook}」和别的 HTTP 触发器重了：用 local.hook 换一个`)
    }
    return missing
  }

  /**
   * 要跑命令的卡片还没用 `test_trigger` 试过，或 `triggers/` 里的脚本在那之后改过：一句提醒；不用提醒是 `null`。
   * 不算「打开前还差的」（不试也能触发），单给模型看。
   */
  async untested(workflow: string, node: string): Promise<string | null> {
    const found = await this.definition(workflow, node)
    if (!found.ok || commandOf(found.result.trigger.data.source) === undefined) return null
    const { tested } = this.store.runs.get(workflow, node)
    if (tested === undefined) return '还没用 test_trigger 试过：先试一遍，看事件行、背景信息对不对'
    const changed = await changedScripts(assetsDir(this.dataDir(), workflow), node, tested)
    if (changed.length === 0) return null
    return `${SCRIPTS_DIR}/ 里的 ${changed.join('、')} 在上次 test_trigger 之后改过：再试一遍，过了再打开`
  }

  /** 「发一条测试请求」：带上令牌向这张 HTTP 触发卡片的地址发一条 POST，和别的程序发来的一样被收下。 */
  async ping(request: TriggerPingRequest): Promise<Outcome<TriggerPingResponse>> {
    const found = await this.definition(request.workflow, request.node)
    if (!found.ok) return found
    const { data } = found.result.trigger
    const { source } = data
    if (source.kind !== 'http') return fail('invalid_args', '这张触发卡片不是 HTTP 触发')
    if (data.enabled !== true || source.hook === undefined || source.token === undefined) {
      return fail('blocked', '先启用这个触发器，地址才收请求')
    }
    const listen = this.listen()
    const url = hookUrl(advertisedHost(listen.host), listen.port, source.hook)
    const result = await pingHook(url, source.noToken === true ? null : source.token)
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
  runs: TriggerRuns
  /** 地址和别的开着的卡片重了的 HTTP 卡片（{@link cardKey}）。 */
  clashes: ReadonlySet<string>
  live: LiveFile | null
  unavailable: string | null
  paused: number | undefined
  /** 各卡片排着几个（{@link cardKey} → 个数，没有排着的不在里面）。 */
  queued: Map<string, number>
  /** HTTP 触发的监听地址与端口。 */
  listen: HookBind
  now: number
}

function cardKey(workflow: string, node: string): string {
  return `${workflow}\u0000${node}`
}

/** 开着的 HTTP 卡片里地址和别的重了的那些（{@link cardKey}）：都不收请求，卡片上说重了。 */
function hookClashes(cards: readonly Pick<ActiveCard, 'workflow' | 'trigger'>[]): Set<string> {
  const byHook = new Map<string, string[]>()
  for (const { workflow, trigger } of cards) {
    const { source } = trigger.data
    if (source.kind !== 'http' || source.hook === undefined) continue
    byHook.set(source.hook, [...(byHook.get(source.hook) ?? []), cardKey(workflow, trigger.node)])
  }
  return new Set([...byHook.values()].filter((keys) => keys.length > 1).flat())
}

/** 发出去了一次：记下发进去的会话和这次的编号（下一次看它跑完没有），之前点过的「视为已结束」作废。 */
function sentOn(run: TriggerRun, record: FireRecord): void {
  if (record.session !== undefined) run.lastSession = record.session
  run.lastFire = record.id
  delete run.waived
}

/** 列表回答里与具体卡片无关的那几样。 */
function sceneHead(scene: Scene): Omit<TriggerListResponse, 'triggers'> {
  const { listen } = scene
  return {
    ...(scene.owner === undefined ? {} : { owner: scene.owner }),
    ...(scene.paused === undefined ? {} : { paused: scene.paused }),
    hookOrigin: `http://${advertisedHost(listen.host)}:${String(listen.port)}`,
  }
}

/** 常驻触发源开着、设置没问题时的状态：按负责的进程写下的运行情况说。 */
function liveView(
  kind: FilterKind,
  status: LiveFile['sources'][string][string] | undefined,
  live: LiveFile | null,
): Pick<TriggerView, 'state' | 'next' | 'problem' | 'checked' | 'since' | 'line'> {
  const port = live?.port
  if (kind === 'http' && port?.kind === 'error') return { state: 'error', problem: port.problem }
  // 负责的进程还没开起来（刚打开开关、刚接手）；HTTP 还要等端口真的开了，才收得到请求。
  if (status === undefined || (kind === 'http' && port?.kind !== 'open')) {
    return { state: 'waiting' }
  }
  if (kind === 'http') return { state: 'listening' }
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 命令或脚本目录里用了 `{workspace}` 却没选工作区：一句原因；没问题是 `null`。 */
function workspaceUnbound(
  command: string,
  place: Pick<TriggerData, 'cwd' | 'workspace'>,
): string | null {
  if (place.workspace !== undefined) return null
  const used = command.includes(WORKSPACE_VAR) || (place.cwd?.includes(WORKSPACE_VAR) ?? false)
  return used ? `命令或脚本目录里用了 ${WORKSPACE_VAR}，先选会话工作区` : null
}
