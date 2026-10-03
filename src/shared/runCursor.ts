/**
 * dsh-workflow-lite — 运行到哪了：按图、判定和流水推出**最后执行**的步骤与**接下来**该做的步骤。
 *
 * 只看各步骤的状态会漂：循环里每个步骤都做过一轮、都是 `done`，"第一个没完成的步骤"会跳到环外。
 * 这里改看流水（只追加，下标就是先后）：
 * - 一个步骤做完之后，它该交给的下游（无条件线、条件等于它这一轮判定的线）在那之后还没有动静，
 *   它就是**最后执行**的步骤之一，那些下游就是**接下来**的步骤（回边 = 循环回去，再做一轮）；
 * - 失败的步骤一直算最后执行（等重做或叫停）；
 * - 都接上了（下游在跑，或走到了头）时，最后执行 = 最近做完的那一步（同一次调用写下的几步一起算）。
 *
 * 另外两种「接下来」：从没开始过的入口步骤，和被改回 `pending` 的步骤（它前面的都完成了才轮到）。
 *
 * 用户也可以**指定**下一步（状态里的 `next`，流水里记一条 `next` 事件）：
 * - 指定还在时，「接下来」就是指定的这几步；
 * - 指定那一刻之前做完的步骤，交接都算已经了结——模型做完指定的步骤后，不会再绕回指定之前没接上的下游。
 * 画布上的「最后执行 / 下一步」标记与工具回给模型的进度都用它。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/runCursor
 */

import { analyzeGraph, edgeWhen, type GraphAnalysis } from './graph.ts'
import { isStep } from './model.ts'
import { flowEdges } from './resources.ts'
import type { NodeRunState, NodeStatus, RunState } from './runState.ts'
import type { WorkflowDocument, WorkflowEdge } from './types.ts'

/** 最后执行的一步。 */
export interface CursorStep {
  node: string
  status: NodeStatus
  round?: number
  verdict?: string
  /** 结束时刻。 */
  at?: string
}

/** 接下来的一步。 */
export interface NextStep {
  node: string
  /** 做的话是第几轮。 */
  round: number
  /**
   * `flow` = 上游交过来；`start` = 入口步骤还没开始；`reset` = 被改回 pending，要重做；
   * `pinned` = 用户指定。
   */
  reason: 'flow' | 'start' | 'reset' | 'pinned'
  /** 谁交过来的（`flow` 才有）。 */
  from?: string
  /** 沿回边过来：循环回到这一步。 */
  loop?: true
}

export interface RunCursor {
  /** 按做完的先后。 */
  last: CursorStep[]
  running: string[]
  waiting: string[]
  next: NextStep[]
}

const FINISHED: readonly NodeStatus[] = ['done', 'failed']

function timeOf(value: string | undefined): number {
  const time = value === undefined ? Number.NaN : Date.parse(value)
  return Number.isNaN(time) ? -1 : time
}

export function runCursor(
  document: WorkflowDocument,
  state: RunState,
  analysis: GraphAnalysis = analyzeGraph(document),
): RunCursor {
  const steps = document.nodes.filter(isStep).map((node) => node.id)
  const known = new Set(steps)
  const nodeOf = (id: string): NodeRunState | undefined => state.nodes[id]
  const statusOf = (id: string): NodeStatus => nodeOf(id)?.status ?? 'pending'

  /** 每个步骤在流水里最后一次出现的下标；没出现过是 -1。 */
  const seen = new Map<string, number>()
  state.log.forEach((entry, index) => {
    if (entry.node !== undefined && known.has(entry.node)) seen.set(entry.node, index)
  })
  const touched = (id: string): number => seen.get(id) ?? -1
  const pinned = (state.next ?? []).filter(
    (id, index, list) => known.has(id) && list.indexOf(id) === index,
  )
  /**
   * 生效过的最后一次指定：在它之前做完的步骤，交接都算了结。
   * 生效 = 指定还在，或者指定之后（下一次指定之前）模型做过事；指定了又被用户取消、模型还没动的，不算。
   */
  const pins = state.log.flatMap((entry, index) => (entry.event === 'next' ? [index] : []))
  const acted = (from: number, to: number): boolean =>
    state.log.slice(from + 1, to).some((entry) => entry.node !== undefined && entry.by !== 'user')
  let cutoff = -1
  for (let index = pins.length - 1; index >= 0 && cutoff < 0; index -= 1) {
    const at = pins[index] as number
    const until = pins[index + 1] ?? state.log.length
    if (acted(at, until) || (index === pins.length - 1 && pinned.length > 0)) cutoff = at
  }
  /** `target` 在 `source` 做完之后有没有动静（开始、做完、被跳过、被改…）。 */
  const movedAfter = (target: string, source: string): boolean => {
    const a = touched(target)
    const b = touched(source)
    if (a !== b) return a > b
    if (target === source || a >= 0) return false
    // 两边都没进过流水（手写的旧状态）：退回去比时间。
    const node = nodeOf(target)
    const since = timeOf(nodeOf(source)?.finishedAt)
    return since >= 0 && Math.max(timeOf(node?.startedAt), timeOf(node?.finishedAt)) >= since
  }

  const flows = flowEdges(document).filter(
    (edge) => known.has(edge.source) && known.has(edge.target),
  )
  const outgoing = new Map<string, WorkflowEdge[]>()
  const forwardIn = new Map<string, string[]>()
  for (const edge of flows) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge])
    if (!analysis.backEdges.has(edge.id)) {
      forwardIn.set(edge.target, [...(forwardIn.get(edge.target) ?? []), edge.source])
    }
  }
  const busy = (id: string): boolean => statusOf(id) === 'running' || statusOf(id) === 'waiting'
  const roundAfter = (id: string): number => (nodeOf(id)?.round ?? 0) + 1

  const next: NextStep[] = []
  const add = (step: NextStep): void => {
    if (!next.some((item) => item.node === step.node)) next.push(step)
  }

  // 做完了、还有下游没接上的。
  const frontier: string[] = []
  for (const id of steps) {
    const node = nodeOf(id)
    if (node === undefined || !FINISHED.includes(node.status)) continue
    if (node.status === 'failed') {
      frontier.push(id)
      continue
    }
    if (touched(id) >= 0 && touched(id) < cutoff) continue
    const open = (outgoing.get(id) ?? []).filter((edge) => {
      const when = edgeWhen(edge)
      return (when === undefined || when === node.verdict) && !movedAfter(edge.target, id)
    })
    if (open.length > 0) frontier.push(id)
    if (pinned.length > 0) continue
    for (const edge of open) {
      const target = edge.target
      const loop = analysis.backEdges.has(edge.id)
      // 下游正在跑 / 在等，或者汇合处还有别的上游没做完：先不排它。
      if (busy(target)) continue
      if (!loop && (forwardIn.get(target) ?? []).some((other) => other !== id && busy(other))) {
        continue
      }
      add({
        node: target,
        round: roundAfter(target),
        reason: 'flow',
        from: id,
        ...(loop ? { loop: true as const } : {}),
      })
    }
  }

  for (const id of pinned) {
    if (!busy(id)) add({ node: id, round: roundAfter(id), reason: 'pinned' })
  }

  for (const id of pinned.length > 0 ? [] : steps) {
    const node = nodeOf(id)
    if ((node?.status ?? 'pending') !== 'pending') continue
    const history = touched(id) >= 0 || (node?.round ?? 0) >= 1
    if (!history) {
      if ((forwardIn.get(id) ?? []).length === 0) add({ node: id, round: 1, reason: 'start' })
      continue
    }
    const ready = (forwardIn.get(id) ?? []).every((before) => {
      const status = statusOf(before)
      return status === 'done' || status === 'skipped'
    })
    if (ready) add({ node: id, round: roundAfter(id), reason: 'reset' })
  }

  const order = (a: string, b: string): number => touched(a) - touched(b)
  let last = frontier.sort(order)
  if (last.length === 0) {
    const finished = steps.filter((id) => FINISHED.includes(statusOf(id)))
    const latest = finished.reduce<string | undefined>(
      (best, id) =>
        best === undefined ||
        touched(id) > touched(best) ||
        (touched(id) === touched(best) &&
          timeOf(nodeOf(id)?.finishedAt) > timeOf(nodeOf(best)?.finishedAt))
          ? id
          : best,
      undefined,
    )
    if (latest !== undefined) {
      // 同一次调用写下的几步（流水里同一时刻）一起算。
      const at = state.log[touched(latest)]?.at
      last = finished
        .filter((id) => id === latest || (at !== undefined && state.log[touched(id)]?.at === at))
        .sort(order)
    }
  }

  return {
    last: last.map((id) => {
      const node = nodeOf(id)
      return {
        node: id,
        status: statusOf(id),
        ...(node?.round === undefined ? {} : { round: node.round }),
        ...(node?.verdict === undefined ? {} : { verdict: node.verdict }),
        ...(node?.finishedAt === undefined ? {} : { at: node.finishedAt }),
      }
    }),
    running: steps.filter((id) => statusOf(id) === 'running'),
    waiting: steps.filter((id) => statusOf(id) === 'waiting'),
    next,
  }
}
