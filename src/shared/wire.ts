/**
 * dsh-workflow-lite — 画布 ↔ host 的线格式。
 *
 * 画布与 host 走**共享 Connection 的 `/api` 通道**（与生态里其它插件同一条路）：
 * host 侧一个 endpoint 注册一条精确 Fetch 路由，客户端用 `connection.rpc.call` 调。
 * 这里只放**名字与形状**，host 与 client 两边都 import 它，避免两处各写一套字面量。
 *
 * 本文件留通道名、端点名表与把各组串起来的调用映射；各端点的请求 / 返回形状按组放在 `wire/`：
 * `graph`（`graph/*`）、`plan`、`memory`、`host`、`run`、`config`，与 `host/rpc/` 的分组一一对应；
 * `pack/*` 的形状在 `pack.ts` 与 `skillPack.ts`；各组共用的 `WireWarning` 在 `wire/common.ts`。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire
 */

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
import type {
  SkillBrowseRequest,
  SkillBuildRequest,
  SkillExportRequest,
  SkillExportResponse,
  SkillFileResponse,
  SkillImageRequest,
  SkillPreviewResponse,
} from './skillPack.ts'
import type { PluginConfigView, PluginConfigWrite } from './wire/config.ts'
import type {
  GraphCreateRequest,
  GraphCreateResponse,
  GraphDeleteRequest,
  GraphDeleteResponse,
  GraphListRequest,
  GraphListResponse,
  GraphLoadRequest,
  GraphLoadResponse,
  GraphNodeTemplateCreateRequest,
  GraphNodeTemplateCreateResponse,
  GraphNodeTemplateDeleteRequest,
  GraphNodeTemplateDeleteResponse,
  GraphNodeTemplateDraftRequest,
  GraphNodeTemplateDraftResponse,
  GraphNodeTemplateRequest,
  GraphNodeTemplateResponse,
  GraphNodeTemplateSaveRequest,
  GraphNodeTemplateSaveResponse,
  GraphRenameRequest,
  GraphRenameResponse,
  GraphSaveRequest,
  GraphSaveResponse,
  GraphTemplatesRequest,
  GraphTemplatesResponse,
  GraphVersionDeleteRequest,
  GraphVersionLoadRequest,
  GraphVersionLoadResponse,
  GraphVersionNoteRequest,
  GraphVersionNoteResponse,
  GraphVersionRestoreRequest,
  GraphVersionRestoreResponse,
  GraphVersionSaveRequest,
  GraphVersionSaveResponse,
  GraphVersionsRequest,
  GraphVersionsResponse,
} from './wire/graph.ts'
import type {
  HostListRequest,
  HostListResponse,
  HostSkillRequest,
  HostSkillResponse,
  HostSkillsRequest,
  HostSkillsResponse,
} from './wire/host.ts'
import type {
  MemoryBrowseRequest,
  MemoryCreateRequest,
  MemoryEntryResponse,
  MemoryIdRequest,
  MemoryImageRequest,
  MemoryListResponse,
  MemoryUpdateRequest,
  MemoryVersionNoteRequest,
  MemoryVersionRequest,
  MemoryVersionResponse,
  MemoryVersionRestoreResponse,
  MemoryVersionSaveRequest,
  MemoryVersionsResponse,
} from './wire/memory.ts'
import type { PlanBuildRequest, PlanBuildResponse } from './wire/plan.ts'
import type {
  RunBindRequest,
  RunDeleteRequest,
  RunDirRequest,
  RunDirResponse,
  RunFileRequest,
  RunFileResponse,
  RunHistoryRequest,
  RunHistoryResponse,
  RunImageRequest,
  RunImageResponse,
  RunLatestRequest,
  RunLatestResponse,
  RunLinesRequest,
  RunLinesResponse,
  RunListRequest,
  RunListResponse,
  RunLoadRequest,
  RunLoadResponse,
  RunSaveRequest,
  RunSaveResponse,
  RunStartRequest,
  RunStartResponse,
  RunStatRequest,
  RunStatResponse,
  RunStorageRequest,
  StorageStats,
} from './wire/run.ts'

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
