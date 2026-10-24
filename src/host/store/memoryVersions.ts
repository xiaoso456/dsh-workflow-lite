/**
 * dsh-workflow-lite — 记忆的版本：`<dataDir>/memory-versions/<id>/`。
 *
 * 一个版本 = `<n>.json`（元信息）+ `<n>/`（那一刻整个记忆文件夹的拷贝）：
 *
 * ```json
 * { "format": 1, "n": 3, "createdAt": 1759650000000, "note": "跑通了审查", "hash": "…", "files": 4, "bytes": 2310 }
 * ```
 *
 * 平时只有手动存；恢复到别的版本之前，现在的内容没存成版本就先自动存一份（多一个 `autoBefore`）。
 * 内容（文件清单 + 每个文件的哈希）和已有的某个版本一样就不再存。拷贝跳过 `.git`、`node_modules` 和软链，
 * 超过导出包的上限就不存。和工作流的版本线各自独立：恢复工作流版本不动记忆。
 *
 * @module @xiaoso/dsh-workflow-lite/host/store/memoryVersions
 */

import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { MAX_MEMORY_VERSIONS, MAX_VERSION_NOTE_CODEPOINTS } from '../../shared/limits.ts'
import type { MemoryVersionEntry } from '../../shared/memoryLib.ts'
import { codepointLength } from '../../shared/naming.ts'
import { fingerprint, readTree, sha256, type Tree, walkTree } from '../pack/tree.ts'
import { readFileText, removeTree, renameDir, unlinkFile, writeFileAtomic } from './atomic.ts'
import { readMemoryMeta, serialMemory } from './memories.ts'
import { memoriesDir, memoryFolder, memoryVersionsDir } from './paths.ts'
import type { Outcome } from './repository.ts'

const FORMAT = 1
const FILE_NAME = /^([1-9]\d{0,8})\.json$/iu

/** 盘上的一个版本（`current` 由调用方比出来）。 */
interface StoredMemoryVersion {
  n: number
  createdAt: number
  note: string
  autoBefore?: number
  hash: string
  files: number
  bytes: number
  invalid?: true
}

export interface MemoryVersionOptions {
  now?: () => number
}

function fail(
  code: 'invalid_args' | 'not_found' | 'io_error',
  message: string,
  detail?: Record<string, unknown>,
): Outcome<never> {
  return { ok: false, error: { code, message, ...(detail === undefined ? {} : { detail }) } }
}

function ioError(what: string, error: unknown): Outcome<never> {
  return fail('io_error', `${what}失败：${error instanceof Error ? error.message : String(error)}`)
}

function versionText(version: StoredMemoryVersion): string {
  const payload = {
    format: FORMAT,
    n: version.n,
    createdAt: version.createdAt,
    note: version.note,
    ...(version.autoBefore === undefined ? {} : { autoBefore: version.autoBefore }),
    hash: version.hash,
    files: version.files,
    bytes: version.bytes,
  }
  return `${JSON.stringify(payload, null, 2)}\n`
}

function parseVersion(text: string, n: number): StoredMemoryVersion {
  const broken: StoredMemoryVersion = {
    n,
    createdAt: 0,
    note: '',
    hash: '',
    files: 0,
    bytes: 0,
    invalid: true,
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return broken
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return broken
  const record = raw as Record<string, unknown>
  if (typeof record.hash !== 'string') return broken
  const number = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : 0
  return {
    n,
    createdAt: number(record.createdAt),
    note: typeof record.note === 'string' ? record.note : '',
    ...(typeof record.autoBefore === 'number' ? { autoBefore: record.autoBefore } : {}),
    hash: record.hash,
    files: number(record.files),
    bytes: number(record.bytes),
  }
}

/** 一条记忆的全部版本，新的在前。 */
async function readVersions(dataDir: string, id: string): Promise<StoredMemoryVersion[]> {
  const dir = memoryVersionsDir(dataDir, id)
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const versions: StoredMemoryVersion[] = []
  for (const name of names) {
    const match = FILE_NAME.exec(name)
    if (match === null) continue
    const n = Number(match[1])
    const text = await readFileText(join(dir, name))
    if (text !== null) versions.push(parseVersion(text, n))
  }
  return versions.sort((a, b) => b.n - a.n)
}

/** 现在的文件夹：树和内容指纹。文件夹还没有（模型还没写过）就是空树。超了上限回 `over`。 */
async function currentTree(
  dataDir: string,
  id: string,
): Promise<{ tree: Tree; hash: string; over: boolean }> {
  const tree = (await walkTree(memoryFolder(dataDir, id))) ?? {
    dir: true,
    files: [],
    bytes: 0,
    skipped: 0,
    over: false,
  }
  if (tree.over || !tree.dir) return { tree, hash: '', over: tree.over }
  const { files } = await readTree(tree)
  return { tree, hash: sha256(new TextEncoder().encode(fingerprint(files))), over: false }
}

function entryOf(version: StoredMemoryVersion, currentHash: string): MemoryVersionEntry {
  return {
    n: version.n,
    createdAt: version.createdAt,
    note: version.note,
    ...(version.autoBefore === undefined ? {} : { autoBefore: version.autoBefore }),
    files: version.files,
    bytes: version.bytes,
    current: version.invalid !== true && version.hash === currentHash,
    ...(version.invalid === true ? { invalid: true as const } : {}),
  }
}

async function exists(dataDir: string, id: string): Promise<Outcome<null>> {
  const meta = await readMemoryMeta(dataDir, id)
  return meta === null ? fail('not_found', `记忆 ${id} 不存在`) : { ok: true, result: null }
}

/** 一条记忆的版本，新的在前。 */
export async function listMemoryVersions(
  dataDir: string,
  id: string,
): Promise<Outcome<MemoryVersionEntry[]>> {
  const found = await exists(dataDir, id)
  if (!found.ok) return found
  const current = await currentTree(dataDir, id)
  const versions = await readVersions(dataDir, id)
  return { ok: true, result: versions.map((version) => entryOf(version, current.hash)) }
}

/** 把一棵树拷进 `target`（先拷进同级的临时目录，拷完再改名，半路失败不留半份）。 */
async function copyTree(tree: Tree, target: string): Promise<void> {
  const temp = join(dirname(target), `.tmp-${randomUUID()}`)
  try {
    await mkdir(temp, { recursive: true })
    for (const file of tree.files) {
      const to = join(temp, ...file.rel.split('/'))
      await mkdir(dirname(to), { recursive: true })
      await copyFile(file.full, to)
    }
    await renameDir(temp, target)
  } catch (error) {
    await removeTree(temp).catch(() => undefined)
    throw error
  }
}

/**
 * 存一份（不排队，调用方已在 {@link serialMemory} 里）。和已有某个版本一样：`skipSame` 就回 `null`，
 * 否则报 `invalid_args`（`detail.same` 是那个版本号）。
 */
async function saveLocked(
  dataDir: string,
  id: string,
  note: string,
  options: MemoryVersionOptions & { autoBefore?: number; skipSame?: boolean },
): Promise<Outcome<MemoryVersionEntry | null>> {
  if (codepointLength(note) > MAX_VERSION_NOTE_CODEPOINTS) {
    return fail('invalid_args', `版本说明不能超过 ${MAX_VERSION_NOTE_CODEPOINTS} 个字`)
  }
  const current = await currentTree(dataDir, id)
  if (current.over) return fail('invalid_args', '记忆文件夹太大了（超过导出包的上限），存不了版本')
  const versions = await readVersions(dataDir, id)
  const same = versions.find((version) => version.invalid !== true && version.hash === current.hash)
  if (same !== undefined) {
    if (options.skipSame === true) return { ok: true, result: null }
    return fail('invalid_args', `内容和 v${same.n} 一样，不用再存`, { same: same.n })
  }
  try {
    const dir = memoryVersionsDir(dataDir, id)
    await mkdir(dir, { recursive: true })
    // 到了上限先删最旧的。
    for (const old of versions.slice(MAX_MEMORY_VERSIONS - 1)) {
      await removeTree(join(dir, String(old.n)))
      await unlinkFile(join(dir, `${old.n}.json`))
    }
    const n = (versions[0]?.n ?? 0) + 1
    await removeTree(join(dir, String(n)))
    await copyTree(current.tree, join(dir, String(n)))
    const version: StoredMemoryVersion = {
      n,
      createdAt: (options.now ?? Date.now)(),
      note,
      ...(options.autoBefore === undefined ? {} : { autoBefore: options.autoBefore }),
      hash: current.hash,
      files: current.tree.files.length,
      bytes: current.tree.bytes,
    }
    await writeFileAtomic(join(dir, `${n}.json`), versionText(version))
    return { ok: true, result: entryOf(version, current.hash) }
  } catch (error) {
    return ioError('存记忆版本', error)
  }
}

/** 把现在的文件夹存成新版本；`skipSame` 时内容没变回 `null`（连同工作流一起存时用）。 */
export async function saveMemoryVersion(
  dataDir: string,
  id: string,
  note: string,
  options: MemoryVersionOptions & { skipSame?: boolean } = {},
): Promise<Outcome<MemoryVersionEntry | null>> {
  const found = await exists(dataDir, id)
  if (!found.ok) return found
  return serialMemory(dataDir, id, () => saveLocked(dataDir, id, note, options))
}

/** 恢复到第 `n` 版：现在的内容没存成版本就先自动存一份（`saved`），再整个换掉文件夹。 */
export async function restoreMemoryVersion(
  dataDir: string,
  id: string,
  n: number,
  options: MemoryVersionOptions = {},
): Promise<Outcome<{ saved: MemoryVersionEntry | null }>> {
  const found = await exists(dataDir, id)
  if (!found.ok) return found
  return serialMemory(dataDir, id, async () => {
    const versions = await readVersions(dataDir, id)
    const target = versions.find((version) => version.n === n)
    if (target === undefined || target.invalid === true) {
      return fail('not_found', `记忆 ${id} 没有 v${n}（或者它坏了）`)
    }
    const snapshot = await walkTree(join(memoryVersionsDir(dataDir, id), String(n)))
    if (snapshot === null || !snapshot.dir) return fail('not_found', `v${n} 的拷贝不见了`)
    const saved = await saveLocked(dataDir, id, '', { ...options, autoBefore: n, skipSame: true })
    if (!saved.ok) return saved
    const folder = memoryFolder(dataDir, id)
    const old = join(memoriesDir(dataDir), `.old-${randomUUID()}`)
    const fresh = join(memoriesDir(dataDir), `.new-${randomUUID()}`)
    try {
      await copyTree(snapshot, fresh)
      await renameDir(folder, old).catch((error: unknown) => {
        // 文件夹本来就没有（还没写过）：直接放进去。
        if ((error as { code?: string }).code !== 'ENOENT') throw error
      })
      await renameDir(fresh, folder)
      await removeTree(old)
    } catch (error) {
      await removeTree(fresh).catch(() => undefined)
      return ioError('恢复记忆', error)
    }
    return { ok: true, result: { saved: saved.result } }
  })
}

/** 改版本说明。 */
export async function noteMemoryVersion(
  dataDir: string,
  id: string,
  n: number,
  note: string,
): Promise<Outcome<MemoryVersionEntry>> {
  if (codepointLength(note) > MAX_VERSION_NOTE_CODEPOINTS) {
    return fail('invalid_args', `版本说明不能超过 ${MAX_VERSION_NOTE_CODEPOINTS} 个字`)
  }
  const found = await exists(dataDir, id)
  if (!found.ok) return found
  return serialMemory(dataDir, id, async () => {
    const version = (await readVersions(dataDir, id)).find((candidate) => candidate.n === n)
    if (version === undefined || version.invalid === true) {
      return fail('not_found', `记忆 ${id} 没有 v${n}（或者它坏了）`)
    }
    const next = { ...version, note }
    try {
      await writeFileAtomic(join(memoryVersionsDir(dataDir, id), `${n}.json`), versionText(next))
    } catch (error) {
      return ioError('改版本说明', error)
    }
    const current = await currentTree(dataDir, id)
    return { ok: true, result: entryOf(next, current.hash) }
  })
}

/** 删一个版本（元信息和拷贝）。 */
export async function deleteMemoryVersion(
  dataDir: string,
  id: string,
  n: number,
): Promise<Outcome<{ removed: true }>> {
  const found = await exists(dataDir, id)
  if (!found.ok) return found
  return serialMemory(dataDir, id, async () => {
    const dir = memoryVersionsDir(dataDir, id)
    if (!(await readVersions(dataDir, id)).some((version) => version.n === n)) {
      return fail('not_found', `记忆 ${id} 没有 v${n}`)
    }
    try {
      await removeTree(join(dir, String(n)))
      await unlinkFile(join(dir, `${n}.json`))
    } catch (error) {
      return ioError('删记忆版本', error)
    }
    return { ok: true, result: { removed: true } }
  })
}
