/**
 * dsh-workflow-lite — 实例的图改了以后，运行状态跟着对齐的几处。
 *
 * - 新加的步骤补一项 `pending`；删掉的步骤（只能是没执行过的）去掉；
 * - 用户指定的下一步里去掉图里没有了的；
 * - 不再有条件出边的步骤去掉判定（还有条件出边、只是取值变了的不动，留给校验指出来，让用户重新选）；
 * - 身份字段 `plan` 换成新图的 planId。
 *
 * 插件保存时把这些落到 YAML 上（保留注释），画布拿它预览改完的样子、提前挑出保存不了的问题。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/runSync
 */

import type { RunGraphFacts, RunState } from './runState.ts'

/** 一处对齐：`to` 为 `null` = 删掉这个字段。 */
export interface SyncOp {
  path: string[]
  to: unknown
}

/** 步骤执行过没有（状态不是 pending，或流水里有它）：执行过的不能从图里删。 */
export function hasHistory(state: RunState, id: string): boolean {
  const node = state.nodes[id]
  if (node !== undefined && node.status !== 'pending') return true
  return state.log.some((entry) => entry.node === id)
}

/** 状态要怎么改才和新图对得上。`plan` 给了就连身份字段一起换。 */
export function syncOps(state: RunState, facts: RunGraphFacts, plan?: string): SyncOp[] {
  const ops: SyncOp[] = []
  if (plan !== undefined && plan !== state.plan) ops.push({ path: ['plan'], to: plan })
  for (const id of facts.steps) {
    if (state.nodes[id] === undefined) ops.push({ path: ['nodes', id], to: { status: 'pending' } })
  }
  for (const [id, node] of Object.entries(state.nodes)) {
    if (!facts.steps.includes(id)) {
      ops.push({ path: ['nodes', id], to: null })
      continue
    }
    if (node.verdict !== undefined && facts.verdicts[id] === undefined) {
      ops.push({ path: ['nodes', id, 'verdict'], to: null })
    }
  }
  if (state.next !== undefined) {
    const kept = state.next.filter((id) => facts.steps.includes(id))
    if (kept.length !== state.next.length)
      ops.push({ path: ['next'], to: kept.length === 0 ? null : kept })
  }
  return ops
}

/** 把对齐叠到状态上（画布预览用；不改入参）。 */
export function applySync(state: RunState, ops: readonly SyncOp[]): RunState {
  if (ops.length === 0) return state
  const next = structuredClone(state) as unknown as Record<string, unknown>
  for (const op of ops) {
    const parents = op.path.slice(0, -1)
    const key = op.path[op.path.length - 1] ?? ''
    let cursor = next
    for (const part of parents) {
      const child = cursor[part]
      if (typeof child !== 'object' || child === null) {
        cursor = {}
        break
      }
      cursor = child as Record<string, unknown>
    }
    if (op.to === null) delete cursor[key]
    else cursor[key] = structuredClone(op.to)
  }
  return next as unknown as RunState
}
