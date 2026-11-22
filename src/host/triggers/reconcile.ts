/**
 * dsh-workflow-lite — 对一遍账：拿图里的卡片对照运行记录，算出这一轮哪些卡片在跑、哪些到点了、下一次是什么时候。
 *
 * 开关在图里，运行记录在数据库里；这里把两边对上：
 * - 图里开着、没被自动停用、还没开始跑的：从现在开始跑（记下开始的时刻，清掉上一回的排期、失败计数、看过的实例）；
 * - 图里关了的：运行记录里这一回的东西清掉（开始的时刻、排期、失败计数、自动停用）；
 * - 卡片不在了：运行记录删掉。工作流暂时读不出来时保留，删除工作流时由仓储清理。
 *
 * 只算不做：返回要写回运行记录的改动、在跑的卡片、到点的定时（只管到点直接执行的，
 * 带检查命令的由 `runtime.ts` 常驻着查）、最早的下一次时刻，由 `service.ts` 去写、去触发。
 * 改动是按「现读的记录」再应用一遍的（{@link RoundPlan.apply}）：算的时候和写的时候之间，
 * 别的进程可能已经动过（比如用户刚把自动停用的卡片重新打开），这种卡片不动它。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/reconcile
 */

import { nextFire } from '../../shared/schedule.ts'
import { sourceProblem } from '../../shared/trigger.ts'
import type { TriggerData, TriggerSchedule } from '../../shared/types.ts'
import type { TriggerGraphs, WorkflowTrigger } from './graphs.ts'
import type { TriggerRun, TriggerRuns } from './runRecords.ts'

/** 这一轮在跑的一张卡片：图里开着、没被自动停用。 */
export interface ActiveCard {
  workflow: string
  trigger: WorkflowTrigger
  /** 图现在执行不了的原因（有就发不出去）。 */
  blocked?: string
}

/** 到点了的一张卡片。 */
export interface DueFire extends ActiveCard {
  /** 晚了多久（毫秒）：DSH 没在运行时错过的，这个数会很大。 */
  late: number
}

export interface RoundPlan {
  /** 把这一轮算出来的改动应用到现读的记录上。 */
  apply(runs: TriggerRuns): void
  /** 在跑的卡片（接续、常驻的触发源、排着的都按它）。 */
  active: ActiveCard[]
  fires: DueFire[]
  /** 在跑的卡片里最早的下一次触发时刻。 */
  next?: number
}

type Change =
  /** 卡片从图里删掉了。 */
  | { kind: 'dropNode'; workflow: string; node: string }
  /** 图里打开了：从这一刻开始跑。 */
  | { kind: 'start'; workflow: string; node: string; since: number }
  /** 图里关了：这一回的东西清掉。 */
  | { kind: 'stop'; workflow: string; node: string }
  /** 记下下一次的时刻（规则写得不对时清掉）。 */
  | {
      kind: 'schedule'
      workflow: string
      node: string
      since: number
      rule: string
      due: number | undefined
    }

/** 一条规则的记号：运行记录里记着排期时用的是哪条规则，对不上就是改过了。 */
function ruleOf(schedule: TriggerSchedule): string {
  return JSON.stringify(schedule)
}

/** 这张卡片在跑：图里开着，没被自动停用。 */
export function isActive(data: TriggerData, run: TriggerRun | undefined): boolean {
  return data.enabled === true && run?.stopped === undefined
}

/** 从这一刻开始跑：上一回的排期、失败计数、看过的实例都清掉。 */
export function startRun(run: TriggerRun, since: number): void {
  run.since = since
  delete run.due
  delete run.rule
  delete run.failures
  delete run.stopped
  delete run.seen
}

/** 停下：这一回的东西清掉（上一次的会话、触发、检查结果、试的时刻留着）。 */
function stopRun(run: TriggerRun): void {
  delete run.since
  delete run.due
  delete run.rule
  delete run.failures
  delete run.stopped
}

/**
 * 一张开着的卡片下一次什么时候触发（给界面看）：排过期就是排好的那一刻；
 * 还没开始跑、或规则在排期之后改过，排好的那一刻不作数，按「从现在起」现算（下一轮对账也是这么排的）。
 */
export function upcoming(
  run: TriggerRun,
  schedule: TriggerSchedule,
  now: number,
): number | undefined {
  const changed = run.rule !== undefined && run.rule !== ruleOf(schedule)
  if (!changed && run.since !== undefined && run.due !== undefined) return run.due
  const since = changed ? now : (run.since ?? now)
  return nextFire(schedule, new Date(now), new Date(since))?.getTime()
}

export async function planRound(
  runs: TriggerRuns,
  graphs: TriggerGraphs,
  now: number,
): Promise<RoundPlan> {
  const changes: Change[] = []
  const active: ActiveCard[] = []
  const fires: DueFire[] = []
  let next: number | undefined

  const keys = new Set([...(await graphs.names()).map(graphs.idOf), ...Object.keys(runs)])
  for (const key of keys) {
    if (key === undefined) continue
    const graph = await graphs.readById(key)
    // 改名时文件路径可能暂时不可用，工作流删除时由仓储清理记录。
    if (graph.kind !== 'ok') continue
    const records = runs[key] ?? {}

    const present = new Set(graph.triggers.map((trigger) => trigger.node))
    for (const node of Object.keys(records)) {
      if (!present.has(node)) changes.push({ kind: 'dropNode', workflow: key, node })
    }

    for (const trigger of graph.triggers) {
      const { node } = trigger
      const run = records[node]
      if (trigger.data.enabled !== true) {
        if (run?.since !== undefined || run?.stopped !== undefined) {
          changes.push({ kind: 'stop', workflow: key, node })
        }
        continue
      }
      if (!isActive(trigger.data, run)) continue
      const card: ActiveCard = {
        workflow: graph.workflow,
        trigger,
        ...(graph.blocked === undefined ? {} : { blocked: graph.blocked }),
      }
      active.push(card)
      let since = run?.since
      if (since === undefined) {
        since = now
        changes.push({ kind: 'start', workflow: key, node, since })
      }

      // 只排到点直接执行的定时；带检查命令的定时、监听程序、HTTP 由 `runtime.ts` 常驻着做。
      const { source } = trigger.data
      if (source.kind !== 'schedule' || source.check !== undefined) continue
      const { schedule } = source
      const rule = ruleOf(schedule)
      const fresh = run?.since === undefined
      if (sourceProblem(source) !== null) {
        if (!fresh && (run?.due !== undefined || run?.rule !== rule)) {
          changes.push({ kind: 'schedule', workflow: key, node, since, rule, due: undefined })
        }
        continue
      }
      // 规则改过：从现在重新算起。
      if (!fresh && run?.rule !== undefined && run.rule !== rule) since = now
      const from = since
      const after = (moment: number): number | undefined =>
        nextFire(schedule, new Date(moment), new Date(from))?.getTime()
      // 还没排过：第一次是开始跑（或改规则）之后的头一个时刻——哪怕它已经过了，也算到点。
      let due = !fresh && run?.rule === rule ? run.due : undefined
      if (due === undefined) due = after(since)
      if (due !== undefined && due <= now) {
        fires.push({ ...card, late: now - due })
        due = after(now)
      }
      if (fresh || due !== run?.due || rule !== run?.rule || since !== run?.since) {
        changes.push({ kind: 'schedule', workflow: key, node, since, rule, due })
      }
      if (due !== undefined && (next === undefined || due < next)) next = due
    }
  }

  return {
    active,
    fires,
    ...(next === undefined ? {} : { next }),
    apply(current) {
      for (const change of changes) {
        const group = current[change.workflow] ?? {}
        current[change.workflow] = group
        if (change.kind === 'dropNode') {
          delete group[change.node]
          continue
        }
        const run = group[change.node] ?? {}
        group[change.node] = run
        if (change.kind === 'stop') {
          stopRun(run)
          continue
        }
        // 算完之后被自动停用了：不动它。
        if (run.stopped !== undefined) continue
        if (change.kind === 'start') {
          // 别的进程刚开始过了：用它的。
          if (run.since === undefined) startRun(run, change.since)
          continue
        }
        run.since = change.since
        run.rule = change.rule
        if (change.due === undefined) delete run.due
        else run.due = change.due
      }
    },
  }
}
