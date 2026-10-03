/**
 * dsh-workflow-lite — 资源节点与交接：图上"传了什么"的唯一解释。
 *
 * 两种东西在步骤之间传，性质不同，所以分开表达：
 * - **资源**是独立的东西，不依赖某一次运行——画成**资源节点**，一个资源里可以放好几项（文件、文件夹、
 *   网址、Skill、自定义）。步骤 → 资源 = 写它（写的是其中的文件与文件夹：产出，或在原文件上更新）；
 *   资源 → 步骤 = 读它。几个步骤连到同一个资源，它就是几步之间共用的一份；一条线都没连的资源交给
 *   整个工作流。
 * - **执行结果**是某一次运行的回复——沿**步骤 → 步骤**的线交给下游（缺省就交；可以附一段交接说明，
 *   也可以设成"只管先后"）。
 *
 * 编译器、校验、画布、工具都从这里取解释。纯函数，不碰磁盘、不 import DSH 包。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/resources
 */

import {
  idKey,
  isInput,
  isResource,
  isStep,
  itemShortName,
  makeEdgeId,
  outputSpecs,
  resourceIdFor,
} from './model.ts'
import { outputKey } from './outputPaths.ts'
import {
  type Handoff,
  type OutputSpec,
  RESOURCE_TYPE,
  type ResourceData,
  type ResourceItem,
  type ResourceNode,
  type StepNode,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
  WRITABLE_KINDS,
} from './types.ts'

// ─────────────────────────────────────────────────────────────
// 线的种类
// ─────────────────────────────────────────────────────────────

/**
 * - `flow`：步骤 → 步骤（先后，带条件与交接）；
 * - `write`：步骤 → 资源；`read`：资源 → 步骤；
 * - `ask`：输入 → 步骤（把用户的回答交给它）；
 * - `invalid`：资源 → 资源、连进输入节点、输入连到资源（保存级）；`dangling`：端点不存在。
 */
export type EdgeKind = 'flow' | 'write' | 'read' | 'ask' | 'invalid' | 'dangling'

/** 按 `idKey` 查节点（同 id 重复时取第一个）。 */
export function nodeIndex(document: WorkflowDocument): Map<string, WorkflowNode> {
  const map = new Map<string, WorkflowNode>()
  for (const node of document.nodes) {
    const key = idKey(node.id)
    if (!map.has(key)) map.set(key, node)
  }
  return map
}

export function edgeKind(nodes: ReadonlyMap<string, WorkflowNode>, edge: WorkflowEdge): EdgeKind {
  const source = nodes.get(idKey(edge.source))
  const target = nodes.get(idKey(edge.target))
  if (source === undefined || target === undefined) return 'dangling'
  if (isInput(target)) return 'invalid'
  if (isInput(source)) return isStep(target) ? 'ask' : 'invalid'
  if (isResource(source)) return isResource(target) ? 'invalid' : 'read'
  return isResource(target) ? 'write' : 'flow'
}

/** 只留步骤 → 步骤的线（执行次序、环、批次只看它们）。 */
export function flowEdges(document: WorkflowDocument): WorkflowEdge[] {
  const nodes = nodeIndex(document)
  return document.edges.filter((edge) => edgeKind(nodes, edge) === 'flow')
}

// ─────────────────────────────────────────────────────────────
// 资源里的内容
// ─────────────────────────────────────────────────────────────

/** 这一项步骤能不能写（文件、文件夹）。 */
export function isWritable(item: ResourceItem): boolean {
  return WRITABLE_KINDS.includes(item.kind)
}

/** 资源的称呼：名字；没有名字就用第一项的简称；什么都没有就是 id。 */
export function resourceTitle(resource: ResourceNode): string {
  const label = resource.data.label?.trim()
  if (label !== undefined && label !== '') return label
  const first = resource.data.items[0]
  if (first === undefined || first.value.trim() === '') return resource.id
  return first.kind === 'text' ? resource.id : itemShortName(first)
}

// ─────────────────────────────────────────────────────────────
// 谁在用哪个资源
// ─────────────────────────────────────────────────────────────

export interface ResourceInfo {
  resource: ResourceNode
  /** 写它的步骤（文件中的顺序）；`update` = 在原文件上更新。 */
  writers: { id: string; update: boolean }[]
  /** 读它的步骤。 */
  readers: string[]
}

/** 一个资源有没有连任何步骤：一条线都没有就交给整个工作流。 */
export function isShared(info: ResourceInfo): boolean {
  return info.writers.length === 0 && info.readers.length === 0
}

/** 资源节点 id（规范大小写）→ 写它、读它的步骤。 */
export function resourceGraph(document: WorkflowDocument): Map<string, ResourceInfo> {
  const nodes = nodeIndex(document)
  const graph = new Map<string, ResourceInfo>()
  for (const node of document.nodes) {
    if (isResource(node) && !graph.has(node.id)) {
      graph.set(node.id, { resource: node, writers: [], readers: [] })
    }
  }
  for (const edge of document.edges) {
    const kind = edgeKind(nodes, edge)
    if (kind === 'write') {
      const resource = nodes.get(idKey(edge.target))
      const step = nodes.get(idKey(edge.source))
      const info = resource === undefined ? undefined : graph.get(resource.id)
      if (info === undefined || step === undefined) continue
      if (info.writers.some((writer) => writer.id === step.id)) continue
      info.writers.push({ id: step.id, update: edge.data?.update === true })
    } else if (kind === 'read') {
      const resource = nodes.get(idKey(edge.source))
      const step = nodes.get(idKey(edge.target))
      const info = resource === undefined ? undefined : graph.get(resource.id)
      if (info === undefined || step === undefined || info.readers.includes(step.id)) continue
      info.readers.push(step.id)
    }
  }
  // 在原文件上更新本来就要先读：同一个步骤既写又读，只记成写。
  for (const info of graph.values()) {
    info.readers = info.readers.filter((id) => !info.writers.some((writer) => writer.id === id))
  }
  return graph
}

/** 一个步骤和它连着的资源（不含交给整个工作流的那些）。 */
export interface StepResources {
  writes: { resource: ResourceNode; update: boolean; edge: WorkflowEdge }[]
  reads: { resource: ResourceNode; edge: WorkflowEdge }[]
}

export function stepResources(document: WorkflowDocument, stepId: string): StepResources {
  const nodes = nodeIndex(document)
  const key = idKey(stepId)
  const out: StepResources = { writes: [], reads: [] }
  for (const edge of document.edges) {
    const kind = edgeKind(nodes, edge)
    if (kind === 'write' && idKey(edge.source) === key) {
      const resource = nodes.get(idKey(edge.target))
      if (resource !== undefined && isResource(resource)) {
        out.writes.push({ resource, update: edge.data?.update === true, edge })
      }
    } else if (kind === 'read' && idKey(edge.target) === key) {
      const resource = nodes.get(idKey(edge.source))
      if (resource !== undefined && isResource(resource)) out.reads.push({ resource, edge })
    }
  }
  return out
}

/** 交给整个工作流的资源（一条线都没连的那些），按文件中的顺序。 */
export function sharedResources(document: WorkflowDocument): ResourceNode[] {
  return [...resourceGraph(document).values()].filter(isShared).map((info) => info.resource)
}

/** 某个步骤与某个资源的关系（画布高亮用）；没关系是 `null`。 */
export type ResourceRole = 'producer' | 'updater' | 'reader'

export function roleOf(info: ResourceInfo | undefined, stepId: string): ResourceRole | null {
  if (info === undefined) return null
  const writer = info.writers.find((item) => item.id === stepId)
  if (writer !== undefined) return writer.update ? 'updater' : 'producer'
  return info.readers.includes(stepId) ? 'reader' : null
}

// ─────────────────────────────────────────────────────────────
// 产出（步骤模板里的 `output` ↔ 图上的资源）
// ─────────────────────────────────────────────────────────────

/** 一个步骤写的资源里的文件，摊成产出清单（存成步骤模板时用）。 */
export function outputsOf(document: WorkflowDocument, stepId: string): OutputSpec[] {
  return stepResources(document, stepId).writes.flatMap(({ resource }) =>
    resource.data.items
      .filter((item) => item.kind === 'file')
      .map((item) =>
        item.note === undefined ? { path: item.value } : { path: item.value, rule: item.note },
      ),
  )
}

/** 一个产出文件对应的资源内容：一个文件项，生成规则写进它的说明。 */
export function outputResource(spec: OutputSpec): ResourceData {
  const rule = spec.rule?.trim()
  return {
    items: [
      rule === undefined || rule === ''
        ? { kind: 'file', value: spec.path }
        : { kind: 'file', value: spec.path, note: spec.rule as string },
    ],
  }
}

/** 按路径（规范化后）找放着这个文件的资源；有好几个时优先只放了它一项的。 */
export function resourceByPath(document: WorkflowDocument, path: string): ResourceNode | undefined {
  const key = outputKey(path)
  const holders = document.nodes.filter(
    (node): node is ResourceNode =>
      isResource(node) &&
      node.data.items.some((item) => item.kind === 'file' && outputKey(item.value) === key),
  )
  return holders.find((node) => node.data.items.length === 1) ?? holders[0]
}

/** 新资源节点（`(0,0)` = 还没摆过，由布局补位）。 */
export function newResourceNode(
  document: WorkflowDocument,
  data: ResourceData,
  position: { x: number; y: number } = { x: 0, y: 0 },
): ResourceNode {
  const taken = new Set(document.nodes.map((node) => idKey(node.id)))
  return {
    id: resourceIdFor(data, (candidate) => taken.has(idKey(candidate))),
    type: RESOURCE_TYPE,
    position: { ...position },
    data: { ...data, items: data.items.map((item) => ({ ...item })) },
  }
}

function writeEdge(step: string, resource: string, update: boolean): WorkflowEdge {
  return {
    id: makeEdgeId(step, resource),
    source: step,
    target: resource,
    sourceHandle: null,
    targetHandle: null,
    ...(update ? { data: { update: true as const } } : {}),
  }
}

/**
 * 让一个步骤恰好写这些文件（工具的 `write_node` 与模板展开用）：
 * 路径已有资源就连上它（文件项没写过说明就补上），没有就新建一个只放这个文件的资源；
 * 不在清单里的写入线去掉，去掉之后什么都不连的资源一并删掉。**就地改** `document`。
 * @param positionOf - 新资源节点的坐标（第几个新资源 → 坐标）；缺省 `(0,0)`。
 * @returns 新建的资源节点 id。
 */
export function setStepOutputs(
  document: WorkflowDocument,
  stepId: string,
  specs: readonly OutputSpec[],
  positionOf?: (index: number) => { x: number; y: number },
): string[] {
  const step = document.nodes.find((node) => idKey(node.id) === idKey(stepId))
  if (step === undefined || !isStep(step)) return []
  const created: string[] = []
  const wanted = new Set<string>()
  for (const spec of specs) {
    let resource = resourceByPath(document, spec.path)
    if (resource === undefined) {
      resource = newResourceNode(document, outputResource(spec), positionOf?.(created.length))
      document.nodes = [...document.nodes, resource]
      created.push(resource.id)
    } else if (spec.rule !== undefined && spec.rule.trim() !== '') {
      const key = outputKey(spec.path)
      const current = resource
      const items = current.data.items.map((item) =>
        item.kind === 'file' && outputKey(item.value) === key && item.note !== spec.rule
          ? { ...item, note: spec.rule as string }
          : item,
      )
      if (items.some((item, index) => item !== current.data.items[index])) {
        const replaced: ResourceNode = { ...current, data: { ...current.data, items } }
        document.nodes = document.nodes.map((node) => (node === current ? replaced : node))
        resource = replaced
      }
    }
    const target = resource
    wanted.add(idKey(target.id))
    const id = makeEdgeId(step.id, target.id)
    if (!document.edges.some((edge) => edge.id === id)) {
      // 这个资源已经有别的步骤在写：接着写默认是"在原文件上更新"，不是覆盖。
      const written = document.edges.some(
        (edge) => idKey(edge.target) === idKey(target.id) && idKey(edge.source) !== idKey(step.id),
      )
      document.edges = [...document.edges, writeEdge(step.id, target.id, written)]
    }
  }
  const nodes = nodeIndex(document)
  const dropped = document.edges.filter(
    (edge) =>
      edgeKind(nodes, edge) === 'write' &&
      idKey(edge.source) === idKey(step.id) &&
      !wanted.has(idKey(edge.target)),
  )
  if (dropped.length > 0) {
    const gone = new Set(dropped.map((edge) => edge.id))
    document.edges = document.edges.filter((edge) => !gone.has(edge.id))
    const orphans = new Set(
      dropped
        .map((edge) => idKey(edge.target))
        .filter(
          (key) =>
            !document.edges.some(
              (edge) => idKey(edge.source) === key || idKey(edge.target) === key,
            ),
        ),
    )
    document.nodes = document.nodes.filter((node) => !orphans.has(idKey(node.id)))
  }
  return created
}

/** 把模板里的产出清单（`data.output`）挑出来，剩下的是步骤自己的 `data`。 */
export function splitOutputs(data: StepNode['data']): {
  data: StepNode['data']
  outputs: OutputSpec[]
} {
  const { output, ...rest } = data
  return { data: rest, outputs: outputSpecs(output) }
}

// ─────────────────────────────────────────────────────────────
// 交接（步骤 → 步骤）
// ─────────────────────────────────────────────────────────────

/** 一条步骤间的线实际交了什么。 */
export interface ResolvedHandoff {
  /** 交不交上游的执行结果。 */
  result: boolean
  note?: string
}

export function resolveHandoff(handoff: Handoff | false | undefined): ResolvedHandoff {
  if (handoff === false) return { result: false }
  const note = handoff?.note.trim()
  return note === undefined || note === '' ? { result: true } : { result: true, note }
}
