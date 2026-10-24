/**
 * dsh-workflow-lite — 记忆库：`<dataDir>/memories/`。
 *
 * 一条记忆 = `<id>.json`（元数据）+ `<id>/`（一份 skill 文件夹，图里写 `{memory}/<id>`，执行时模型直接读写）。
 * 本模块管增删改、列表（连同哪些工作流在用）和只读浏览；版本在 `memoryVersions.ts`。
 * 浏览走实例文件夹浏览的那几样（`runs/files.ts`），同样只许往下走、软链指出去的不认。
 *
 * @module @xiaoso/dsh-workflow-lite/host/store/memories
 */

import type { Dirent } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  type MemoryEntry,
  type MemoryMeta,
  memoryMetaText,
  memoryTextProblem,
  parseMemoryMeta,
} from '../../shared/memoryLib.ts'
import { idKey } from '../../shared/model.ts'
import { checkName, normalizeName } from '../../shared/naming.ts'
import { memoryRefs } from '../../shared/presets.ts'
import { MEMORY_TYPES, type MemoryType } from '../../shared/types.ts'
import type {
  MemoryBrowseRequest,
  MemoryCreateRequest,
  MemoryImageRequest,
  MemoryUpdateRequest,
  RunDirResponse,
  RunFileResponse,
  RunImageResponse,
} from '../../shared/wire.ts'
import { walkTree } from '../pack/tree.ts'
import {
  cleanSub,
  readRunDir,
  readRunFile,
  readRunImage,
  realInside,
  resolveImageRef,
  resolveSelfImage,
} from '../runs/files.ts'
import { readFileText, removeTree, unlinkFile, writeFileAtomic } from './atomic.ts'
import {
  JSON_SUFFIX,
  memoriesDir,
  memoryFolder,
  memoryMetaFile,
  memoryVersionsDir,
} from './paths.ts'
import type { Outcome, Repository } from './repository.ts'

/** 撞名加序号的上限（`-2` … `-99`）。 */
const MAX_SEQUENTIAL = 99

export interface MemoryDeps {
  dataDir: string
  /** 列「在用的工作流」要扫各工作流当前存的那份。 */
  repository: Pick<Repository, 'list' | 'load'>
  now?: () => number
}

function fail(code: 'invalid_args' | 'not_found' | 'io_error', message: string): Outcome<never> {
  return { ok: false, error: { code, message } }
}

function ioError(what: string, error: unknown): Outcome<never> {
  return fail('io_error', `${what}失败：${error instanceof Error ? error.message : String(error)}`)
}

/** 同一条记忆上的写操作排队做（建、改、删、存版本、恢复），免得两个请求交错着写。 */
const queues = new Map<string, Promise<unknown>>()

export function serialMemory<T>(dataDir: string, id: string, task: () => Promise<T>): Promise<T> {
  const key = `${resolve(dataDir)}\n${idKey(id)}`
  const previous = queues.get(key) ?? Promise.resolve()
  const next = previous.then(task, task)
  const settled = next.catch(() => undefined)
  queues.set(key, settled)
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key)
  })
  return next
}

/** id 合不合规矩（同工作流名）。合规回 `null`。 */
export function memoryIdProblem(id: string): string | null {
  return checkName(id)?.message ?? null
}

/** 读一条记忆的元数据：不存在回 `null`，读不出来回 `'invalid'`。 */
export async function readMemoryMeta(
  dataDir: string,
  id: string,
): Promise<MemoryMeta | 'invalid' | null> {
  if (memoryIdProblem(id) !== null) return null
  const text = await readFileText(memoryMetaFile(dataDir, id))
  if (text === null) return null
  return parseMemoryMeta(text, id) ?? 'invalid'
}

/** 库里有没有这条记忆（元数据在就算，读不出来也算）。 */
export async function hasMemory(dataDir: string, id: string): Promise<boolean> {
  return (await readMemoryMeta(dataDir, id)) !== null
}

/** 库里所有记忆的 id（按元数据文件认；隐藏的、不合名字规矩的不算）。 */
async function memoryIds(dataDir: string): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(memoriesDir(dataDir), { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(JSON_SUFFIX))
    .map((entry) => entry.name.slice(0, -JSON_SUFFIX.length))
    .filter((id) => memoryIdProblem(id) === null)
}

/** 被占用的名字：元数据文件、文件夹（大小写不同也算同一个）。 */
async function takenIds(dataDir: string): Promise<Set<string>> {
  let entries: Dirent[]
  try {
    entries = await readdir(memoriesDir(dataDir), { withFileTypes: true })
  } catch {
    return new Set()
  }
  const taken = new Set<string>()
  for (const entry of entries) {
    const name = entry.name.toLowerCase().endsWith(JSON_SUFFIX)
      ? entry.name.slice(0, -JSON_SUFFIX.length)
      : entry.name
    taken.add(idKey(name))
  }
  return taken
}

/** 各工作流当前存的那份引用了哪些记忆：记忆 id 的 `idKey` → 工作流名（按名字排）。 */
export async function memoryUsage(
  repository: Pick<Repository, 'list' | 'load'>,
): Promise<Map<string, string[]>> {
  const usage = new Map<string, string[]>()
  const listed = await repository.list()
  for (const workflow of listed.workflows) {
    const loaded = await repository.load(workflow.name)
    if (loaded.document === null) continue
    for (const id of memoryRefs(loaded.document)) {
      const key = idKey(id)
      usage.set(key, [...(usage.get(key) ?? []), workflow.name])
    }
  }
  for (const names of usage.values()) names.sort((a, b) => a.localeCompare(b))
  return usage
}

/** 文件夹现在的样子：几个文件、多大、最近改动。 */
async function folderStats(
  dir: string,
): Promise<{ files: number; bytes: number; updatedAt: number | null }> {
  const tree = await walkTree(dir)
  if (tree === null || !tree.dir) return { files: 0, bytes: 0, updatedAt: null }
  let updatedAt: number | null = null
  for (const file of tree.files) {
    try {
      const info = await stat(file.full)
      if (updatedAt === null || info.mtimeMs > updatedAt) updatedAt = info.mtimeMs
    } catch {
      // 走完树之后被删了：不算。
    }
  }
  return { files: tree.files.length, bytes: tree.bytes, updatedAt }
}

async function versionCount(dataDir: string, id: string): Promise<number> {
  try {
    const entries = await readdir(memoryVersionsDir(dataDir, id))
    return entries.filter((name) => /^[1-9]\d{0,8}\.json$/iu.test(name)).length
  } catch {
    return 0
  }
}

async function entryOf(
  dataDir: string,
  id: string,
  usage: ReadonlyMap<string, string[]>,
): Promise<MemoryEntry | null> {
  const meta = await readMemoryMeta(dataDir, id)
  if (meta === null) return null
  const stats = await folderStats(memoryFolder(dataDir, id))
  const base: MemoryMeta =
    meta === 'invalid' ? { id, type: 'step', name: '', description: '', createdAt: 0 } : meta
  return {
    ...base,
    usedBy: usage.get(idKey(id)) ?? [],
    files: stats.files,
    bytes: stats.bytes,
    updatedAt: stats.updatedAt ?? base.createdAt,
    versions: await versionCount(dataDir, id),
    ...(meta === 'invalid' ? { invalid: true as const } : {}),
  }
}

/** 一条记忆的列表行；不存在回 `not_found`。 */
export async function memoryEntry(deps: MemoryDeps, id: string): Promise<Outcome<MemoryEntry>> {
  const entry = await entryOf(deps.dataDir, id, await memoryUsage(deps.repository))
  return entry === null ? fail('not_found', `记忆 ${id} 不存在`) : { ok: true, result: entry }
}

/** 库里的全部记忆，按名称排。 */
export async function listMemories(deps: MemoryDeps): Promise<MemoryEntry[]> {
  const usage = await memoryUsage(deps.repository)
  const entries: MemoryEntry[] = []
  for (const id of await memoryIds(deps.dataDir)) {
    const entry = await entryOf(deps.dataDir, id, usage)
    if (entry !== null) entries.push(entry)
  }
  const title = (entry: MemoryEntry): string => (entry.name.trim() === '' ? entry.id : entry.name)
  return entries.sort((a, b) => title(a).localeCompare(title(b)) || a.id.localeCompare(b.id))
}

function textProblems(fields: { name?: string; description?: string }): string | null {
  if (fields.name !== undefined) {
    const problem = memoryTextProblem('name', fields.name)
    if (problem !== null) return problem
  }
  if (fields.description !== undefined) {
    const problem = memoryTextProblem('description', fields.description)
    if (problem !== null) return problem
  }
  return null
}

/** 新建一条：挑一个没被占的 id（建议的撞了加序号），写元数据、建空文件夹。 */
export async function createMemory(
  deps: MemoryDeps,
  request: MemoryCreateRequest,
): Promise<Outcome<MemoryEntry>> {
  const type: MemoryType | undefined = MEMORY_TYPES.find((value) => value === request.type)
  if (type === undefined) return fail('invalid_args', '记忆的类型只能是工作流记忆或步骤记忆')
  const problem = textProblems(request)
  if (problem !== null) return fail('invalid_args', problem)
  const base = normalizeName(
    request.id ?? (type === 'workflow' ? 'workflow-memory' : 'step-memory'),
  )
  const idProblem = memoryIdProblem(base)
  if (idProblem !== null) return fail('invalid_args', `记忆 id 不合规矩：${idProblem}`)
  return serialMemory(deps.dataDir, '', async () => {
    try {
      const taken = await takenIds(deps.dataDir)
      let id = base
      for (let n = 2; taken.has(idKey(id)); n += 1) {
        if (n > MAX_SEQUENTIAL) return fail('invalid_args', `${base} 这个名字的记忆太多了，换一个`)
        id = `${base}-${n}`
      }
      if (memoryIdProblem(id) !== null) return fail('invalid_args', `${base} 太长了，换一个短点的`)
      const meta: MemoryMeta = {
        id,
        type,
        name: request.name ?? id,
        description: request.description ?? '',
        createdAt: (deps.now ?? Date.now)(),
      }
      await mkdir(memoryFolder(deps.dataDir, id), { recursive: true })
      await writeFileAtomic(memoryMetaFile(deps.dataDir, id), memoryMetaText(meta))
      return memoryEntry(deps, id)
    } catch (error) {
      return ioError('建记忆', error)
    }
  })
}

/** 改名称、描述。 */
export async function updateMemory(
  deps: MemoryDeps,
  request: MemoryUpdateRequest,
): Promise<Outcome<MemoryEntry>> {
  const problem = textProblems(request)
  if (problem !== null) return fail('invalid_args', problem)
  return serialMemory(deps.dataDir, request.id, async () => {
    const meta = await readMemoryMeta(deps.dataDir, request.id)
    if (meta === null) return fail('not_found', `记忆 ${request.id} 不存在`)
    if (meta === 'invalid')
      return fail('invalid_args', `记忆 ${request.id} 的元数据读不出来，只能删掉`)
    const next: MemoryMeta = {
      ...meta,
      ...(request.name === undefined ? {} : { name: request.name }),
      ...(request.description === undefined ? {} : { description: request.description }),
    }
    try {
      await writeFileAtomic(memoryMetaFile(deps.dataDir, meta.id), memoryMetaText(next))
    } catch (error) {
      return ioError('改记忆', error)
    }
    return memoryEntry(deps, meta.id)
  })
}

/** 删一条：元数据、文件夹、版本一起删。引用它的记忆卡留着（会报「记忆不存在」）。 */
export async function deleteMemory(
  deps: MemoryDeps,
  id: string,
): Promise<Outcome<{ removed: true }>> {
  return serialMemory(deps.dataDir, id, async () => {
    if ((await readMemoryMeta(deps.dataDir, id)) === null) {
      return fail('not_found', `记忆 ${id} 不存在`)
    }
    try {
      await removeTree(memoryVersionsDir(deps.dataDir, id))
      await removeTree(memoryFolder(deps.dataDir, id))
      await unlinkFile(memoryMetaFile(deps.dataDir, id))
    } catch (error) {
      return ioError('删记忆', error)
    }
    return { ok: true, result: { removed: true } }
  })
}

/**
 * 导入时直接写一份元数据（id 已经定好、没被占）：类型、名称、描述照包里的，时间按现在。
 * 文件夹由调用方写。
 */
export async function writeMemoryMeta(dataDir: string, meta: MemoryMeta): Promise<void> {
  await mkdir(memoryFolder(dataDir, meta.id), { recursive: true })
  await writeFileAtomic(memoryMetaFile(dataDir, meta.id), memoryMetaText(meta))
}

/** 导入、新建时挑一个没被占的 id：`base` 没被占就是它，否则加序号。 */
export async function freeMemoryId(dataDir: string, base: string): Promise<string | null> {
  const taken = await takenIds(dataDir)
  let id = base
  for (let n = 2; taken.has(idKey(id)); n += 1) {
    if (n > MAX_SEQUENTIAL) return null
    id = `${base}-${n}`
  }
  return memoryIdProblem(id) === null ? id : null
}

// ── 浏览 ───────────────────────────────────────────────────────

/** 要看的那一份：根（当前文件夹，或某个版本的拷贝）、绝对路径、给人看的路径。 */
async function locate(
  dataDir: string,
  request: MemoryBrowseRequest,
): Promise<Outcome<{ root: string; full: string; display: string; sub: string }>> {
  if ((await readMemoryMeta(dataDir, request.id)) === null) {
    return fail('not_found', `记忆 ${request.id} 不存在`)
  }
  const sub = cleanSub(request.sub)
  if (!sub.ok) return sub
  const root =
    request.version === undefined
      ? memoryFolder(dataDir, request.id)
      : join(memoryVersionsDir(dataDir, request.id), String(request.version))
  const full = sub.result === '' ? root : resolve(root, ...sub.result.split('/'))
  if (!(await realInside(root, full))) return fail('invalid_args', '只能看记忆文件夹里面的东西')
  const head = request.version === undefined ? request.id : `${request.id} · v${request.version}`
  const display = sub.result === '' ? head : `${head}/${sub.result}`
  return { ok: true, result: { root, full, display, sub: sub.result } }
}

export async function memoryDir(
  dataDir: string,
  request: MemoryBrowseRequest,
): Promise<Outcome<RunDirResponse>> {
  const at = await locate(dataDir, request)
  if (!at.ok) return at
  try {
    return { ok: true, result: await readRunDir(at.result.full, at.result.display, at.result.sub) }
  } catch (error) {
    return ioError('读文件夹', error)
  }
}

export async function memoryFile(
  dataDir: string,
  request: MemoryBrowseRequest,
): Promise<Outcome<RunFileResponse>> {
  const at = await locate(dataDir, request)
  if (!at.ok) return at
  try {
    return { ok: true, result: await readRunFile(at.result.full, at.result.display) }
  } catch (error) {
    return ioError('读文件', error)
  }
}

/** 一张图：`src` 是 Markdown 里的相对路径（按文档所在目录解析，只许落在记忆文件夹里）；不给就是目标自己。 */
export async function memoryImage(
  dataDir: string,
  request: MemoryImageRequest,
): Promise<Outcome<RunImageResponse>> {
  const at = await locate(dataDir, request)
  if (!at.ok) return at
  const { root, full } = at.result
  const image =
    request.src === undefined ? resolveSelfImage(full) : resolveImageRef(root, full, request.src)
  if (!image.ok) return image
  if (!(await realInside(root, image.result.full))) {
    return fail('invalid_args', '只能看记忆文件夹里面的东西')
  }
  try {
    return await readRunImage(image.result.full, image.result.mime)
  } catch (error) {
    return ioError('读图片', error)
  }
}
