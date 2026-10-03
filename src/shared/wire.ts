/**
 * dsh-workflow-lite — 画布 ↔ host 的线格式。
 *
 * 画布与 host 走**共享 Connection 的 `/api` 通道**（与生态里其它插件同一条路）：
 * host 侧一个 endpoint 注册一条精确 Fetch 路由，客户端用 `connection.rpc.call` 调。
 * 这里只放**名字与形状**，host 与 client 两边都 import 它，避免两处各写一套字面量。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire
 */

import type { InstanceSummary, InstanceView, StateEdit } from './runState.ts'
import type {
  CompileResult,
  InputAnswer,
  ListResult,
  NodeData,
  NodeIndexEntry,
  PlanId,
  TemplateEntry,
  ToolWarning,
  ValidationProblem,
  Viewport,
  WorkflowDocument,
  WorkflowNode,
} from './types.ts'

/**
 * 共享 Connection 的通道名。
 *
 * **DSH 写死为 `/api`**：客户端载波在发请求前跑 `assertTarget`，通道必须匹配
 * `/^\/[A-Za-z0-9._~-]+$/`（**带前导斜杠**），endpoint 的每一段必须匹配
 * `/^[A-Za-z0-9_$.-]+$/`，然后 POST 到 `` `${channel}/${endpoint}`.slice(1) ``。
 * 传别的值会当场 `invalid RPC target` —— 所以这个常量**不是可配置项**。
 *
 * @see {@link https://github.com/deepseek-ai/dsh-client-connection} `lib/types/client/rpc.ts`
 */
export const API_CHANNEL = '/api'

/** 本插件在 `/api` 下的命名空间（＝ `/api/<namespace>/<endpoint>` 里的那一段）。 */
export const WORKFLOW_LITE_CHANNEL = 'workflow-lite'

/** 画布用到的端点。**只列画布真用得上的**——模型那条路走工具，不走 RPC。 */
export const WORKFLOW_LITE_ENDPOINTS = [
  'graph/list',
  'graph/load',
  'graph/save',
  'graph/create',
  'graph/rename',
  'graph/delete',
  'graph/templates',
  'graph/nodeTemplate',
  'graph/nodeTemplateCreate',
  'graph/nodeTemplateDraft',
  'graph/nodeTemplateSave',
  'graph/nodeTemplateDelete',
  'plan/build',
  'run/list',
  'run/load',
  'run/bind',
  'run/save',
  'run/delete',
  'run/storage',
  'run/start',
  'run/file',
  'host/list',
  'host/skills',
  'host/skill',
] as const

export type WorkflowLiteEndpoint = (typeof WORKFLOW_LITE_ENDPOINTS)[number]

/**
 * 线方法名（＝ RPC 信封里的 `method`，也是通道内的相对路径）：`<namespace>/<endpoint>`。
 *
 * **不要再拼上通道名**：载波自己会把 `<channel>/<endpoint>` 拼起来，
 * 这里多带一段就会变成 `workflow-lite/workflow-lite/graph/list` 而被拒。
 */
export function endpointName(endpoint: WorkflowLiteEndpoint): string {
  return `${WORKFLOW_LITE_CHANNEL}/${endpoint}`
}

/** 路由路径（host 侧注册用）：`<channel>/<method>`。 */
export function routePath(endpoint: WorkflowLiteEndpoint): string {
  return `${API_CHANNEL}/${endpointName(endpoint)}`
}

/** 客户端调 RPC 用的 (channel, endpoint) 二元组——**唯一出处**，别处不许自己拼。 */
export function rpcTarget(endpoint: WorkflowLiteEndpoint): {
  channel: string
  endpoint: string
} {
  return { channel: API_CHANNEL, endpoint: endpointName(endpoint) }
}

// ─────────────────────────────────────────────────────────────
// 端点形状
// ─────────────────────────────────────────────────────────────

/**
 * 一条非阻塞信息（警告 / 提示）——就是工具侧的 `ToolWarning`，不另立一套，
 * 否则两边的 `code` 会各自漂移（一边是 `ValidationCode`，一边是裸 `string`）。
 */
export type WireWarning = ToolWarning

/** `graph/list` —— 顶部工作流选择器的数据源。 */
export interface GraphListRequest {
  /** 预留：未来按需过滤。 */
  filter?: string
}
/**
 * `graph/list` 的回执。
 *
 * 比工具侧的 `ListResult` 多一个 `limits`：画布要自己判「超 `maxNodes` ⇒ 只摆网格假位、
 * 不跑自动布局」，而那条判据是活配置，只有 host 知道。
 */
export interface GraphListResponse extends ListResult {
  limits: {
    maxNodes: number
    saveDebounceMs: number
  }
}

/** `graph/load` —— 打开一张图。 */
export interface GraphLoadRequest {
  name: string
}
export interface GraphLoadResponse {
  name: string
  document: WorkflowDocument
  /** 加载时的内容哈希——保存时要拿它做写前比对。 */
  hash: string
  /** 保存级问题。**非空时画布进只读错误态**，`document` 只是空壳。 */
  problems: ValidationProblem[]
  warnings: WireWarning[]
  /** 解析失败时的原始文本（只读错误态展示用，受 `maxResultBytes` 约束）。 */
  raw?: string
}

/** `graph/save` —— 写回。**整文件重写 + 写前哈希比对 + 字段级合并。** */
export interface GraphSaveRequest {
  name: string
  document: WorkflowDocument
  /** 加载时拿到的哈希。null = 新建后首次写。 */
  baseHash: string | null
  /** 画布「保留我的」：合并出冲突也照写，冲突 id 以本地为准。**工具写路径不传**。 */
  force?: boolean
}
export interface GraphSaveResponse {
  hash: string
  warnings: WireWarning[]
  /** 成功路径上恒为空——真冲突走 `conflict` 错误（`detail.ids`），不写盘。 */
  conflictIds: string[]
}

/** `graph/create` */
export interface GraphCreateRequest {
  name: string
  /** 从 `templates/workflows/<from>.json` 单文件复制。 */
  from?: string
}
export interface GraphCreateResponse {
  /** 实际生成的名字（撞名会加序号）。 */
  name: string
  warnings: WireWarning[]
}

/** `graph/rename` */
export interface GraphRenameRequest {
  name: string
  to: string
}
export interface GraphRenameResponse {
  name: string
  warnings: WireWarning[]
}

/** `graph/delete` */
export interface GraphDeleteRequest {
  name: string
}
export interface GraphDeleteResponse {
  warnings: WireWarning[]
}

/** `graph/templates` —— 模板库。 */
export interface GraphTemplatesRequest {
  /** 预留。 */
  kind?: 'workflows' | 'nodes'
}
export interface GraphTemplatesResponse {
  workflows: TemplateEntry[]
  nodes: TemplateEntry[]
}

/**
 * `graph/nodeTemplate` —— 读一个**节点模板的 `data` 本体**，供画布拖入实例化。
 *
 * 为什么要单独一条：`graph/templates` 只列名字（工具 `list` 的口径），而
 * 「拖入模板节点」= 复制模板的 `data` 本体 + 分配新 `id` + 新 `position`。
 * 没有这条，磁盘模板在画布上就只是个点不动的名字。
 */
export interface GraphNodeTemplateRequest {
  name: string
}
export interface GraphNodeTemplateResponse {
  name: string
  data: NodeData
}

/**
 * `graph/nodeTemplateCreate` —— 在 `templates/nodes/` 下**新建**一个节点模板。
 *
 * 从前模板只能手写 JSON 丢进目录里；画布上「自定义 node」那一节的「＋」磁贴要靠这条
 * 把它建出来。名字是人在对话框里指着输的，所以**撞名报 `conflict`，既不覆盖也不自动加序号**
 * （自动改名会让人找不到刚建的那个；覆盖别人的模板更不可接受）。
 */
export interface GraphNodeTemplateCreateRequest {
  name: string
  /** 模板本体 = 节点的 `data`（`label` / `prompt` / `output`）。 */
  data: NodeData
}
export interface GraphNodeTemplateCreateResponse {
  /** 实际写入的模板名（＝入参；撞名会在写之前报错）。 */
  name: string
  warnings: WireWarning[]
}

/**
 * `graph/nodeTemplateDraft` —— 读一个节点模板给人**编辑**（「我的步骤」的属性面板）。
 *
 * 与 `graph/nodeTemplate` 的区别：那条是"拿去用"，提示词还空着的半成品会被挡掉；
 * 这条只挡文件本身坏了的，半成品正是要打开来改的。
 */
export interface GraphNodeTemplateDraftRequest {
  name: string
}
export type GraphNodeTemplateDraftResponse = GraphNodeTemplateResponse

/**
 * `graph/nodeTemplateSave` —— 覆盖保存一个**已存在**的节点模板。
 * 给了 `from`（旧名字）且与 `name` 不同 = 改名并保存；新名字被占用报 `conflict`。
 */
export interface GraphNodeTemplateSaveRequest {
  name: string
  data: NodeData
  from?: string
}
export interface GraphNodeTemplateSaveResponse {
  name: string
  warnings: WireWarning[]
}

/** `graph/nodeTemplateDelete` —— 删除一个节点模板。 */
export interface GraphNodeTemplateDeleteRequest {
  name: string
}
export interface GraphNodeTemplateDeleteResponse {
  warnings: WireWarning[]
}

/** `plan/build` —— 画布上的编译预览（两个 tab）。 */
export interface PlanBuildRequest {
  name: string
  /** true = 整卷版（内联正文）；缺省 = 派发版。 */
  full?: boolean
  goal?: string
  /** 执行者的工作区根（进 ⑤ 动态尾）；缺省时渲染「工作区路径：未指定」。 */
  cwd?: string
}
export interface PlanBuildResponse {
  plan: string
  planId: PlanId
  /** 只装编译级问题。 */
  problems: ValidationProblem[]
  warnings: WireWarning[]
}

// ─────────────────────────────────────────────────────────────
// 调用映射（client 的 typed caller 用它推类型）
// ─────────────────────────────────────────────────────────────

export interface WorkflowLiteRpcMap {
  'graph/list': { args: GraphListRequest; result: GraphListResponse }
  'graph/load': { args: GraphLoadRequest; result: GraphLoadResponse }
  'graph/save': { args: GraphSaveRequest; result: GraphSaveResponse }
  'graph/create': { args: GraphCreateRequest; result: GraphCreateResponse }
  'graph/rename': { args: GraphRenameRequest; result: GraphRenameResponse }
  'graph/delete': { args: GraphDeleteRequest; result: GraphDeleteResponse }
  'graph/templates': { args: GraphTemplatesRequest; result: GraphTemplatesResponse }
  'graph/nodeTemplate': { args: GraphNodeTemplateRequest; result: GraphNodeTemplateResponse }
  'graph/nodeTemplateCreate': {
    args: GraphNodeTemplateCreateRequest
    result: GraphNodeTemplateCreateResponse
  }
  'graph/nodeTemplateDraft': {
    args: GraphNodeTemplateDraftRequest
    result: GraphNodeTemplateDraftResponse
  }
  'graph/nodeTemplateSave': {
    args: GraphNodeTemplateSaveRequest
    result: GraphNodeTemplateSaveResponse
  }
  'graph/nodeTemplateDelete': {
    args: GraphNodeTemplateDeleteRequest
    result: GraphNodeTemplateDeleteResponse
  }
  'plan/build': { args: PlanBuildRequest; result: PlanBuildResponse }
  'run/list': { args: RunListRequest; result: RunListResponse }
  'run/load': { args: RunLoadRequest; result: RunLoadResponse }
  'run/bind': { args: RunBindRequest; result: { transferred: boolean } }
  'run/save': { args: RunSaveRequest; result: RunSaveResponse }
  'run/delete': { args: RunDeleteRequest; result: { removed: true } }
  'run/storage': { args: RunStorageRequest; result: StorageStats }
  'run/start': { args: RunStartRequest; result: RunStartResponse }
  'run/file': { args: RunFileRequest; result: RunFileResponse }
  'host/list': { args: HostListRequest; result: HostListResponse }
  'host/skills': { args: HostSkillsRequest; result: HostSkillsResponse }
  'host/skill': { args: HostSkillRequest; result: HostSkillResponse }
}

// ── 主机上的东西（资源节点选文件、文件夹、skill 用）─────────

/**
 * `host/list`：列主机上一个目录里的东西（只给名字与是不是目录，不读内容）。
 * `path` 缺省 = `cwd`（会话的工作区），再缺省 = 用户主目录。
 */
export interface HostListRequest {
  path?: string
  cwd?: string
}
export interface HostListEntry {
  name: string
  dir: boolean
}
export interface HostListResponse {
  /** 实际列的目录（绝对路径，分隔符统一成 `/`）。 */
  path: string
  /** 上一级目录；已经是根就是 `null`。 */
  parent: string | null
  /** 目录在前、各自按名字排；隐藏项（`.` 开头）也列出来，由前端决定显不显示。 */
  entries: HostListEntry[]
  /** 列不全（条目太多）时为真。 */
  truncated: boolean
  /** 可以跳去的根：工作区、主目录，Windows 上还有各个盘符。 */
  places: { label: string; path: string }[]
}

/**
 * `host/skills`：会话里的 agent 能用的 skill（只列模型能用的）。
 * 给了 `session` 就按那个会话的 agent 预设看（本地 skill 挂在预设底下）；不给按默认预设。
 */
export interface HostSkillsRequest {
  cwd?: string
  session?: string
}
/** 一个 skill 的摘要。`source`：从哪来（`project-dsh`、`user-agents`、`bundled`…）。 */
export interface HostSkillEntry {
  name: string
  description: string
  source: string
  /** SKILL.md 的绝对路径（分隔符统一成 `/`）；插件运行时注册的 skill 没有。 */
  path?: string
}
export interface HostSkillsResponse {
  skills: HostSkillEntry[]
  /** 没装 skill 服务时为假（前端只能手写名字）。 */
  available: boolean
}

/** `host/skill`：读一个 skill 的全文（预览用）。 */
export interface HostSkillRequest {
  name: string
  cwd?: string
  session?: string
}
export interface HostSkillResponse extends HostSkillEntry {
  /** 什么时候该用它（SKILL.md 头部的 `when_to_use`）。 */
  whenToUse?: string
  /** 正文（Markdown，已去掉头部元数据）。 */
  content: string
}

// ── 工作流实例 ─────────────────────

/** `run/list`：`session` 给了且 `all` 不为真时只列这个会话的。 */
export interface RunListRequest {
  session?: string
  all?: boolean
}
export interface RunListResponse {
  instances: InstanceSummary[]
  /** 请求方会话的当前实例。 */
  current?: string
}

/** `run/load`：`since` = 上次拿到的 `mtime`，文件没变就只回 `unchanged`。 */
export interface RunLoadRequest {
  id: string
  session?: string
  since?: number
}
export type RunLoadResponse = InstanceView | { unchanged: true; mtime: number }

/** `run/bind`：设会话的当前实例（实例属于别的会话时转过来）。 */
export interface RunBindRequest {
  id: string
  session: string
}

/** `run/save`：保存用户在画布上攒的改动，并通知模型。 */
export interface RunSaveRequest {
  id: string
  session?: string
  edits: StateEdit[]
  /** 给模型的说明（可选）。 */
  note?: string
}
export interface RunSaveResponse {
  /** 通知送到模型了没有；没送到时模型下次调用工具会收到。 */
  notified: boolean
  mtime: number
}

/** `run/delete`：删实例记录与快照；`withState` 为真时连状态文件一起删。 */
export interface RunDeleteRequest {
  id: string
  withState?: boolean
}

/**
 * `run/start`：画布上的「执行」——用模板现在的样子建一个新实例，归到 `session`，
 * 回一句要发进那个会话的话（前端走会话输入框的标准发送流程发出去）。
 */
export interface RunStartRequest {
  workflow: string
  session: string
  /** 那个会话的工作区（状态文件建在这里、计划的 ⑤ 段也用它）。 */
  cwd?: string
  /** 用户在「执行」前对输入节点的回答（输入 id → 回答）；没回答的用默认值。 */
  answers?: Record<string, InputAnswer>
}
export interface RunStartResponse {
  instance: InstanceSummary
  prompt: string
}

/** `run/file` 整份带回正文的上限（字节）；再大只回元信息。 */
export const RUN_FILE_TEXT_MAX = 256 * 1024

/** 文件能怎么看：Markdown / 纯文本带正文；二进制、太大、不在只有元信息。 */
export type RunFileKind = 'markdown' | 'text' | 'binary' | 'tooLarge' | 'missing'

/**
 * `run/file`：看实例里的一份文件。`node` + `item` = 快照里某个资源的第几项（文件）；
 * `path` = 实例工作区里的相对路径（状态文件 `outputs` 里写的）。工作区外的随手路径一律拒绝。
 */
export interface RunFileRequest {
  id: string
  node?: string
  item?: number
  path?: string
}
export interface RunFileResponse {
  /** 绝对路径（交给系统程序打开用）。 */
  path: string
  /** 给人看的路径（相对工作区）。 */
  display: string
  exists: boolean
  size: number
  mtime: number
  kind: RunFileKind
  /** `markdown` / `text` 时才有。 */
  text?: string
  limit: number
}

/** `run/storage`：存储统计与清理。 */
export interface RunStorageRequest {
  action?: 'stats' | 'clearDispatch' | 'clearFinished'
}
export interface StorageStats {
  dataDir: string
  instances: number
  /** 已结束（完成 / 已取消）的实例数。 */
  finished: number
  dispatchFiles: number
  dispatchBytes: number
  /** 这次清理删掉了几项（只在清理动作里有）。 */
  cleared?: number
}

/** 画布内部用的节点索引（host 的 `read` 索引与它同构）。 */
export type { CompileResult, NodeIndexEntry, Viewport, WorkflowNode }
