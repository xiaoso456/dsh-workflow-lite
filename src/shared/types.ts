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

/** 步骤节点的类型标记。读到未知 `type` 按步骤渲染并报**警告**。 */
export const NODE_TYPE = 'wfNode'

/** 文件节点的类型标记：一份产出 / 输入文件，步骤写它（步骤 → 文件）、读它（文件 → 步骤）。 */
export const FILE_TYPE = 'wfFile'

/** 一张图 = 一个 JSON 的顶层形状（React Flow 原生三件套 + 可选的工作流设置）。 */
export interface WorkflowDocument {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  viewport: Viewport
  /** 整张工作流的设置；全是缺省值时整键不写（老文件不受影响）。 */
  settings?: WorkflowSettings
}

/**
 * 执行方式：
 * - `auto` 不规定，由主 agent 自己决定（缺省）；
 * - `serial` 主 agent 本人逐个执行；
 * - `subagent` 主 agent 当 leader，每个节点派一个子代理；
 * - `team` 主 agent 当 Team Lead，节点交给 Agent Team 的队员。
 */
export const EXECUTION_MODES = ['auto', 'serial', 'subagent', 'team'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

export interface WorkflowSettings {
  /**
   * 产出根目录：相对路径（相对工作区）或绝对路径，存规范化后的写法（`shared/outputPaths.ts`）。
   * 编译时每个产出文件都拼在它下面。缺省 = 工作区根。
   */
  outputRoot?: string
  /** 执行方式；缺省 = `auto`（`auto` 不写盘）。 */
  mode?: Exclude<ExecutionMode, 'auto'>
  /**
   * 记录运行状态：打开后每次编译建一个工作流实例，带一份由主 agent 维护的 YAML 状态文件
   * 缺省 = 关（关时不写盘）。
   */
  runState?: true
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

/** 图里的节点：步骤，或文件。 */
export type WorkflowNode = StepNode | FileNode

export interface StepNode {
  /** 身份，**创建后不可改**；同时是载荷文件名 ⇒ 受文件名约束。图内**大小写不敏感唯一**。 */
  id: string
  type: typeof NODE_TYPE
  /** **存盘**。缺失（或 `(0,0)`）→ 布局补位并回写，不算保存级。 */
  position: Point
  data: NodeData
}

/**
 * 文件节点：一份独立的文件，和执行结果不同，它不依赖某一次运行——几个步骤可以先后写它、读它。
 * `id` 与步骤共用一个命名空间（图内大小写不敏感唯一），但不产生载荷文件。
 */
export interface FileNode {
  id: string
  type: typeof FILE_TYPE
  position: Point
  data: FileData
}

export interface FileData {
  /** 文件路径：相对产出根目录（没配根目录就是相对工作区），禁止绝对路径与 `..`。 */
  path: string
  /** 这份文件该怎么写：格式、必须包含什么、给谁看。进计划。 */
  rule?: string
}

export interface NodeData {
  /** 显示名。不要求唯一、不参与寻址与排序；缺省或空串时回落渲染 `id`。**不得含换行或 `|`**。 */
  label?: string
  /** 一句话说明这一步做什么（给人看：步骤库、卡片）。**不进计划**，也不进载荷。 */
  description?: string
  /** 提示词正文，逐字交给执行者。**缺失或为空串 = 编译级**（允许落盘、阻塞编译）。 */
  prompt?: string
  /**
   * 产出契约——**只在步骤模板里用**（模板放到画布上时展开成文件节点）；
   * 图里的产出是文件节点，老图里步骤上的 `output` 读入时自动迁成文件节点。
   * - 字符串 = 一个产出文件；数组 = 一个或多个，每个可带生成规则；`false` = 不产出文件。
   */
  output?: string | false | OutputSpec[]
}

/** 一个产出：文件路径（相对工作区根）+ 可选的生成规则。 */
export interface OutputSpec {
  path: string
  /** 这份产出该怎么写：格式、必须包含什么、给谁看。 */
  rule?: string
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
  /**
   * 交接（只用在步骤 → 步骤的线上）：上游这一次的执行结果交不交给下游。
   * - 缺省 = 交：把上游回复里的结论与要点交给下游；
   * - 对象 = 交，并附一段交接说明（下游拿到之后怎么用）；
   * - `false` = 只管先后，什么都不交。
   * 文件不走这里——文件是独立的节点，谁写谁读看连到它的线。
   */
  handoff?: Handoff | false
  /**
   * 写入方式（只用在步骤 → 文件的线上）：缺省 = 产出（整份写出 / 覆盖）；
   * `true` = 在原文件上更新（先读再改，比如修完在问题清单里打钩）。
   */
  update?: true
}

/** 交接说明（空白说明的规范写法是"不写"，即缺省）。 */
export interface Handoff {
  note: string
}

/** 顶层键序（canonical writer 与白名单的唯一口径）。 */
export const DOCUMENT_KEYS = ['nodes', 'edges', 'viewport', 'settings'] as const

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
  | 'settings_invalid'
  | 'handoff_invalid'
  | 'file_edge_invalid'
  // 编译级
  | 'prompt_empty'
  | 'too_many_nodes'
  | 'no_nodes'
  // 警告
  | 'loop_without_exit'
  | 'mixed_conditional_edges'
  | 'duplicate_edge'
  | 'shared_output'
  | 'file_overwritten'
  | 'unknown_node_type'
  | 'unknown_fields_dropped'
  // 提示
  | 'branch_not_exhaustive'
  | 'freeform_when'
  | 'multi_back_edges'
  | 'file_unwritten'
  | 'file_order'
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
// 工具线格式（唯一工具 workflow_lite，16 个 action）
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
  'configure',
  'write_file',
  'runs',
  'resume',
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
  /** 节点模板的一句话描述（有才给）。 */
  description?: string
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
  /** 前置步骤（含回边）的 `id`，按 `id` 码位序。 */
  predecessors: string[]
  /** 它读的文件（路径）。 */
  reads?: string[]
  /** 它写的文件（路径；`update` = 在原文件上更新）。 */
  writes?: { path: string; update?: true }[]
}

/** 索引里的一个文件节点。 */
export interface FileIndexEntry {
  id: string
  path: string
  rule?: string
  /** 写它的步骤 id（`update` = 在原文件上更新）。 */
  writers: { id: string; update?: true }[]
  /** 读它的步骤 id。 */
  readers: string[]
}

export interface ReadIndexResult {
  workflow: string
  viewport: Viewport
  /** 工作流设置（有才给）。 */
  settings?: WorkflowSettings
  nodes: NodeIndexEntry[]
  /** 文件节点（有才给）。 */
  files?: FileIndexEntry[]
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
  | { action: 'configure'; result: WriteResult }
  | { action: 'write_file'; result: WriteResult }
  | { action: 'runs'; result: unknown }
  | { action: 'resume'; result: unknown }

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
