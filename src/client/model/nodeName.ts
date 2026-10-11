/**
 * dsh-workflow-lite — 节点怎么称呼：提示条里点名用，复制出来的副本起名用。纯函数，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/nodeName
 */

import { isInput, isResource } from '../../shared/model.ts'
import { resourceTitle } from '../../shared/resources.ts'
import type { WorkflowDocument, WorkflowNode } from '../../shared/types.ts'

/** 点名的字数上限：问题、提示词摘要可以很长，提示条放不下。 */
const NAME_MAX = 28

/** 节点的称呼：步骤 = 显示名（没有就是 id）；资源 = 名字或第一项的简称；输入 = 问题（没写就是 id）。 */
export function nodeTitle(node: WorkflowNode): string {
  const raw = isResource(node)
    ? resourceTitle(node)
    : isInput(node)
      ? node.data.question.trim() || node.id
      : node.data.label?.trim() || node.id
  const flat = raw.replace(/\s+/gu, ' ')
  return flat.length > NAME_MAX ? `${flat.slice(0, NAME_MAX - 1)}…` : flat
}

/** 复制出来的副本叫什么：原名后面接「副本」，已有就依次「副本 2」「副本 3」…（`taken` = 图里已有的名字）。 */
export function copyTitle(label: string, suffix: string, taken: ReadonlySet<string>): string {
  const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const base = label.replace(new RegExp(`\\s+${escaped}(?:\\s+\\d+)?$`, 'u'), '')
  const first = `${base} ${suffix}`
  if (!taken.has(first)) return first
  for (let n = 2; ; n += 1) {
    const candidate = `${first} ${n}`
    if (!taken.has(candidate)) return candidate
  }
}

/** 图里节点已用的显示名（步骤、资源的 `label`），给 {@link copyTitle} 避重。 */
export function takenLabels(doc: WorkflowDocument): Set<string> {
  const names = new Set<string>()
  for (const node of doc.nodes) {
    if (isInput(node)) continue
    const label = node.data.label?.trim()
    if (label !== undefined && label !== '') names.add(label)
  }
  return names
}
