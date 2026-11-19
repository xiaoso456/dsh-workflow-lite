/**
 * dsh-workflow-lite — 接续触发：另一个工作流的一次执行结束了，就触发这一个。
 *
 * 实例跑没跑完记在它的运行状态文件里（模型经 `state` 改成 done / failed / cancelled），
 * 改的会话可能在别的 DSH 进程里，所以不靠通知：负责触发的进程每一轮问一次 {@link RunWatch}，
 * 拿到「打开开关之后改过状态文件、已经结束、还没处理过」的实例。处理过的记进本机状态（`seen`），
 * 不论触发了没有（结果对不上、暂停着）都记，免得每一轮重读。
 *
 * 这里只放说法（结果对不对得上在 `shared/trigger.ts` 的 `afterMatches`，对话框里也用），触发、记账在 `service.ts`。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/after
 */

import type { RunStatus } from '../../shared/runState.ts'
import type { FinishedStatus } from '../../shared/trigger.ts'
import type { TriggerSource } from '../../shared/types.ts'

/** 结束了的一个实例。 */
export interface FinishedRun {
  id: string
  status: FinishedStatus
  /** 状态文件最后修改的时刻（≈ 结束的时刻）。 */
  at: number
  goal?: string
  cwd?: string
  statePath?: string
  /** 做完了几步 / 一共几步。 */
  done?: number
  total?: number
}

/** 实例那边给触发器用的一面。 */
export interface RunWatch {
  /**
   * 工作流 `workflow` 里状态文件在 `since` 之后改过、已经结束、不在 `skip` 里的实例（旧的在前），
   * 以及这个工作流现在所有实例的 id（本机状态里清掉已删实例用）。
   */
  finished(
    workflow: string,
    since: number,
    skip: ReadonlySet<string>,
  ): Promise<{ runs: FinishedRun[]; ids: string[] }>
  /**
   * 一个实例的运行状态：整体状态（没有状态文件、读不出来不给）和状态文件最后改动的时刻。
   * 实例不在了是 `null`。「上次执行未结束时」靠它（见 `runEnd.ts`）。
   */
  stateOf(instance: string): Promise<{ status?: RunStatus; at?: number } | null>
  /**
   * 工作流 `workflow` 最新建的那个实例：整体状态（没有状态文件、读不出来不给）和最近一次动静的时刻
   * （状态文件最后改动的时刻，没有就是建的时刻）。没有实例是 `null`。卡片上「等的那个工作流现在怎样」靠它。
   */
  newest(workflow: string): Promise<{ id: string; status?: RunStatus; at: number } | null>
}

type AfterSource = Extract<TriggerSource, { kind: 'after' }>

const STATUS_TEXT: Record<FinishedStatus, string> = {
  done: '成功（done）',
  failed: '失败（failed）',
  cancelled: '取消（cancelled）',
}

/** 交给下一个工作流的背景信息：那个实例是谁、结果如何、去哪儿看它的产出。 */
export function afterInfo(workflow: string, run: FinishedRun): string {
  const steps =
    run.done === undefined || run.total === undefined
      ? ''
      : `，完成 ${String(run.done)}/${String(run.total)} 步`
  const lines = [
    `工作流「${workflow}」的实例 ${run.id} 结束了：${STATUS_TEXT[run.status]}${steps}。`,
  ]
  if (run.goal !== undefined) lines.push(`它的目标：${run.goal}`)
  if (run.cwd !== undefined) lines.push(`它的工作区：${run.cwd}`)
  if (run.statePath !== undefined) {
    lines.push(
      `它的运行状态文件：${run.statePath}（各步骤的状态、备注和产出都记在这里，需要时去读）`,
    )
  }
  return lines.join('\n')
}

/** 接续触发这张卡片现在能不能用；能用是 `null`。 */
export function afterProblem(
  self: string,
  source: AfterSource,
  target: { kind: 'missing' } | { kind: 'broken' } | { kind: 'ok'; runState: boolean },
): string | null {
  if (source.workflow === '') return '还没选等哪个工作流跑完'
  if (source.workflow === self) return '不能等自己跑完（会一直触发自己）'
  if (target.kind === 'missing') return `工作流「${source.workflow}」不存在（改名了的话重新选一下）`
  if (target.kind === 'ok' && !target.runState) {
    return `工作流「${source.workflow}」没开「记录运行状态」，看不出它什么时候跑完`
  }
  return null
}
