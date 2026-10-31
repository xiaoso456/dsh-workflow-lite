/**
 * dsh-workflow-lite — 画布 ↔ host 的线格式。
 *
 * 画布与 host 走**共享 Connection 的 `/api` 通道**（与生态里其它插件同一条路）：
 * host 侧一个 endpoint 注册一条精确 Fetch 路由，客户端用 `connection.rpc.call` 调。
 * 这里只放**名字与形状**，host 与 client 两边都 import 它，避免两处各写一套字面量。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire
 */

import type { MemoryEntry, MemoryVersionEntry } from './memoryLib.ts'
import type {
  PackApplyRequest,
  PackApplyResponse,
  PackExportRequest,
  PackExportResponse,
  PackImportPreview,
  PackReadRequest,
  PackReadResponse,
  PackScanRequest,
  PackScanResponse,
  PackTokenRequest,
  PackUploadRequest,
  PackUploadResponse,
} from './pack.ts'
import type { InstanceSummary, InstanceView, StateEdit } from './runState.ts'
import type {
  SkillBrowseRequest,
  SkillBuildRequest,
  SkillExportRequest,
  SkillExportResponse,
  SkillFileResponse,
  SkillImageRequest,
  SkillPreviewResponse,
} from './skillPack.ts'
import type {
  CompileResult,
  InputAnswer,
  LineFilter,
  ListResult,
  MemoryType,
  NodeData,
  NodeIndexEntry,
  PlanId,
  TemplateEntry,
  ToolWarning,
  ValidationProblem,
  VersionEntry,
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
  'graph/versions',
  'graph/versionSave',
  'graph/versionLoad',
  'graph/versionRestore',
  'graph/versionNote',
  'graph/versionDelete',
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
  'run/lines',
  'run/image',
  'run/dir',
  'run/stat',
  'run/history',
  'run/latest',
  'memory/list',
  'memory/create',
  'memory/update',
  'memory/delete',
  'memory/file',
  'memory/image',
  'memory/dir',
  'memory/versions',
  'memory/versionSave',
  'memory/versionRestore',
  'memory/versionNote',
  'memory/versionDelete',
  'host/list',
  'host/skills',
  'host/skill',
  'config/get',
  'config/set',
  'pack/scan',
  'pack/export',
  'pack/read',
  'pack/upload',
  'pack/inspect',
  'pack/apply',
  'pack/discard',
  'pack/skillPreview',
  'pack/skillExport',
  'pack/skillDir',
  'pack/skillFile',
  'pack/skillImage',
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

// ── 工作流版本 ─────────────────────

/** `graph/versions` —— 一个工作流存下的版本，新的在前。 */
export interface GraphVersionsRequest {
  name: string
}
export interface GraphVersionsResponse {
  versions: VersionEntry[]
}

/** `graph/versionSave` —— 把磁盘上现在的样子存成新版本。内容和已有版本一样时报 `invalid_args`（`detail.same`）。 */
export interface GraphVersionSaveRequest {
  name: string
  note?: string
  /** 连同引用的记忆一起存：每条各存一份，说明相同（内容没变的跳过）。 */
  memories?: boolean
}
export interface GraphVersionSaveResponse {
  /** 只有给了 `memories` 才可能是 `null`：工作流和 v`same` 一样，没另存（记忆照存）。 */
  version: VersionEntry | null
  same?: number
  /** 给了 `memories` 才有：每条记忆存下的版本；没变是 `null`，存不了带 `error`。 */
  memories?: { id: string; version: MemoryVersionEntry | null; error?: string }[]
}

/** `graph/versionLoad` —— 读一个版本的整张图（切换前看会变什么）。 */
export interface GraphVersionLoadRequest {
  name: string
  n: number
}
export interface GraphVersionLoadResponse {
  version: VersionEntry
  document: WorkflowDocument
}

/** `graph/versionRestore` —— 切到某个版本；现在的内容没存成版本时先自动存一份（`saved`）。 */
export interface GraphVersionRestoreRequest {
  name: string
  n: number
}
export interface GraphVersionRestoreResponse {
  /** 写回后的整图哈希。 */
  hash: string
  saved: VersionEntry | null
}

/** `graph/versionNote` —— 改版本说明。 */
export interface GraphVersionNoteRequest {
  name: string
  n: number
  note: string
}
export interface GraphVersionNoteResponse {
  version: VersionEntry
}

/** `graph/versionDelete` */
export interface GraphVersionDeleteRequest {
  name: string
  n: number
}

// ── 记忆库 ─────────────────────

/** `memory/list` —— 库里的全部记忆，按名称排。 */
export interface MemoryListResponse {
  memories: MemoryEntry[]
}

/** `memory/create` —— 新建一条：`id` 是建议的（撞了加序号，不给就按类型取默认的），名称缺省等于 id。 */
export interface MemoryCreateRequest {
  type: MemoryType
  id?: string
  name?: string
  description?: string
}
export interface MemoryEntryResponse {
  memory: MemoryEntry
}

/** `memory/update` —— 改名称、描述（id、类型不改）。 */
export interface MemoryUpdateRequest {
  id: string
  name?: string
  description?: string
}

/** 指一条记忆（`memory/delete`、`memory/versions`）。 */
export interface MemoryIdRequest {
  id: string
}

/** `memory/file`、`memory/dir` —— 看记忆文件夹里的东西；给 `version` 看的是那个版本的拷贝。`sub` 同 {@link RunFileRequest.sub}。 */
export interface MemoryBrowseRequest {
  id: string
  version?: number
  sub?: string
}
export interface MemoryImageRequest extends MemoryBrowseRequest {
  /** 同 {@link RunImageRequest.src}。 */
  src?: string
}

export interface MemoryVersionsResponse {
  versions: MemoryVersionEntry[]
}

/** `memory/versionSave` —— 把现在的文件夹存成新版本。内容和已有版本一样时报 `invalid_args`（`detail.same`）。 */
export interface MemoryVersionSaveRequest {
  id: string
  note?: string
}
export interface MemoryVersionResponse {
  version: MemoryVersionEntry
}

/** 指一个版本（`memory/versionRestore`、`memory/versionDelete`）。 */
export interface MemoryVersionRequest {
  id: string
  n: number
}
/** 恢复：现在的内容没存成版本时先自动存一份（`saved`）。 */
export interface MemoryVersionRestoreResponse {
  saved: MemoryVersionEntry | null
}

export interface MemoryVersionNoteRequest {
  id: string
  n: number
  note: string
}

/** `graph/templates` —— 节点模板库（「我的步骤」）。 */
export type GraphTemplatesRequest = Record<string, never>
export interface GraphTemplatesResponse {
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
  'graph/versions': { args: GraphVersionsRequest; result: GraphVersionsResponse }
  'graph/versionSave': { args: GraphVersionSaveRequest; result: GraphVersionSaveResponse }
  'graph/versionLoad': { args: GraphVersionLoadRequest; result: GraphVersionLoadResponse }
  'graph/versionRestore': { args: GraphVersionRestoreRequest; result: GraphVersionRestoreResponse }
  'graph/versionNote': { args: GraphVersionNoteRequest; result: GraphVersionNoteResponse }
  'graph/versionDelete': { args: GraphVersionDeleteRequest; result: { removed: true } }
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
  'run/lines': { args: RunLinesRequest; result: RunLinesResponse }
  'run/image': { args: RunImageRequest; result: RunImageResponse }
  'run/dir': { args: RunDirRequest; result: RunDirResponse }
  'run/stat': { args: RunStatRequest; result: RunStatResponse }
  'run/history': { args: RunHistoryRequest; result: RunHistoryResponse }
  'run/latest': { args: RunLatestRequest; result: RunLatestResponse }
  'memory/list': { args: Record<string, never>; result: MemoryListResponse }
  'memory/create': { args: MemoryCreateRequest; result: MemoryEntryResponse }
  'memory/update': { args: MemoryUpdateRequest; result: MemoryEntryResponse }
  'memory/delete': { args: MemoryIdRequest; result: { removed: true } }
  'memory/file': { args: MemoryBrowseRequest; result: RunFileResponse }
  'memory/image': { args: MemoryImageRequest; result: RunImageResponse }
  'memory/dir': { args: MemoryBrowseRequest; result: RunDirResponse }
  'memory/versions': { args: MemoryIdRequest; result: MemoryVersionsResponse }
  'memory/versionSave': { args: MemoryVersionSaveRequest; result: MemoryVersionResponse }
  'memory/versionRestore': { args: MemoryVersionRequest; result: MemoryVersionRestoreResponse }
  'memory/versionNote': { args: MemoryVersionNoteRequest; result: MemoryVersionResponse }
  'memory/versionDelete': { args: MemoryVersionRequest; result: { removed: true } }
  'host/list': { args: HostListRequest; result: HostListResponse }
  'host/skills': { args: HostSkillsRequest; result: HostSkillsResponse }
  'host/skill': { args: HostSkillRequest; result: HostSkillResponse }
  'config/get': { args: Record<string, never>; result: PluginConfigView }
  'config/set': { args: PluginConfigWrite; result: PluginConfigView }
  'pack/scan': { args: PackScanRequest; result: PackScanResponse }
  'pack/export': { args: PackExportRequest; result: PackExportResponse }
  'pack/read': { args: PackReadRequest; result: PackReadResponse }
  'pack/upload': { args: PackUploadRequest; result: PackUploadResponse }
  'pack/inspect': { args: PackTokenRequest; result: PackImportPreview }
  'pack/apply': { args: PackApplyRequest; result: PackApplyResponse }
  'pack/discard': { args: PackTokenRequest; result: { removed: true } }
  'pack/skillPreview': { args: SkillBuildRequest; result: SkillPreviewResponse }
  'pack/skillExport': { args: SkillExportRequest; result: SkillExportResponse }
  'pack/skillDir': { args: SkillBrowseRequest; result: RunDirResponse }
  'pack/skillFile': { args: SkillBrowseRequest; result: SkillFileResponse }
  'pack/skillImage': { args: SkillImageRequest; result: RunImageResponse }
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
  /** SKILL.md 头部里解析出的其余键值（原样，值可能是字符串、数字、列表、对象）；头部没有别的键就不带。 */
  metadata?: Record<string, unknown>
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

/**
 * `run/latest`：模板画布上的展示卡要看「上次执行」的结果——这个工作流最近的几个实例里，
 * 同一个资源（id 相同）里同一个文件（路径原文相同）真的生成了的，取修改时间最新的那一份。
 */
export interface RunLatestRequest {
  workflow: string
  /** 最多 {@link RUN_STAT_MAX} 项；`value` 是模板里这一项的路径原文。 */
  targets: { node: string; value: string }[]
}
export interface RunLatestOutput {
  instance: string
  /** 这一项在那个实例的图里是第几项（读内容时用它）。 */
  item: number
  size: number
  mtime: number
}
export interface RunLatestResponse {
  /** 和 `targets` 一一对应；哪个实例里都没生成是 `null`。 */
  latest: (RunLatestOutput | null)[]
}

/** `run/latest` 往回看这个工作流最近建的几个实例。 */
export const RUN_LATEST_SCAN = 20

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
  /** `false` = 只保存、不通知模型（也不暂存通知）；缺省通知。 */
  notify?: boolean
  /** 改了图时：改之前那版的 planId 与改完的整张图（工作流设置不在实例里改，给了也不认）。 */
  graph?: { base: string; document: WorkflowDocument }
}
export interface RunSaveResponse {
  /** 通知送到模型了没有；没送到时模型下次调用工具会收到。 */
  notified: boolean
  mtime: number
  /** 改了图时：新图的 planId。 */
  planId?: string
  /** 没有通知模型：只改了不进计划的东西（挪卡片、描述），或者用户选了不通知。 */
  quiet?: true
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
  /** 那个会话的工作区（状态文件建在这里、计划的「本次执行」也用它）。 */
  cwd?: string
  /** 用户在「执行」前对输入节点的回答（输入 id → 回答）；没回答的用默认值。 */
  answers?: Record<string, InputAnswer>
}
export interface RunStartResponse {
  instance: InstanceSummary
  prompt: string
}

/** `run/file` 整份带回正文的上限（字节）；再大只回元信息。 */
export const RUN_FILE_TEXT_MAX = 1024 * 1024

/** HTML 的上限单独放宽：报告、看板这类产出常有几 MB。 */
export const RUN_FILE_HTML_MAX = 8 * 1024 * 1024

/** 文件能怎么看：Markdown / HTML / 纯文本带正文；二进制、太大、不在、是个文件夹只有元信息。 */
export type RunFileKind =
  | 'markdown'
  | 'html'
  | 'text'
  | 'binary'
  | 'tooLarge'
  | 'missing'
  | 'folder'

/**
 * `run/file`：看实例里的一份文件。`node` + `item` = 快照里某个资源的第几项（文件）；
 * `path` = 实例工作区里的相对路径（状态文件 `outputs` 里写的）。工作区外的随手路径一律拒绝。
 */
export interface RunFileRequest {
  id: string
  node?: string
  item?: number
  path?: string
  /**
   * `node` + `item` 指向文件夹时，看文件夹里的哪一份：相对那个文件夹的路径（`/` 分隔，只能往下走，
   * 不许 `..`、不许落到文件夹外面——软链指出去的也不行）。
   */
  sub?: string
  /** `node` + `item` 指向文件时，看存下的第几版（{@link RunVersion.v}）；不给就是现在的文件。 */
  version?: number
  /** 纯文本太大时读最后一段（日志看最新的）而不是只回「太大」，见 {@link RunFileResponse.cut}。 */
  tail?: boolean
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
  /** `markdown` / `html` / `text` 时才有。 */
  text?: string
  limit: number
  /** 带 `tail` 读、文件太大时：前面没读的字节数（`text` 是从这之后到末尾）。 */
  cut?: number
}

/** `run/lines` 的筛选（和展示设置里存的是同一个形状）。 */
export type { LineFilter }

/** `run/lines` 一次最多要多少行。 */
export const RUN_LINES_MAX = 2000
/** 不筛时一次最多读多少字节（凑不够行数也停）。 */
export const RUN_LINES_PLAIN_BYTES = 1024 * 1024
/** 筛的时候最多扫多少字节、多久（扫到就停，回的结果说清楚只扫了多少）。 */
export const RUN_LINES_FILTER_BYTES = 64 * 1024 * 1024
export const RUN_LINES_FILTER_MS = 300

/**
 * `run/lines`：日志、纯文本按行读（画布上只拿要显示的那几行，不整份读）。定位同 {@link RunFileRequest}（`node` + `item`，
 * 文件夹里的一份带 `sub`，存下的一版带 `version`）。
 * - `tail`：从末尾往前要 `limit` 行；给了 `before`（上一回的 `start`）就是接着往上翻。
 * - `head`：从 `from`（缺省 0）往后要 `limit` 行。
 * - `follow`：从上一回的 `end` 起读新追加的（`tag` 是上一回给的指纹，对不上——文件被重写、截短过——就当 `tail` 重读，
 *   回答里没有 `appended`）。
 */
export interface RunLinesRequest {
  id: string
  node: string
  item?: number
  sub?: string
  version?: number
  mode: 'tail' | 'head' | 'follow'
  limit: number
  before?: number
  from?: number
  tag?: string
  /** `follow` + 带上下文筛：上一回最后一处匹配还欠几行下文（上一回的 `owed`）。 */
  owed?: number
  filter?: LineFilter
}

/** 一行。 */
export interface RunLine {
  /** 行首在文件里的字节位置。 */
  at: number
  /** 去掉了行尾换行、终端颜色码；太长的截到 4096 个字（`long`）。 */
  text: string
  /** 命中的几段：`[起, 止, 起, 止, …]`（字的下标）。 */
  hits?: number[]
  /** 是匹配行的上下文，自己不匹配。 */
  ctx?: true
  long?: true
  /** 和前一行（这一回的第一行：和读的起点）之间跳过了几行（筛掉的）。 */
  skip?: number
}

export interface RunLinesResponse {
  path: string
  display: string
  exists: boolean
  size: number
  mtime: number
  /** `lines` 才有行；二进制、UTF-16（不按行读，改用 `run/file`）、不在的只有元信息。 */
  kind: 'lines' | 'binary' | 'utf16' | 'missing'
  /** 按文件里的顺序。 */
  lines: RunLine[]
  /** 末尾还没写完（没有换行）的那一行：显示，但不算进 `end`，续读时写完了再给。 */
  pending?: RunLine
  /** 这一回扫过的范围（字节）：`start` 起、`end` 止（`end` 在行首）。往上翻带 `start`，往下、续读带 `end`。 */
  start: number
  end: number
  /** `end` 处的指纹（续读时带回来）。 */
  tag: string
  /** 最后一行之后、`end` 之前还扫过几行（筛掉的）。 */
  trail: number
  /** 扫过的范围里匹配了几行（不筛时 = 行数）。 */
  matched: number
  /** 这一回的方向上还有没扫的：`tail` = `start` 前面还有，`head` = `end` 后面还有。 */
  more: boolean
  /** 最后一处匹配还欠几行下文（续读时带回来）。 */
  owed?: number
  /** 扫到上限停下了：`bytes` 字节、`time` 时间。 */
  stopped?: 'bytes' | 'time'
  /** 续读时一下子多出太多，只给了最后那些：和上一回接不上。 */
  gap?: true
  /** 续读成功：这些行接在上一回后面。 */
  appended?: true
}

/** `run/image` 一张图的上限（字节）。 */
export const RUN_IMAGE_MAX = 8 * 1024 * 1024

/**
 * `run/image`：实例里一份 Markdown 引用的本地图片。文档用 `run/file` 的同一套定位（`node` + `item`
 * 或 `path`），`src` 是文档里写的相对路径，按文档所在目录解析。只认图片扩展名；解析出来的位置
 * 必须在实例工作区里，或在文档自己的目录下（产出根目录是工作区外的绝对路径时）。
 */
export interface RunImageRequest extends RunFileRequest {
  /** 不给就是目标文件自己（它得是张图）：文件夹里点开一张图用的。 */
  src?: string
}
export interface RunImageResponse {
  mime: string
  /** 图片字节的 base64。 */
  data: string
}

/** `run/stat` 一次最多问几份。 */
export const RUN_STAT_MAX = 64

/**
 * `run/stat`：快照里几个资源项（文件）现在的样子，只看在不在、大小、修改时间，不读内容。
 * 画布上展示着的卡隔一会儿问一次，变了才重读内容。
 */
export interface RunStatRequest {
  id: string
  targets: { node: string; item: number }[]
}
export interface RunStatResponse {
  /**
   * 按 `targets` 的顺序；定位不到（项不在快照里、越界）的当作不在。
   * `versions`：这一项存下了几版（见 {@link RunHistoryResponse}）；`revision`：各版每变一次（多存一版、
   * 记了一条判定）加一，变了再去问 `run/history`。
   */
  stats: { exists: boolean; size: number; mtime: number; versions: number; revision: number }[]
}

/**
 * 一份产出存下的一版。写它的步骤每一轮做完（完成或失败）存一版；在原文件上更新的、开始前就在的，
 * 第一次开始前先存一份原样（`phase: 'before'`）。和上一版一样的不存。
 */
export interface RunVersion {
  /** 版本号：这份文件里从 1 递增，删掉中间的也不重排。读这一版时带上它。 */
  v: number
  /** 写它的步骤。 */
  step: string
  /** 那个步骤的第几轮。 */
  round: number
  phase: 'before' | 'done' | 'failed'
  /** 存下的时间（毫秒）。 */
  at: number
  size: number
  /** 存的时候原文件的修改时间：和现在的文件对得上 = 现在就是这一版。 */
  mtime: number
  /** 读过（或写了）这一版之后给出的判定；`again` = 这个判定把流程领回去重做。 */
  verdicts?: { step: string; value: string; again: boolean }[]
}

/** `run/history`：快照里一个资源项（文件）存下的各版，旧的在前。 */
export interface RunHistoryRequest {
  id: string
  node: string
  item?: number
}
export interface RunHistoryResponse {
  versions: RunVersion[]
  /** 超了上限、从中间删掉的版数（第一版和最近的留着）。 */
  dropped: number
}

/** 一份产出最多存几版（超了删中间的，第一版留着）。 */
export const RUN_HISTORY_VERSIONS_MAX = 20

/** 一份文件超过这么大就不存了（反正也只能这么大才看得了）。 */
export const RUN_HISTORY_FILE_MAX = 8 * 1024 * 1024

/** 一个实例存的各版加起来最多这么大（超了从版数最多的那份删中间的）。 */
export const RUN_HISTORY_INSTANCE_MAX = 100 * 1024 * 1024

/** `run/dir` 一次最多列多少项。 */
export const RUN_DIR_MAX = 3000

/**
 * `run/dir`：看资源里一个文件夹（及它下面的子文件夹）里有什么。`node` + `item` 定位文件夹项，
 * `sub` 是往下走的相对路径（缺省 = 文件夹本身），规矩同 {@link RunFileRequest.sub}。
 */
export interface RunDirRequest {
  id: string
  node: string
  item?: number
  sub?: string
}

export interface RunDirEntry {
  name: string
  dir: boolean
  /** 字节数；文件夹是 0。 */
  size: number
  mtime: number
  /** 子文件夹里有几项、其中几张图（只数一层；子文件夹多时只数前 {@link RUN_DIR_COUNTED} 个）。 */
  items?: number
  images?: number
}

/** 一层里最多数几个子文件夹的项数。 */
export const RUN_DIR_COUNTED = 64
export interface RunDirResponse {
  /** 这一层的绝对路径。 */
  path: string
  /** 给人看的路径。 */
  display: string
  /** 整理过的 `sub`（`/` 分隔、没有首尾斜杠；根是空串）。 */
  sub: string
  /** 目录在不在（不在时 `entries` 为空）。 */
  exists: boolean
  /** 目录在前、各自按名字排（数字按大小）；`.` 开头的也列。 */
  entries: RunDirEntry[]
  /** 条目太多只列了一部分。 */
  truncated: boolean
}

/** `run/storage`：存储统计与清理。 */
export interface RunStorageRequest {
  action?: 'stats' | 'clearDispatch' | 'clearFinished' | 'clearHistory'
}
export interface StorageStats {
  dataDir: string
  /** `workflows/` 下的文件数与字节数。 */
  workflows: number
  workflowBytes: number
  /** 我的步骤（`templates/nodes/`）。 */
  templates: number
  templateBytes: number
  /** 工作流版本（`versions/`）。 */
  versions: number
  versionBytes: number
  /** 记忆库里几条；占用连同记忆的版本（`memories/` + `memory-versions/`）。 */
  memories: number
  memoryBytes: number
  instances: number
  /** 已结束（完成 / 已取消）的实例数。 */
  finished: number
  /** 实例在数据目录里的占用（`runs/` 下的图快照与回答；工作区里的实例目录不算）。 */
  instanceBytes: number
  /** 其中各实例存下的产出各版（`runs/<实例>/history/`）占多少。 */
  historyBytes: number
  /** 旧版本遗留的任务描述（`.dispatch/`），现在已不再读写。 */
  dispatchFiles: number
  dispatchBytes: number
  /** 这次清理删掉了几项（只在清理动作里有）。 */
  cleared?: number
}

// ── 插件设置（工作流中心「设置」页）──────────────────────

/** 设置页能改的几项（插件 Config 里给人用的那几个，`routePrefix` 这类接线细节不露）。 */
export const PLUGIN_CONFIG_KEYS = [
  'dataDir',
  'maxNodes',
  'saveDebounceMs',
  'maxResultBytes',
  'installSkill',
] as const
export type PluginConfigKey = (typeof PLUGIN_CONFIG_KEYS)[number]

export interface PluginConfigValues {
  dataDir: string
  maxNodes: number
  saveDebounceMs: number
  maxResultBytes: number
  installSkill: boolean
}

/** 要重启 DSH 才生效的几项（装配时定住的）。 */
export const RESTART_CONFIG_KEYS: readonly PluginConfigKey[] = ['dataDir', 'installSkill']

/**
 * `config/get` / `config/set` 的回答。`available: false` = 这个 DSH 没有设置服务，页面只读地显示现值。
 * `defaults` 是去掉用户改动后的值（schema 默认值，或 profile 里更底层给的值），「恢复默认」就回到它。
 */
export interface PluginConfigView {
  available: boolean
  writable: boolean
  revision: number
  values: PluginConfigValues
  defaults: PluginConfigValues
  /** 用户改过的那几项。 */
  overridden: PluginConfigKey[]
}

/** `config/set`：改几项、把几项恢复默认；`revision` 是读到时的修订号，别人先改了就拒绝。 */
export interface PluginConfigWrite {
  revision: number
  set?: Partial<PluginConfigValues>
  reset?: PluginConfigKey[]
}

/** 画布内部用的节点索引（host 的 `read` 索引与它同构）。 */
export type { CompileResult, NodeIndexEntry, Viewport, WorkflowNode }
