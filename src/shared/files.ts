/**
 * dsh-workflow-lite — 文件节点与交接：图上"传了什么"的唯一解释。
 *
 * 两种东西在步骤之间传，性质不同，所以分开表达：
 * - **文件**是独立的东西，不依赖某一次运行——画成**文件节点**。步骤 → 文件 = 写它（产出，或在原文件上
 *   更新）；文件 → 步骤 = 读它。几个步骤连到同一个文件节点，它就是几步之间共用的一份。
 * - **执行结果**是某一次运行的回复——沿**步骤 → 步骤**的线交给下游（缺省就交；可以附一段交接说明，
 *   也可以设成"只管先后"）。
 *
 * 编译器、校验、画布、工具都从这里取解释。纯函数，不碰磁盘、不 import DSH 包。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/files
 */

import { fileIdFor, idKey, isFile, isStep, makeEdgeId, outputSpecs } from './model.ts'
import { outputKey } from './outputPaths.ts'
import {
  FILE_TYPE,
  type FileNode,
  type Handoff,
  type OutputSpec,
  type StepNode,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
} from './types.ts'

// ─────────────────────────────────────────────────────────────
// 线的种类
// ─────────────────────────────────────────────────────────────

/**
 * - `flow`：步骤 → 步骤（先后，带条件与交接）；
 * - `write`：步骤 → 文件；`read`：文件 → 步骤；
 * - `invalid`：文件 → 文件（保存级）；`dangling`：端点不存在。
 */
export type EdgeKind = 'flow' | 'write' | 'read' | 'invalid' | 'dangling'

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
  if (isFile(source)) return isFile(target) ? 'invalid' : 'read'
  return isFile(target) ? 'write' : 'flow'
}

/** 只留步骤 → 步骤的线（执行次序、环、批次只看它们）。 */
export function flowEdges(document: WorkflowDocument): WorkflowEdge[] {
  const nodes = nodeIndex(document)
  return document.edges.filter((edge) => edgeKind(nodes, edge) === 'flow')
}

// ─────────────────────────────────────────────────────────────
// 谁在用哪份文件
// ─────────────────────────────────────────────────────────────

export interface FileInfo {
  file: FileNode
  /** 写它的步骤（文件中的顺序）；`update` = 在原文件上更新。 */
  writers: { id: string; update: boolean }[]
  /** 读它的步骤。 */
  readers: string[]
}

/** 文件节点 id（规范大小写）→ 写它、读它的步骤。 */
export function fileGraph(document: WorkflowDocument): Map<string, FileInfo> {
  const nodes = nodeIndex(document)
  const graph = new Map<string, FileInfo>()
  for (const node of document.nodes) {
    if (isFile(node) && !graph.has(node.id)) {
      graph.set(node.id, { file: node, writers: [], readers: [] })
    }
  }
  for (const edge of document.edges) {
    const kind = edgeKind(nodes, edge)
    if (kind === 'write') {
      const file = nodes.get(idKey(edge.target))
      const step = nodes.get(idKey(edge.source))
      const info = file === undefined ? undefined : graph.get(file.id)
      if (info === undefined || step === undefined) continue
      if (info.writers.some((writer) => writer.id === step.id)) continue
      info.writers.push({ id: step.id, update: edge.data?.update === true })
    } else if (kind === 'read') {
      const file = nodes.get(idKey(edge.source))
      const step = nodes.get(idKey(edge.target))
      const info = file === undefined ? undefined : graph.get(file.id)
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

/** 一个步骤和它连着的文件。 */
export interface StepFiles {
  writes: { file: FileNode; update: boolean; edge: WorkflowEdge }[]
  reads: { file: FileNode; edge: WorkflowEdge }[]
}

export function stepFiles(document: WorkflowDocument, stepId: string): StepFiles {
  const nodes = nodeIndex(document)
  const key = idKey(stepId)
  const out: StepFiles = { writes: [], reads: [] }
  for (const edge of document.edges) {
    const kind = edgeKind(nodes, edge)
    if (kind === 'write' && idKey(edge.source) === key) {
      const file = nodes.get(idKey(edge.target))
      if (file !== undefined && isFile(file)) {
        out.writes.push({ file, update: edge.data?.update === true, edge })
      }
    } else if (kind === 'read' && idKey(edge.target) === key) {
      const file = nodes.get(idKey(edge.source))
      if (file !== undefined && isFile(file)) out.reads.push({ file, edge })
    }
  }
  return out
}

/** 某个步骤与某份文件的关系（画布高亮用）；没关系是 `null`。 */
export type FileRole = 'producer' | 'updater' | 'reader'

export function roleOf(info: FileInfo | undefined, stepId: string): FileRole | null {
  if (info === undefined) return null
  const writer = info.writers.find((item) => item.id === stepId)
  if (writer !== undefined) return writer.update ? 'updater' : 'producer'
  return info.readers.includes(stepId) ? 'reader' : null
}

/** 一个步骤写的文件，摊成产出清单（存成步骤模板时用）。 */
export function outputsOf(document: WorkflowDocument, stepId: string): OutputSpec[] {
  return stepFiles(document, stepId).writes.map(({ file }) =>
    file.data.rule === undefined
      ? { path: file.data.path }
      : { path: file.data.path, rule: file.data.rule },
  )
}

/** 按路径（规范化后）找文件节点。 */
export function fileByPath(document: WorkflowDocument, path: string): FileNode | undefined {
  const key = outputKey(path)
  return document.nodes.find(
    (node): node is FileNode => isFile(node) && outputKey(node.data.path) === key,
  )
}

/** 新文件节点（`(0,0)` = 还没摆过，由布局补位）。 */
export function newFileNode(
  document: WorkflowDocument,
  spec: OutputSpec,
  position: { x: number; y: number } = { x: 0, y: 0 },
): FileNode {
  const taken = new Set(document.nodes.map((node) => idKey(node.id)))
  return {
    id: fileIdFor(spec.path, (candidate) => taken.has(idKey(candidate))),
    type: FILE_TYPE,
    position: { ...position },
    data:
      spec.rule === undefined || spec.rule.trim() === ''
        ? { path: spec.path }
        : { path: spec.path, rule: spec.rule },
  }
}

function writeEdge(step: string, file: string, update: boolean): WorkflowEdge {
  return {
    id: makeEdgeId(step, file),
    source: step,
    target: file,
    sourceHandle: null,
    targetHandle: null,
    ...(update ? { data: { update: true as const } } : {}),
  }
}

/**
 * 让一个步骤恰好写这些文件（工具的 `write_node` 与模板展开用）：
 * 路径已有文件节点就连上它（规则没写过就补上），没有就新建；不在清单里的写入线去掉，
 * 去掉之后什么都不连的文件节点一并删掉。**就地改** `document`。
 * @param positionOf - 新文件节点的坐标（第几个新文件 → 坐标）；缺省 `(0,0)`。
 * @returns 新建的文件节点 id。
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
    let file = fileByPath(document, spec.path)
    if (file === undefined) {
      file = newFileNode(document, spec, positionOf?.(created.length))
      document.nodes = [...document.nodes, file]
      created.push(file.id)
    } else if (spec.rule !== undefined && spec.rule.trim() !== '' && file.data.rule !== spec.rule) {
      const replaced: FileNode = { ...file, data: { ...file.data, rule: spec.rule } }
      document.nodes = document.nodes.map((node) => (node === file ? replaced : node))
      file = replaced
    }
    wanted.add(idKey(file.id))
    const id = makeEdgeId(step.id, file.id)
    if (!document.edges.some((edge) => edge.id === id)) {
      // 这份文件已经有别的步骤在写：接着写默认是"在原文件上更新"，不是覆盖。
      const written = document.edges.some(
        (edge) => idKey(edge.target) === idKey(file.id) && idKey(edge.source) !== idKey(step.id),
      )
      document.edges = [...document.edges, writeEdge(step.id, file.id, written)]
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
