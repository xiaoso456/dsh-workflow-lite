/**
 * dsh-workflow-lite — 编辑器状态机（**纯逻辑**，组件只管接线）。
 *
 * 事实源是磁盘上的那份 JSON。三个计数讲清"有没有没落盘的改动"：
 * - `rev`       每次改文档 +1（撤销/重做也算——它们同样需要落盘）；
 * - `savedRev`  磁盘上已知持有的那一版；
 * - `savingRev` 在途那笔保存对应的版本。
 * `rev !== savedRev` 即为脏。保存期间又来的改动不会被误判成已落盘，因为保存成功只把
 * `savedRev` 推到 `savingRev`，而不是推到最新。
 *
 * 节点身份一律按 `idKey`（大小写不敏感）比较；`label` 只用于显示。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/editor
 */

import {
  canonicalOutput,
  idKey,
  makeEdgeId,
  normalizeCoord,
  sameNodeData,
} from '../../shared/model.ts'
import {
  NODE_TYPE,
  type NodeData,
  type Point,
  type ValidationProblem,
  type Viewport,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../shared/types.ts'

/** 选中态：步骤、连线，或什么都不选。用一个联合表达，互斥是结构上保证的。 */
export type Selection = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null

/** `idle` 没打开任何工作流；`broken` 文件读不了（只读，绝不写盘）。 */
export type Phase = 'idle' | 'loading' | 'ready' | 'broken'

export interface EditorState {
  phase: Phase
  name: string | null
  doc: WorkflowDocument | null
  /** 本地文档所基于的磁盘内容哈希（保存时提交它做写前比对）。 */
  baseHash: string | null
  /** host 给的全部校验问题（四级）。 */
  problems: ValidationProblem[]
  /** `broken` 态的说明与原文。 */
  broken: { message: string; raw: string | null } | null
  selection: Selection
  rev: number
  savedRev: number
  saving: boolean
  savingRev: number
  saveError: string | null
  /** 撤销栈：每个元素是"那次改动之前"的文档。 */
  past: WorkflowDocument[]
  future: WorkflowDocument[]
  /** 当前历史条目的合并键；相同键的连续改动并成一条撤销步。 */
  mergeKey: string | null
  /** 每载入一份新基线 +1：画布据此重新定视口（保存不算，免得每存一次都跳一下）。 */
  loadSeq: number
}

/** 撤销栈上限。 */
export const HISTORY_LIMIT = 60

export const initialState: EditorState = {
  phase: 'idle',
  name: null,
  doc: null,
  baseHash: null,
  problems: [],
  broken: null,
  selection: null,
  rev: 0,
  savedRev: 0,
  saving: false,
  savingRev: 0,
  saveError: null,
  past: [],
  future: [],
  mergeKey: null,
  loadSeq: 0,
}

/** 会改文档的动作。 */
export type Edit =
  | {
      type: 'addNode'
      id: string
      data: NodeData
      position: Point
      /** 顺手从这个步骤连一条线过来（「添加下一步」）。 */
      from?: string
    }
  /** 一次加进一小片图（示例流程）：算一条撤销步。 */
  | {
      type: 'addGraph'
      nodes: WorkflowNode[]
      edges: { source: string; target: string; when?: string }[]
    }
  | { type: 'removeNode'; id: string }
  /**
   * 改坐标。`silent` = 程序自动补位：照样落盘，但不进撤销栈
   * （`Ctrl+Z` 撤出一个"节点全叠在原点"的版本不是任何人想要的）。
   */
  | { type: 'moveNodes'; positions: Record<string, Point>; silent?: boolean }
  /**
   * 改步骤的 `data`。值为 `undefined` 的键表示**清掉这一项**。
   * `merge` 相同的连续改动并成一条撤销步（连续打字）。
   */
  | { type: 'patchNode'; id: string; patch: Partial<NodeData>; merge?: string }
  | { type: 'connect'; source: string; target: string; when?: string }
  | { type: 'removeEdge'; id: string }
  /** 改条件。`merge` 相同的连续改动并成一条撤销步（在自定义条件里连续打字）。 */
  | { type: 'setWhen'; id: string; when: string | undefined; merge?: string }
  /** 视口是视图状态：照样落盘，但不进撤销栈。 */
  | { type: 'setViewport'; viewport: Viewport }

export type Action =
  | Edit
  | { type: 'loading'; name: string }
  | {
      type: 'loaded'
      name: string
      doc: WorkflowDocument
      baseHash: string
      problems: ValidationProblem[]
    }
  | {
      type: 'broken'
      name: string
      message: string
      raw: string | null
      problems: ValidationProblem[]
    }
  | { type: 'closed' }
  | { type: 'renamed'; name: string }
  | { type: 'select'; selection: Selection }
  | { type: 'undo' }
  | { type: 'redo' }
  /** 一次交互结束（输入失焦）：断开历史合并。 */
  | { type: 'seal' }
  | { type: 'saveStarted'; rev: number }
  | { type: 'saveDone'; baseHash: string }
  | { type: 'saveFailed'; message: string }
  /**
   * 回读磁盘后的刷新。带 `doc` = 本地没有在途改动，整份换成磁盘上（合并后）的版本；
   * `external` = 这份来自外部改动而不是自己的保存，旧历史作废。
   */
  | {
      type: 'refreshed'
      problems: ValidationProblem[]
      doc?: WorkflowDocument
      baseHash?: string
      external?: boolean
    }

// ─────────────────────────────────────────────────────────────
// 读
// ─────────────────────────────────────────────────────────────

export function isDirty(state: EditorState): boolean {
  return state.rev !== state.savedRev
}

export function findNode(doc: WorkflowDocument, id: string): WorkflowNode | undefined {
  const key = idKey(id)
  return doc.nodes.find((node) => idKey(node.id) === key)
}

export function findEdge(doc: WorkflowDocument, id: string): WorkflowEdge | undefined {
  return doc.edges.find((edge) => edge.id === id)
}

/** 一条边的条件值（空串与缺省同义）。 */
export function whenOf(edge: WorkflowEdge): string | undefined {
  const when = edge.data?.when
  return when === undefined || when === '' ? undefined : when
}

/** 新步骤的 id：撞名就加 `-2`、`-3`…（**绝不静默覆盖**）。 */
export function uniqueNodeId(doc: WorkflowDocument, base: string): string {
  if (findNode(doc, base) === undefined) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`
    if (findNode(doc, candidate) === undefined) return candidate
  }
}

/** 选中的东西在这份文档里还在不在；不在就放掉。 */
function keepSelection(doc: WorkflowDocument, selection: Selection): Selection {
  if (selection === null) return null
  if (selection.kind === 'node') return findNode(doc, selection.id) === undefined ? null : selection
  return findEdge(doc, selection.id) === undefined ? null : selection
}

// ─────────────────────────────────────────────────────────────
// 改文档（纯函数；返回 `null` = 这次动作什么都没改）
// ─────────────────────────────────────────────────────────────

interface Applied {
  doc: WorkflowDocument
  selection: Selection
}

function newEdge(source: string, target: string, when: string | undefined): WorkflowEdge {
  return {
    id: makeEdgeId(source, target, when),
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(when === undefined || when === '' ? {} : { data: { when } }),
  }
}

function newNode(id: string, data: NodeData, position: Point): WorkflowNode {
  return {
    id,
    type: NODE_TYPE,
    position: { x: normalizeCoord(position.x), y: normalizeCoord(position.y) },
    data,
  }
}

function applyEdit(doc: WorkflowDocument, selection: Selection, edit: Edit): Applied | null {
  switch (edit.type) {
    case 'addNode': {
      const id = uniqueNodeId(doc, edit.id)
      const source = edit.from === undefined ? undefined : findNode(doc, edit.from)
      return {
        doc: {
          ...doc,
          nodes: [...doc.nodes, newNode(id, edit.data, edit.position)],
          edges:
            source === undefined ? doc.edges : [...doc.edges, newEdge(source.id, id, undefined)],
        },
        // 新步骤接管选中：加完接着就是改它。
        selection: { kind: 'node', id },
      }
    }

    case 'addGraph': {
      // 调用方给的 id 可能与图里已有的撞名：逐个改名，并把边的两端跟着换过去。
      const renamed = new Map<string, string>()
      let next = doc
      for (const node of edit.nodes) {
        const id = uniqueNodeId(next, node.id)
        renamed.set(node.id, id)
        next = { ...next, nodes: [...next.nodes, newNode(id, node.data, node.position)] }
      }
      const edges = [...next.edges]
      for (const edge of edit.edges) {
        const source = renamed.get(edge.source)
        const target = renamed.get(edge.target)
        if (source === undefined || target === undefined) continue
        edges.push(newEdge(source, target, edge.when))
      }
      if (renamed.size === 0) return null
      return { doc: { ...next, edges }, selection: null }
    }

    case 'removeNode': {
      const node = findNode(doc, edit.id)
      if (node === undefined) return null
      const key = idKey(node.id)
      // 连带删掉以它为端点的边——不然会留下悬空边（保存级问题）。
      const next = {
        ...doc,
        nodes: doc.nodes.filter((candidate) => candidate !== node),
        edges: doc.edges.filter((edge) => idKey(edge.source) !== key && idKey(edge.target) !== key),
      }
      return { doc: next, selection: keepSelection(next, selection) }
    }

    case 'moveNodes': {
      let touched = false
      const nodes = doc.nodes.map((node) => {
        const target = edit.positions[node.id]
        if (target === undefined) return node
        const x = normalizeCoord(target.x)
        const y = normalizeCoord(target.y)
        if (node.position.x === x && node.position.y === y) return node
        touched = true
        return { ...node, position: { x, y } }
      })
      return touched ? { doc: { ...doc, nodes }, selection } : null
    }

    case 'patchNode': {
      const node = findNode(doc, edit.id)
      if (node === undefined) return null
      const data: NodeData = { ...node.data, ...edit.patch }
      for (const key of ['label', 'description', 'prompt', 'output'] as const) {
        if (key in edit.patch && edit.patch[key] === undefined) delete data[key]
      }
      if ('output' in edit.patch) {
        const output = canonicalOutput(data.output)
        if (output === undefined) delete data.output
        else data.output = output
      }
      if (sameNodeData(data, node.data)) return null
      return {
        doc: {
          ...doc,
          nodes: doc.nodes.map((candidate) => (candidate === node ? { ...node, data } : candidate)),
        },
        selection,
      }
    }

    case 'connect': {
      const source = findNode(doc, edit.source)
      const target = findNode(doc, edit.target)
      if (source === undefined || target === undefined) return null
      const edge = newEdge(source.id, target.id, edit.when)
      if (findEdge(doc, edge.id) !== undefined) return null
      return {
        doc: { ...doc, edges: [...doc.edges, edge] },
        selection: { kind: 'edge', id: edge.id },
      }
    }

    case 'removeEdge': {
      if (findEdge(doc, edit.id) === undefined) return null
      const next = { ...doc, edges: doc.edges.filter((edge) => edge.id !== edit.id) }
      return { doc: next, selection: keepSelection(next, selection) }
    }

    case 'setWhen': {
      const edge = findEdge(doc, edit.id)
      if (edge === undefined) return null
      const when = edit.when === '' ? undefined : edit.when
      if (whenOf(edge) === when) return null
      // `when` 是边 id 的一部分：改它等于换一条边。目标 id 已被占用就不动（不造重复边）。
      const id = makeEdgeId(edge.source, edge.target, when)
      if (findEdge(doc, id) !== undefined) return null
      const label = edge.data?.label
      const data = {
        ...(when === undefined ? {} : { when }),
        ...(label === undefined ? {} : { label }),
      }
      const replaced: WorkflowEdge = {
        id,
        source: edge.source,
        target: edge.target,
        sourceHandle: null,
        targetHandle: null,
        ...(Object.keys(data).length === 0 ? {} : { data }),
      }
      return {
        doc: {
          ...doc,
          edges: doc.edges.map((candidate) => (candidate === edge ? replaced : candidate)),
        },
        // 选中跟着搬到新 id 上，否则正在编辑的那条线会从面板里消失。
        selection:
          selection?.kind === 'edge' && selection.id === edge.id ? { kind: 'edge', id } : selection,
      }
    }

    case 'setViewport': {
      const current = doc.viewport
      const { x, y, zoom } = edit.viewport
      if (current.x === x && current.y === y && current.zoom === zoom) return null
      return { doc: { ...doc, viewport: { x, y, zoom } }, selection }
    }
  }
}

function isEdit(action: Action): action is Edit {
  switch (action.type) {
    case 'addNode':
    case 'addGraph':
    case 'removeNode':
    case 'moveNodes':
    case 'patchNode':
    case 'connect':
    case 'removeEdge':
    case 'setWhen':
    case 'setViewport':
      return true
    default:
      return false
  }
}

function pushPast(past: WorkflowDocument[], doc: WorkflowDocument): WorkflowDocument[] {
  const next = [...past, doc]
  return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next
}

/** 这次改动怎么进历史。 */
function historyAfter(
  state: EditorState,
  before: WorkflowDocument,
  edit: Edit,
): Pick<EditorState, 'past' | 'future' | 'mergeKey'> {
  // 不进历史的两种：视口、程序自动补位。它们也不打断正在进行的合并链。
  if (edit.type === 'setViewport' || (edit.type === 'moveNodes' && edit.silent === true)) {
    return { past: state.past, future: state.future, mergeKey: state.mergeKey }
  }
  const key = edit.type === 'patchNode' || edit.type === 'setWhen' ? (edit.merge ?? null) : null
  // 同一个合并键：栈顶已经是这次交互开始之前的快照，不再压。
  if (key !== null && key === state.mergeKey) {
    return { past: state.past, future: [], mergeKey: key }
  }
  return { past: pushPast(state.past, before), future: [], mergeKey: key }
}

// ─────────────────────────────────────────────────────────────
// 状态机
// ─────────────────────────────────────────────────────────────

export function reduce(state: EditorState, action: Action): EditorState {
  if (isEdit(action)) {
    if (state.phase !== 'ready' || state.doc === null) return state
    const applied = applyEdit(state.doc, state.selection, action)
    if (applied === null) return state
    return {
      ...state,
      doc: applied.doc,
      selection: applied.selection,
      rev: state.rev + 1,
      ...historyAfter(state, state.doc, action),
    }
  }

  switch (action.type) {
    case 'loading':
      return { ...initialState, phase: 'loading', name: action.name, loadSeq: state.loadSeq }

    case 'loaded':
      // 新基线：计数与历史都从头开始（旧历史属于上一份文档）。
      return {
        ...initialState,
        phase: 'ready',
        name: action.name,
        doc: action.doc,
        baseHash: action.baseHash,
        problems: action.problems,
        loadSeq: state.loadSeq + 1,
      }

    case 'broken':
      return {
        ...initialState,
        phase: 'broken',
        name: action.name,
        problems: action.problems,
        broken: { message: action.message, raw: action.raw },
        loadSeq: state.loadSeq,
      }

    case 'closed':
      return { ...initialState, loadSeq: state.loadSeq }

    case 'renamed':
      return state.name === null ? state : { ...state, name: action.name }

    case 'select': {
      if (state.doc === null) return state
      const selection = keepSelection(state.doc, action.selection)
      const same =
        selection?.kind === state.selection?.kind && selection?.id === state.selection?.id
      return same ? state : { ...state, selection }
    }

    case 'seal':
      return state.mergeKey === null ? state : { ...state, mergeKey: null }

    case 'undo': {
      const previous = state.past.at(-1)
      if (state.doc === null || previous === undefined) return state
      return {
        ...state,
        doc: previous,
        selection: keepSelection(previous, state.selection),
        past: state.past.slice(0, -1),
        future: [state.doc, ...state.future],
        mergeKey: null,
        rev: state.rev + 1,
      }
    }

    case 'redo': {
      const next = state.future[0]
      if (state.doc === null || next === undefined) return state
      return {
        ...state,
        doc: next,
        selection: keepSelection(next, state.selection),
        past: pushPast(state.past, state.doc),
        future: state.future.slice(1),
        mergeKey: null,
        rev: state.rev + 1,
      }
    }

    case 'saveStarted':
      return { ...state, saving: true, savingRev: action.rev }

    case 'saveDone':
      return {
        ...state,
        saving: false,
        savedRev: state.savingRev,
        baseHash: action.baseHash,
        saveError: null,
      }

    case 'saveFailed':
      return { ...state, saving: false, saveError: action.message }

    case 'refreshed': {
      if (action.doc === undefined) return { ...state, problems: action.problems }
      return {
        ...state,
        doc: action.doc,
        baseHash: action.baseHash ?? state.baseHash,
        problems: action.problems,
        selection: keepSelection(action.doc, state.selection),
        ...(action.external === true ? { past: [], future: [], mergeKey: null } : {}),
      }
    }
  }
}
