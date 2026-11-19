/**
 * dsh-workflow-lite — 线格式：`host/*` 端点形状：列主机上的目录与 skill（资源节点选文件、文件夹、skill 用）。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/host
 */

import type { ChoiceFallback } from '../types.ts'

export type { ChoiceFallback } from '../types.ts'

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

// ── 新建会话用什么跑（agent 预设、模型）─────────

/** 一个 agent 预设。内置的几个不带 `name`（界面按 id 译名）。 */
export interface AgentPresetEntry {
  id: string
  name?: string
  description?: string
  /** 不指定预设时 DSH 用的就是它。 */
  isDefault: boolean
  /** 组不起来的原因（坏了）；能用就没有。 */
  broken?: string
}

/** 一档思考强度（模型自己的档位）。 */
export interface ModelEffortEntry {
  id: string
  name: string
}

export interface ModelEntry {
  id: string
  name: string
  description?: string
  /** 能选的档位；空 = 这个模型不分档。 */
  efforts: ModelEffortEntry[]
  defaultEffort?: string
}

export interface ModelProviderEntry {
  id: string
  name: string
  models: ModelEntry[]
}

/**
 * `host/agents`：能选的预设、模型，以及这个 DSH 能不能只给一个会话换模型。
 * 给了 `session`（画布所在的会话）就拿它试一下能不能换；没给、或那个会话不在时按上一次知道的算。
 */
export interface HostAgentsRequest {
  session?: string
}
export interface HostAgentsResponse {
  presets: AgentPresetEntry[]
  providers: ModelProviderEntry[]
  /** 读不出模型列表的服务商。 */
  failures: { id: string; name: string; message: string }[]
  /** DSH 现在的默认模型（「跟随默认」后面写的那个）。 */
  defaultModel?: { provider: string; model: string; effort?: string }
  /** 只给一个会话换模型：能（`true`）/ 这个 DSH 不能，模型一律用默认（`false`）/ 还不知道（`null`）。 */
  modelSelectable: boolean | null
  /** 能给新会话设的权限（DSH 的权限预设）；这个 DSH 不能给会话设权限时没有这个键。 */
  permissions?: { options: PermissionEntry[]; defaultId: string }
  /** 这个 DSH 里没有会话服务（列不出来）。 */
  unavailable?: string
}

/** 一套权限：DSH 权限预设的名字（如 `workspace-write`）、显示名（没配时就是名字本身）、一句说明。 */
export interface PermissionEntry {
  id: string
  name: string
  description?: string
}

/** `host/prepareSession`：给刚建好、还没发消息的会话装上模型、设好权限（画布「执行」新建会话后、发消息前）。 */
export interface HostPrepareSessionRequest {
  session: string
  model?: { provider: string; model: string; effort?: string }
  permission?: string
}
export interface HostPrepareSessionResponse {
  /** 没用上的那几项；全用上了是空的。 */
  fallbacks: ChoiceFallback[]
}
