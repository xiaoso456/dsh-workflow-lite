/**
 * dsh-workflow-lite — 线格式：`host/*` 端点形状：列主机上的目录与 skill（资源节点选文件、文件夹、skill 用）。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/host
 */

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
