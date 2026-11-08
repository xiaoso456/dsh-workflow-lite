/**
 * dsh-workflow-lite — 仓储的版本部分：列 / 存 / 读 / 切换 / 改说明 / 删除版本，以及导入工作流包里的版本。
 *
 * 版本文件的形状在 `versions.ts`；这里管流程：写类动作全程在锁内，
 * 切换版本前会把还没存成版本的现在内容自动存一份，导入时先查完再写。
 * @module @xiaoso/dsh-workflow-lite/host/store/repoVersions
 */

import { CONTROL_CHARS, MAX_VERSION_NOTE_CODEPOINTS, MAX_VERSIONS } from '../../shared/limits.ts'
import { readDocument, writeDocument } from '../../shared/model.ts'
import type { VersionEntry, WorkflowDocument } from '../../shared/types.ts'
import {
  ensureDir,
  hashOf,
  readFileText,
  removeTree,
  unlinkFile,
  writeFileAtomic,
} from './atomic.ts'
import { pathKind, versionFile, versionsDir, workflowFile, workflowOccupant } from './paths.ts'
import type { RepoCore } from './repoCore.ts'
import {
  describeProblems,
  fail,
  hasLevel,
  mapWriteFailure,
  type Outcome,
  ok,
} from './repoResult.ts'
import {
  contentKey,
  parseVersion,
  readVersions,
  type StoredVersion,
  versionText,
} from './versions.ts'

/** 导入的一个版本。 */
export interface ImportVersion {
  n: number
  createdAt: number
  note: string
  document: WorkflowDocument
}

export interface ImportRequest {
  mode: 'new' | 'merge'
  name: string
  /** 按编号从小到大。 */
  versions: ImportVersion[]
  /** 导入后工作流的内容。 */
  current: WorkflowDocument
  /** 检查都过了、写版本与工作流之前做的事；拿到的是归一后的图名。 */
  prepare?: (name: string) => Promise<Outcome<void>>
}

export interface ImportResult {
  name: string
  /** 写下的版本号，和 `request.versions` 一一对应（重复的那几个不在里面）。 */
  versions: number[]
  /** 和已有版本内容一样、没再存的（包里的编号）。 */
  duplicates: number[]
}

/** 版本的线形状：`current` = 和磁盘上现在的内容一样（`key` 是现在那份的内容键）。 */
function versionEntry(version: StoredVersion, key: string | null): VersionEntry {
  return {
    n: version.n,
    createdAt: version.createdAt,
    note: version.note,
    ...(version.autoBefore === undefined ? {} : { autoBefore: version.autoBefore }),
    nodeCount: version.document?.nodes.length ?? 0,
    current: sameContent(version, key),
    ...(version.document === null ? { invalid: true as const } : {}),
  }
}

function sameContent(version: StoredVersion, key: string | null): boolean {
  return key !== null && version.document !== null && contentKey(version.document) === key
}

/** 版本说明：去掉首尾空白，换行压成空格；只防病态输入。 */
function checkVersionNote(note: string): Outcome<string> {
  const text = note.replace(/\s*[\r\n]+\s*/g, ' ').trim()
  if ([...text].length > MAX_VERSION_NOTE_CODEPOINTS) {
    return fail('invalid_args', `版本说明太长了（最多 ${MAX_VERSION_NOTE_CODEPOINTS} 字）`)
  }
  if (CONTROL_CHARS.test(text)) return fail('invalid_args', '版本说明里有控制字符')
  return ok(text)
}

/** 版本部分用到的核心能力。 */
type VersionsCore = Pick<
  RepoCore,
  'dataDir' | 'withLock' | 'ensureLayout' | 'resolveName' | 'validate' | 'rememberBaseline'
>

export class VersionStore {
  private readonly core: VersionsCore

  constructor(core: VersionsCore) {
    this.core = core
  }

  async listVersions(workflow: string): Promise<Outcome<VersionEntry[]>> {
    const current = await this.currentContent(workflow)
    if (!current.ok) return current
    const { name, key } = current.result
    const versions = await readVersions(this.core.dataDir, name)
    return ok(versions.map((version) => versionEntry(version, key)))
  }

  async saveVersion(workflow: string, note: string): Promise<Outcome<VersionEntry>> {
    return this.core.withLock(async () => {
      const checked = checkVersionNote(note)
      if (!checked.ok) return checked
      const current = await this.currentContent(workflow)
      if (!current.ok) return current
      const { name, key, document } = current.result
      if (document === null || key === null) {
        return fail('blocked', `图 ${name} 有保存级问题，不能存成版本`, { workflow: name })
      }
      const versions = await readVersions(this.core.dataDir, name)
      const same = versions.find((version) => sameContent(version, key))
      if (same !== undefined) {
        return fail('invalid_args', `现在的内容和 v${same.n} 一样，不用再存`, {
          workflow: name,
          same: same.n,
        })
      }
      return this.writeVersion(name, versions, { note: checked.result, document, key })
    })
  }

  async readVersion(
    workflow: string,
    n: number,
  ): Promise<Outcome<{ entry: VersionEntry; document: WorkflowDocument }>> {
    const current = await this.currentContent(workflow)
    if (!current.ok) return current
    const { name, key } = current.result
    const version = await this.findVersion(name, n)
    if (!version.ok) return version
    const document = version.result.document
    if (document === null) {
      return fail('blocked', `版本 v${n} 的文件坏了，读不出来`, { workflow: name, n })
    }
    return ok({ entry: versionEntry(version.result, key), document })
  }

  async restoreVersion(
    workflow: string,
    n: number,
  ): Promise<Outcome<{ hash: string; saved: VersionEntry | null }>> {
    return this.core.withLock(async () => {
      const current = await this.currentContent(workflow)
      if (!current.ok) return current
      const { name, key, document } = current.result
      const target = await this.findVersion(name, n)
      if (!target.ok) return target
      const restored = target.result.document
      if (restored === null) {
        return fail('blocked', `版本 v${n} 的文件坏了，不能切换`, { workflow: name, n })
      }
      const problems = this.core
        .validate(restored, name)
        .filter((problem) => problem.level === 'save')
      if (problems.length > 0) {
        return fail('blocked', `版本 v${n} 有保存级问题，不能切换：${describeProblems(problems)}`, {
          workflow: name,
          n,
          problems,
        })
      }

      // 现在的内容哪个版本都不是：先存一份，切回来不丢。磁盘上的那份坏了就不存（存了也切不回去）。
      let saved: VersionEntry | null = null
      const versions = await readVersions(this.core.dataDir, name)
      if (
        document !== null &&
        key !== null &&
        !versions.some((version) => sameContent(version, key))
      ) {
        const written = await this.writeVersion(name, versions, {
          note: '',
          document,
          key,
          autoBefore: n,
        })
        if (!written.ok) return written
        // 写回之后现在的内容就是 v<n> 了，自动存的这份不再是「当前」。
        saved = { ...written.result, current: false }
      }

      const file = workflowFile(this.core.dataDir, name)
      const text = writeDocument(restored)
      try {
        await writeFileAtomic(file, text)
      } catch (error) {
        return mapWriteFailure(error, file)
      }
      const hash = await hashOf(text)
      this.core.rememberBaseline(name, hash, restored)
      return ok({ hash, saved })
    })
  }

  async noteVersion(workflow: string, n: number, note: string): Promise<Outcome<VersionEntry>> {
    return this.core.withLock(async () => {
      const checked = checkVersionNote(note)
      if (!checked.ok) return checked
      const current = await this.currentContent(workflow)
      if (!current.ok) return current
      const { name, key } = current.result
      const version = await this.findVersion(name, n)
      if (!version.ok) return version
      const document = version.result.document
      if (document === null) {
        return fail('blocked', `版本 v${n} 的文件坏了，改不了说明`, { workflow: name, n })
      }
      const next = { ...version.result, note: checked.result, document }
      const file = versionFile(this.core.dataDir, name, n)
      try {
        await writeFileAtomic(file, versionText(next))
      } catch (error) {
        return mapWriteFailure(error, file)
      }
      return ok(versionEntry(next, key))
    })
  }

  async deleteVersion(workflow: string, n: number): Promise<Outcome<{ removed: true }>> {
    return this.core.withLock(async () => {
      const resolved = this.core.resolveName(workflow)
      if (!resolved.ok) return resolved
      const file = versionFile(this.core.dataDir, resolved.result, n)
      if ((await pathKind(file)) !== 'file') {
        return fail('not_found', `版本 v${n} 不存在`, { workflow: resolved.result, n })
      }
      try {
        await unlinkFile(file)
      } catch (error) {
        return mapWriteFailure(error, file)
      }
      return ok({ removed: true as const })
    })
  }

  async importWorkflow(request: ImportRequest): Promise<Outcome<ImportResult>> {
    return this.core.withLock(async () => {
      const resolved = this.core.resolveName(request.name)
      if (!resolved.ok) return resolved
      const name = resolved.result
      const ready = await this.core.ensureLayout()
      if (!ready.ok) return ready

      for (const [label, document] of [
        ...request.versions.map((version) => [`v${version.n}`, version.document] as const),
        ['当前内容', request.current] as const,
      ]) {
        const problems = [
          ...readDocument(writeDocument(document)).problems,
          ...this.core.validate(document, name),
        ].filter((problem) => problem.level === 'save')
        if (problems.length > 0) {
          return fail('blocked', `包里的 ${label} 有保存级问题：${describeProblems(problems)}`, {
            problems,
          })
        }
      }

      const occupant = await workflowOccupant(this.core.dataDir, name)
      const existing: StoredVersion[] = []
      if (request.mode === 'new') {
        if (occupant !== null) {
          return fail('conflict', `工作流 ${name} 已经在了，换个名字`, {
            workflow: name,
            occupant,
          })
        }
      } else {
        if (occupant !== 'file') return fail('not_found', `图 ${name} 不存在`, { workflow: name })
        existing.push(...(await readVersions(this.core.dataDir, name)))
      }

      // 排好每个版本落到哪个编号。
      const keys = new Set(
        existing.flatMap((version) =>
          version.document === null ? [] : [contentKey(version.document)],
        ),
      )
      let next = existing.reduce((max, version) => Math.max(max, version.n), 0)
      const planned: { n: number; version: ImportVersion }[] = []
      const duplicates: number[] = []
      for (const version of request.versions) {
        const key = contentKey(version.document)
        if (request.mode === 'merge') {
          if (keys.has(key)) {
            duplicates.push(version.n)
            continue
          }
          next += 1
          planned.push({ n: next, version })
        } else {
          planned.push({ n: version.n, version })
        }
        keys.add(key)
      }
      if (existing.length + planned.length > MAX_VERSIONS) {
        return fail(
          'invalid_args',
          `一个工作流最多存 ${MAX_VERSIONS} 个版本，导入后会有 ${existing.length + planned.length} 个，先删掉一些旧的`,
          { workflow: name },
        )
      }

      if (request.prepare !== undefined) {
        const prepared = await request.prepare(name)
        if (!prepared.ok) return prepared
      }

      const dir = versionsDir(this.core.dataDir, name)
      try {
        // 新建时那个名字下可能留着没人认领的旧版本（工作流早被删了）：清掉，免得混进来。
        if (request.mode === 'new') await removeTree(dir)
        if (planned.length > 0) await ensureDir(dir)
        for (const { n, version } of planned) {
          await writeFileAtomic(
            versionFile(this.core.dataDir, name, n),
            versionText({
              n,
              createdAt: version.createdAt,
              note: version.note,
              document: version.document,
            }),
          )
        }
      } catch (error) {
        return mapWriteFailure(error, dir)
      }

      const file = workflowFile(this.core.dataDir, name)
      const text = writeDocument(request.current)
      try {
        await writeFileAtomic(file, text)
      } catch (error) {
        return mapWriteFailure(error, file)
      }
      this.core.rememberBaseline(name, await hashOf(text), request.current)
      return ok({ name, versions: planned.map((entry) => entry.n), duplicates })
    })
  }

  /** 磁盘上现在那份：图名、内容键（比版本用）与文档；坏了的图 `document` / `key` 是 `null`。 */
  private async currentContent(
    workflow: string,
  ): Promise<Outcome<{ name: string; key: string | null; document: WorkflowDocument | null }>> {
    const resolved = this.core.resolveName(workflow)
    if (!resolved.ok) return resolved
    const name = resolved.result
    const text = await readFileText(workflowFile(this.core.dataDir, name))
    if (text === null) return fail('not_found', `图 ${name} 不存在`, { workflow: name })
    const parsed = readDocument(text)
    const broken =
      parsed.document === null ||
      hasLevel([...parsed.problems, ...this.core.validate(parsed.document, name)], 'save')
    if (broken || parsed.document === null) return ok({ name, key: null, document: null })
    return ok({ name, key: contentKey(parsed.document), document: parsed.document })
  }

  private async findVersion(name: string, n: number): Promise<Outcome<StoredVersion>> {
    if (!Number.isInteger(n) || n < 1) return fail('invalid_args', `版本号不对：${n}`, { n })
    const text = await readFileText(versionFile(this.core.dataDir, name, n))
    if (text === null) return fail('not_found', `版本 v${n} 不存在`, { workflow: name, n })
    return ok(parseVersion(text, n))
  }

  /** 写一个新版本（序号接着现有最大的往上数）。**必须在 `withLock` 内调用**。 */
  private async writeVersion(
    name: string,
    existing: readonly StoredVersion[],
    content: { note: string; document: WorkflowDocument; key: string; autoBefore?: number },
  ): Promise<Outcome<VersionEntry>> {
    if (existing.length >= MAX_VERSIONS) {
      return fail('invalid_args', `一个工作流最多存 ${MAX_VERSIONS} 个版本，先删掉一些旧的`, {
        workflow: name,
      })
    }
    const n = existing.reduce((max, version) => Math.max(max, version.n), 0) + 1
    const version: StoredVersion & { document: WorkflowDocument } = {
      n,
      createdAt: Date.now(),
      note: content.note,
      ...(content.autoBefore === undefined ? {} : { autoBefore: content.autoBefore }),
      document: content.document,
    }
    const file = versionFile(this.core.dataDir, name, n)
    try {
      await ensureDir(versionsDir(this.core.dataDir, name))
      await writeFileAtomic(file, versionText(version))
    } catch (error) {
      return mapWriteFailure(error, file)
    }
    return ok(versionEntry(version, content.key))
  }
}
