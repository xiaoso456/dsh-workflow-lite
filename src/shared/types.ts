/**
 * dsh-workflow-lite — 文件格式、线格式与校验词汇表。
 *
 * 事实源是 `workflows/<图名>.json`：React Flow 原生三件套 `{ nodes, edges, viewport }`
 * 加我们自己的 `data`。本模块**只放类型与常量，不 import 任何 DSH 包、不含副作用**，
 * 好让 host / client / 单测三边直接共用。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/types
 */

// ─────────────────────────────────────────────────────────────
// 图 JSON（事实源）
// ─────────────────────────────────────────────────────────────

/** 节点类型标记。取值集合只有这一个；读到未知 `type` 按它渲染并报**警告**。 */
export const NODE_TYPE = 'wfNode'

/** 一张图 = 一个 JSON 的顶层形状（React Flow 原生三件套）。 */
export interface WorkflowDocument {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  viewport: Viewport
}

export interface Viewport {
  x: number
  y: number
  zoom: number
}

export interface Point {
  x: number
  y: number
}

export interface WorkflowNode {
  /** 身份，**创建后不可改**；同时是载荷文件名 ⇒ 受文件名约束。图内**大小写不敏感唯一**。 */
  id: string
  type: string
  /** **存盘**。缺失 → 分层布局补位并回写（提示级），不算保存级。 */
  position: Point
  data: NodeData
}

export interface NodeData {
  /** 显示名。不要求唯一、不参与寻址与排序；缺省或空串时回落渲染 `id`。**不得含换行或 `|`**。 */
  label?: string
  /** 提示词正文，逐字交给执行者。**缺失或为空串 = 编译级**（允许落盘、阻塞编译）。 */
  prompt?: string
  /** 产出契约**三态**：字符串 = 产出；`false` = 显式声明不产出文件；缺省 = 未声明。 */
  output?: string | false
}

export interface WorkflowEdge {
  /** 由工具按构造式生成：`<source>-><target>`，带 `when` 时追加 `#<when>`。 */
  id: string
  source: string
  target: string
  /** 恒为 `null`，但**一律写出**（保持 React Flow 原生形状；不在"缺省整键省略"之列）。 */
  sourceHandle: null
  targetHandle: null
  data?: EdgeData
}

export interface EdgeData {
  /** 条件出边的判据；**缺省 = 无条件边**（可以有多条 ⇒ 并行扇出）。空串 = 保存级。 */
  when?: string
  /** 作者手写的语义短标签，不参与任何判定。 */
  label?: string
}

/** 顶层键序（canonical writer 与白名单的唯一口径）。 */
export const DOCUMENT_KEYS = ['nodes', 'edges', 'viewport'] as const

/** node 的写出键序。 */
export const NODE_KEYS = ['id', 'type', 'position', 'data'] as const

/** edge 的写出键序。 */
export const EDGE_KEYS = ['id', 'source', 'target', 'sourceHandle', 'targetHandle', 'data'] as const

// ─────────────────────────────────────────────────────────────
// 模板
// ─────────────────────────────────────────────────────────────

/** `templates/workflows/<模板名>.json` —— 与一张图**同构**。 */
export type WorkflowTemplate = WorkflowDocument

/** `templates/nodes/<模板名>.json` —— **一个节点的 `data` 本体**（不带 `id` / `position`）。 */
export type NodeTemplate = NodeData

// ─────────────────────────────────────────────────────────────
// 派生：载荷与派发计划
// ─────────────────────────────────────────────────────────────

/** 一次编译的内容寻址标识：图内容哈希前 8 位。同内容 ⇒ 同 planId ⇒ 幂等覆盖。 */
export type PlanId = string

/** 载荷路径形态：`.dispatch/<图名>/<planId>/<节点 id>.md`（派生物，可随时删）。 */
export interface PayloadPath {
  nodeId: string
  /** 绝对路径。 */
  path: string
}

/** 编译器（纯函数）的输入。 */
export interface PlanFacts {
  name: string
  document: WorkflowDocument
  /** 本次目标；缺省时 ⑤ 段渲染「目标：未指定」。 */
  goal?: string
  /** 工作区路径（＝ ⑤ 段的 cwd）；取不到时 ⑤ 渲染「工作区路径：未指定」。 */
  cwd?: string
  /** 路径映射：节点 id → 绝对载荷路径（host 侧算好注入，编译器本身不碰磁盘）。 */
  payloadPaths: ReadonlyMap<string, string>
}

/** 编译器（纯函数）的产物。 */
export interface PlanResult {
  plan: string
  problems: ValidationProblem[]
}

// ─────────────────────────────────────────────────────────────
// 校验词汇表（级别的唯一出处：`shared/validate.ts`）
// ─────────────────────────────────────────────────────────────

/**
 * 四级。
 * - `save` 拒绝加载 / 拒绝写入
 * - `compile` 允许落盘、**阻塞编译**
 * - `warning` / `hint` 不阻塞任何操作
 */
export type ValidationLevel = 'save' | 'compile' | 'warning' | 'hint'

/** 可判定的机器码；文案由 UI / 工具各自本地化。 */
export type ValidationCode =
  // 保存级
  | 'json_parse_failed'
  | 'schema_invalid'
  | 'node_id_missing'
  | 'node_id_duplicate'
  | 'node_id_case_collision'
  | 'edge_field_missing'
  | 'edge_dangling'
  | 'edge_id_duplicate'
  | 'when_invalid'
  | 'label_invalid'
  | 'output_invalid'
  | 'name_invalid'
  | 'workflow_dir_collision'
  // 编译级
  | 'prompt_empty'
  | 'too_many_nodes'
  | 'no_nodes'
  // 警告
  | 'loop_without_exit'
  | 'mixed_conditional_edges'
  | 'duplicate_edge'
  | 'shared_output'
  | 'unknown_node_type'
  | 'unknown_fields_dropped'
  // 提示
  | 'branch_not_exhaustive'
  | 'freeform_when'
  | 'multi_back_edges'
  | 'missing_output'
  | 'stray_entry'
  | 'position_filled'
  | 'legacy_structure'
  | 'invalid_template'

export interface ValidationProblem {
  level: ValidationLevel
  code: ValidationCode
  message: string
  /** 归属的节点 id（有归属时）。 */
  node?: string
  /** 归属的边 id（有归属时）。 */
  edge?: string
}

// ─────────────────────────────────────────────────────────────
// 工具线格式（唯一工具 workflow_lite，12 个 action）
// ─────────────────────────────────────────────────────────────

export const TOOL_NAME = 'workflow_lite'

export const ACTIONS = [
  'list',
  'read',
  'compile',
  'create',
  'write_node',
  'set_label',
  'delete_node',
  'connect',
  'disconnect',
  'rename_workflow',
  'delete_workflow',
  'save_as_template',
] as const

export type Action = (typeof ACTIONS)[number]

/** 失败码只有五个。 */
export type ErrorCode = 'not_found' | 'invalid_args' | 'blocked' | 'conflict' | 'io_error'

/** 变更摘要条目。 */
export interface ChangedEntry {
  kind: 'workflow' | 'node' | 'edge'
  op: 'add' | 'update' | 'delete' | 'rename'
  id: string
  /** 该条变更的细节（例如被连带删掉的 `edge.id` 清单）。 */
  detail?: Record<string, unknown>
}

/** 非阻塞信息（警告与提示共用一条通道，带 `level` 区分）。 */
export interface ToolWarning {
  level: 'warning' | 'hint'
  code: ValidationCode
  message: string
  nodes?: string[]
  workflows?: string[]
}

export interface ToolError {
  error: {
    code: ErrorCode
    message: string
    /** 结构化补充：跨文件操作的「已改 N / 未改 M」清单、解析错误的行列与片段等。 */
    detail?: Record<string, unknown>
  }
}

// ── 各 action 的返回值 ────────────────────────────────────────

/** 模板条目的状态标记（`list` 用）。 */
export interface TemplateEntry {
  name: string
  invalid?: true
  reason?: string
}

export interface WorkflowEntry {
  name: string
  nodeCount: number
  /** 那份 JSON 的 mtime（选择器"最近修改"的判据）。 */
  updatedAt: number
  invalid?: true
  reason?: string
}

export interface ListResult {
  workflows: WorkflowEntry[]
  templates: {
    workflows: TemplateEntry[]
    nodes: TemplateEntry[]
  }
  warnings: ToolWarning[]
}

/** `read` 不给 `node` 时的索引——**绝不含 `prompt`**。 */
export interface NodeIndexEntry {
  id: string
  label?: string
  /** 前置（含回边）的 `id`，按 `id` 码位序。 */
  predecessors: string[]
  output?: string | false
}

export interface ReadIndexResult {
  workflow: string
  viewport: Viewport
  nodes: NodeIndexEntry[]
  warnings: ToolWarning[]
}

/** `read` 给了 `node=<id>` 时的单节点详情——这里才有正文。 */
export interface ReadNodeResult {
  workflow: string
  node: WorkflowNode
  /** 该节点的出边（按 `id` 码位序）。 */
  edges: WorkflowEdge[]
  warnings: ToolWarning[]
}

export interface WriteResult {
  changed: ChangedEntry[]
  warnings: ToolWarning[]
}

export interface CompileResult {
  plan: string
  /** **只在 `compile` 里出现**，只装编译级问题。 */
  problems: ValidationProblem[]
  warnings: ToolWarning[]
  planId: PlanId
}

/** 工具的成功返回联合。 */
export type ToolSuccess =
  | { action: 'list'; result: ListResult }
  | { action: 'read'; result: ReadIndexResult | ReadNodeResult }
  | { action: 'compile'; result: CompileResult }
  | { action: 'create'; result: WriteResult }
  | { action: 'write_node'; result: WriteResult }
  | { action: 'set_label'; result: WriteResult }
  | { action: 'delete_node'; result: WriteResult }
  | { action: 'connect'; result: WriteResult }
  | { action: 'disconnect'; result: WriteResult }
  | { action: 'rename_workflow'; result: WriteResult }
  | { action: 'delete_workflow'; result: WriteResult }
  | { action: 'save_as_template'; result: WriteResult }

// ─────────────────────────────────────────────────────────────
// 图语义（供编译器与画布共用）
// ─────────────────────────────────────────────────────────────

/** 出边的四种形态。 */
export type EdgeShape =
  /** 只有一条出边 */
  | 'sequence'
  /** 多条出边，**全都**没有 `when` ⇒ 全部都会走 */
  | 'fanout'
  /** 多条出边，**全都**有 `when` ⇒ 只走成立的那一条 */
  | 'branch'
  /** 混用 ⇒ 有歧义，警告 */
  | 'mixed'

/** 一个强连通分量＝一个循环体。 */
export interface CycleGroup {
  /** 该 SCC 内的节点 id，按批次序、同批次按 `id` 码位序。 */
  nodes: string[]
  /** 该 SCC 内的回边 id（SCC 内 DFS 指向栈上祖先的边；自环也算）。 */
  backEdges: string[]
  /** 被环外入边指向的入口节点；没有环外入边时取 `id` 最小者。 */
  entry: string
  /** 环上指向环外的条件边 id ⇒ 有出口；空 ⇒ 循环体没有出口（警告）。 */
  exits: string[]
}

/** 执行批次：一批可并行的节点。 */
export interface ExecutionBatch {
  /** 节点 id，按 `id` 码位序。 */
  nodes: string[]
}
