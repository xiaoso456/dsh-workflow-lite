/**
 * dsh-workflow-lite — 画布状态机（**纯逻辑**，组件只管接线）。
 *
 * 事实源是磁盘上的那份 JSON：`baseHash` 是"我改之前磁盘长什么样"，
 * `dirty` 是"本地还有没落盘的改动"。保存成功后 `baseHash` 换成本次写回的哈希。
 *
 * 全篇的序一律按 **`id` 码位序**；节点定位一律用 `id`，`label` 只用于显示。
 *
 * @module @xiaoso/dsh-workflow-lite/client/core/state
 */

import { byId } from '../../shared/graph.ts'
import { idKey, normalizeCoord } from '../../shared/model.ts'
import type {
  ExecutionBatch,
  NodeData,
  Point,
  ToolWarning,
  ValidationProblem,
  Viewport,
  WorkflowDocument,
  WorkflowEdge,
} from '../../shared/types.ts'

export type SyncStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'dirty' | 'error'

export interface CanvasState {
  /** 当前打开的图名；null = 还没打开任何图。 */
  name: string | null
  /** 规范化后的图；null = 未加载或加载失败。 */
  document: WorkflowDocument | null
  /** 加载时磁盘上的内容哈希（保存时提交它做写前比对）。 */
  baseHash: string | null
  /** 本地还有未落盘的改动。 */
  dirty: boolean
  status: SyncStatus
  /** 上一个失败的人话说明（成功时清空）。 */
  error: string | null
  /** 选中的节点 id。 */
  selected: string | null
  /**
   * 选中的**边** id（`<source>-><target>[#when]`）。
   *
   * 与 `selected`（节点）**互斥**：同时只能有一个非空。这条不变式靠 `select` 动作与
   * `applyDocumentChange` 里那几处收尾共同维持——任何一处漏了，右栏就会同时想渲染
   * 节点属性与边编辑区。选中态由**画布**发起（点节点 / 点边 / 点空白），右栏只反映。
   */
  selectedEdge: string | null
  /** 加载时 host 给的**全部四级问题**——校验面板的数据源。 */
  problems: ValidationProblem[]
  /** 同源的警告与提示（`problems` 里 `warning` / `hint` 那两级的线格式副本）。 */
  warnings: ToolWarning[]
  /** 保存级破损时的**原始文本**，只读错误态展示用。 */
  raw: string | null
  /** 只读错误态：图不可加载（保存级破损 / 已被删或改名）。**此态下一律不写盘。** */
  blocked: boolean
  /** 文档改动的单调计数。用来回答"这次保存开始之后，又有人改过吗"。 */
  editSeq: number
  /** 最近一次保存**开始**时对应的 `editSeq`（由 `saveStarted` 显式带上，不靠时序猜）。 */
  savingSeq: number
  /** 撤销栈：每个元素是"那次改动**之前**"的文档快照。最多 `HISTORY_LIMIT` 条。 */
  past: WorkflowDocument[]
  /** 重做栈。任何新改动都会清空它（分叉之后旧的重做路径就不该还能走）。 */
  future: WorkflowDocument[]
  /**
   * 当前历史条目对应的**合并键**；`null` = 下一条改动要新开一条。
   *
   * 它的用途只有一个：把"一次交互"压成一条撤销步。拖动一个节点会连着发几十个
   * `moveNode`（每帧一个），在提示词里打一句话会连着发几十个 `setNodeData`。
   * 不合并的话，撤销键要按几十次才退得回上一步——那不叫撤销。
   */
  historyKey: string | null
}

/** 撤销栈上限。取 50：够退回一次像样的编辑会话，又不至于把整张图的几十份快照常驻内存。 */
export const HISTORY_LIMIT = 50

/** 复制节点时的落点偏移（右下 24px），让人一眼看出这是刚复制出来的。 */
export const DUPLICATE_OFFSET = 24

/**
 * 自动布局的栅格：列宽 260、行高 140。
 *
 * 抽成常量是因为**两处**都要用同一套几何：`placeNodes`（按批次摆位）与
 * `avoidOverlap`（给"点一下加节点"找空位）。两处各写一份数字，迟早会漂。
 */
export const LAYOUT_COLUMN_W = 260
export const LAYOUT_ROW_H = 140
/** 栅格原点（左上角第一个格子的坐标）。 */
export const LAYOUT_ORIGIN: Point = { x: 120, y: 80 }

/**
 * 自动布局一行放几列（排满一行就换行）。
 *
 * **必须折行**：列 = 执行批次序，而一条 24 个节点的长链有 24 个批次——不折行就是
 * 24 列 1 行、单排 5980 单位宽，任何画布都装不下（视口缩到 0.1 仍然只是一条横线，
 * 节点卡小到读不出字）。按 6 列折行之后同一张图是 6 列 4 行，比例接近普通屏幕，
 * 缩放后卡片的可读性也就回来了。
 *
 * 6 是"一张卡够宽（260px 列距）又不至于把视口撑成一个竖条"的折中：再小会让纵向太长。
 */
export const LAYOUT_COLUMNS = 6

export const initialCanvasState: CanvasState = {
  name: null,
  document: null,
  baseHash: null,
  dirty: false,
  status: 'idle',
  error: null,
  selected: null,
  selectedEdge: null,
  problems: [],
  warnings: [],
  raw: null,
  blocked: false,
  editSeq: 0,
  savingSeq: 0,
  past: [],
  future: [],
  historyKey: null,
}

export type CanvasAction =
  | { type: 'loadStarted' }
  | {
      type: 'loaded'
      name: string
      document: WorkflowDocument
      baseHash: string
      problems: ValidationProblem[]
      warnings: ToolWarning[]
    }
  | {
      type: 'loadFailed'
      message: string
      /** 保存级破损时带上原文与问题清单，画布进**只读错误态**而不是空白。 */
      raw?: string
      problems?: ValidationProblem[]
    }
  /**
   * 选节点 / 选边 / 都不选。
   *
   * 两个字段都是可选的：给了 `node` 就选节点（`selectedEdge` 一并清空），
   * 给了非空 `edge` 就选边（`selected` 一并清空），两个都不给就是"什么都不选"。
   * 同时给一个非空 `edge` 与一个 `node` 时**以边为准**——互斥态只认一个赢家，
   * 不允许出现"两者同时非空"的合法状态。
   */
  | { type: 'select'; node?: string | null; edge?: string | null }
  | { type: 'moveNode'; id: string; position: Point }
  | { type: 'setPositions'; positions: Record<string, Point> }
  | { type: 'setViewport'; viewport: Viewport }
  | { type: 'setNodeData'; id: string; data: Partial<NodeData> }
  | { type: 'addNode'; id: string; data: NodeData; position: Point }
  | { type: 'deleteNode'; id: string }
  | { type: 'connect'; source: string; target: string; when?: string }
  | { type: 'disconnect'; source: string; target: string; when?: string }
  | { type: 'setEdgeWhen'; source: string; target: string; from?: string; to?: string }
  | { type: 'saveStarted'; seq: number }
  | { type: 'saveSucceeded'; baseHash: string }
  | { type: 'saveFailed'; message: string }
  | {
      /**
       * 保存成功后回读一次磁盘：刷新问题清单与基线哈希。
       * `document` 只在**本地没有在途改动**时给——否则会把用户刚敲的字顶掉。
       */
      type: 'refreshed'
      baseHash: string
      problems: ValidationProblem[]
      warnings: ToolWarning[]
      document?: WorkflowDocument
    }
  | { type: 'closed' }
  | { type: 'undo' }
  | { type: 'redo' }
  /**
   * 断开历史合并：下一次改动必定新开一条撤销步。
   *
   * 触发点是"一次交互结束"——节点拖拽松手、文本输入失焦、保存成功。
   * 不发它的话，先拖 A 再拖 B 会被并成一条（合并键只看 id，A 和 B 不同所以其实不会），
   * 更真实的情形是：改完 label 接着改 prompt，两者都落在 `data:<id>` 上，就被并成一条了。
   */
  | { type: 'historyBreak' }

/** 边 id 的构造式（与 host 侧一致）：`<source>-><target>`，带 `when` 时追加 `#<when>`。 */
export function edgeIdOf(source: string, target: string, when?: string): string {
  const base = `${source}->${target}`
  return when === undefined || when === '' ? base : `${base}#${when}`
}

/** 一条边的条件值（空串与缺省同义）。 */
export function whenOf(edge: WorkflowEdge): string | undefined {
  const when = edge.data?.when
  return when === undefined || when === '' ? undefined : when
}

/** 把文档里的节点按 `id` 码位序排好（渲染与列表一律用它）。 */
export function sortedNodeIds(document: WorkflowDocument): string[] {
  return document.nodes.map((node) => node.id).sort(byId)
}

/** 节点 id 是否已在图里（大小写不敏感）。 */
export function hasNode(document: WorkflowDocument, id: string): boolean {
  const key = idKey(id)
  return document.nodes.some((node) => idKey(node.id) === key)
}

/**
 * 边 id 是否还在图里。
 *
 * 不做大小写归一：边 id 是 `<source>-><target>#<when>` 拼出来的，`when` 是用户写的
 * 条件值（大小写敏感），拿 `idKey` 压一遍会把 `#Fail` 和 `#fail` 混成一条。
 */
export function hasEdge(document: WorkflowDocument, id: string | null): boolean {
  if (id === null) return false
  return document.edges.some((edge) => edge.id === id)
}

/** 找一个节点（大小写不敏感）。 */
export function findNode(document: WorkflowDocument, id: string) {
  const key = idKey(id)
  return document.nodes.find((node) => idKey(node.id) === key)
}

/** 删节点时**连带删掉所有以它为 source 或 target 的边**——不这样就会留下悬空 edge（保存级）。 */
export function withoutNode(document: WorkflowDocument, id: string): WorkflowDocument {
  const key = idKey(id)
  return {
    ...document,
    nodes: document.nodes.filter((node) => idKey(node.id) !== key),
    edges: document.edges.filter(
      (edge) => idKey(edge.source) !== key && idKey(edge.target) !== key,
    ),
  }
}

/** 幂等地加一条边（同 source+target+when 不重复）。 */
export function withEdge(
  document: WorkflowDocument,
  source: string,
  target: string,
  when?: string,
): WorkflowDocument {
  const id = edgeIdOf(source, target, when)
  if (document.edges.some((edge) => edge.id === id)) return document
  const edge: WorkflowEdge = {
    id,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(when === undefined || when === '' ? {} : { data: { when } }),
  }
  return { ...document, edges: [...document.edges, edge] }
}

/** 删一条边。`when` 缺省时只删那条**无条件边**。 */
export function withoutEdge(
  document: WorkflowDocument,
  source: string,
  target: string,
  when?: string,
): WorkflowDocument {
  const id = edgeIdOf(source, target, when)
  return { ...document, edges: document.edges.filter((edge) => edge.id !== id) }
}

/** 改一个节点的 `data`（局部合并）。 */
export function withNodeData(
  document: WorkflowDocument,
  id: string,
  patch: Partial<NodeData>,
): WorkflowDocument {
  const key = idKey(id)
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      idKey(node.id) === key ? { ...node, data: { ...node.data, ...patch } } : node,
    ),
  }
}

/** 整体替掉一个节点的 `data`（`setNodeData` 用：合并与清除都算完了，不能再合并回原值）。 */
export function withNodeDataReplaced(
  document: WorkflowDocument,
  id: string,
  data: NodeData,
): WorkflowDocument {
  const key = idKey(id)
  return {
    ...document,
    nodes: document.nodes.map((node) => (idKey(node.id) === key ? { ...node, data } : node)),
  }
}

/** 改一个节点的坐标（归一化到 2 位小数）。 */
export function withNodePosition(
  document: WorkflowDocument,
  id: string,
  position: Point,
): WorkflowDocument {
  const key = idKey(id)
  const next = { x: normalizeCoord(position.x), y: normalizeCoord(position.y) }
  return {
    ...document,
    nodes: document.nodes.map((node) =>
      idKey(node.id) === key ? { ...node, position: next } : node,
    ),
  }
}

/** 新节点的 id：从 `node` 起，撞名就加 `-2`、`-3`…（**绝不静默覆盖**）。 */
export function uniqueNodeId(document: WorkflowDocument, base: string): string {
  if (!hasNode(document, base)) return base
  for (let n = 2; n <= 99; n += 1) {
    const candidate = `${base}-${n}`
    if (!hasNode(document, candidate)) return candidate
  }
  throw new Error(`节点 id ${base} 太挤了`)
}

/** 加一个节点（id 撞名时自动加序号）。 */
export function withNewNode(
  document: WorkflowDocument,
  base: string,
  data: NodeData,
  position: Point = { x: 0, y: 0 },
): { document: WorkflowDocument; id: string } {
  const id = uniqueNodeId(document, base)
  return {
    document: {
      ...document,
      nodes: [
        ...document.nodes,
        {
          id,
          type: 'wfNode',
          position: { x: normalizeCoord(position.x), y: normalizeCoord(position.y) },
          data,
        },
      ],
    },
    id,
  }
}

/**
 * 按**执行批次**摆位：格子按批次序走，行 = 批内序。
 *
 * 格子先按 `LAYOUT_COLUMNS` 横向铺满再折到下一排——只横着排的话长链会拉成一条
 * 几千单位宽的横线（见 `LAYOUT_COLUMNS` 的注释）。
 *
 * 它确定性、不吃额外依赖，而且**反映执行次序**——比不分青红皂白的环形布局好读。
 * 两条入口共用同一套几何：`layoutMissing` 只补没摆过的，`layoutAll` 显式重排整图。
 *
 * （原本选型是 elkjs；v1 用这个同步回落代替。）
 *
 * @param document - 要摆的图。
 * @param batches - `analyzeGraph` 给的执行批次。
 * @param onlyUnplaced - 只处理坐标为 `(0,0)` 的占位节点（host 新建节点时的初始值）。
 */
function placeNodes(
  document: WorkflowDocument,
  batches: readonly ExecutionBatch[],
  onlyUnplaced: boolean,
): Map<string, Point> {
  const placed = new Map<string, Point>()
  const targets = new Set<string>()
  for (const node of document.nodes) {
    if (!onlyUnplaced || (node.position.x === 0 && node.position.y === 0)) {
      targets.add(idKey(node.id))
    }
  }
  if (targets.size === 0) return placed
  for (const [column, batch] of batches.entries()) {
    /*
     * 折行：`column` 是执行批次序，横排铺满 `LAYOUT_COLUMNS` 列之后换到下一排。
     * 每个批次占一个独立格子，所以批内节点按 `row` 纵向排不会和别的批次撞。
     */
    const cellX = LAYOUT_ORIGIN.x + (column % LAYOUT_COLUMNS) * LAYOUT_COLUMN_W
    const cellY = LAYOUT_ORIGIN.y + Math.floor(column / LAYOUT_COLUMNS) * LAYOUT_ROW_H
    for (const [row, id] of batch.nodes.entries()) {
      if (!targets.has(idKey(id))) continue
      placed.set(id, { x: cellX, y: cellY + row * LAYOUT_ROW_H })
    }
  }
  return placed
}

/** 给**还没摆过**的节点补一个确定性坐标（已有坐标的一律不动）。 */
export function layoutMissing(
  document: WorkflowDocument,
  batches: readonly ExecutionBatch[],
): Map<string, Point> {
  return placeNodes(document, batches, true)
}

/**
 * 显式重排整图（「自动布局」按钮 / 显式请求重排）——**每个节点都重算**。
 *
 * 与 `layoutMissing` 同一套几何：同一张图必然摆成同一版式，所以它是幂等的。
 */
export function layoutAll(
  document: WorkflowDocument,
  batches: readonly ExecutionBatch[],
): Map<string, Point> {
  return placeNodes(document, batches, false)
}

/** 有没有改动需要落盘。 */
export function needsSave(state: CanvasState): boolean {
  return state.dirty && state.document !== null && state.name !== null && state.status !== 'saving'
}

/**
 * 状态机。
 *
 * 约定：**任何改动文档的动作都把 `dirty` 置真并把状态推到 `dirty`**；
 * 保存成功把 `baseHash` 换成本次写回的哈希并清脏；失败保留改动、写明错误。
 */
export function reduce(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, status: 'loading', error: null }

    case 'loaded':
      return {
        name: action.name,
        document: action.document,
        baseHash: action.baseHash,
        dirty: false,
        status: 'idle',
        error: null,
        selected: null,
        selectedEdge: null,
        problems: action.problems,
        warnings: action.warnings,
        raw: null,
        blocked: false,
        // 新基线：版本计数从头开始，历史也重新开始（旧历史属于上一张图，套用过来只会撤销出别的图的内容）。
        editSeq: 0,
        savingSeq: 0,
        past: [],
        future: [],
        historyKey: null,
      }

    case 'loadFailed':
      // 保存级破损 / 图已被删或改名 ⇒ **只读错误态**：留着原文与问题清单给人看，但绝不写盘。
      return {
        ...state,
        status: 'error',
        error: action.message,
        document: null,
        dirty: false,
        problems: action.problems ?? [],
        warnings: [],
        raw: action.raw ?? null,
        blocked: true,
        // 图都读不出来，选中一个不存在的 id 没有意义（边选中尤其：它会去索引一份不存在的文档）。
        selectedEdge: null,
        // 图都读不出来（保存级破损 / 已被删或改名），旧历史没有意义。
        past: [],
        future: [],
        historyKey: null,
      }

    case 'refreshed':
      return {
        ...state,
        baseHash: action.baseHash,
        problems: action.problems,
        warnings: action.warnings,
        ...(action.document === undefined ? {} : { document: action.document }),
      }

    case 'select':
      /*
       * 节点与边是**互斥**的选中态：两边只能有一个非空，所以每一次 select 都把另一边
       * 明确地写回 `null`（而不是"没提到就不动"——那会留下两者同时非空的状态）。
       * 非空 `edge` 优先：同一动作既给了边又给了节点时，边赢。
       */
      if (action.edge !== undefined && action.edge !== null) {
        return { ...state, selected: null, selectedEdge: action.edge }
      }
      return { ...state, selected: action.node ?? null, selectedEdge: null }

    case 'closed':
      return { ...initialCanvasState }

    case 'historyBreak':
      // 只断合并链：不动文档、不压栈、不进历史、不置脏。
      return state.historyKey === null ? state : { ...state, historyKey: null }

    case 'undo': {
      const current = state.document
      const previous = state.past.at(-1)
      // 空栈就是没得撤销——**什么都不做**，不要白推一次 editSeq（那会引发一次没必要的写盘）。
      if (current === null || previous === undefined) return state
      return {
        ...state,
        document: previous,
        past: state.past.slice(0, -1),
        future: [current, ...state.future],
        historyKey: null,
        ...keepSelection(previous, state.selected, state.selectedEdge),
        dirty: true,
        status: 'dirty',
        editSeq: state.editSeq + 1,
      }
    }

    case 'redo': {
      const current = state.document
      const next = state.future[0]
      if (current === null || next === undefined) return state
      const past = [...state.past, current]
      return {
        ...state,
        document: next,
        past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
        future: state.future.slice(1),
        historyKey: null,
        ...keepSelection(next, state.selected, state.selectedEdge),
        dirty: true,
        status: 'dirty',
        editSeq: state.editSeq + 1,
      }
    }

    case 'saveStarted':
      // 记下这次保存对应的是哪个版本——保存期间又改了就靠它认出来。
      return { ...state, status: 'saving', savingSeq: action.seq }

    case 'saveSucceeded': {
      // **保存期间又来改动 ⇒ 仍然脏**。无条件清脏会让"在途改动"被当成已落盘，
      // 紧接着的回读就会用磁盘版本把它盖掉（那条数据丢失路径）。
      const dirty = state.editSeq !== state.savingSeq
      return {
        ...state,
        baseHash: action.baseHash,
        dirty,
        status: dirty ? 'dirty' : 'saved',
        error: null,
      }
    }

    case 'saveFailed':
      return { ...state, status: 'error', error: action.message }

    default: {
      // 剩下的是"改文档"的动作——统一走这里：改了就是脏的，并把版本推一格。
      const next = applyDocumentChange(state, action)
      if (next === state) return state
      const bumped: CanvasState = {
        ...next,
        dirty: true,
        status: 'dirty',
        editSeq: state.editSeq + 1,
      }
      // 视口是**视图状态**而不是文档内容：它照样落盘，但不进撤销栈
      // （`Ctrl+Z` 把画面平移回去不是用户要的“撤销”）。
      if (action.type === 'setViewport') return bumped
      return { ...bumped, ...pushHistory(state, action) }
    }
  }
}

/** 只处理会改文档的动作；不改则原样返回（引用相等即"没动"）。 */
function applyDocumentChange(state: CanvasState, action: CanvasAction): CanvasState {
  const document = state.document
  if (document === null) return state

  switch (action.type) {
    case 'moveNode': {
      const node = findNode(document, action.id)
      if (node === undefined) return state
      if (
        node.position.x === normalizeCoord(action.position.x) &&
        node.position.y === normalizeCoord(action.position.y)
      ) {
        return state
      }
      return { ...state, document: withNodePosition(document, action.id, action.position) }
    }

    case 'setViewport': {
      const current = document.viewport
      if (
        current.x === action.viewport.x &&
        current.y === action.viewport.y &&
        current.zoom === action.viewport.zoom
      ) {
        return state
      }
      return { ...state, document: { ...document, viewport: { ...action.viewport } } }
    }

    case 'setNodeData': {
      const node = findNode(document, action.id)
      if (node === undefined) return state
      const merged: NodeData = { ...node.data, ...action.data }
      // 显式 `undefined` 表示"清掉这一项"。
      for (const key of ['label', 'prompt', 'output'] as const) {
        if (key in action.data && action.data[key] === undefined) delete merged[key]
      }
      if (
        merged.label === node.data.label &&
        merged.prompt === node.data.prompt &&
        merged.output === node.data.output
      ) {
        return state
      }
      return { ...state, document: withNodeDataReplaced(document, action.id, merged) }
    }

    case 'addNode': {
      const { document: next, id } = withNewNode(document, action.id, action.data, action.position)
      // 新节点接管选中态：选中的节点与选中的边互斥，所以边上那个选中要一并放掉。
      return { ...state, document: next, selected: id, selectedEdge: null }
    }

    case 'deleteNode': {
      if (!hasNode(document, action.id)) return state
      const next = withoutNode(document, action.id)
      return {
        ...state,
        document: next,
        selected:
          state.selected !== null && idKey(state.selected) === idKey(action.id)
            ? null
            : state.selected,
        // 删节点会连带删掉所有以它为端点的边：选中的那条恰好被带走时就一起清掉。
        selectedEdge: hasEdge(next, state.selectedEdge) ? state.selectedEdge : null,
      }
    }

    case 'setPositions': {
      let acc = document
      let touched = false
      for (const [id, position] of Object.entries(action.positions)) {
        const node = findNode(acc, id)
        // 不存在的 id 直接跳过——**不隐式造节点**，也不白造一份新文档。
        if (node === undefined) continue
        if (
          node.position.x === normalizeCoord(position.x) &&
          node.position.y === normalizeCoord(position.y)
        ) {
          continue
        }
        acc = withNodePosition(acc, id, position)
        touched = true
      }
      return touched ? { ...state, document: acc } : state
    }

    case 'setEdgeWhen': {
      if ((action.from ?? '') === (action.to ?? '')) return state
      const removed = withoutEdge(document, action.source, action.target, action.from)
      if (removed.edges.length === document.edges.length) return state
      const added = withEdge(removed, action.source, action.target, action.to)
      /*
       * 改 `when` 等于**换了一条边**（`when` 是边 id 的一部分）。若选中的正是这条，
       * 选中要跟着搬到新 id 上——否则用户点一下「fail」，右栏的边编辑区立刻就消失了
       * （选中的 id 在新文档里不存在 ⇒ 被当成"边没了"清掉）。
       */
      const oldId = edgeIdOf(action.source, action.target, action.from)
      return {
        ...state,
        document: added,
        selectedEdge:
          state.selectedEdge === oldId
            ? edgeIdOf(action.source, action.target, action.to)
            : state.selectedEdge,
      }
    }

    case 'connect': {
      const next = withEdge(document, action.source, action.target, action.when)
      return next === document ? state : { ...state, document: next }
    }

    case 'disconnect': {
      const next = withoutEdge(document, action.source, action.target, action.when)
      if (next.edges.length === document.edges.length) return state
      const removedId = edgeIdOf(action.source, action.target, action.when)
      return {
        ...state,
        document: next,
        // 断开的正是选中的那条 ⇒ 选中态跟着消失（右栏回到整图概览）。
        selectedEdge: state.selectedEdge === removedId ? null : state.selectedEdge,
      }
    }

    default:
      return state
  }
}

/**
 * 一条改动动作的**合并键**：同一个键的连续改动合成一条撤销步。
 *
 * 只有"一次交互会连发很多次"的那三种动作需要合并键：
 * - `moveNode`：拖一个节点每帧发一次 ⇒ 一次拖拽 = 一个 `move:<id>`
 * - `setNodeData`：在提示词里打一句话每字符发一次 ⇒ 一次连续编辑 = 一个 `data:<id>`
 * - `setPositions`：补位/重排一次发一个，但它本身就是批量
 *
 * 其余动作（加/删节点、连线、断线、改 `when`）**各自一条**：它们是离散的、有后果的操作，
 * 合并起来会让撤销变得不可预测。
 *
 * 合并键只按 **id** 分，所以"先改 A 的 label，再改 A 的 prompt"会被并成一条；
 * 这靠 `historyBreak` 在输入失焦时断开来解决。
 */
function historyKeyOf(action: CanvasAction): string | null {
  switch (action.type) {
    case 'moveNode':
      return `move:${action.id}`
    case 'setNodeData':
      return `data:${action.id}`
    case 'setPositions':
      return 'layout'
    default:
      return null
  }
}

/**
 * 以 `preferred` 为中心、按"环"枚举栅格偏移。第 0 环就是原点自己，第 r 环是
 * `max(|dx|,|dy|) === r` 那一圈。顺序固定（dx、dy 各自升序）⇒ 同样的输入必然
 * 得到同样的落点，不会"同样的图刷新两次节点换个位置"。
 */
function ringOffsets(ring: number): [number, number][] {
  if (ring === 0) return [[0, 0]]
  const out: [number, number][] = []
  for (let dx = -ring; dx <= ring; dx += 1) {
    for (let dy = -ring; dy <= ring; dy += 1) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === ring) out.push([dx, dy])
    }
  }
  return out
}

/**
 * 节点卡的占位盒，用来判"两张卡会不会压在一起"。
 *
 * **不能拿栅格间距当阈值**：`LAYOUT_COLUMN_W * 0.6 = 156` 比卡片的最大宽度（220）还小，
 * 于是一个被手拖到"右侧 156..220px、纵向挨得近"的邻居会被判成不冲突，新节点照落不误，
 * 两张卡横向仍叠着（最多约 64px）。阈值该描述**卡片本身占多大地**，而不是格子隔多远
 * ——这是独立测试工程复核时指出的口径缺口。
 *
 * 取值对齐 `NodeCard.module.css` 的 `max-width: 220px` 与卡片最高约 90px，各留一点余量。
 * 两个数都**小于**栅格步长（260 / 140），所以环上相邻的槽位不会被误判成冲突——
 * "相邻槽位互不冲突"是避让能收敛的前提，`state.spec.ts` 里有两条不变式钉着它。
 */
export const NODE_FOOTPRINT_W = 224
export const NODE_FOOTPRINT_H = 96

function tooClose(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < NODE_FOOTPRINT_W && Math.abs(a.y - b.y) < NODE_FOOTPRINT_H
}

/**
 * 允许落点的**偏移区间**（相对理想点，画布坐标）。
 *
 * 为什么是四个数而不是一个对称的"半径"：`node.position` 是卡片的**左上角**，不是中心。
 * 一张宽 `W` 的卡要完整落在以 `C` 为中心、半宽 `halfW` 的可见区里，左上角得落在
 * `[C.x - halfW, C.x + halfW - W]`——**左边界和右边界离理想点的距离不一样**
 * （右边界要多减一个卡宽）。用一个对称的 `limit` 表达不了，而且两头都会错：
 * 既拒掉本来合法的左向槽位，又在右向放松半张卡。
 */
export interface PlacementBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/**
 * 给一个"理想落点"找一个不压住已有节点的位置。
 *
 * 为什么需要它："点一下节点库条目"这个动作没有指针位置可依据，只能落在视口中心。
 * 连点两次就是**逐像素重合的两个节点**——上面那个看得见、下面那个既看不见也点不中，
 * 界面还不会说"这里有两个"（独立审计 P3 实测第 2、3 个节点坐标完全相同）。
 *
 * 策略：从理想点起按环向外找第一个空位（先近后远，所以不会把新节点扔到很远的地方）。
 *
 * `bounds` 是**可见区对应的偏移区间**：给了它，候选就会被**夹**进这个区间里再判冲突
 * （不是丢掉越界的候选——那样会在窄视口下把避让退化成"永远放中心"，P3 原地复发）。
 * 不给的话环最多能跑到 `rings × 260 × rings × 140` 画布单位，而画布可视区往往只有
 * 四五百个画布单位宽，于是新节点会被放到左栏/右栏底下、标题被 `overflow: hidden` 裁掉、
 * 那半截点不到（真浏览器验收量到过一个越界 29px 的实例）。
 * **纯函数拿不到视口信息，所以由调用方算好传进来**，这样它依旧是纯的、确定性可测的。
 *
 * 环都找遍了就**原样返回理想点**——理想点是视口中心，它一定在可见区内，
 * 所以最坏情况是"叠一个"，而不是"扔到看不见的地方"。
 *
 * 只给"点击添加"用。拖放进来的落点是用户明确指的，不偏移、也不受 `bounds` 约束。
 *
 * @param document - 当前的图。
 * @param preferred - 理想落点。
 * @param rings - 向外找几环（默认 4 环）。
 * @param bounds - 可见区对应的偏移区间；不传则不限制。
 */
export function avoidOverlap(
  document: WorkflowDocument,
  preferred: Point,
  rings = 4,
  bounds?: PlacementBounds,
): Point {
  const taken = document.nodes.map((node) => node.position)
  for (let ring = 0; ring <= rings; ring += 1) {
    for (const [dx, dy] of ringOffsets(ring)) {
      const candidate = {
        x: preferred.x + clampOffset(dx * LAYOUT_COLUMN_W, bounds?.minX, bounds?.maxX),
        y: preferred.y + clampOffset(dy * LAYOUT_ROW_H, bounds?.minY, bounds?.maxY),
      }
      if (!taken.some((position) => tooClose(position, candidate))) return candidate
    }
  }
  return preferred
}

/**
 * 把一个偏移**夹进**允许区间。
 *
 * 越界的候选是**夹回来**而不是丢掉——这一点是整个设计的关节，第一版写错了：
 * 当时是"超出 `limit` 就 `continue`"，而环的步长是 260、窄视口允许的横向偏移只有一百多，
 * 于是 `±260` 两个候选全被拒，避让退化成"永远放中心"，**连点两次又逐像素重合**
 * （P3 原地复发，最终验收在第 25 步逮到）。夹回来之后它们变成合法的近旁落点，
 * 既在可见区内、又不重合。
 *
 * 区间给反了（`min > max`，即视口比一张卡还窄）时返回 `max`——退化情形下也别抛。
 */
function clampOffset(offset: number, min: number | undefined, max: number | undefined): number {
  if (min === undefined || max === undefined) return offset
  return Math.min(Math.max(offset, min), max)
}

/**
 * 把"这次改动**之前**"的文档压进撤销栈。
 *
 * 语义（三句话，缺一条撤销就会怪）：
 * 1. 带合并键、且与当前 `historyKey` 相同 ⇒ **不压**。栈顶已经是这次交互开始之前的快照了。
 * 2. 带合并键、但与当前不同（或当前是 `null`）⇒ 压一版，并接管合并键。
 * 3. 不带合并键 ⇒ 压一版，并把合并键设回 `null`（打断合并链）。
 *
 * 任何一次压栈都清空重做栈：分叉之后，旧的那条重做路径已经不可能再走到。
 *
 * @param state - 改动**之前**的状态。
 * @param action - 引起这次改动的动作。
 */
function pushHistory(
  state: CanvasState,
  action: CanvasAction,
): Pick<CanvasState, 'past' | 'future' | 'historyKey'> {
  const document = state.document
  // 没有文档就没有可压的快照。理论上走不到（`applyDocumentChange` 在 `document === null`
  // 时原样返回、于是 default 分支提前 return），这里只是别让它变成一个隐式的空快照。
  if (document === null) {
    return { past: state.past, future: state.future, historyKey: state.historyKey }
  }

  const key = historyKeyOf(action)
  if (key !== null && key === state.historyKey) {
    return { past: state.past, future: [], historyKey: key }
  }

  const past = [...state.past, document]
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past,
    future: [],
    historyKey: key,
  }
}

/**
 * 撤销/重做之后让选中态跟着文档走：选中的节点 / 边在新文档里没了，就取消选中。
 *
 * 两个选中态一起判：它们互斥但各自可能单独失效（撤销回"这条边还没建"的那一版），
 * 只清一个的话右栏会拿着一个查不到的 id 去索引文档。
 */
function keepSelection(
  document: WorkflowDocument,
  selected: string | null,
  selectedEdge: string | null,
): Pick<CanvasState, 'selected' | 'selectedEdge'> {
  return {
    selected: selected !== null && hasNode(document, selected) ? selected : null,
    selectedEdge: hasEdge(document, selectedEdge) ? selectedEdge : null,
  }
}

/** 会被当成"正在打字"的标签名。 */
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * 键盘事件是不是打在输入控件里——决定全局快捷键要不要让开。
 *
 * 不让开会很难受：在提示词里按 `Ctrl+Z` 会去撤销整张图，按 `Delete` 会删掉节点，
 * 而用户以为自己在改那段文本。
 *
 * 用**结构化**判定而不是 `instanceof HTMLInputElement`：这个函数是纯逻辑，
 * 单测跑在 node 环境里，没有 DOM 构造函数可用。
 *
 * @param target - `KeyboardEvent.target`。
 */
export function isTypingTarget(target: unknown): boolean {
  if (target === null || typeof target !== 'object') return false
  const element = target as { tagName?: unknown; isContentEditable?: unknown }
  if (typeof element.tagName === 'string' && TYPING_TAGS.has(element.tagName.toUpperCase())) {
    return true
  }
  return element.isContentEditable === true
}

/**
 * 复制一个节点：返回**新节点的完整参数**，由调用方走统一的「加节点」路径 `addNode`。
 *
 * 刻意不返回整份新文档：那样就会出现第二条"往图里加节点"的代码路径，
 * 而这条路径上的 `selected` / `editSeq` / 撤销栈都要各自记得维护一遍。
 *
 * 三条语义：
 * - 新 id 走 `uniqueNodeId(document, 源id)`，撞名就加序号（`scan` → `scan-2`）。
 * - `data` **拷一份**：`NodeData` 的三个字段全是基本类型，浅拷就是深拷；
 *   直接把源对象交出去的话，之后改副本会连带改原件。
 * - **不带边**：边是两个节点之间的事。复制一个节点顺手把它的全部连接也复制出来，
 *   通常会立刻造出一堆重复边，而用户要的只是"再放一个同样的步骤"。
 *
 * @param document - 当前的图。
 * @param id - 要复制的节点 id（大小写不敏感）。
 * @returns 新节点的 `id` / `data` / `position`（源坐标右下偏移 `DUPLICATE_OFFSET`，未归一化）；找不到源节点给 `null`。
 */
export function duplicateNode(
  document: WorkflowDocument,
  id: string,
): { id: string; data: NodeData; position: Point } | null {
  const source = findNode(document, id)
  if (source === undefined) return null
  return {
    id: uniqueNodeId(document, source.id),
    data: { ...source.data },
    position: {
      x: source.position.x + DUPLICATE_OFFSET,
      y: source.position.y + DUPLICATE_OFFSET,
    },
  }
}
