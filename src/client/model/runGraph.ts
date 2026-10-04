/**
 * dsh-workflow-lite — 实例视图里改图：单独撤回一处改动、哪些步骤不能删。
 *
 * 「已改 x 处」的清单按 `shared/graphDiff.ts` 数；这里把清单里的一行还原成改之前的样子
 * （其余改动不动），交给编辑器整张换上（进撤销历史）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/runGraph
 */

import type { GraphChange } from '../../shared/graphDiff.ts'
import { idKey } from '../../shared/model.ts'
import type { RunState } from '../../shared/runState.ts'
import { hasHistory } from '../../shared/runSync.ts'
import type { WorkflowDocument, WorkflowEdge } from '../../shared/types.ts'

const touches = (edge: WorkflowEdge, key: string): boolean =>
  idKey(edge.source) === key || idKey(edge.target) === key

/** 把 `doc` 里的这一处改动还原成 `base` 里的样子。 */
export function revertChange(
  base: WorkflowDocument,
  doc: WorkflowDocument,
  change: GraphChange,
): WorkflowDocument {
  if (change.object === 'layout') {
    const moved = new Set(change.fields.map(idKey))
    return {
      ...doc,
      nodes: doc.nodes.map((node) => {
        const old = base.nodes.find((candidate) => idKey(candidate.id) === idKey(node.id))
        return old === undefined || !moved.has(idKey(node.id))
          ? node
          : { ...node, position: old.position }
      }),
    }
  }
  if (change.object === 'edge') {
    if (change.kind === 'added') {
      return { ...doc, edges: doc.edges.filter((edge) => edge.id !== change.id) }
    }
    const old = base.edges.find((edge) => edge.id === (change.was ?? change.id))
    if (old === undefined) return doc
    if (change.kind === 'removed') {
      const has = (id: string): boolean => doc.nodes.some((node) => idKey(node.id) === idKey(id))
      if (!has(old.source) || !has(old.target)) return doc
      return { ...doc, edges: [...doc.edges, old] }
    }
    return { ...doc, edges: doc.edges.map((edge) => (edge.id === change.id ? old : edge)) }
  }
  const key = idKey(change.id)
  if (change.kind === 'added') {
    return {
      ...doc,
      nodes: doc.nodes.filter((node) => idKey(node.id) !== key),
      edges: doc.edges.filter((edge) => !touches(edge, key)),
    }
  }
  const old = base.nodes.find((node) => idKey(node.id) === key)
  if (old === undefined) return doc
  if (change.kind === 'removed') {
    // 连它的线一起放回来（另一头还在的那些）。
    const present = new Set([...doc.nodes.map((node) => idKey(node.id)), key])
    const edges = base.edges.filter(
      (edge) =>
        touches(edge, key) &&
        present.has(idKey(edge.source)) &&
        present.has(idKey(edge.target)) &&
        !doc.edges.some((candidate) => candidate.id === edge.id),
    )
    return { ...doc, nodes: [...doc.nodes, old], edges: [...doc.edges, ...edges] }
  }
  return {
    ...doc,
    nodes: doc.nodes.map((node) =>
      idKey(node.id) === key ? ({ ...node, data: old.data } as typeof node) : node,
    ),
  }
}

/** 删不得的步骤：执行过的（状态不是待执行，或流水里有它）。不记状态的实例没有限制。 */
export function lockedSteps(state: RunState | null): (id: string) => boolean {
  return (id) => state !== null && hasHistory(state, id)
}
