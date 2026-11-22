/**
 * dsh-workflow-lite — 接续触发要知道的两件事：各工作流最近的几次执行，以及替另一个工作流打开「记录运行状态」。
 *
 * 画布上的触发卡片（`useTriggerScene`）和工作流中心「触发」页共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/workflowRuns
 */

import type { RunStatus } from '../../shared/runState.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { patchWorkflowOnDisk } from './diskPatch.ts'

/** 每个工作流最多列几次执行。 */
export const RECENT_RUNS = 6

/** 一个工作流的一次执行（一个实例）。 */
export interface RunBrief {
  /** 实例 id。 */
  id: string
  /** 状态文件里写的；读不出来是 `undefined`。 */
  status?: RunStatus
  /** 最后一次更新的时刻。 */
  at: number
}

/** 各工作流最近的几次执行（按工作流 ID，新建的在前，每个最多 {@link RECENT_RUNS} 个）。 */
export async function recentRuns(
  rpc: WorkflowLiteRpc,
): Promise<ReadonlyMap<string, readonly RunBrief[]>> {
  const byWorkflow = new Map<string, (RunBrief & { created: number })[]>()
  try {
    const { instances } = await rpc.call('run/list', { all: true })
    for (const run of instances) {
      if (run.workflowId === undefined) continue
      const updated = run.updatedAt === undefined ? Number.NaN : Date.parse(run.updatedAt)
      const list = byWorkflow.get(run.workflowId) ?? []
      list.push({
        id: run.id,
        created: run.createdAt,
        at: Number.isFinite(updated) ? updated : run.createdAt,
        ...(run.status === undefined ? {} : { status: run.status }),
      })
      byWorkflow.set(run.workflowId, list)
    }
  } catch {
    // 读不到就不显示最近的执行。
  }
  const recent = new Map<string, readonly RunBrief[]>()
  for (const [workflow, list] of byWorkflow) {
    recent.set(
      workflow,
      list
        .sort((a, b) => b.created - a.created)
        .slice(0, RECENT_RUNS)
        .map(({ created: _created, ...run }) => run),
    )
  }
  return recent
}

/** 在 `workflow` 的设置里打开「记录运行状态」（接续触发要靠它看出什么时候跑完）；打不开回一句原因。 */
export function enableRunState(rpc: WorkflowLiteRpc, workflow: string): Promise<string | null> {
  return patchWorkflowOnDisk(rpc, workflow, (document) => ({
    ...document,
    settings: { ...document.settings, runState: true },
  }))
}
