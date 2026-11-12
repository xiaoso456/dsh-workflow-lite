/**
 * dsh-workflow-lite — 触发器的业务面：到点触发、开关与本机设置、「立即触发一次」、状态与触发记录。
 *
 * 到点触发只由负责的那个 DSH 进程做（见 `owner.ts`）：每隔几秒报到一次、对一遍账（`reconcile.ts`），
 * 到点的交给 `launcher.ts` 发进会话。开关、设置、「立即触发一次」哪个进程都能做，都落在
 * `<dataDir>/triggers/` 里，负责的进程下一轮就看到。
 *
 * 「连续几次没发出去就自动停用」里的「没发出去」只指触发器自己干不了活：工作区或会话不在了、
 * 会话建不出来、图编译不出计划。跳过（上一次还在跑、超过每小时上限、错过了）不算，
 * 消息发进去之后工作流执行得怎么样更不算。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/service
 */

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { launchOf, scheduleProblem } from '../../shared/trigger.ts'
import type {
  FireRecord,
  TriggerFireRequest,
  TriggerListResponse,
  TriggerSetRequest,
  TriggerView,
} from '../../shared/wire/trigger.ts'
import { fail, type Outcome, ok } from '../store/repoResult.ts'
import type { TriggerDefinition, TriggerGraphs } from './graphs.ts'
import { Launcher } from './launcher.ts'
import { OwnerLock } from './owner.ts'
import { type DueFire, planRound, upcoming } from './reconcile.ts'
import type { SessionPort } from './sessions.ts'
import { ownerFile, type TriggerLocal, type TriggerStore } from './store.ts'

/** 多久报到、对一次账。 */
export const BEAT_MS = 5_000
/** 晚了这么久还没触发，就算「错过了」（DSH 当时没在运行）。 */
export const LATE_MS = 2 * 60_000
/** 触发记录一次最多给画布多少条。 */
const HISTORY_PAGE = 50
const HOUR_MS = 60 * 60_000

export interface TriggerServiceDeps {
  dataDir: () => string
  store: TriggerStore
  graphs: TriggerGraphs
  sessions: SessionPort
  now?: () => number
  /** 测试里换掉（假的进程号、假的存活判断）。 */
  lock?: OwnerLock
  warn?: (message: string) => void
}

export class TriggerService {
  private readonly store: TriggerStore
  private readonly graphs: TriggerGraphs
  private readonly sessions: SessionPort
  private readonly launcher: Launcher
  private readonly lock: OwnerLock
  private readonly now: () => number
  private readonly warn: (message: string) => void
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  /** 正在进行的那一轮（一轮一轮来，不重叠）。 */
  private round: Promise<void> = Promise.resolve()
  /** 开着的卡片里最早的下一次时刻（决定下一轮什么时候来）。 */
  private nextDue: number | undefined

  constructor(deps: TriggerServiceDeps) {
    this.store = deps.store
    this.graphs = deps.graphs
    this.sessions = deps.sessions
    this.now = deps.now ?? Date.now
    this.warn = deps.warn ?? (() => {})
    this.launcher = new Launcher(deps.sessions, deps.store)
    this.lock = deps.lock ?? new OwnerLock({ file: () => ownerFile(deps.dataDir()), now: this.now })
  }

  // ── 到点触发 ───────────────────────────────────────────────

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
    await this.lock.release().catch(() => {})
  }

  private schedule(delay: number): void {
    if (!this.running) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.tick()
        .catch((error: unknown) => {
          this.warn(`触发器这一轮出错：${error instanceof Error ? error.message : String(error)}`)
        })
        .then(() => {
          // 下一轮：最迟一个报到间隔之后；有卡片更早到点就提前到那一刻。
          const wait = this.nextDue === undefined ? BEAT_MS : this.nextDue - this.now()
          this.schedule(Math.min(BEAT_MS, Math.max(200, wait)))
        })
    }, delay)
  }

  /** 跑一轮：报到；负责触发的是本进程就对账、触发到点的卡片。 */
  tick(): Promise<void> {
    const run = this.round.catch(() => {}).then(() => this.runRound())
    this.round = run
    return run
  }

  private async runRound(): Promise<void> {
    this.nextDue = undefined
    // 这个进程发不了会话：不争负责权，留给发得了的。
    if (this.sessions.unavailable() !== null) {
      await this.lock.release()
      return
    }
    if (!(await this.lock.beat())) return
    const now = this.now()
    const plan = await planRound(await this.store.locals(), this.graphs, now)
    const fresh = await this.store.update((locals) => {
      plan.apply(locals)
      return structuredClone(locals)
    })
    this.nextDue = plan.next
    for (const due of plan.fires) {
      // 写回之前别的进程把开关关了：不触发。
      const local = fresh[due.workflow]?.[due.trigger.node]
      if (local?.enabled !== true) continue
      await this.fireDue({ ...due, local }, now)
    }
  }

  private async fireDue(due: DueFire, now: number): Promise<void> {
    const launch = launchOf(due.trigger.data)
    const input = {
      workflow: due.workflow,
      trigger: due.trigger,
      local: due.local,
      channel: 'schedule' as const,
      at: now,
    }
    let record: FireRecord
    if (due.late > LATE_MS && !launch.catchUp) {
      record = await this.launcher.skip(input, '到点时 DSH 没在运行，错过了')
    } else if (due.blocked !== undefined) {
      record = await this.launcher.fail(input, `工作流现在执行不了：${due.blocked}`)
    } else if ((await this.sentWithinHour(due, now)) >= launch.maxPerHour) {
      record = await this.launcher.skip(
        input,
        `这一小时已经触发了 ${String(launch.maxPerHour)} 次，到上限了`,
      )
    } else {
      record = await this.launcher.fire(input)
    }
    await this.settle(record, launch.maxFailures)
  }

  private async sentWithinHour(due: DueFire, now: number): Promise<number> {
    const fires = await this.store.fires()
    return fires.filter(
      (fire) =>
        fire.workflow === due.workflow &&
        fire.node === due.trigger.node &&
        fire.outcome === 'sent' &&
        now - fire.at < HOUR_MS,
    ).length
  }

  /** 一次定时触发之后：发出去了清掉失败计数、记下会话；连续没发出去到了次数就自动停用。 */
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
      local.stopped = `连续 ${String(failures)} 次没发出去：${record.reason ?? '原因不明'}`
      delete local.due
      delete local.failures
    })
  }

  // ── 画布 ───────────────────────────────────────────────────

  /** 一个工作流里每张触发卡片现在的样子。 */
  async list(workflow: string): Promise<TriggerListResponse> {
    const owner = await this.lock.current()
    const graph = await this.graphs.read(workflow)
    if (graph.kind !== 'ok') return { triggers: [], ...(owner === undefined ? {} : { owner }) }
    const locals = (await this.store.locals())[workflow] ?? {}
    const last = new Map<string, FireRecord>()
    for (const fire of await this.store.fires()) {
      if (fire.workflow === workflow) last.set(fire.node, fire)
    }
    const unavailable = this.sessions.unavailable()
    const now = this.now()
    const triggers = graph.triggers.map((trigger): TriggerView => {
      const local = locals[trigger.node] ?? { enabled: false }
      const recent = last.get(trigger.node)
      const base = {
        node: trigger.node,
        enabled: local.enabled,
        ...(local.workspace === undefined ? {} : { workspace: local.workspace }),
        ...(local.session === undefined ? {} : { session: local.session }),
        ...(recent === undefined ? {} : { last: recent }),
      }
      if (!local.enabled) {
        return local.stopped === undefined
          ? { ...base, state: 'off' }
          : { ...base, state: 'stopped', problem: local.stopped }
      }
      const { schedule } = trigger.data.source
      const problem = scheduleProblem(schedule)
      if (problem !== null) return { ...base, state: 'invalid', problem }
      const next = upcoming(local, schedule, now)
      const when = next === undefined ? {} : { next }
      if (owner !== undefined && !owner.mine) return { ...base, ...when, state: 'elsewhere' }
      if (unavailable !== null) return { ...base, state: 'unavailable', problem: unavailable }
      return { ...base, ...when, state: 'waiting' }
    })
    return { triggers, ...(owner === undefined ? {} : { owner }) }
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

  /** 改一张卡片的本机设置：开关、工作区、固定会话；给了哪项改哪项。回这个工作流各卡片的新样子。 */
  async set(request: TriggerSetRequest): Promise<Outcome<TriggerListResponse>> {
    const found = await this.definition(request.workflow, request.node)
    if (!found.ok) return found
    const { trigger } = found.result
    if (request.workspace !== undefined && request.workspace !== '') {
      const directory = await workspaceProblem(request.workspace)
      if (directory !== null) return fail('invalid_args', directory)
    }
    const now = this.now()
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
      if (request.enabled === true && !local.enabled) {
        const missing = enableProblem(trigger, local)
        if (missing !== null) return missing
        local.enabled = true
        local.since = now
        delete local.due
        delete local.rule
        delete local.failures
        delete local.stopped
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
    // 负责触发的是本进程时马上对一遍账（新打开的卡片立刻有「下一次」）。
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
    const input = {
      workflow: request.workflow,
      trigger,
      local,
      channel: 'now' as const,
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

  /** 触发记录，新的在前；给了卡片就只看它的。 */
  async history(workflow: string, node?: string): Promise<FireRecord[]> {
    const fires = await this.store.fires()
    return fires
      .filter((fire) => fire.workflow === workflow && (node === undefined || fire.node === node))
      .reverse()
      .slice(0, HISTORY_PAGE)
  }
}

/** 打开开关之前要先配好的东西；都齐了是 `null`。 */
function enableProblem(trigger: TriggerDefinition, local: TriggerLocal): string | null {
  const problem = scheduleProblem(trigger.data.source.schedule)
  if (problem !== null) return `定时规则不对：${problem}`
  const launch = launchOf(trigger.data)
  if (launch.session === 'fixed') {
    return local.session === undefined ? '先选定发进哪个会话' : null
  }
  return local.workspace === undefined ? '先选在哪个工作区里新建会话' : null
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
