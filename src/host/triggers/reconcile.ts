/**
 * dsh-workflow-lite — 对一遍账：拿本机状态对照图，算出这一轮哪些卡片到点了、各自下一次是什么时候。
 *
 * 只算不做：返回要写回本机状态的改动、到点的卡片、最早的下一次时刻，由 `service.ts` 去写、去触发。
 * 改动是按「现读的状态」再应用一遍的（{@link RoundPlan.apply}）——算的时候和写的时候之间，
 * 别的进程可能已经把开关关了，这种卡片不动它。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/reconcile
 */

import { nextFire, scheduleProblem } from '../../shared/trigger.ts'
import type { TriggerSchedule } from '../../shared/types.ts'
import type { TriggerDefinition, TriggerGraphs } from './graphs.ts'
import type { TriggerLocal, TriggerLocals } from './store.ts'

/** 到点了的一张卡片。 */
export interface DueFire {
  workflow: string
  trigger: TriggerDefinition
  /** 算的那一刻它在本机的状态。 */
  local: TriggerLocal
  /** 晚了多久（毫秒）：DSH 没在运行时错过的，这个数会很大。 */
  late: number
  /** 图现在执行不了的原因（有就发不出去）。 */
  blocked?: string
}

export interface RoundPlan {
  /** 把这一轮算出来的改动应用到现读的状态上。 */
  apply(locals: TriggerLocals): void
  fires: DueFire[]
  /** 开着的卡片里最早的下一次触发时刻。 */
  next?: number
}

type Change =
  /** 工作流不在了：它的状态整组删掉。 */
  | { kind: 'dropWorkflow'; workflow: string }
  /** 卡片从图里删掉了。 */
  | { kind: 'dropNode'; workflow: string; node: string }
  /** 记下下一次的时刻（规则写得不对时清掉）。 */
  | {
      kind: 'schedule'
      workflow: string
      node: string
      since: number
      rule: string
      due: number | undefined
    }

/** 一条规则的记号：本机状态里记着排期时用的是哪条规则，对不上就是改过了。 */
function ruleOf(schedule: TriggerSchedule): string {
  return JSON.stringify(schedule)
}

/**
 * 一张开着的卡片下一次什么时候触发（给界面看）：排过期就是排好的那一刻；
 * 规则在排期之后改过，排好的那一刻不作数，按「从现在起」现算（下一轮对账也是这么排的）。
 */
export function upcoming(
  local: TriggerLocal,
  schedule: TriggerSchedule,
  now: number,
): number | undefined {
  const changed = local.rule !== undefined && local.rule !== ruleOf(schedule)
  if (!changed && local.due !== undefined) return local.due
  const since = changed ? now : (local.since ?? now)
  return nextFire(schedule, new Date(now), new Date(since))?.getTime()
}

export async function planRound(
  locals: TriggerLocals,
  graphs: TriggerGraphs,
  now: number,
): Promise<RoundPlan> {
  const changes: Change[] = []
  const fires: DueFire[] = []
  let next: number | undefined

  for (const [workflow, nodes] of Object.entries(locals)) {
    const graph = await graphs.read(workflow)
    if (graph.kind === 'missing') {
      changes.push({ kind: 'dropWorkflow', workflow })
      continue
    }
    // 图暂时读不出来：开关留着，等用户修好。
    if (graph.kind === 'broken') continue

    for (const [node, local] of Object.entries(nodes)) {
      const trigger = graph.triggers.find((candidate) => candidate.node === node)
      if (trigger === undefined) {
        changes.push({ kind: 'dropNode', workflow, node })
        continue
      }
      if (!local.enabled) continue
      const { schedule } = trigger.data.source
      const rule = ruleOf(schedule)
      if (scheduleProblem(schedule) !== null) {
        if (local.due !== undefined || local.rule !== rule) {
          changes.push({
            kind: 'schedule',
            workflow,
            node,
            since: local.since ?? now,
            rule,
            due: undefined,
          })
        }
        continue
      }
      // 规则改过：从现在重新算起。
      const since = local.rule !== undefined && local.rule !== rule ? now : (local.since ?? now)
      const after = (moment: number): number | undefined =>
        nextFire(schedule, new Date(moment), new Date(since))?.getTime()
      // 还没排过：第一次是打开开关（或改规则）之后的头一个时刻——哪怕它已经过了，也算到点。
      let due = local.rule === rule ? local.due : undefined
      if (due === undefined) due = after(since)
      if (due !== undefined && due <= now) {
        fires.push({
          workflow,
          trigger,
          local,
          late: now - due,
          ...(graph.blocked === undefined ? {} : { blocked: graph.blocked }),
        })
        due = after(now)
      }
      if (due !== local.due || rule !== local.rule || since !== local.since) {
        changes.push({ kind: 'schedule', workflow, node, since, rule, due })
      }
      if (due !== undefined && (next === undefined || due < next)) next = due
    }
  }

  return {
    fires,
    ...(next === undefined ? {} : { next }),
    apply(current) {
      for (const change of changes) {
        if (change.kind === 'dropWorkflow') {
          delete current[change.workflow]
          continue
        }
        const group = current[change.workflow]
        if (group === undefined) continue
        if (change.kind === 'dropNode') {
          delete group[change.node]
          continue
        }
        const local = group[change.node]
        if (local === undefined || !local.enabled) continue
        local.since = change.since
        local.rule = change.rule
        if (change.due === undefined) delete local.due
        else local.due = change.due
      }
    },
  }
}
