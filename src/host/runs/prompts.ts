/**
 * dsh-workflow-lite — 写给模型的话：用户改动的描述、运行位置、「执行」时发进会话的那句话与进度摘要。
 *
 * `resume` / `compile` 回给模型的进度摘要、画布点「执行」发进会话的提示、通知模型的改动清单都在这里；
 * 纯函数，不碰磁盘。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/prompts
 */

import { type RunCursor, runCursor } from '../../shared/runCursor.ts'
import {
  type EditValue,
  type InstanceRecord,
  progressOf,
  type RunState,
  type RunStateIssue,
  type RunStatus,
  type StateEdit,
} from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'

function describeValue(value: EditValue): string {
  if (value === null) return '（空）'
  if (Array.isArray(value)) return value.length === 0 ? '[]' : value.join('、')
  return typeof value === 'string' && value.length > 40
    ? `「${value.slice(0, 40)}…」`
    : String(value)
}

/** 一个字段的改动，写成「status 从 done 改成 pending（要重新执行这一步）」这样的半句。 */
export function describeField(edit: StateEdit): string {
  const field = edit.path[edit.path.length - 1] ?? ''
  if (edit.path.length === 1 && field === 'next') {
    return Array.isArray(edit.to) && edit.to.length > 0
      ? `指定下一步：${edit.to.join('、')}（先做这几步，不按流转推）`
      : '取消了指定的下一步（回到按流转推）'
  }
  const change =
    edit.to === null
      ? `删掉了 ${field}（原来是 ${describeValue(edit.from)}）`
      : edit.from === null
        ? `${field} 写成 ${describeValue(edit.to)}`
        : `${field} 从 ${describeValue(edit.from)} 改成 ${describeValue(edit.to)}`
  let intent = ''
  if (field === 'status' && edit.path.length === 3) {
    if (edit.to === 'pending') intent = '（要重新执行这一步）'
    else if (edit.to === 'skipped') intent = '（这一步不再执行）'
    else if (edit.to === 'done') intent = '（视为已完成）'
  }
  if (field === 'status' && edit.path.length === 1) {
    if (edit.to === 'waiting') intent = '（先停下，等用户）'
    else if (edit.to === 'cancelled') intent = '（用户叫停了这次执行）'
    else if (edit.to === 'running') intent = '（继续执行）'
  }
  return `${change}${intent}`
}

/** 改动按对象归组：`node` 为空串是整体。同一组里状态在前，连带改的字段跟在后面。 */
export function groupEdits(edits: readonly StateEdit[]): { node: string; text: string }[] {
  const groups = new Map<string, StateEdit[]>()
  for (const edit of edits) {
    const key = edit.path.length === 1 ? '' : (edit.path[1] ?? '')
    groups.set(key, [...(groups.get(key) ?? []), edit])
  }
  return [...groups].map(([node, group]) => {
    const ordered = [
      ...group.filter((edit) => edit.path[edit.path.length - 1] === 'status'),
      ...group.filter((edit) => edit.path[edit.path.length - 1] !== 'status'),
    ]
    return { node, text: ordered.map(describeField).join('；') }
  })
}

/**
 * 改动按对象归成几行写给模型：整体一行、每个步骤一行。
 * 返回的行数就是"改了几处"（用户改一个步骤的状态，连带改了轮次、时间，算一处）。
 */
export function describeEdits(edits: readonly StateEdit[]): string[] {
  return groupEdits(edits).map(
    ({ node, text }) => `- ${node === '' ? '整体' : `步骤 ${node}`}：${text}`,
  )
}

/** 运行到哪了，写给模型的一句话（`resume` 用）。 */
export function cursorHint(cursor: RunCursor, status: RunStatus): string {
  const label = (id: string, round: number | undefined): string =>
    round !== undefined && round > 1 ? `${id}（第 ${round} 轮）` : id
  const parts: string[] = []
  if (cursor.running.length > 0) {
    parts.push(`被打断：${cursor.running.join('、')}，重做这一轮`)
  }
  if (cursor.last.length > 0) {
    const items = cursor.last.map((step) => {
      const tail = [
        step.status,
        ...(step.verdict === undefined ? [] : [`判定 ${step.verdict}`]),
      ].join('，')
      return `${label(step.node, step.round)}[${tail}]`
    })
    parts.push(`最后执行：${items.join('、')}`)
  }
  if (cursor.next.length > 0) {
    const items = cursor.next.map((step) => {
      const why =
        step.reason === 'start'
          ? '入口'
          : step.reason === 'reset'
            ? '被改回 pending，重做'
            : step.reason === 'pinned'
              ? '用户指定'
              : step.loop === true
                ? `循环中由 ${step.from} 回到这里`
                : `接 ${step.from}`
      return `${step.node}（第 ${step.round} 轮，${why}）`
    })
    parts.push(`接下来：${items.join('、')}`)
  } else if (cursor.running.length === 0 && cursor.waiting.length === 0) {
    parts.push(
      cursor.last.some((step) => step.status === 'failed')
        ? '没有能接着做的步骤：失败的步骤要重做（改回 running）或整体叫停'
        : status === 'done'
          ? '已经全部走完'
          : '没有要接着做的步骤：核对产出后把整体改成 done 并汇报',
    )
  }
  if (cursor.waiting.length > 0) parts.push(`在等用户：${cursor.waiting.join('、')}`)
  return `${parts.join('；')}。`
}

/**
 * 画布上点「执行」时发进会话的那句话：短、人看得懂；完整计划由模型调 `resume` 拿
 * （计划在工具结果里，对话里照样看得到）。
 */
export function startPrompt(record: InstanceRecord): string {
  const state =
    record.statePath === undefined
      ? ''
      : `，并按计划里「运行状态」一段用 workflow_lite 的 state 动作（instance=${record.id}）记录进度`
  return [
    `执行工作流「${record.workflow}」（实例 ${record.id}）。`,
    `请调用 workflow_lite：action=resume，instance=${record.id}，拿到计划后按计划执行${state}。`,
  ].join('\n')
}

/**
 * 进度摘要（`resume` / `compile` 回给模型）：最后执行到哪、接下来做哪几步——按图、判定和流水推出来
 * （见 `shared/runCursor.ts`），不按清单顺序找"第一个没完成的"（循环里那样会跳出环）。
 * 被打断的（停在 running 的）排在 `next` 最前面：重做这一轮。
 */
export function progressReport(
  record: InstanceRecord,
  read: { state: RunState | null; text: string | null; issues: RunStateIssue[] },
  document: WorkflowDocument,
): Record<string, unknown> {
  if (record.statePath === undefined) return { tracked: false }
  if (read.state === null) {
    return { stateProblem: read.text === null ? 'missing' : 'invalid', issues: read.issues }
  }
  const p = progressOf(read.state)
  const cursor = runCursor(document, read.state)
  const nodes = read.state.nodes
  const next = [
    ...cursor.running.map((node) => ({
      node,
      round: nodes[node]?.round ?? 1,
      reason: 'interrupted',
    })),
    ...cursor.next,
  ]
  return {
    status: read.state.status,
    done: p.done,
    total: p.total,
    ...(p.running.length > 0 ? { interrupted: p.running } : {}),
    ...(p.waiting.length > 0 ? { waiting: p.waiting } : {}),
    ...(p.failed.length > 0 ? { failed: p.failed } : {}),
    last: cursor.last,
    next,
    hint: cursorHint(cursor, read.state.status),
  }
}
