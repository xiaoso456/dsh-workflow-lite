/**
 * dsh-workflow-lite — 实例的读取面：实例列表、画布视图、资源项状态、产出文件 / 图片 / 文件夹 / 各版。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/runReader
 */

import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { idKey, isResource } from '../../shared/model.ts'
import type { InstanceRecord, InstanceSummary, InstanceView } from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import {
  RUN_LATEST_SCAN,
  type RunDirResponse,
  type RunFileResponse,
  type RunHistoryResponse,
  type RunImageResponse,
  type RunLatestOutput,
  type RunLatestResponse,
  type RunLinesRequest,
  type RunLinesResponse,
  type RunStatResponse,
} from '../../shared/wire/run.ts'
import type { Outcome } from '../store/repoResult.ts'
import {
  cleanSub,
  itemLocation,
  type RunFileTarget,
  readRunDir,
  readRunFile,
  readRunImage,
  realInside,
  resolveImageRef,
  resolveRunFile,
  resolveSelfImage,
  statRunPath,
} from './files.ts'
import { LineScanner, patternError, readRunLines, SlowPatternError } from './lines.ts'
import { fail, type RunCore } from './runCore.ts'
import { isInstanceId } from './store.ts'

/** `run/load` 带 `since` 且文件没变时的回答。 */
export interface Unchanged {
  unchanged: true
  mtime: number
}

/** 快照里这一项是文件夹还是文件（画布展示问它在不在时，按它本来的种类看）。 */
function itemKindOf(document: WorkflowDocument, node: string, item: number): 'file' | 'folder' {
  const resource = document.nodes.find((candidate) => idKey(candidate.id) === idKey(node))
  return resource !== undefined &&
    isResource(resource) &&
    resource.data.items[item]?.kind === 'folder'
    ? 'folder'
    : 'file'
}

type ReaderCore = Pick<
  RunCore,
  | 'store'
  | 'history'
  | 'deps'
  | 'snapshot'
  | 'withAssets'
  | 'itemFull'
  | 'readState'
  | 'summarize'
  | 'answersOf'
>

/** 读：列实例、给画布读一个实例、实例里的产出文件 / 图片 / 文件夹 / 各版。 */
export class RunReader {
  private readonly core: ReaderCore
  /** 带筛选按行读的工作线程（用到才起）。 */
  private scanner: LineScanner | null = null

  constructor(core: ReaderCore) {
    this.core = core
  }

  /** 列实例：`all` 为假时只列 `session` 的。新的在前。 */
  async list(session: string | undefined, all: boolean): Promise<InstanceSummary[]> {
    const index = await this.core.store.read()
    const records = index.instances
      .filter((record) => all || (session !== undefined && record.session === session))
      .sort((a, b) => b.createdAt - a.createdAt)
    return Promise.all(records.map((record) => this.core.summarize(record, index, session)))
  }

  /** 会话的当前实例 id（没有就 `undefined`）。 */
  async currentOf(session: string): Promise<string | undefined> {
    return (await this.core.store.read()).current[session]
  }

  /** 读一个实例给画布。`since` 等于文件当前的修改时间时只回"没变"。 */
  async view(
    id: string,
    session: string | undefined,
    since?: number,
  ): Promise<Outcome<InstanceView | Unchanged>> {
    if (!isInstanceId(id)) return fail('invalid_args', `实例 id 不合法：${id}`)
    const index = await this.core.store.read()
    const record = index.instances.find((candidate) => candidate.id === id)
    if (record === undefined) return fail('not_found', `实例 ${id} 不存在`)
    if (since !== undefined) {
      try {
        if (record.statePath === undefined) throw new Error('untracked')
        const mtime = (await stat(record.statePath)).mtimeMs
        if (mtime === since) return { ok: true, result: { unchanged: true, mtime } }
      } catch {
        if (since === 0) return { ok: true, result: { unchanged: true, mtime: 0 } }
      }
    }
    const document = await this.core.snapshot(record)
    if (document === null) return fail('not_found', `实例 ${id} 的图快照不见了`)
    const read = await this.core.readState(record, document)
    const located = this.core.withAssets(record, document)
    const files: Record<string, (boolean | null)[]> = {}
    await Promise.all(
      document.nodes.filter(isResource).map(async (node) => {
        files[node.id] = await Promise.all(
          node.data.items.map(async (item, index) => {
            const location = itemLocation(located, node.id, index)
            if (location === null) return null
            const full =
              isAbsolute(location) || record.cwd === undefined
                ? location
                : join(record.cwd, location)
            try {
              const info = await stat(full)
              return item.kind === 'folder' ? info.isDirectory() : info.isFile()
            } catch {
              return false
            }
          }),
        )
      }),
    )
    return {
      ok: true,
      result: {
        summary: await this.core.summarize(record, index, session),
        document,
        state: read.state,
        issues: read.text === null ? [] : read.issues,
        mtime: read.mtime,
        files,
        answers: await this.core.answersOf(record),
      },
    }
  }

  /**
   * 快照里几个资源项现在在不在、多大、什么时候改的（画布上展示着的卡隔一会儿问一次）。
   * 只 stat，不读内容；项不在快照里、不是路径、读不到的一律当作不在。
   */
  async stat(
    id: string,
    targets: readonly { node: string; item: number }[],
  ): Promise<Outcome<RunStatResponse>> {
    if (!isInstanceId(id)) return fail('invalid_args', `实例 id 不合法：${id}`)
    const record = (await this.core.store.read()).instances.find((candidate) => candidate.id === id)
    if (record === undefined) return fail('not_found', `实例 ${id} 不存在`)
    const snapshot = await this.core.snapshot(record)
    if (snapshot === null) return fail('not_found', `实例 ${id} 的图快照不见了`)
    const located = this.core.withAssets(record, snapshot)
    const missing = { exists: false, size: 0, mtime: 0 }
    const counts = await this.core.history.counts(id, targets)
    const stats = await Promise.all(
      targets.map(async ({ node, item }, index) => {
        const kept = counts[index] ?? { versions: 0, revision: 0 }
        const full = this.core.itemFull(record, located, node, item)
        if (full === null) return { ...missing, ...kept }
        const found = await statRunPath(full, itemKindOf(located, node, item))
        return found === null ? { ...missing, ...kept } : { exists: true, ...found, ...kept }
      }),
    )
    return { ok: true, result: { stats } }
  }

  /**
   * 模板画布上的「上次执行」：这个工作流最近建的 {@link RUN_LATEST_SCAN} 个实例里，同一个资源里同一个路径的文件
   * 真的生成了的，取修改时间最新的。实例的图改过（资源换了 id、路径改了）就认不出，当没有。
   */
  async latest(
    workflow: string,
    targets: readonly { node: string; value: string }[],
  ): Promise<RunLatestResponse> {
    const records = (await this.core.store.read()).instances
      .filter((record) => record.workflow === workflow)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, RUN_LATEST_SCAN)
    const located = await Promise.all(
      records.map(async (record) => {
        const snapshot = await this.core.snapshot(record)
        return snapshot === null
          ? null
          : { record, document: this.core.withAssets(record, snapshot) }
      }),
    )
    const latest = await Promise.all(
      targets.map(async ({ node, value }) => {
        let best: RunLatestOutput | null = null
        for (const entry of located) {
          if (entry === null) continue
          const resource = entry.document.nodes.find(
            (candidate) => idKey(candidate.id) === idKey(node),
          )
          if (resource === undefined || !isResource(resource)) continue
          const item = resource.data.items.findIndex(
            (candidate) =>
              (candidate.kind === 'file' || candidate.kind === 'folder') &&
              candidate.value.trim() === value.trim(),
          )
          if (item < 0) continue
          const want = resource.data.items[item]?.kind === 'folder' ? 'folder' : 'file'
          const location = itemLocation(entry.document, resource.id, item)
          if (location === null) continue
          const full =
            isAbsolute(location) || entry.record.cwd === undefined
              ? location
              : join(entry.record.cwd, location)
          // 没生成、被删了是 null。
          const found = await statRunPath(full, want)
          if (found === null || (best !== null && found.mtime <= best.mtime)) continue
          best = { instance: entry.record.id, item, ...found }
        }
        return best
      }),
    )
    return { latest }
  }

  /** 看实例里的一份产出文件（文件面板与查看框）。 */
  async file(
    id: string,
    target: RunFileTarget,
    options: { tail?: boolean } = {},
  ): Promise<Outcome<RunFileResponse>> {
    const located = await this.locateFile(id, target, options)
    return located.ok ? { ok: true, result: located.result.file } : located
  }

  /**
   * 日志、纯文本按行读（`run/lines`）：只读要显示的那几行；带筛选的在工作线程里扫（正则太慢就停下回错误）。
   * 存下的旧版读那一版的内容。
   */
  async lines(
    id: string,
    target: { node: string; item: number; sub?: string; version?: number },
    request: Omit<RunLinesRequest, 'id' | 'node' | 'item' | 'sub' | 'version'>,
  ): Promise<Outcome<RunLinesResponse>> {
    const bad = patternError(request.filter)
    if (bad !== null) return fail('invalid_args', `正则写得不对：${bad}`)
    const located = await this.resolveTarget(id, target)
    if (!located.ok) return located
    const { full, display } = located.result.found
    let source = full
    if (target.version !== undefined) {
      const kept = await this.core.history.locate(id, target.node, target.item, target.version)
      if (kept === null) return fail('not_found', `${display} 没有存下第 ${target.version} 版`)
      source = kept.full
    }
    this.scanner ??= new LineScanner()
    try {
      const read = await readRunLines(source, display, request, this.scanner)
      return { ok: true, result: { ...read, path: full } }
    } catch (error) {
      if (error instanceof SlowPatternError) return fail('invalid_args', error.message)
      return fail(
        'io_error',
        `读文件失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * 实例里的一张本地图片：`src` 是 Markdown 里写的相对路径，按文档所在目录解析（见 {@link resolveImageRef}）；
   * 不给 `src` 就是目标文件自己（文件夹里点开一张图）。
   */
  async image(id: string, target: RunFileTarget, src?: string): Promise<Outcome<RunImageResponse>> {
    const located = await this.locateFile(id, target)
    if (!located.ok) return located
    const { record, file, source } = located.result
    if (!file.exists) return fail('not_found', `文档不存在：${file.display}`)
    // 存下的旧版：图本身读那一版；文档里引用的图还按原文件的位置找（旧版里引用的图只有现在这一份）。
    const resolved =
      src === undefined ? resolveSelfImage(source) : resolveImageRef(record.cwd, file.path, src)
    if (!resolved.ok) return resolved
    try {
      return await readRunImage(resolved.result.full, resolved.result.mime)
    } catch (error) {
      return fail(
        'io_error',
        `读图片失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** 看资源里一个文件夹（或它下面的子文件夹）里有什么：只列这一层，名字、是不是目录、大小、修改时间。 */
  async dir(
    id: string,
    target: { node: string; item: number; sub?: string },
  ): Promise<Outcome<RunDirResponse>> {
    const resolved = await this.resolveTarget(id, target)
    if (!resolved.ok) return resolved
    const { full, display } = resolved.result.found
    try {
      return { ok: true, result: await readRunDir(full, display, resolved.result.sub) }
    } catch (error) {
      return fail(
        'io_error',
        `读文件夹失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /** 把目标解析到实例里的一个位置（实例、快照、路径一并查过）。 */
  private async resolveTarget(
    id: string,
    target: RunFileTarget,
  ): Promise<
    Outcome<{
      record: InstanceRecord
      document: WorkflowDocument
      found: { full: string; display: string; root?: string }
      sub: string
    }>
  > {
    if (!isInstanceId(id)) return fail('invalid_args', `实例 id 不合法：${id}`)
    const record = (await this.core.store.read()).instances.find((candidate) => candidate.id === id)
    if (record === undefined) return fail('not_found', `实例 ${id} 不存在`)
    const snapshot = await this.core.snapshot(record)
    if (snapshot === null) return fail('not_found', `实例 ${id} 的图快照不见了`)
    const document = this.core.withAssets(record, snapshot)
    const resolved = resolveRunFile(record, document, target)
    if (!resolved.ok) return resolved
    if (
      resolved.result.root !== undefined &&
      !(await realInside(resolved.result.root, resolved.result.full))
    ) {
      return fail('invalid_args', '只能看文件夹里面的东西')
    }
    const sub = 'node' in target ? cleanSub(target.sub) : null
    return {
      ok: true,
      result: { record, document, found: resolved.result, sub: sub?.ok === true ? sub.result : '' },
    }
  }

  /** 一份文件存下的各版（只认快照里的文件项）。 */
  async versions(id: string, node: string, item: number): Promise<Outcome<RunHistoryResponse>> {
    const located = await this.resolveTarget(id, { node, item })
    if (!located.ok) return located
    return { ok: true, result: await this.core.history.list(id, node, item) }
  }

  /**
   * 找到并读出实例里的一份文件（连同实例记录，算图片路径要用它的工作区）。
   * `source` 是真正读的那份：平时就是 `file.path`，看存下的旧版时是那一版的内容（`file` 里的路径还是原文件）。
   */
  private async locateFile(
    id: string,
    target: RunFileTarget,
    options: { tail?: boolean } = {},
  ): Promise<Outcome<{ record: InstanceRecord; file: RunFileResponse; source: string }>> {
    const located = await this.resolveTarget(id, target)
    if (!located.ok) return located
    const { record, document, found: resolved } = located.result
    if ('node' in target && target.version !== undefined) {
      const kept = await this.core.history.locate(id, target.node, target.item, target.version)
      if (kept === null)
        return fail('not_found', `${resolved.display} 没有存下第 ${target.version} 版`)
      try {
        const read = await readRunFile(kept.full, resolved.display, options)
        if (!read.exists)
          return fail('not_found', `${resolved.display} 的第 ${target.version} 版不见了`)
        const file = { ...read, path: resolved.full, mtime: kept.version.mtime }
        return { ok: true, result: { record, file, source: kept.full } }
      } catch (error) {
        return fail(
          'io_error',
          `读文件失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
    try {
      const found = await readRunFile(resolved.full, resolved.display, options)
      // 模型报告的产出可能是相对产出根目录写的：工作区里没有时再到根目录下找。
      if (!found.exists && 'path' in target) {
        const alt = resolveRunFile(record, document, target, true)
        if (alt.ok && alt.result.full !== resolved.full) {
          const second = await readRunFile(alt.result.full, alt.result.display, options)
          if (second.exists) {
            return { ok: true, result: { record, file: second, source: second.path } }
          }
        }
      }
      return { ok: true, result: { record, file: found, source: found.path } }
    } catch (error) {
      return fail(
        'io_error',
        `读文件失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}
