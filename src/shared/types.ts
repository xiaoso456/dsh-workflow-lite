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

/**
 * 资源节点的类型标记：一组给步骤用的东西（文件、文件夹、网址、Skill、自定义）。
 * 步骤写它（步骤 → 资源，写的是其中的文件与文件夹）、读它（资源 → 步骤）。
 */
export const RESOURCE_TYPE = 'wfResource'

/** 输入节点的类型标记：执行前问用户的一个问题，连到用得着回答的步骤上（输入 → 步骤）。 */
export const INPUT_TYPE = 'wfInput'

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

/** 图里的节点：步骤、资源，或输入。 */
export type WorkflowNode = StepNode | ResourceNode | InputNode

export interface StepNode {
  /** 身份，**创建后不可改**；同时是载荷文件名 ⇒ 受文件名约束。图内**大小写不敏感唯一**。 */
  id: string
  type: typeof NODE_TYPE
  /** **存盘**。缺失（或 `(0,0)`）→ 布局补位并回写，不算保存级。 */
  position: Point
  data: NodeData
}

/**
 * 资源节点：一组独立于某一次运行的东西，几个步骤可以先后写它、读它。一个资源里可以放好几项。
 * `id` 与步骤共用一个命名空间（图内大小写不敏感唯一），但不产生载荷文件。
 * 一条线都没连的资源交给整个工作流（每个步骤都能用）。
 */
export interface ResourceNode {
  id: string
  type: typeof RESOURCE_TYPE
  position: Point
  data: ResourceData
}

/**
 * 资源里一项的种类：
 * - `file` 文件、`folder` 文件夹：`value` 是路径。绝对路径原样用；相对路径在有步骤写这个资源时
 *   放在产出根目录下，只被读时相对工作区（见 `shared/outputPaths.ts` 的 `resolveItemPath`）；
 * - `url` 网址；`skill` DSH 能识别的 skill 名；`text` 自定义（一段原样交给执行者的提示词）。
 */
export const RESOURCE_KINDS = ['file', 'folder', 'url', 'skill', 'text'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/** 步骤能写的种类（其余的只能读）。 */
export const WRITABLE_KINDS: readonly ResourceKind[] = ['file', 'folder']

export interface ResourceItem {
  kind: ResourceKind
  /** 路径 / 网址 / skill 名 / 自定义的正文。空 = 编译级。 */
  value: string
  /** 这一项怎么用（写文件时是生成要求）。进计划；`text` 不用它。 */
  note?: string
}

export interface ResourceData {
  /** 名字：卡片标题，也是计划里称呼它的方式。缺省回落成内容摘要。**不得含换行或 `|`**。 */
  label?: string
  /** 一句话描述（给人看：卡片上显示）。**不进计划**。 */
  description?: string
  /** 内容，按添加顺序。 */
  items: ResourceItem[]
}

/**
 * 输入节点：执行前问用户的一个问题。用户点「执行」时先填好它们，编译时**问题与回答**进计划，
 * 占位与说明只给填写的人看，不进计划。
 * `id` 与步骤、文件共用一个命名空间，但不产生载荷文件。
 */
export interface InputNode {
  id: string
  type: typeof INPUT_TYPE
  position: Point
  data: InputData
}

/** 输入的交互方式：单行文字 / 多行文字 / 单选 / 多选。 */
export const INPUT_KINDS = ['text', 'textarea', 'choice', 'multi'] as const
export type InputKind = (typeof INPUT_KINDS)[number]

/** 一份回答：文字题与单选是一段文字，多选是选中的那几项（按选项顺序）。 */
export type InputAnswer = string | string[]

export interface InputData {
  /** 问题：原样进计划。空 = 编译级。**不得含换行**。 */
  question: string
  /** 交互方式；缺省 = `text`（`text` 不写盘）。 */
  kind?: Exclude<InputKind, 'text'>
  /** 选项（单选 / 多选用；其余方式不写）。 */
  options?: string[]
  /** 默认值：文字题是预填的文字，单选是一个选项，多选是若干选项。用户没改就用它。 */
  default?: InputAnswer
  /** 占位：输入框里的灰字。不进计划。 */
  placeholder?: string
  /** 说明：填写时显示在问题下面。不进计划。 */
  hint?: string
  /** 必填：没有回答（也没有默认值）时不能执行。 */
  required?: true
}

export interface NodeData {
  /** 显示名。不要求唯一、不参与寻址与排序；缺省或空串时回落渲染 `id`。**不得含换行或 `|`**。 */
  label?: string
  /** 一句话说明这一步做什么（给人看：步骤库、卡片）。**不进计划**，也不进载荷。 */
  description?: string
  /** 卡片上的图标（图标库里的名字，见 `shared/appearance.ts`）；缺省按 id 猜。不进计划。 */
  icon?: string
  /** 卡片的颜色（色板里的名字）；缺省按 id 猜。不进计划。 */
  color?: string
  /** 提示词正文，逐字交给执行者。**缺失或为空串 = 编译级**（允许落盘、阻塞编译）。 */
  prompt?: string
  /**
   * 产出契约——**只在步骤模板里用**（模板放到画布上时展开成资源节点，每个产出一个文件项）；
   * 图里的产出是资源节点。
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
   * 资源不走这里——资源是独立的节点，谁写谁读看连到它的线。
   */
  handoff?: Handoff | false
  /**
   * 写入方式（只用在步骤 → 资源的线上）：缺省 = 产出（整份写出 / 覆盖）；
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
  /** 本次目标；缺省时 ⑤ 段不写这一行。 */
  goal?: string
  /** 工作区路径（＝ ⑤ 段的 cwd）；取不到时 ⑤ 渲染「工作区路径：未指定」。 */
  cwd?: string
  /** 工作流实例 id（预览时是 `{instance}`）；不给就不写。 */
  instance?: string
  /**
   * 用户对输入节点的回答（输入 id → 回答）。**不给 = 预览**：问题照写，回答处写「执行时填写」；
   * 给了（哪怕是空对象）= 真的要执行：没回答的用默认值，必填的还空着就是编译级。
   */
  answers?: Readonly<Record<string, InputAnswer>>
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
  | 'resource_edge_invalid'
  | 'resource_invalid'
  | 'input_invalid'
  // 编译级
  | 'prompt_empty'
  | 'too_many_nodes'
  | 'no_nodes'
  | 'input_question_empty'
  | 'input_options_empty'
  | 'input_missing'
  | 'resource_empty'
  | 'resource_item_empty'
  | 'resource_unwritable'
  // 警告
  | 'loop_without_exit'
  | 'mixed_conditional_edges'
  | 'duplicate_edge'
  | 'shared_output'
  | 'resource_overwritten'
  | 'input_default_invalid'
  | 'unknown_node_type'
  | 'unknown_fields_dropped'
  // 提示
  | 'branch_not_exhaustive'
  | 'freeform_when'
  | 'multi_back_edges'
  | 'resource_order'
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
  'write_resource',
  'runs',
  'resume',
  'state',
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
  /** 节点模板选的图标与颜色（有才给）。 */
  icon?: string
  color?: string
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
  /** 它读的资源（资源 id）。 */
  reads?: string[]
  /** 它写的资源（资源 id；`update` = 在原文件上更新）。 */
  writes?: { id: string; update?: true }[]
  /** 交给它的用户输入（输入节点 id）。 */
  inputs?: string[]
}

/** 索引里的一个输入节点（不含占位与说明——那是给填写的人看的）。 */
export interface InputIndexEntry {
  id: string
  question: string
  kind: InputKind
  options?: string[]
  default?: InputAnswer
  required?: true
  /** 回答交给哪些步骤；空 = 交给整个工作流。 */
  readers: string[]
}

/** 索引里的一个资源节点（不含描述——那是给人看的）。 */
export interface ResourceIndexEntry {
  id: string
  label?: string
  items: ResourceItem[]
  /** 写它的步骤 id（`update` = 在原文件上更新）。 */
  writers: { id: string; update?: true }[]
  /** 读它的步骤 id；写读都没有 = 交给整个工作流。 */
  readers: string[]
}

export interface ReadIndexResult {
  workflow: string
  viewport: Viewport
  /** 工作流设置（有才给）。 */
  settings?: WorkflowSettings
  nodes: NodeIndexEntry[]
  /** 资源节点（有才给）。 */
  resources?: ResourceIndexEntry[]
  /** 输入节点（有才给），按画布上从上到下的顺序。 */
  inputs?: InputIndexEntry[]
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
  | { action: 'write_resource'; result: WriteResult }
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
  /** 被环外入边指向的入口节点；没有环外入边时按语义挑最像起点的（见 `graph.ts` 的 `loopStart`）。 */
  entry: string
  /** 环上指向环外的条件边 id ⇒ 有出口；空 ⇒ 循环体没有出口（警告）。 */
  exits: string[]
}

/** 执行批次：一批可并行的节点。 */
export interface ExecutionBatch {
  /** 节点 id，按 `id` 码位序。 */
  nodes: string[]
}
