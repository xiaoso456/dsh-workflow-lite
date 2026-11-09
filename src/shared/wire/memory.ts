/**
 * dsh-workflow-lite — 线格式：`memory/*` 端点形状：记忆库的增删改查与版本。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/memory
 */

import type { MemoryEntry, MemoryVersionEntry } from '../memoryLib.ts'
import type { MemoryType } from '../types.ts'

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
