/**
 * dsh-workflow-lite — 线格式：`graph/*` 端点形状：工作流增删改查、版本、节点模板。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/graph
 */

import type { MemoryVersionEntry } from '../memoryLib.ts'
import type {
  ListResult,
  NodeData,
  TemplateEntry,
  ValidationProblem,
  VersionEntry,
  WorkflowDocument,
} from '../types.ts'
import type { WireWarning } from './common.ts'

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
