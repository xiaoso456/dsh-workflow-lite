/**
 * dsh-workflow-lite — 仓储核心：各部分共用的那一小块状态与读-改-写骨架。
 *
 * 拿着数据根目录、注入的文档级校验器、进程内写锁和基线快照，对外只给几样东西：
 * - `withLock`：一条 promise 链，写路径全程串行（一次工具调用全程在锁内）；
 * - `mutate` / `persist`：读-改-写（写前哈希比对 → 字段级合并 → 复核 → 原子写），**所有写都走这一条**；
 * - `validate` / `resolveName` / `pickFreeName`：校验与名字；
 * - `rememberBaseline` / `baselineFor` / `dropBaselines`：基线快照。
 *
 * 各部分（`repoWorkflows` / `repoList` / `repoVersions` / `repoNodes` / `repoTemplates`）
 * 只按自己用到的几项取窄接口（`Pick<RepoCore, …>`），不碰别的。
 * @module @xiaoso/dsh-workflow-lite/host/store/repoCore
 */

import { analyzeGraph } from '../../shared/graph.ts'
import { cloneDocument, idKey, readDocument, writeDocument } from '../../shared/model.ts'
import { checkName, normalizeName } from '../../shared/naming.ts'
import type {
  ChangedEntry,
  ToolWarning,
  ValidationProblem,
  WorkflowDocument,
  WriteResult,
} from '../../shared/types.ts'
import { ensureDir, hashOf, readFileText, writeFileAtomic } from './atomic.ts'
import { mergeDocuments } from './merge.ts'
import {
  describeOccupant,
  layoutDirs,
  type NameOccupant,
  pathKind,
  templateOccupant,
  workflowFile,
  workflowOccupant,
} from './paths.ts'
import {
  type Failure,
  fail,
  hasLevel,
  mapWriteFailure,
  type Outcome,
  ok,
  onlyLevel,
  problemsToWarnings,
  saveProblem,
} from './repoResult.ts'

/** 合并-重试的上限：合并期间磁盘还在变就再读一次，超过这个次数即认输报 `conflict`。 */
export const MAX_MERGE_ATTEMPTS = 5

/** 撞名自动加序号的上限（`-2` … `-99`）。 */
export const MAX_SEQUENTIAL = 99

/**
 * 文档级校验器——`shared/validate.ts` 的入口在 host 装配时注入（缺省不做文档级校验）。
 *
 * 图名要一起给：校验层有两条规则依赖它（图名的文件名约束、同名目录占位）。
 * `maxNodes` 这类活配置由装配方闭包进来，仓储不认识 Config。
 *
 * 列表按文件身份记着每张图的保存级问题（见 `repoList.ts`）：**保存级问题只能取决于文档和图名**。
 * 要加看别的东西（配置、别的文件）的规则，放到编译级或警告里。
 */
export type DocumentValidator = (
  document: WorkflowDocument,
  workflow: string,
) => ValidationProblem[]

/** 名字空间：图目录与两个模板子目录**不能混**（`workflows` 这个词在两处都出现）。 */
type NameSpace = 'graphs' | 'templates/nodes'

export type MutationOutcome =
  | { ok: true; document: WorkflowDocument; changed: ChangedEntry[]; warnings: ToolWarning[] }
  | Failure

/** 基线快照的容量上限（同名最多 4 个版本，全局最多 64 个；按插入序淘汰最旧的）。 */
const MAX_BASELINES = 64
const MAX_BASELINES_PER_NAME = 4

/** 快照键的分隔符用的是**名字里不可能出现**的控制字符（`checkName` 禁控制字符）。 */
function baselineKey(name: string, hash: string): string {
  return `${idKey(name)}\u0000${hash}`
}

/** 仓储核心。见文件头。 */
export class RepoCore {
  readonly dataDir: string

  private readonly validator: DocumentValidator | null

  /**
   * 基线快照：`"<图名>\0<整图哈希>" → document`，只记 `load()` / 上一次写落盘的那个版本。
   * **它不服务任何读路径**（`read` / `compile` 永远直接读盘；`list` 每次看盘上的文件身份，见 `repoList.ts`），
   * 只为了让 `save()` 拿得到 `mergeDocuments` 需要的 `base`。
   *
   * 同名留多个快照是必要的：画布与工具可能各自持有旧基线并发写，只留最新一份的话
   * 旧基线就退化成"以磁盘为基线"，会把对方刚落盘的改动当成自己的旧值顶掉。
   */
  private readonly baselines = new Map<string, WorkflowDocument>()

  /** 进程内写锁：一条 promise 链，写路径全程串行。 */
  private chain: Promise<void> = Promise.resolve()

  constructor(dataDir: string, validate?: DocumentValidator) {
    this.dataDir = dataDir
    this.validator = validate ?? null
  }

  // ── 锁 ──────────────────────────────────────────────────

  async withLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  // ── 布局 ────────────────────────────────────────────────

  async ensureLayout(): Promise<Outcome<{ created: string[] }>> {
    const created: string[] = []
    try {
      for (const dir of layoutDirs(this.dataDir)) {
        const kind = await pathKind(dir)
        if (kind === 'dir') continue
        if (kind === 'file') {
          return fail('invalid_args', `数据目录被文件占位，无法创建：${dir}`, { path: dir })
        }
        if (await ensureDir(dir)) created.push(dir)
      }
    } catch (error) {
      return mapWriteFailure(error, this.dataDir)
    }
    return ok({ created })
  }

  // ── 读-改-写 ──────────────────────────────────────────

  /**
   * 读-改-写核心：写前哈希比对 → 字段级合并 → 复核 → 原子写。
   * **必须在 `withLock` 内调用**。
   *
   * 返回的 `diskBefore` 是"写这一笔之前磁盘上的样子"——`changed` 应当相对它算，
   * 否则会把外部先落盘的改动也算成我们改的。
   */
  async persist(
    name: string,
    baseDocument: WorkflowDocument | null,
    baseHash: string | null,
    next: WorkflowDocument,
    force: boolean,
  ): Promise<
    Outcome<{
      hash: string
      document: WorkflowDocument
      diskBefore: WorkflowDocument | null
      warnings: ToolWarning[]
    }>
  > {
    const file = workflowFile(this.dataDir, name)
    let text = await readFileText(file)
    if (text === null) return fail('not_found', `图 ${name} 不存在`, { workflow: name })
    let diskHash = await hashOf(text)
    let document = cloneDocument(next)
    let baseline = baseDocument
    let stable = false
    let attempts = 0

    for (; attempts < MAX_MERGE_ATTEMPTS; attempts += 1) {
      if (baseHash !== null && diskHash === baseHash && baseline !== null) {
        stable = true
        break
      }
      const theirs = readDocument(text)
      if (theirs.document === null || hasLevel(theirs.problems, 'save')) {
        return fail('blocked', `磁盘上的图 ${name} 有保存级问题，拒绝覆盖`, {
          problems: onlyLevel(theirs.problems, 'save'),
        })
      }
      // 基线缺失时退化为「以磁盘为基线」：本地改动照写，不误报冲突。
      const merged = mergeDocuments(baseline ?? theirs.document, document, theirs.document)
      if (merged.conflictIds.length > 0 && !force) {
        return fail(
          'conflict',
          `写前比对发现以下 id 双方都改过：${merged.conflictIds.join('、')}`,
          {
            ids: merged.conflictIds,
            baseHash,
            diskHash,
          },
        )
      }
      document = merged.document
      baseline = theirs.document

      const reread = await readFileText(file)
      if (reread === null)
        return fail('not_found', `图 ${name} 在合并期间被删除`, { workflow: name })
      const rereadHash = await hashOf(reread)
      if (rereadHash === diskHash) {
        stable = true
        break
      }
      text = reread
      diskHash = rereadHash
    }

    if (!stable) {
      return fail(
        'conflict',
        `图 ${name} 在合并期间持续被外部修改（已重试 ${MAX_MERGE_ATTEMPTS} 次）`,
        { baseHash, diskHash, attempts },
      )
    }

    const finalText = writeDocument(document)
    // 合并后的终稿必须先过保存级自检（合并可能造出悬空 edge），再落盘。
    const selfProblems = [
      ...readDocument(finalText).problems,
      ...this.validate(document, name),
    ].filter((problem) => problem.level === 'save')
    // 悬空 edge 的权威判据在校验层（`shared/validate.ts`）；这里拦是因为**只有合并会亲手造出**它
    // （本地删了 A、磁盘上 meanwhile 多了一条指向 A 的边）——仓储绝不写出打不开的文件。
    for (const edge of analyzeGraph(document).danglingEdges) {
      selfProblems.push(saveProblem('edge_dangling', `悬空 edge：${edge.id}`))
    }
    if (selfProblems.length > 0) {
      return fail('blocked', `合并后的图 ${name} 有保存级问题，拒绝写入`, {
        problems: selfProblems,
      })
    }

    try {
      await writeFileAtomic(file, finalText)
    } catch (error) {
      return mapWriteFailure(error, file)
    }
    const writtenHash = await hashOf(finalText)
    this.rememberBaseline(name, writtenHash, document)
    return ok({
      hash: writtenHash,
      document,
      // 稳定下来的 `text` 就是这一笔之前磁盘上的内容（最后一轮读到的、并已复核未再变）。
      diskBefore: readDocument(text).document,
      warnings: problemsToWarnings(this.validate(document, name)),
    })
  }

  /** 一次写类工具调用的公共骨架：锁 + 预检 + 读-改-写。 */
  async mutate(
    workflow: string,
    apply: (document: WorkflowDocument) => Promise<MutationOutcome>,
  ): Promise<Outcome<WriteResult>> {
    return this.withLock(async () => {
      const resolved = this.resolveName(workflow)
      if (!resolved.ok) return resolved
      const name = resolved.result
      const ready = await this.ensureLayout()
      if (!ready.ok) return ready

      const file = workflowFile(this.dataDir, name)
      const text = await readFileText(file)
      if (text === null) {
        return fail('not_found', `图 ${name} 不存在——图只能由 create 产生`, { workflow: name })
      }
      const parsed = readDocument(text)
      const problems = [
        ...parsed.problems,
        ...(parsed.document === null ? [] : this.validate(parsed.document, name)),
      ]
      if (parsed.document === null || hasLevel(problems, 'save')) {
        return fail('blocked', `图 ${name} 有保存级问题，拒绝写入`, {
          problems: onlyLevel(problems, 'save'),
        })
      }

      const before = cloneDocument(parsed.document)
      const applied = await apply(cloneDocument(parsed.document))
      if (!applied.ok) return applied

      const persisted = await this.persist(
        name,
        before,
        await hashOf(text),
        applied.document,
        false,
      )
      if (!persisted.ok) return persisted
      return ok({
        changed: applied.changed,
        warnings: [...applied.warnings, ...persisted.result.warnings],
      })
    })
  }

  // ── 校验与名字 ──────────────────────────────────────────

  validate(document: WorkflowDocument, workflow: string): ValidationProblem[] {
    return this.validator?.(document, workflow) ?? []
  }

  resolveName(raw: string): Outcome<string> {
    const name = normalizeName(raw)
    const issue = checkName(name)
    if (issue !== null) {
      return fail('blocked', `名字不合法：${issue.message}`, {
        name: raw,
        code: issue.code,
        problems: [saveProblem(issue.code, issue.message)],
      })
    }
    return ok(name)
  }

  async occupantOf(space: NameSpace, name: string): Promise<NameOccupant> {
    if (space === 'graphs') return workflowOccupant(this.dataDir, name)
    return templateOccupant(this.dataDir, name)
  }

  /** 新建类操作：撞名（**含同名目录**）自动加序号并说明是哪一样占了位。 */
  async pickFreeName(
    base: string,
    space: NameSpace,
    warnings: ToolWarning[],
  ): Promise<Outcome<string>> {
    let candidate = base
    let firstOccupant: NameOccupant = null
    let occupant = await this.occupantOf(space, candidate)
    let index = 1
    while (occupant !== null) {
      if (firstOccupant === null) firstOccupant = occupant
      index += 1
      if (index > MAX_SEQUENTIAL) {
        return fail('invalid_args', `同名条目过多（已试到 ${base}-${MAX_SEQUENTIAL}）`, {
          name: base,
        })
      }
      candidate = `${base}-${index}`
      const issue = checkName(candidate)
      if (issue !== null) {
        return fail('invalid_args', `加序号后的名字不合法：${issue.message}`, { candidate })
      }
      occupant = await this.occupantOf(space, candidate)
    }
    if (firstOccupant !== null) {
      warnings.push({
        level: 'hint',
        code: 'workflow_dir_collision',
        message: `目标名 "${base}" 已被${describeOccupant(firstOccupant)}占用，已改用 "${candidate}"`,
        workflows: [candidate],
      })
    }
    return ok(candidate)
  }

  // ── 基线 ────────────────────────────────────────────────

  rememberBaseline(name: string, hash: string, document: WorkflowDocument): void {
    const key = baselineKey(name, hash)
    this.baselines.delete(key)
    this.baselines.set(key, cloneDocument(document))

    const prefix = `${idKey(name)}\u0000`
    const sameName: string[] = []
    for (const existing of this.baselines.keys()) {
      if (existing.startsWith(prefix)) sameName.push(existing)
    }
    while (sameName.length > MAX_BASELINES_PER_NAME) {
      const oldest = sameName.shift()
      if (oldest !== undefined) this.baselines.delete(oldest)
    }
    while (this.baselines.size > MAX_BASELINES) {
      const oldest = this.baselines.keys().next()
      if (oldest.done) break
      this.baselines.delete(oldest.value)
    }
  }

  baselineFor(name: string, hash: string | null): WorkflowDocument | null {
    if (hash === null) return null
    const entry = this.baselines.get(baselineKey(name, hash))
    return entry === undefined ? null : cloneDocument(entry)
  }

  dropBaselines(name: string): void {
    const prefix = `${idKey(name)}\u0000`
    for (const key of [...this.baselines.keys()]) {
      if (key.startsWith(prefix)) this.baselines.delete(key)
    }
  }
}
