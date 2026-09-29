/**
 * dsh-workflow-lite — 字段级合并（文件级冲突，字段级合并）。
 *
 * 合并单位 = **`node.id` 与 `edge.id`**（大小写不敏感，与图内身份一致）。只有两种情况算冲突：
 * 1. **同一个 node 的 `data` 双方都改过**（各改成不一样的）；
 * 2. **同一个 `id` 一方删、一方改**。
 *
 * 两边改的是不同节点 / 边 ⇒ **自动合并、不报冲突**——"改 A 节点不会因为 B 节点被改而冲突"。
 * `viewport` 与 `position` 是纯视图态，**本地优先、永不冲突**（坐标与 viewport 都存盘，
 * 但它们不承载语义，没道理为"谁最后拖的"打断作者）。
 *
 * 冲突时输出文档以**本地为准**（"保留我的"）；调用方若要"用磁盘的"，直接重新加载就是了。
 * 纯函数：不碰磁盘、不改入参、不 import DSH 包。
 * @module @xiaoso/dsh-workflow-lite/host/store/merge
 */

import { idKey } from '../../shared/model.ts'
import type {
  NodeData,
  Point,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from '../../shared/types.ts'

export interface MergeResult {
  document: WorkflowDocument
  /** 冲突的 `node.id` / `edge.id`（按出现顺序，已去重）。 */
  conflictIds: string[]
}

/**
 * 把「本地要写回的 `mine`」与「此刻磁盘上的 `theirs`」按 `base`（加载时的基线）合并。
 */
export function mergeDocuments(
  base: WorkflowDocument,
  mine: WorkflowDocument,
  theirs: WorkflowDocument,
): MergeResult {
  const conflicts = new Set<string>()
  const document: WorkflowDocument = {
    nodes: mergeNodes(base, mine, theirs, conflicts),
    edges: mergeEdges(base, mine, theirs, conflicts),
    // 纯视图态：本地优先。
    viewport: { ...mine.viewport },
  }
  return { document, conflictIds: [...conflicts] }
}

// ─────────────────────────────────────────────────────────────
// 节点
// ─────────────────────────────────────────────────────────────

function mergeNodes(
  base: WorkflowDocument,
  mine: WorkflowDocument,
  theirs: WorkflowDocument,
  conflicts: Set<string>,
): WorkflowNode[] {
  const baseById = indexNodes(base.nodes)
  const theirsById = indexNodes(theirs.nodes)
  const out: WorkflowNode[] = []
  const seen = new Set<string>()

  for (const local of mine.nodes) {
    const key = idKey(local.id)
    if (seen.has(key)) continue
    seen.add(key)
    const other = theirsById.get(key)
    const origin = baseById.get(key)

    if (other === undefined) {
      // 磁盘上没有这个 id：本地新增，或对方删了。
      if (origin === undefined) {
        out.push(local)
        continue
      }
      if (sameNodeData(origin, local)) continue // 对方删、本地没动 ⇒ 采纳删除
      conflicts.add(local.id) // 一方删、一方改
      out.push(local) // 本地优先
      continue
    }

    if (origin === undefined) {
      // 双方各自新增了同一个 id。
      if (!sameNodeData(local, other)) conflicts.add(local.id)
      out.push(local)
      continue
    }

    const localChanged = !sameNodeData(origin, local)
    const otherChanged = !sameNodeData(origin, other)
    if (localChanged && otherChanged && !sameNodeData(local, other)) {
      conflicts.add(local.id)
      out.push({ ...local, position: pickPosition(origin, other, local) })
      continue
    }
    const winner = otherChanged && !localChanged ? other : local
    out.push({ ...winner, position: pickPosition(origin, other, local) })
  }

  // 磁盘上独有的 id：对方新增（采纳），或本地删了它。
  for (const other of theirs.nodes) {
    const key = idKey(other.id)
    if (seen.has(key)) continue
    seen.add(key)
    const origin = baseById.get(key)
    if (origin === undefined) {
      out.push(other)
      continue
    }
    if (sameNodeData(origin, other)) continue // 双方都删 ⇒ 无
    conflicts.add(other.id) // 本地删、对方改 ⇒ 冲突；本地优先 ⇒ 保持删除
  }

  return out
}

/** 坐标是视图态：谁动过就用谁的（都动过则本地优先），**不报冲突**。 */
function pickPosition(origin: WorkflowNode, other: WorkflowNode, local: WorkflowNode): Point {
  if (!samePosition(origin.position, local.position)) return { ...local.position }
  if (!samePosition(origin.position, other.position)) return { ...other.position }
  return { ...local.position }
}

function indexNodes(nodes: readonly WorkflowNode[]): Map<string, WorkflowNode> {
  const map = new Map<string, WorkflowNode>()
  for (const node of nodes) {
    const key = idKey(node.id)
    if (!map.has(key)) map.set(key, node)
  }
  return map
}

/** 冲突判据只看 `data` 三个字段（`label` / `prompt` / `output`），缺省与缺省相等。 */
function sameNodeData(a: WorkflowNode, b: WorkflowNode): boolean {
  const left: NodeData = a.data
  const right: NodeData = b.data
  return left.label === right.label && left.prompt === right.prompt && left.output === right.output
}

function samePosition(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

// ─────────────────────────────────────────────────────────────
// 边
// ─────────────────────────────────────────────────────────────

function mergeEdges(
  base: WorkflowDocument,
  mine: WorkflowDocument,
  theirs: WorkflowDocument,
  conflicts: Set<string>,
): WorkflowEdge[] {
  const baseById = indexEdges(base.edges)
  const theirsById = indexEdges(theirs.edges)
  const out: WorkflowEdge[] = []
  const seen = new Set<string>()

  for (const local of mine.edges) {
    const key = idKey(local.id)
    if (seen.has(key)) continue
    seen.add(key)
    const other = theirsById.get(key)
    const origin = baseById.get(key)

    if (other === undefined) {
      if (origin === undefined) {
        out.push(local)
        continue
      }
      if (sameEdge(origin, local)) continue
      conflicts.add(local.id)
      out.push(local)
      continue
    }

    if (origin === undefined) {
      if (!sameEdge(local, other)) conflicts.add(local.id)
      out.push(local)
      continue
    }

    const localChanged = !sameEdge(origin, local)
    const otherChanged = !sameEdge(origin, other)
    if (localChanged && otherChanged && !sameEdge(local, other)) {
      conflicts.add(local.id)
      out.push(local)
      continue
    }
    out.push(otherChanged && !localChanged ? other : local)
  }

  for (const other of theirs.edges) {
    const key = idKey(other.id)
    if (seen.has(key)) continue
    seen.add(key)
    const origin = baseById.get(key)
    if (origin === undefined) {
      out.push(other)
      continue
    }
    if (sameEdge(origin, other)) continue
    conflicts.add(other.id)
  }

  return out
}

function indexEdges(edges: readonly WorkflowEdge[]): Map<string, WorkflowEdge> {
  const map = new Map<string, WorkflowEdge>()
  for (const edge of edges) {
    const key = idKey(edge.id)
    if (!map.has(key)) map.set(key, edge)
  }
  return map
}

/** 边的"内容"＝端点 + `data` 两字段；边没有独立的视图态。 */
function sameEdge(a: WorkflowEdge, b: WorkflowEdge): boolean {
  return (
    a.source === b.source &&
    a.target === b.target &&
    a.data?.when === b.data?.when &&
    a.data?.label === b.data?.label
  )
}
