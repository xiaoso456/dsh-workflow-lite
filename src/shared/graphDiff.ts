/**
 * dsh-workflow-lite — 两版图之间改了什么。
 *
 * 实例视图里改图时，底部的「已改 x 处」按它数；保存时插件按它写给模型的通知。
 * 按对象比：步骤、资源、输入按 id；连线先按 id，对不上再按两端认（改条件会换 id）。
 * 挪卡片合成一处「布局」：不进计划，也不用告诉模型。
 *
 * 纯函数，不碰磁盘。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/graphDiff
 */

import {
  canonicalHandoff,
  canonicalInput,
  canonicalResource,
  idKey,
  isInput,
  isResource,
} from './model.ts'
import { resourceTitle } from './resources.ts'
import type { WorkflowDocument, WorkflowEdge, WorkflowNode } from './types.ts'

export type ChangeObject = 'step' | 'resource' | 'input' | 'edge' | 'layout'

export interface GraphChange {
  object: ChangeObject
  kind: 'added' | 'removed' | 'changed'
  /** 节点 id 或连线 id（删掉的是原来的 id，其余是现在的）；布局是空串。 */
  id: string
  /** 改了的连线原来的 id（改条件会换 id）。 */
  was?: string
  /** 改了哪些字段（`changed` 才有）；布局是挪动了的节点 id。 */
  fields: string[]
}

/** 不进计划的字段：只改了这些，模型那边什么都不用变。 */
const COSMETIC: Record<Exclude<ChangeObject, 'layout'>, readonly string[]> = {
  step: ['description', 'look'],
  resource: ['description'],
  input: ['placeholder', 'hint'],
  edge: ['label'],
}

/** 这处改动会不会让计划变样（要不要告诉模型）。 */
export function affectsPlan(change: GraphChange): boolean {
  if (change.object === 'layout') return false
  if (change.kind !== 'changed') return true
  const cosmetic = COSMETIC[change.object]
  return change.fields.some((field) => !cosmetic.includes(field))
}

function objectOf(node: WorkflowNode): Exclude<ChangeObject, 'edge' | 'layout'> {
  if (isResource(node)) return 'resource'
  if (isInput(node)) return 'input'
  return 'step'
}

const same = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const text = (value: string | undefined): string => value?.trim() ?? ''

/** 同一个节点两版之间改了哪些字段。 */
function nodeFields(before: WorkflowNode, after: WorkflowNode): string[] {
  if (isResource(before) && isResource(after)) {
    const a = canonicalResource(before.data)
    const b = canonicalResource(after.data)
    return [
      ...(text(a.label) === text(b.label) ? [] : ['label']),
      ...(text(a.description) === text(b.description) ? [] : ['description']),
      ...(same(a.items, b.items) ? [] : ['items']),
    ]
  }
  if (isInput(before) && isInput(after)) {
    const a = canonicalInput(before.data) as unknown as Record<string, unknown>
    const b = canonicalInput(after.data) as unknown as Record<string, unknown>
    return ['question', 'kind', 'options', 'default', 'placeholder', 'hint', 'required'].filter(
      (key) => !same(a[key], b[key]),
    )
  }
  if (isResource(before) || isInput(before) || isResource(after) || isInput(after)) return []
  const a = before.data
  const b = after.data
  return [
    ...(text(a.label) === text(b.label) ? [] : ['label']),
    ...(text(a.description) === text(b.description) ? [] : ['description']),
    ...(a.icon === b.icon && a.color === b.color ? [] : ['look']),
    ...((a.prompt ?? '') === (b.prompt ?? '') ? [] : ['prompt']),
  ]
}

function edgeFields(before: WorkflowEdge, after: WorkflowEdge): string[] {
  const a = before.data ?? {}
  const b = after.data ?? {}
  return [
    ...(text(a.when) === text(b.when) ? [] : ['when']),
    ...(same(canonicalHandoff(a.handoff), canonicalHandoff(b.handoff)) ? [] : ['handoff']),
    ...((a.update === true) === (b.update === true) ? [] : ['update']),
    ...(text(a.label) === text(b.label) ? [] : ['label']),
  ]
}

const ends = (edge: WorkflowEdge): string => `${idKey(edge.source)}->${idKey(edge.target)}`

/** `base` → `next` 改了什么：节点按图里的顺序在前（删掉的排在最前），连线其次，布局最后。 */
export function graphChanges(base: WorkflowDocument, next: WorkflowDocument): GraphChange[] {
  const changes: GraphChange[] = []
  const before = new Map(base.nodes.map((node) => [idKey(node.id), node]))
  const after = new Map(next.nodes.map((node) => [idKey(node.id), node]))
  const moved: string[] = []

  for (const node of base.nodes) {
    if (!after.has(idKey(node.id))) {
      changes.push({ object: objectOf(node), kind: 'removed', id: node.id, fields: [] })
    }
  }
  for (const node of next.nodes) {
    const old = before.get(idKey(node.id))
    if (old === undefined) {
      changes.push({ object: objectOf(node), kind: 'added', id: node.id, fields: [] })
      continue
    }
    const fields = nodeFields(old, node)
    if (fields.length > 0)
      changes.push({ object: objectOf(node), kind: 'changed', id: node.id, fields })
    if (old.position.x !== node.position.x || old.position.y !== node.position.y)
      moved.push(node.id)
  }

  // 连线：同 id 的直接比；剩下的按两端配对（改条件换了 id），再剩下的才是删掉 / 新加的。
  const oldEdges = new Map(base.edges.map((edge) => [edge.id, edge]))
  const unmatchedOld = base.edges.filter((edge) => !next.edges.some((e) => e.id === edge.id))
  const removed: WorkflowEdge[] = []
  const pairs = new Map<string, WorkflowEdge[]>()
  for (const edge of unmatchedOld) pairs.set(ends(edge), [...(pairs.get(ends(edge)) ?? []), edge])
  const edgeChanges: GraphChange[] = []
  for (const edge of next.edges) {
    const old = oldEdges.get(edge.id)
    if (old !== undefined) {
      const fields = edgeFields(old, edge)
      if (fields.length > 0)
        edgeChanges.push({ object: 'edge', kind: 'changed', id: edge.id, fields })
      continue
    }
    const candidates = pairs.get(ends(edge)) ?? []
    const partner = candidates.shift()
    if (partner === undefined) {
      edgeChanges.push({ object: 'edge', kind: 'added', id: edge.id, fields: [] })
      continue
    }
    edgeChanges.push({
      object: 'edge',
      kind: 'changed',
      id: edge.id,
      was: partner.id,
      fields: edgeFields(partner, edge),
    })
  }
  for (const list of pairs.values()) removed.push(...list)
  // 跟着节点一起删掉 / 加上的线不另算：删一个步骤就是一处。
  const gone = (id: string): boolean => !after.has(idKey(id))
  const fresh = (id: string): boolean => !before.has(idKey(id))
  for (const edge of removed) {
    if (gone(edge.source) || gone(edge.target)) continue
    changes.push({ object: 'edge', kind: 'removed', id: edge.id, fields: [] })
  }
  for (const change of edgeChanges) {
    const edge = next.edges.find((candidate) => candidate.id === change.id)
    if (change.kind === 'added' && edge !== undefined && (fresh(edge.source) || fresh(edge.target)))
      continue
    changes.push(change)
  }
  if (moved.length > 0) changes.push({ object: 'layout', kind: 'changed', id: '', fields: moved })
  return changes
}

// ─────────────────────────────────────────────────────────────
// 写给模型的说明
// ─────────────────────────────────────────────────────────────

const FIELD_TEXT: Record<string, string> = {
  label: '名称',
  description: '描述',
  look: '图标与颜色',
  prompt: '提示词',
  items: '内容',
  question: '问题',
  kind: '题型',
  options: '选项',
  default: '默认值',
  placeholder: '占位',
  hint: '说明',
  required: '必填',
  when: '条件',
  handoff: '交接',
  update: '写入方式',
}

const OBJECT_TEXT: Record<Exclude<ChangeObject, 'layout'>, string> = {
  step: '步骤',
  resource: '资源',
  input: '输入',
  edge: '连线',
}

function nodeName(doc: WorkflowDocument, id: string): string {
  const node = doc.nodes.find((candidate) => idKey(candidate.id) === idKey(id))
  if (node === undefined) return id
  if (isResource(node))
    return resourceTitle(node) === node.id ? node.id : `${node.id}（${resourceTitle(node)}）`
  if (isInput(node)) return node.id
  const label = text(node.data.label)
  return label === '' || label === node.id ? node.id : `${node.id}（${label}）`
}

function edgeName(edge: WorkflowEdge | undefined, id: string): string {
  if (edge === undefined) return id
  const when = text(edge.data?.when)
  return `${edge.source} → ${edge.target}${when === '' ? '' : `（条件 ${when}）`}`
}

/** 一处改动写成一行（不带前面的「- 」），比如「步骤 review（审查）：改了提示词、名称」。 */
export function describeGraphChange(
  change: GraphChange,
  base: WorkflowDocument,
  next: WorkflowDocument,
): string {
  if (change.object === 'layout') return `布局：挪动了 ${change.fields.length} 张卡片`
  const kind = OBJECT_TEXT[change.object]
  if (change.object === 'edge') {
    const now = next.edges.find((edge) => edge.id === change.id)
    const old = base.edges.find((edge) => edge.id === (change.was ?? change.id))
    if (change.kind === 'added') return `新加连线 ${edgeName(now, change.id)}`
    if (change.kind === 'removed') return `删掉了连线 ${edgeName(old, change.id)}`
    const fields = change.fields.map((field) => FIELD_TEXT[field] ?? field).join('、')
    return `连线 ${edgeName(now, change.id)}：改了${fields}`
  }
  if (change.kind === 'added') return `新加${kind} ${nodeName(next, change.id)}`
  if (change.kind === 'removed') return `删掉了${kind} ${nodeName(base, change.id)}`
  const fields = change.fields.map((field) => FIELD_TEXT[field] ?? field).join('、')
  return `${kind} ${nodeName(next, change.id)}：改了${fields}`
}
