/**
 * dsh-workflow-lite — 实例视图里用户攒的状态改动（草稿）。
 *
 * 改动不实时落盘：先记成"字段 → 改前 / 改后"的清单，用户确认后一次交给 host（`run/save`）。
 * 草稿期间状态文件照常刷新：模型改了别的字段，画布跟着变；模型改了用户也改过的**同一个**字段，
 * 那条就是冲突，让用户选（见 {@link rebase}）。
 *
 * 全是纯函数：实例视图只负责把它们接到界面上。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/runDraft
 */

import {
  type EditValue,
  type NodeRunState,
  type NodeStatus,
  type RunState,
  type StateEdit,
  statusFields,
} from '../../shared/runState.ts'

/** 草稿里的一条冲突：用户以为的旧值、用户要的新值、文件里现在的值。 */
export interface DraftConflict {
  path: string[]
  from: EditValue
  to: EditValue
  disk: EditValue
}

export function samePath(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index])
}

export function sameValue(a: EditValue, b: EditValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** 状态里某个字段的值（没有 = `null`）。 */
export function valueAt(state: RunState, path: readonly string[]): EditValue {
  let cursor: unknown = state
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return null
    cursor = (cursor as Record<string, unknown>)[key]
  }
  if (cursor === undefined || cursor === null) return null
  if (typeof cursor === 'string' || typeof cursor === 'number') return cursor
  if (Array.isArray(cursor))
    return cursor.filter((item): item is string => typeof item === 'string')
  return null
}

/**
 * 记一处改动。`base` 是文件里现在的状态：同一个字段第一次改时记下它的值当"改前"；
 * 改回和"改前"一样就从草稿里撤掉。
 */
export function setField(
  draft: readonly StateEdit[],
  base: RunState,
  path: readonly string[],
  to: EditValue,
): StateEdit[] {
  const existing = draft.find((edit) => samePath(edit.path, path))
  const from = existing === undefined ? valueAt(base, path) : existing.from
  const rest = draft.filter((edit) => !samePath(edit.path, path))
  if (sameValue(from, to)) return rest
  const next: StateEdit = { path: [...path], from, to }
  if (existing === undefined) return [...rest, next]
  // 原地替换，清单顺序（= 用户改的先后）不变。
  return draft.map((edit) => (samePath(edit.path, path) ? next : edit))
}

/** 把草稿叠到状态上（画布显示的就是叠完的样子）。 */
export function applyDraft(state: RunState, draft: readonly StateEdit[]): RunState {
  if (draft.length === 0) return state
  const next: RunState = {
    ...state,
    nodes: Object.fromEntries(Object.entries(state.nodes).map(([id, node]) => [id, { ...node }])),
  }
  for (const edit of draft) {
    if (edit.path.length === 1) {
      const key = edit.path[0] as 'status' | 'note'
      if (edit.to === null) delete next[key]
      else (next as unknown as Record<string, EditValue>)[key] = edit.to
      continue
    }
    const node = next.nodes[edit.path[1] ?? '']
    if (node === undefined) continue
    const field = edit.path[2] as keyof NodeRunState
    if (edit.to === null) delete node[field]
    else (node as unknown as Record<string, EditValue>)[field] = edit.to
  }
  return next
}

/**
 * 把一个步骤改成某个状态（连带的字段一起改，见 `statusFields`）。
 * `base` 是文件里的状态，`now` 是这一刻的时间（ISO 8601）。
 */
export function setNodeStatus(
  draft: readonly StateEdit[],
  base: RunState,
  id: string,
  status: NodeStatus,
  now: string,
): StateEdit[] {
  const current = applyDraft(base, draft).nodes[id]
  if (current === undefined) return [...draft]
  let next = [...draft]
  for (const [field, value] of Object.entries(statusFields(current, status, now))) {
    next = setField(next, base, ['nodes', id, field], value as EditValue)
  }
  return next
}

/**
 * "重跑这一步"：它和它下游已经做过的步骤一起改回 `pending`。
 * `downstream` 由调用方按图算好（含它自己）。
 */
export function rerun(
  draft: readonly StateEdit[],
  base: RunState,
  ids: readonly string[],
  now: string,
): StateEdit[] {
  let next = [...draft]
  const effective = applyDraft(base, draft)
  for (const id of ids) {
    const node = effective.nodes[id]
    if (node === undefined || node.status === 'pending') continue
    next = setNodeStatus(next, base, id, 'pending', now)
  }
  return next
}

/**
 * 文件刷新之后重新对一遍草稿：
 * - 文件里已经是用户要的值（模型也这么改了）→ 这条不用再存，撤掉；
 * - 文件里的值和"改前"对不上 → 冲突；
 * - 其余照旧。
 */
export function rebase(
  draft: readonly StateEdit[],
  disk: RunState,
): { draft: StateEdit[]; conflicts: DraftConflict[] } {
  const kept: StateEdit[] = []
  const conflicts: DraftConflict[] = []
  for (const edit of draft) {
    const now = valueAt(disk, edit.path)
    if (sameValue(now, edit.to)) continue
    kept.push(edit)
    if (!sameValue(now, edit.from)) conflicts.push({ ...edit, disk: now })
  }
  return { draft: kept, conflicts }
}

/** 冲突的两种了结：以我的为准（改前换成文件里的值），或用文件里的（撤掉这条）。 */
export function resolve(
  draft: readonly StateEdit[],
  conflict: DraftConflict,
  keep: 'mine' | 'theirs',
): StateEdit[] {
  if (keep === 'theirs') return draft.filter((edit) => !samePath(edit.path, conflict.path))
  return draft.map((edit) =>
    samePath(edit.path, conflict.path) ? { ...edit, from: conflict.disk } : edit,
  )
}

/** 改了几处：按对象算（整体一处、每个步骤一处），连带改的字段不另算。 */
export function changeCount(draft: readonly StateEdit[]): number {
  return new Set(draft.map((edit) => (edit.path.length === 1 ? '' : (edit.path[1] ?? '')))).size
}

/** 一个步骤在草稿里有没有改动（卡片上挂小圆点）。 */
export function editedNodes(draft: readonly StateEdit[]): Set<string> {
  const set = new Set<string>()
  for (const edit of draft) if (edit.path.length === 3) set.add(edit.path[1] ?? '')
  return set
}

/** 从某个步骤往下（沿步骤之间的线，含回边）能走到的步骤，含它自己。 */
export function downstreamOf(
  edges: readonly { source: string; target: string }[],
  steps: ReadonlySet<string>,
  start: string,
): string[] {
  const seen = new Set<string>([start])
  const queue = [start]
  while (queue.length > 0) {
    const id = queue.shift() as string
    for (const edge of edges) {
      if (edge.source !== id || !steps.has(edge.target) || seen.has(edge.target)) continue
      seen.add(edge.target)
      queue.push(edge.target)
    }
  }
  return [...seen]
}
