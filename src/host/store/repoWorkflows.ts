/**
 * dsh-workflow-lite — 仓储的工作流部分：读一张图（`load`）、整图保存（`save`）、建 / 改名 / 删。
 *
 * 读-改-写的骨架在 `repoCore`，这里只写图级的流程：`load` 记基线，`save` 走 `persist`，
 * `create` / `rename` / `remove` 各自在锁内完成（改名与删除连带版本、资料目录）。
 * @module @xiaoso/dsh-workflow-lite/host/store/repoWorkflows
 */

import {
  idKey,
  readDocument,
  sameEdgeData,
  sameNodeContent,
  writeDocument,
} from '../../shared/model.ts'
import { normalizeName, sameName } from '../../shared/naming.ts'
import type {
  ChangedEntry,
  Point,
  ToolWarning,
  ValidationProblem,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
  WriteResult,
} from '../../shared/types.ts'
import {
  hashOf,
  readFileText,
  removeTree,
  renamePath,
  unlinkFile,
  writeFileAtomic,
} from './atomic.ts'
import {
  assetsDir,
  describeOccupant,
  dispatchDir,
  pathKind,
  tempName,
  versionsDir,
  workflowFile,
  workflowOccupant,
} from './paths.ts'
import type { RepoCore } from './repoCore.ts'
import { fail, hasLevel, mapWriteFailure, type Outcome, ok, saveProblem } from './repoResult.ts'

export interface LoadResult {
  /** 名字归一后的图名（`not_found` 时也给出，便于上层报错）。 */
  name: string
  /** 可加载时的规范化文档；**保存级问题 ⇒ `null`**。 */
  document: WorkflowDocument | null
  /** 磁盘上的原文（供只读错误态展示）；不存在时 `null`。 */
  text: string | null
  /** 原文的整图哈希（写前比对的基线）；不存在时 `null`。 */
  hash: string | null
  /** 读入阶段的问题，含 `warning` / `hint`（上层按 `level` 分流）。 */
  problems: ValidationProblem[]
  /** `false` ⇒ 拒绝加载：要么保存级非空，要么文档不可用。 */
  loadable: boolean
  /** 那个文件在不在。`loadable=false` 时用它区分 `not_found` 与 `blocked`。 */
  exists: boolean
}

export interface SaveOptions {
  /** 加载时记录的整图哈希；`null` = 没有基线（退化为"以磁盘为基线"的合并，不报冲突）。 */
  baseHash: string | null
  /** 画布「保留我的」：冲突也写（冲突 id 以本地为准）。**工具写路径不要传**。 */
  force?: boolean
}

export interface SaveResult {
  /** 写回后磁盘内容的整图哈希 ⇒ 新的基线。 */
  hash: string
  changed: ChangedEntry[]
  warnings: ToolWarning[]
}

function emptyDocument(): WorkflowDocument {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

function sameData(a: WorkflowNode, b: WorkflowNode): boolean {
  return sameNodeContent(a, b)
}

function sameEdgeContent(a: WorkflowEdge, b: WorkflowEdge): boolean {
  return a.source === b.source && a.target === b.target && sameEdgeData(a.data, b.data)
}

/** `before → after` 的变更摘要（`save` 回告用）。 */
export function diffDocuments(
  before: WorkflowDocument | null,
  after: WorkflowDocument,
): ChangedEntry[] {
  const changed: ChangedEntry[] = []
  if (before === null) {
    for (const node of after.nodes) changed.push({ kind: 'node', op: 'add', id: node.id })
    for (const edge of after.edges) changed.push({ kind: 'edge', op: 'add', id: edge.id })
    return changed
  }

  const beforeNodes = new Map(before.nodes.map((node) => [idKey(node.id), node]))
  const afterNodeKeys = new Set(after.nodes.map((node) => idKey(node.id)))
  for (const node of after.nodes) {
    const prior = beforeNodes.get(idKey(node.id))
    if (prior === undefined) changed.push({ kind: 'node', op: 'add', id: node.id })
    else if (!sameData(prior, node) || !samePoint(prior.position, node.position)) {
      changed.push({ kind: 'node', op: 'update', id: node.id })
    }
  }
  for (const prior of before.nodes) {
    if (!afterNodeKeys.has(idKey(prior.id)))
      changed.push({ kind: 'node', op: 'delete', id: prior.id })
  }

  const beforeEdges = new Map(before.edges.map((edge) => [idKey(edge.id), edge]))
  const afterEdgeKeys = new Set(after.edges.map((edge) => idKey(edge.id)))
  for (const edge of after.edges) {
    const prior = beforeEdges.get(idKey(edge.id))
    if (prior === undefined) changed.push({ kind: 'edge', op: 'add', id: edge.id })
    else if (!sameEdgeContent(prior, edge))
      changed.push({ kind: 'edge', op: 'update', id: edge.id })
  }
  for (const prior of before.edges) {
    if (!afterEdgeKeys.has(idKey(prior.id)))
      changed.push({ kind: 'edge', op: 'delete', id: prior.id })
  }

  return changed
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y
}

/** 工作流部分用到的核心能力。 */
type WorkflowsCore = Pick<
  RepoCore,
  | 'dataDir'
  | 'withLock'
  | 'ensureLayout'
  | 'resolveName'
  | 'validate'
  | 'persist'
  | 'pickFreeName'
  | 'rememberBaseline'
  | 'baselineFor'
  | 'dropBaselines'
>

export class WorkflowStore {
  private readonly core: WorkflowsCore

  constructor(core: WorkflowsCore) {
    this.core = core
  }

  // ── 读 ──────────────────────────────────────────────────

  async load(workflow: string): Promise<LoadResult> {
    const resolved = this.core.resolveName(workflow)
    if (!resolved.ok) {
      const problem = saveProblem('name_invalid', resolved.error.message)
      return {
        name: normalizeName(workflow),
        document: null,
        text: null,
        hash: null,
        problems: [problem],
        loadable: false,
        exists: false,
      }
    }
    const name = resolved.result
    const file = workflowFile(this.core.dataDir, name)
    const occupant = await workflowOccupant(this.core.dataDir, name)
    const text = await readFileText(file)

    const problems: ValidationProblem[] = []
    if (occupant === 'both') {
      // `workflows/<名>.json` 与 `workflows/<名>/` 同时存在 ⇒ 保存级，拒绝加载。
      problems.push(
        saveProblem(
          'workflow_dir_collision',
          `workflows/${name}.json 与 workflows/${name}/ 同时存在：同名目录占位，拒绝加载`,
        ),
      )
    }
    if (text === null) {
      return {
        name,
        document: null,
        text: null,
        hash: null,
        problems,
        loadable: false,
        exists: false,
      }
    }

    const parsed = readDocument(text)
    problems.push(...parsed.problems)
    if (parsed.document !== null) problems.push(...this.core.validate(parsed.document, name))

    const loadable = parsed.document !== null && !hasLevel(problems, 'save')
    const hash = await hashOf(text)
    if (loadable && parsed.document !== null)
      this.core.rememberBaseline(name, hash, parsed.document)
    return {
      name,
      document: loadable ? parsed.document : null,
      text,
      hash,
      problems,
      loadable,
      exists: true,
    }
  }

  // ── 写：整图 ────────────────────────────────────────────

  async save(
    workflow: string,
    next: WorkflowDocument,
    options: SaveOptions,
  ): Promise<Outcome<SaveResult>> {
    return this.core.withLock(async () => {
      const resolved = this.core.resolveName(workflow)
      if (!resolved.ok) return resolved
      const name = resolved.result
      const ready = await this.core.ensureLayout()
      if (!ready.ok) return ready

      const file = workflowFile(this.core.dataDir, name)
      const currentText = await readFileText(file)
      if (currentText === null) {
        return fail('not_found', `图 ${name} 不存在——图只能由 create 产生`, { workflow: name })
      }

      const base = this.core.baselineFor(name, options.baseHash)
      const persisted = await this.core.persist(
        name,
        base,
        options.baseHash,
        next,
        options.force === true,
      )
      if (!persisted.ok) return persisted
      return ok({
        hash: persisted.result.hash,
        changed: diffDocuments(persisted.result.diskBefore, persisted.result.document),
        warnings: persisted.result.warnings,
      })
    })
  }

  // ── 写：图级 ────────────────────────────────────────────

  async create(workflow: string): Promise<Outcome<WriteResult>> {
    return this.core.withLock(async () => {
      const resolved = this.core.resolveName(workflow)
      if (!resolved.ok) return resolved
      const requested = resolved.result
      const ready = await this.core.ensureLayout()
      if (!ready.ok) return ready

      const document = emptyDocument()

      const warnings: ToolWarning[] = []
      const picked = await this.core.pickFreeName(requested, 'graphs', warnings)
      if (!picked.ok) return picked
      const name = picked.result

      const file = workflowFile(this.core.dataDir, name)
      const text = writeDocument(document)
      try {
        await writeFileAtomic(file, text)
      } catch (error) {
        return mapWriteFailure(error, file)
      }
      this.core.rememberBaseline(name, await hashOf(text), document)
      return ok({
        changed: [
          {
            kind: 'workflow',
            op: 'add',
            id: name,
            detail: { requested, renamed: name !== requested },
          },
        ],
        warnings,
      })
    })
  }

  async rename(workflow: string, to: string): Promise<Outcome<WriteResult>> {
    return this.core.withLock(async () => {
      const fromResolved = this.core.resolveName(workflow)
      if (!fromResolved.ok) return fromResolved
      const toResolved = this.core.resolveName(to)
      if (!toResolved.ok) return toResolved
      const from = fromResolved.result
      const target = toResolved.result
      const ready = await this.core.ensureLayout()
      if (!ready.ok) return ready

      const sourceOccupant = await workflowOccupant(this.core.dataDir, from)
      if (sourceOccupant === null) return fail('not_found', `图 ${from} 不存在`, { workflow: from })
      if (sourceOccupant === 'dir') {
        return fail('not_found', `图 ${from} 不存在（workflows/ 下只有同名目录，那是旧结构）`, {
          workflow: from,
        })
      }
      if (from === target) {
        return fail('invalid_args', `目标图名与原图名相同：${from}`, { workflow: from, to: target })
      }

      const targetOccupant = await workflowOccupant(this.core.dataDir, target)
      if (targetOccupant !== null) {
        // 只改大小写时，不区分大小写的文件系统会把"自己那份文件"报成占位者。
        const caseOnly = sameName(from, target)
        const selfOccupied = caseOnly && targetOccupant === 'file'
        if (!selfOccupied) {
          return fail(
            'invalid_args',
            `目标图名 ${target} 已存在（占用者：${describeOccupant(targetOccupant)}），拒绝改名——改名是命令，不是建议`,
            { workflow: from, to: target, occupant: targetOccupant },
          )
        }
      }

      const sourceFile = workflowFile(this.core.dataDir, from)
      const targetFile = workflowFile(this.core.dataDir, target)
      try {
        if (sameName(from, target)) {
          // Windows 上"只改大小写"要两步 rename。
          const temp = tempName(sourceFile)
          await renamePath(sourceFile, temp)
          await renamePath(temp, targetFile)
        } else {
          await renamePath(sourceFile, targetFile)
        }
      } catch (error) {
        return mapWriteFailure(error, targetFile)
      }
      try {
        await removeTree(dispatchDir(this.core.dataDir, from))
      } catch (error) {
        return mapWriteFailure(error, dispatchDir(this.core.dataDir, from))
      }
      // 版本跟着工作流走。新名字下要是有没人认领的旧版本目录（工作流早被删了），先清掉。
      const fromVersions = versionsDir(this.core.dataDir, from)
      const toVersions = versionsDir(this.core.dataDir, target)
      try {
        if ((await pathKind(fromVersions)) === 'dir') {
          if (sameName(from, target)) {
            const temp = tempName(fromVersions)
            await renamePath(fromVersions, temp)
            await renamePath(temp, toVersions)
          } else {
            await removeTree(toVersions)
            await renamePath(fromVersions, toVersions)
          }
        } else if (!sameName(from, target)) {
          await removeTree(toVersions)
        }
      } catch (error) {
        return mapWriteFailure(error, toVersions)
      }
      // 资料目录同样跟着走（规矩和版本一样）。
      const fromAssets = assetsDir(this.core.dataDir, from)
      const toAssets = assetsDir(this.core.dataDir, target)
      try {
        if ((await pathKind(fromAssets)) === 'dir') {
          if (sameName(from, target)) {
            const temp = tempName(fromAssets)
            await renamePath(fromAssets, temp)
            await renamePath(temp, toAssets)
          } else {
            await removeTree(toAssets)
            await renamePath(fromAssets, toAssets)
          }
        } else if (!sameName(from, target)) {
          await removeTree(toAssets)
        }
      } catch (error) {
        return mapWriteFailure(error, toAssets)
      }
      this.core.dropBaselines(from)
      return ok({
        changed: [
          {
            kind: 'workflow',
            op: 'rename',
            id: target,
            detail: { from, dispatchRemoved: true },
          },
        ],
        warnings: [],
      })
    })
  }

  async remove(workflow: string): Promise<Outcome<WriteResult>> {
    return this.core.withLock(async () => {
      const resolved = this.core.resolveName(workflow)
      if (!resolved.ok) return resolved
      const name = resolved.result
      const file = workflowFile(this.core.dataDir, name)
      if ((await pathKind(file)) !== 'file') {
        return fail('not_found', `图 ${name} 不存在`, { workflow: name })
      }
      try {
        await unlinkFile(file)
        await removeTree(dispatchDir(this.core.dataDir, name))
        await removeTree(versionsDir(this.core.dataDir, name))
        await removeTree(assetsDir(this.core.dataDir, name))
      } catch (error) {
        return mapWriteFailure(error, file)
      }
      this.core.dropBaselines(name)
      return ok({
        changed: [{ kind: 'workflow', op: 'delete', id: name, detail: { dispatchRemoved: true } }],
        warnings: [],
      })
    })
  }
}
