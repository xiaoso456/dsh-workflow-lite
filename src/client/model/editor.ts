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

import { pickAppearance } from '../../shared/appearance.ts'
import {
  canonicalHandoff,
  canonicalInput,
  canonicalOutput,
  cloneInputData,
  cloneResourceData,
  idKey,
  isInput,
  isResource,
  isStep,
  makeEdgeId,
  normalizeCoord,
  readSettings,
  sameHandoff,
  sameNodeData,
  sameSettings,
} from '../../shared/model.ts'
import { outputKey } from '../../shared/outputPaths.ts'
import { newResourceNode, setStepOutputs, splitOutputs } from '../../shared/resources.ts'
import {
  type EdgeData,
  type Handoff,
  INPUT_TYPE,
  type InputData,
  type InputNode,
  NODE_TYPE,
  type NodeData,
  type Point,
  type ResourceData,
  type StepNode,
  type ValidationProblem,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowSettings,
} from '../../shared/types.ts'
import { inputSpot, resourceSpot } from './layout.ts'

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
  /**
   * 每压一条新的撤销步 +1（撤销、重做、合并进上一步都不算），换基线也不归零。
   * 撤销栈到了上限时长度不再变，靠它才看得出"又多了一步"（实例视图把图和状态的撤销排成一条时用）。
   */
  historySeq: number
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
  historySeq: 0,
  loadSeq: 0,
}

/** 会改文档的动作。 */
export type Edit =
  | {
      type: 'addNode'
      id: string
      /** 步骤的 `data`；带着 `output`（来自模板）时展开成挂在它右下方的资源节点。 */
      data: NodeData
      position: Point
      /** 顺手从这个节点连一条线过来（「添加下一步」；从资源拖出来 = 新步骤读这个资源）。 */
      from?: string
    }
  /**
   * 加一个资源节点。给了 `writer` 就连「步骤 → 资源」（写），给了 `reader` 就连「资源 → 步骤」（读）。
   * 没给坐标时挂在写它（读它）的步骤右下方。`select` = 加完选中它（缺省不动选中）。
   */
  | {
      type: 'addResource'
      data: ResourceData
      position?: Point
      writer?: string
      reader?: string
      select?: boolean
    }
  /**
   * 加一个输入节点。给了 `reader` 就连「输入 → 步骤」（把回答交给它）；没给坐标时放在它左边。
   * 加完选中它（好接着写问题）。
   */
  | { type: 'addInput'; id: string; data: InputData; position?: Point; reader?: string }
  /** 改输入节点（值为 `undefined` 的键 = 清掉这一项）。`merge` 同 `patchNode`。 */
  | { type: 'patchInput'; id: string; patch: Partial<InputData>; merge?: string }
  /** 一次加进一小片图（示例流程）：算一条撤销步。`settings` 并进工作流设置（同一步）。 */
  | {
      type: 'addGraph'
      settings?: WorkflowSettings
      nodes: WorkflowNode[]
      edges: {
        source: string
        target: string
        when?: string
        handoff?: Handoff | false
        update?: boolean
      }[]
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
  /** 改资源节点：名字 / 描述 / 内容（值为 `undefined` 的键 = 清掉；`items` 整份替换）。 */
  | { type: 'patchResource'; id: string; patch: Partial<ResourceData>; merge?: string }
  | { type: 'connect'; source: string; target: string; when?: string }
  | { type: 'removeEdge'; id: string }
  /** 改条件。`merge` 相同的连续改动并成一条撤销步（在自定义条件里连续打字）。 */
  | { type: 'setWhen'; id: string; when: string | undefined; merge?: string }
  /**
   * 改交接（步骤 → 步骤）。`undefined` = 交执行结果，`false` = 只管先后，对象 = 交执行结果并附说明。
   * `merge` 相同的连续改动并成一条撤销步（在交接说明里连续打字）。
   */
  | { type: 'setHandoff'; id: string; handoff: Handoff | false | undefined; merge?: string }
  /** 改写入方式（步骤 → 资源）：整份写出 / 在原文件上更新。 */
  | { type: 'setUpdate'; id: string; update: boolean }
  /** 视口是视图状态：照样落盘，但不进撤销栈。 */
  /** 换掉整份工作流设置（设置对话框「完成」时一次交出来 = 一条撤销步）。 */
  | { type: 'setSettings'; settings: WorkflowSettings | undefined }
  /** 整张换掉（实例视图撤回某一处改动时用）；选中的东西不在了就放掉。 */
  | { type: 'replaceDoc'; doc: WorkflowDocument }

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
  /** 丢掉重做栈（实例视图里别处有了新的一步：撤销排成一条，新的一步之后都不能重做）。 */
  | { type: 'dropFuture' }
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

function newEdge(
  source: string,
  target: string,
  when: string | undefined,
  extra: { handoff?: Handoff | false | undefined; update?: boolean | undefined } = {},
): WorkflowEdge {
  const data = {
    ...(when === undefined || when === '' ? {} : { when }),
    ...(extra.handoff === undefined ? {} : { handoff: extra.handoff }),
    ...(extra.update === true ? { update: true as const } : {}),
  }
  return {
    id: makeEdgeId(source, target, when),
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(Object.keys(data).length === 0 ? {} : { data }),
  }
}

/** 路径被占了就在文件名后面加 `-2`、`-3`…（`taken` 里是规范化、小写后的路径）。 */
function freePath(path: string, taken: ReadonlySet<string>): string {
  if (!taken.has(outputKey(path).toLowerCase())) return path
  const dot = path.lastIndexOf('.')
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const cut = dot > slash + 1 ? dot : path.length
  for (let n = 2; ; n += 1) {
    const candidate = `${path.slice(0, cut)}-${n}${path.slice(cut)}`
    if (!taken.has(outputKey(candidate).toLowerCase())) return candidate
  }
}

/** 这个资源已经有步骤在写（`except` 除外）——再接上来的写入默认是"在原文件上更新"。 */
export function alreadyWritten(
  doc: WorkflowDocument,
  resourceId: string,
  except?: string,
): boolean {
  return doc.edges.some(
    (edge) =>
      idKey(edge.target) === idKey(resourceId) &&
      (except === undefined || idKey(edge.source) !== idKey(except)),
  )
}

/** 图里资源已经用掉的文件路径（规范化、小写后）。 */
export function takenPaths(doc: WorkflowDocument): string[] {
  return doc.nodes.flatMap((node) =>
    isResource(node)
      ? node.data.items
          .filter((item) => item.kind === 'file')
          .map((item) => outputKey(item.value).toLowerCase())
      : [],
  )
}

/** 换掉一条边的 `data`（空了就整键不留）。 */
function withEdgeData(edge: WorkflowEdge, data: EdgeData): WorkflowEdge {
  const { data: _old, ...rest } = edge
  return Object.keys(data).length === 0 ? rest : { ...rest, data }
}

function at(position: Point): Point {
  return { x: normalizeCoord(position.x), y: normalizeCoord(position.y) }
}

function newNode(id: string, data: NodeData, position: Point): StepNode {
  return { id, type: NODE_TYPE, position: at(position), data }
}

/** 新步骤的 `data`：没带图标与颜色就挑图里用得最少的（尽量不和已有的步骤重样）。 */
function withLook(doc: WorkflowDocument, id: string, data: NodeData): NodeData {
  const look = pickAppearance(doc.nodes, data, id)
  return { ...data, icon: look.icon, color: look.color }
}

function applyEdit(doc: WorkflowDocument, selection: Selection, edit: Edit): Applied | null {
  switch (edit.type) {
    case 'addNode': {
      const id = uniqueNodeId(doc, edit.id)
      const source = edit.from === undefined ? undefined : findNode(doc, edit.from)
      const { data, outputs } = splitOutputs(edit.data)
      const next: WorkflowDocument = {
        ...doc,
        nodes: [...doc.nodes, newNode(id, withLook(doc, id, data), edit.position)],
        edges: source === undefined ? doc.edges : [...doc.edges, newEdge(source.id, id, undefined)],
      }
      // 模板里的产出：各成一个**新的**资源（路径被占了就加序号），挂在新步骤右下方，连上写入线。
      // 要和已有的资源共用一份，在画布上把线连过去就是了。
      if (outputs.length > 0) {
        const taken = new Set(takenPaths(doc))
        const fresh = outputs.map((spec) => {
          const path = freePath(spec.path, taken)
          taken.add(outputKey(path).toLowerCase())
          return { ...spec, path }
        })
        setStepOutputs(next, id, fresh, () => resourceSpot(next, edit.position))
      }
      // 新步骤接管选中：加完接着就是改它。
      return { doc: next, selection: { kind: 'node', id } }
    }

    case 'addResource': {
      const writer = edit.writer === undefined ? undefined : findNode(doc, edit.writer)
      const reader = edit.reader === undefined ? undefined : findNode(doc, edit.reader)
      const anchor = writer ?? reader
      const resource = newResourceNode(
        doc,
        edit.data,
        at(edit.position ?? resourceSpot(doc, anchor?.position)),
      )
      const edges = [...doc.edges]
      if (writer !== undefined && isStep(writer)) {
        edges.push(newEdge(writer.id, resource.id, undefined))
      }
      if (reader !== undefined && isStep(reader)) {
        edges.push(newEdge(resource.id, reader.id, undefined))
      }
      return {
        doc: { ...doc, nodes: [...doc.nodes, resource], edges },
        selection: edit.select === true ? { kind: 'node', id: resource.id } : selection,
      }
    }

    case 'addInput': {
      const id = uniqueNodeId(doc, edit.id)
      const reader = edit.reader === undefined ? undefined : findNode(doc, edit.reader)
      const step = reader !== undefined && isStep(reader) ? reader : undefined
      const node: InputNode = {
        id,
        type: INPUT_TYPE,
        position: at(edit.position ?? inputSpot(doc, step?.position)),
        data: canonicalInput(edit.data),
      }
      return {
        doc: {
          ...doc,
          nodes: [...doc.nodes, node],
          edges: step === undefined ? doc.edges : [...doc.edges, newEdge(id, step.id, undefined)],
        },
        selection: { kind: 'node', id },
      }
    }

    case 'patchInput': {
      const node = findNode(doc, edit.id)
      if (node === undefined || !isInput(node)) return null
      const merged: Record<string, unknown> = { ...node.data, ...edit.patch }
      for (const [key, value] of Object.entries(edit.patch)) {
        if (value === undefined) delete merged[key]
      }
      // 不在这里规范化：正在打的选项里的空格、刚加的空选项都要留着。写盘时（canonical writer）
      // 与用到它的地方（执行对话框、计划）才按题型取形。
      const data = merged as unknown as InputData
      if (JSON.stringify(data) === JSON.stringify(node.data)) return null
      return {
        doc: {
          ...doc,
          nodes: doc.nodes.map((candidate) => (candidate === node ? { ...node, data } : candidate)),
        },
        selection,
      }
    }

    case 'addGraph': {
      // 调用方给的 id 可能与图里已有的撞名：逐个改名，并把边的两端跟着换过去。
      const renamed = new Map<string, string>()
      let next = doc
      for (const node of edit.nodes) {
        const id = uniqueNodeId(next, node.id)
        renamed.set(node.id, id)
        const added: WorkflowNode = isInput(node)
          ? { ...node, id, position: at(node.position), data: cloneInputData(node.data) }
          : isResource(node)
            ? { ...node, id, position: at(node.position), data: cloneResourceData(node.data) }
            : newNode(id, node.data, node.position)
        next = { ...next, nodes: [...next.nodes, added] }
      }
      const edges = [...next.edges]
      for (const edge of edit.edges) {
        const source = renamed.get(edge.source)
        const target = renamed.get(edge.target)
        if (source === undefined || target === undefined) continue
        edges.push(newEdge(source, target, edge.when, edge))
      }
      if (renamed.size === 0) return null
      const { settings: _old, ...rest } = next
      const settings =
        edit.settings === undefined
          ? doc.settings
          : readSettings({ ...doc.settings, ...edit.settings })
      return {
        doc: settings === undefined ? { ...rest, edges } : { ...rest, edges, settings },
        selection: null,
      }
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
      if (node === undefined || !isStep(node)) return null
      const data: NodeData = { ...node.data, ...edit.patch }
      for (const key of ['label', 'description', 'icon', 'color', 'prompt', 'output'] as const) {
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

    case 'patchResource': {
      const node = findNode(doc, edit.id)
      if (node === undefined || !isResource(node)) return null
      const merged: Record<string, unknown> = { ...node.data, ...edit.patch }
      for (const [key, value] of Object.entries(edit.patch)) {
        if (value === undefined && key !== 'items') delete merged[key]
      }
      // 不在这里规范化：正在打的空项、名字里的空格都要留着；写盘时（canonical writer）再取形。
      const data = { ...merged, items: (merged.items as ResourceData['items'] | undefined) ?? [] }
      if (JSON.stringify(data) === JSON.stringify(node.data)) return null
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
      // 资源不能直接连资源、不能连进输入、输入只连步骤；连着资源或输入的线没有条件。
      if (isResource(source) && isResource(target)) return null
      if (isInput(target) || (isInput(source) && !isStep(target))) return null
      const toResource = isResource(target)
      const plain = isResource(source) || isInput(source) || toResource
      const edge = newEdge(source.id, target.id, plain ? undefined : edit.when, {
        update: toResource && alreadyWritten(doc, target.id, source.id),
      })
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
      // 标签与交接跟着搬到新边上，只换条件。
      const { when: _old, ...kept } = edge.data ?? {}
      const replaced = withEdgeData({ ...edge, id }, when === undefined ? kept : { when, ...kept })
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

    case 'setHandoff': {
      const edge = findEdge(doc, edit.id)
      if (edge === undefined) return null
      const handoff = canonicalHandoff(edit.handoff)
      if (sameHandoff(edge.data?.handoff, handoff)) return null
      const { handoff: _old, ...rest } = edge.data ?? {}
      const replaced = withEdgeData(edge, handoff === undefined ? rest : { ...rest, handoff })
      return {
        doc: {
          ...doc,
          edges: doc.edges.map((candidate) => (candidate === edge ? replaced : candidate)),
        },
        selection,
      }
    }

    case 'setUpdate': {
      const edge = findEdge(doc, edit.id)
      if (edge === undefined || (edge.data?.update === true) === edit.update) return null
      const { update: _old, ...rest } = edge.data ?? {}
      const replaced = withEdgeData(edge, edit.update ? { ...rest, update: true } : rest)
      return {
        doc: {
          ...doc,
          edges: doc.edges.map((candidate) => (candidate === edge ? replaced : candidate)),
        },
        selection,
      }
    }

    case 'replaceDoc':
      return edit.doc === doc
        ? null
        : { doc: edit.doc, selection: keepSelection(edit.doc, selection) }

    case 'setSettings': {
      // 走一遍和写盘同一份的规范化：根目录标准化、缺省值不留。
      const settings = readSettings(edit.settings)
      if (sameSettings(doc.settings, settings)) return null
      const { settings: _old, ...rest } = doc
      return { doc: settings === undefined ? rest : { ...rest, settings }, selection }
    }
  }
}

function isEdit(action: Action): action is Edit {
  switch (action.type) {
    case 'addNode':
    case 'addResource':
    case 'patchResource':
    case 'addInput':
    case 'patchInput':
    case 'setUpdate':
    case 'addGraph':
    case 'removeNode':
    case 'moveNodes':
    case 'patchNode':
    case 'connect':
    case 'removeEdge':
    case 'setWhen':
    case 'setHandoff':
    case 'setSettings':
    case 'replaceDoc':
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
): Pick<EditorState, 'past' | 'future' | 'mergeKey' | 'historySeq'> {
  const seq = state.historySeq
  // 不进历史：程序自动补位。它也不打断正在进行的合并链。
  if (edit.type === 'moveNodes' && edit.silent === true) {
    return { past: state.past, future: state.future, mergeKey: state.mergeKey, historySeq: seq }
  }
  const key =
    edit.type === 'patchNode' ||
    edit.type === 'patchResource' ||
    edit.type === 'patchInput' ||
    edit.type === 'setWhen' ||
    edit.type === 'setHandoff'
      ? (edit.merge ?? null)
      : null
  // 同一个合并键：栈顶已经是这次交互开始之前的快照，不再压。
  if (key !== null && key === state.mergeKey) {
    return { past: state.past, future: [], mergeKey: key, historySeq: seq }
  }
  return { past: pushPast(state.past, before), future: [], mergeKey: key, historySeq: seq + 1 }
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
      return {
        ...initialState,
        phase: 'loading',
        name: action.name,
        loadSeq: state.loadSeq,
        historySeq: state.historySeq,
      }

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
        historySeq: state.historySeq,
      }

    case 'broken':
      return {
        ...initialState,
        phase: 'broken',
        name: action.name,
        problems: action.problems,
        broken: { message: action.message, raw: action.raw },
        loadSeq: state.loadSeq,
        historySeq: state.historySeq,
      }

    case 'closed':
      return { ...initialState, loadSeq: state.loadSeq, historySeq: state.historySeq }

    case 'renamed':
      return state.name === null ? state : { ...state, name: action.name }

    case 'select': {
      if (state.doc === null) return state
      const selection = keepSelection(state.doc, action.selection)
      const same =
        selection?.kind === state.selection?.kind && selection?.id === state.selection?.id
      return same ? state : { ...state, selection }
    }

    case 'dropFuture':
      return state.future.length === 0 ? state : { ...state, future: [] }

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
