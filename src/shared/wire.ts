/**
 * dsh-workflow-lite — 画布 ↔ host 的线格式。
 *
 * 画布与 host 走**共享 Connection 的 `/api` 通道**（与生态里其它插件同一条路）：
 * host 侧一个 endpoint 注册一条精确 Fetch 路由，客户端用 `connection.rpc.call` 调。
 * 这里只放**名字与形状**，host 与 client 两边都 import 它，避免两处各写一套字面量。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire
 */

import type {
  CompileResult,
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
}

/** 画布内部用的节点索引（host 的 `read` 索引与它同构）。 */
export type { CompileResult, NodeIndexEntry, Viewport, WorkflowNode }
