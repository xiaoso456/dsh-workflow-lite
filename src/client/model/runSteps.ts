/**
 * dsh-workflow-lite — 「运行实例」页右栏按步骤看一个实例：步骤按执行的先后排、各种状态各几步、停在哪一步。纯计算，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/runSteps
 */

import { analyzeGraph } from '../../shared/graph.ts'
import { findNode, isStep } from '../../shared/model.ts'
import type { RunCursor } from '../../shared/runCursor.ts'
import type { NodeStatus, RunState } from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import { nodeTitle } from './nodeName.ts'

export interface StepLine {
  id: string
  name: string
  status: NodeStatus
}

/** 图里的步骤按执行的先后（按批次，同一批按图里的顺序）；状态没记的是待执行。 */
export function stepLines(doc: WorkflowDocument, state: RunState | null): StepLine[] {
  const order = analyzeGraph(doc).batches.flatMap((batch) => batch.nodes)
  const steps = doc.nodes.filter(isStep)
  const ids = [...new Set([...order, ...steps.map((node) => node.id)])]
  return ids.flatMap((id) => {
    const node = findNode(doc, id)
    if (node === undefined || !isStep(node)) return []
    return [{ id, name: nodeTitle(node), status: state?.nodes[id]?.status ?? 'pending' }]
  })
}

/** 各种状态各几步。 */
export function stepCounts(lines: readonly StepLine[]): Record<NodeStatus, number> {
  const counts: Record<NodeStatus, number> = {
    pending: 0,
    running: 0,
    waiting: 0,
    done: 0,
    failed: 0,
    skipped: 0,
  }
  for (const line of lines) counts[line.status] += 1
  return counts
}

/** 现在停在哪一步：执行中的、等用户的，再不然最后做过的那步（失败的也是它）；一步都没做过是第一步。 */
export function keyStep(lines: readonly StepLine[], cursor: RunCursor | null): string | undefined {
  return (
    cursor?.running[0] ??
    cursor?.waiting[0] ??
    cursor?.last.at(-1)?.node ??
    lines.find((line) => line.status !== 'pending')?.id ??
    lines[0]?.id
  )
}
