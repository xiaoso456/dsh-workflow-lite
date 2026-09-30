/**
 * dsh-workflow-lite — 文件仓储：唯一的副作用边界。
 *
 * 这一层兑现四条硬规矩：
 * 1. **单文件原子写**——一切写入都经 `atomic.writeFileAtomic`；
 * 2. **进程内锁的粒度 = 一次工具调用全程**（含预检与全部文件写）——`withLock` 把写路径串行化，
 *    所以 `delete_node` 的"删节点 + 连带删边"不可能被另一个写插进来；
 * 3. **写前哈希比对 + 字段级合并**——不一致不算冲突：按 `node.id` / `edge.id` 合并，
 *    只有「同一个 node 的 `data` 双方都改过」或「同一个 `id` 一方删、一方改」才回 `conflict`；
 *    合并期间基线又变则重试（有上限，见 {@link MAX_MERGE_ATTEMPTS}）；
 * 4. **绝不隐式创建**——除 `write_node` 的 upsert 以外，写 action 指向不存在的图一律 `not_found`。
 *
 * 失败**不抛**（除真 IO 故障的 errno 翻译外）：返回 `{ ok: false, error: ToolError['error'] }`，
 * `code ∈ { not_found, invalid_args, blocked, conflict, io_error }`。
 *
 * 校验分工：本模块只把「读出的文本 → 文档」交给**注入的** `validate`（`shared/validate.ts`
 * 落地后由 host 装配），外加两条只有存储层才知道的判据——`workflow_dir_collision`
 * （`.json` 与同名目录并存）与"合并后的终稿先自检再落盘"（用 `readDocument` 复核 canonical 文本）。
 * @module @xiaoso/dsh-workflow-lite/host/store/repository
 */

import { stat } from 'node:fs/promises'
import { join } from 'node:path'

import { analyzeGraph } from '../../shared/graph.ts'
import {
  cloneDocument,
  findNode,
  idKey,
  makeEdgeId,
  normalizeCoord,
  readDocument,
  writeDocument,
} from '../../shared/model.ts'
import {
  checkLabel,
  checkName,
  checkOutput,
  checkWhen,
  normalizeName,
  sameName,
} from '../../shared/naming.ts'
import {
  type ChangedEntry,
  type ErrorCode,
  type ListResult,
  NODE_TYPE,
  type NodeData,
  type Point,
  type TemplateEntry,
  type ToolError,
  type ToolWarning,
  type ValidationProblem,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowEntry,
  type WorkflowNode,
  type WorkflowTemplate,
  type WriteResult,
} from '../../shared/types.ts'
// 只借类型：仓储不运行时依赖校验层，装配时把 `validateDocument` 注入进来即可。
import type { ValidationReport } from '../../shared/validate.ts'
import {
  ensureDir,
  hashOf,
  readFileText,
  removeTree,
  renamePath,
  unlinkFile,
  writeFileAtomic,
} from './atomic.ts'
import { mergeDocuments } from './merge.ts'
import {
  type DirScan,
  describeOccupant,
  dispatchDir,
  errnoCode,
  layoutDirs,
  type NameOccupant,
  pathKind,
  scanTemplateDir,
  scanWorkflowDir,
  type TemplateKind,
  templateFile,
  templateOccupant,
  tempName,
  workflowFile,
  workflowOccupant,
} from './paths.ts'

/** 合并-重试的上限：合并期间磁盘还在变就再读一次，超过这个次数即认输报 `conflict`。 */
export const MAX_MERGE_ATTEMPTS = 5

/** 撞名自动加序号的上限（`-2` … `-99`）。 */
export const MAX_SEQUENTIAL = 99

// ─────────────────────────────────────────────────────────────
// 对外形状
// ─────────────────────────────────────────────────────────────

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

/** 仓储的统一返回：成功 `{ ok: true, result }`，失败 `{ ok: false, error }`（就是 `ToolError` 的字段）。 */
export type Outcome<T> = { ok: true; result: T } | { ok: false; error: ToolError['error'] }

/**
 * 文档级校验器——`shared/validate.ts` 的入口在 host 装配时注入（缺省不做文档级校验）。
 *
 * 图名要一起给：校验层有两条规则依赖它（图名的文件名约束、同名目录占位）。
 * `maxNodes` 这类活配置由装配方闭包进来，仓储不认识 Config。
 */
export type DocumentValidator = (
  document: WorkflowDocument,
  workflow: string,
) => ValidationProblem[]

/** 模板预检器（可注入）。缺省只做结构判据 + "零节点的图模板算编译级"。 */
export type TemplateValidator = (
  kind: TemplateKind,
  value: WorkflowDocument | NodeData,
) => ValidationProblem[]

export interface RepositoryOptions {
  /** 数据根目录（Config 的 `dataDir`，默认 `~/.dsh/workflow-lite`）。 */
  dataDir: string
  /** 见 {@link DocumentValidator}。 */
  validate?: DocumentValidator
  /** 见 {@link TemplateValidator}。 */
  validateTemplate?: TemplateValidator
}

export interface CreateOptions {
  /** 从 `templates/workflows/<from>.json` 单文件复制；`viewport` 重置、`position` 带过去。 */
  from?: string
}

export interface SaveAsTemplateOptions {
  /** 模板名；缺省 = 原图名。撞名自动加序号。 */
  to?: string
}

/** `write_node` 的语义入参——`undefined` 一律表示"不改这一项"。 */
export interface NodeUpsert {
  /** 节点 id（图内大小写不敏感唯一）；不存在即新建。 */
  id: string
  /** `data.prompt`；允许空串（空 `prompt` 是编译级，不拦落盘）。 */
  content?: string
  /** 显示名；空串 = 清除（回落渲染 `id`）。 */
  label?: string
  /** 产出契约三态：字符串 = 产出；`false` = 显式不产出；`null` = 清除。 */
  output?: string | false | null
  /** `true` ⇒ `output: false`（与 `output` 同时给出时以本字段为准）。 */
  noOutput?: boolean
  /** 从 `templates/nodes/<from>.json` 取 `data` 本体（**不复制模板的 `id` 与 `position`**）。 */
  fromTemplate?: string
  /** 显式坐标；缺省时新建节点留 `{0,0}` 并报 `position_filled` 提示（布局由上层跑）。 */
  position?: Point
}

export interface Repository {
  readonly dataDir: string
  /** 首次启动按需创建 `workflows/` 与 `templates/{workflows,nodes}`（**不建 `.dispatch/`**）。 */
  ensureLayout(): Promise<Outcome<{ created: string[] }>>
  load(workflow: string): Promise<LoadResult>
  save(workflow: string, next: WorkflowDocument, options: SaveOptions): Promise<Outcome<SaveResult>>
  list(): Promise<ListResult>
  create(workflow: string, options?: CreateOptions): Promise<Outcome<WriteResult>>
  rename(workflow: string, to: string): Promise<Outcome<WriteResult>>
  remove(workflow: string): Promise<Outcome<WriteResult>>
  saveAsTemplate(workflow: string, options?: SaveAsTemplateOptions): Promise<Outcome<WriteResult>>
  /** 读一个模板：`kind='workflows'` 给整图文档，`kind='nodes'` 给 `data` 本体。 */
  readTemplate(kind: TemplateKind, name: string): Promise<Outcome<WorkflowTemplate | NodeData>>
  /**
   * 新建一个节点模板文件（`templates/nodes/<名>.json`）。
   *
   * 名字撞了报 `conflict`：**不覆盖、也不自动加序号**——名字是人在对话框里指着输的，
   * 悄悄改名会让他找不到刚建的那个。
   */
  createNodeTemplate(name: string, data: NodeData): Promise<Outcome<WriteResult>>
  writeNode(workflow: string, upsert: NodeUpsert): Promise<Outcome<WriteResult>>
  setLabel(workflow: string, node: string, label: string): Promise<Outcome<WriteResult>>
  deleteNode(workflow: string, node: string): Promise<Outcome<WriteResult>>
  connect(
    workflow: string,
    source: string,
    target: string,
    when?: string,
  ): Promise<Outcome<WriteResult>>
  disconnect(
    workflow: string,
    source: string,
    target: string,
    when?: string,
  ): Promise<Outcome<WriteResult>>
}

// ─────────────────────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────────────────────

type Failure = { ok: false; error: ToolError['error'] }

function fail(code: ErrorCode, message: string, detail?: Record<string, unknown>): Failure {
  return { ok: false, error: detail === undefined ? { code, message } : { code, message, detail } }
}

function ok<T>(result: T): { ok: true; result: T } {
  return { ok: true, result }
}

function saveProblem(code: ValidationProblem['code'], message: string): ValidationProblem {
  return { level: 'save', code, message }
}

function hasLevel(
  problems: readonly ValidationProblem[],
  level: ValidationProblem['level'],
): boolean {
  return problems.some((problem) => problem.level === level)
}

function onlyLevel(
  problems: readonly ValidationProblem[],
  level: ValidationProblem['level'],
): ValidationProblem[] {
  return problems.filter((problem) => problem.level === level)
}

/**
 * `shared/validate.ts` 的 `ValidationReport` → 仓储的 `ValidationProblem[]`。
 * 装配时的接线就是这两行（`maxNodes` 是活配置，用闭包每次重读）：
 *
 * ```ts
 * createRepository({
 *   dataDir,
 *   validate: (document, workflow) =>
 *     reportProblems(validateDocument(document, { workflowName: workflow, maxNodes: cfg.maxNodes })),
 * })
 * ```
 */
export function reportProblems(report: ValidationReport): ValidationProblem[] {
  return [...report.save, ...report.compile, ...report.warning, ...report.hint]
}

/** 把非阻塞问题（警告 / 提示）转成工具线格式的 `warnings`。 */
export function problemsToWarnings(problems: readonly ValidationProblem[]): ToolWarning[] {
  const warnings: ToolWarning[] = []
  for (const problem of problems) {
    if (problem.level !== 'warning' && problem.level !== 'hint') continue
    warnings.push({
      level: problem.level,
      code: problem.code,
      message: problem.message,
      ...(problem.node === undefined ? {} : { nodes: [problem.node] }),
    })
  }
  return warnings
}

function describeProblems(problems: readonly ValidationProblem[]): string {
  return problems.map((problem) => problem.message).join('；')
}

/** errno → 工具失败码：`dataDir` 不可写 / 不可用 ⇒ `invalid_args`，其余 IO 失败 ⇒ `io_error`。 */
function mapWriteFailure(error: unknown, target: string): Failure {
  const code = errnoCode(error) ?? 'unknown'
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'ENOTDIR') {
    return fail('invalid_args', `数据目录不可写或不可用（${code}）：${target}`, {
      errno: code,
      path: target,
    })
  }
  if (code === 'ENOENT' || code === 'EEXIST') {
    return fail(
      'invalid_args',
      `数据目录结构不可用（${code}）：${target}——dataDir 必须是一个可写的目录`,
      {
        errno: code,
        path: target,
      },
    )
  }
  return fail('io_error', `写入失败（${code}）：${target}`, { errno: code, path: target })
}

function emptyDocument(): WorkflowDocument {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

/**
 * 编译级里与存储强相关的那一条：**图内没有节点**。
 * 它同时决定「零节点的图模板算 invalid、拒绝作为 `from`」与「空图拒绝存为模板」。
 * 其余编译级规则（`prompt` 为空、超 `maxNodes`）归校验层，仓储不内联。
 */
function noNodesProblem(): ValidationProblem {
  return { level: 'compile', code: 'no_nodes', message: '图内没有节点' }
}

/** 补一条 `no_nodes`（注入的校验层已经报过就不重复报）。 */
function appendNoNodes(
  problems: ValidationProblem[],
  document: WorkflowDocument,
): ValidationProblem[] {
  if (document.nodes.length > 0) return problems
  if (problems.some((problem) => problem.code === 'no_nodes')) return problems
  return [...problems, noNodesProblem()]
}

function setLabelValue(data: NodeData, label: string | undefined): void {
  if (label === undefined) delete data.label
  else data.label = label
}

function setPromptValue(data: NodeData, prompt: string | undefined): void {
  if (prompt === undefined) delete data.prompt
  else data.prompt = prompt
}

function setOutputValue(data: NodeData, output: string | false | undefined): void {
  if (output === undefined) delete data.output
  else data.output = output
}

function sameData(a: NodeData, b: NodeData): boolean {
  return a.label === b.label && a.prompt === b.prompt && a.output === b.output
}

function sameEdgeContent(a: WorkflowEdge, b: WorkflowEdge): boolean {
  return (
    a.source === b.source &&
    a.target === b.target &&
    a.data?.when === b.data?.when &&
    a.data?.label === b.data?.label
  )
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
    else if (!sameData(prior.data, node.data) || !samePoint(prior.position, node.position)) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 名字空间：图目录与两个模板子目录**不能混**（`workflows` 这个词在两处都出现）。 */
type NameSpace = 'graphs' | 'templates/workflows' | 'templates/nodes'

type MutationOutcome =
  | { ok: true; document: WorkflowDocument; changed: ChangedEntry[]; warnings: ToolWarning[] }
  | Failure

/** 基线快照的容量上限（同名最多 4 个版本，全局最多 64 个；按插入序淘汰最旧的）。 */
const MAX_BASELINES = 64
const MAX_BASELINES_PER_NAME = 4

/** 快照键的分隔符用的是**名字里不可能出现**的控制字符（`checkName` 禁控制字符）。 */
function baselineKey(name: string, hash: string): string {
  return `${idKey(name)}\u0000${hash}`
}

// ─────────────────────────────────────────────────────────────
// 实现
// ─────────────────────────────────────────────────────────────

class FileRepository implements Repository {
  readonly dataDir: string

  private readonly validator: DocumentValidator | null
  private readonly templateValidator: TemplateValidator | null

  /**
   * 基线快照：`"<图名>\0<整图哈希>" → document`，只记 `load()` / 上一次写落盘的那个版本。
   * **它不服务任何读路径**（`list` / `read` / `compile` 永远直接读盘，不设内容缓存），
   * 只为了让 `save()` 拿得到 `mergeDocuments` 需要的 `base`。
   *
   * 同名留多个快照是必要的：画布与工具可能各自持有旧基线并发写，只留最新一份的话
   * 旧基线就退化成"以磁盘为基线"，会把对方刚落盘的改动当成自己的旧值顶掉。
   */
  private readonly baselines = new Map<string, WorkflowDocument>()

  /** 进程内写锁：一条 promise 链，写路径全程串行。 */
  private chain: Promise<void> = Promise.resolve()

  constructor(options: RepositoryOptions) {
    this.dataDir = options.dataDir
    this.validator = options.validate ?? null
    this.templateValidator = options.validateTemplate ?? null
  }

  // ── 锁 ──────────────────────────────────────────────────────

  private async withLock<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  // ── 布局 ────────────────────────────────────────────────────

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

  // ── 读 ──────────────────────────────────────────────────────

  async load(workflow: string): Promise<LoadResult> {
    const resolved = this.resolveName(workflow)
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
    const file = workflowFile(this.dataDir, name)
    const occupant = await workflowOccupant(this.dataDir, name)
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
    if (parsed.document !== null) problems.push(...this.validate(parsed.document, name))

    const loadable = parsed.document !== null && !hasLevel(problems, 'save')
    const hash = await hashOf(text)
    if (loadable && parsed.document !== null) this.rememberBaseline(name, hash, parsed.document)
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

  // ── 写：整图 ────────────────────────────────────────────────

  async save(
    workflow: string,
    next: WorkflowDocument,
    options: SaveOptions,
  ): Promise<Outcome<SaveResult>> {
    return this.withLock(async () => {
      const resolved = this.resolveName(workflow)
      if (!resolved.ok) return resolved
      const name = resolved.result
      const ready = await this.ensureLayout()
      if (!ready.ok) return ready

      const file = workflowFile(this.dataDir, name)
      const currentText = await readFileText(file)
      if (currentText === null) {
        return fail('not_found', `图 ${name} 不存在——图只能由 create 产生`, { workflow: name })
      }

      const base = this.baselineFor(name, options.baseHash)
      const persisted = await this.persist(
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

  /**
   * 读-改-写核心：写前哈希比对 → 字段级合并 → 复核 → 原子写。
   * **必须在 `withLock` 内调用**。
   *
   * 返回的 `diskBefore` 是"写这一笔之前磁盘上的样子"——`changed` 应当相对它算，
   * 否则会把外部先落盘的改动也算成我们改的。
   */
  private async persist(
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

  // ── 列举 ────────────────────────────────────────────────────

  async list(): Promise<ListResult> {
    const warnings: ToolWarning[] = []

    const [scan, templateWorkflows, templateNodes, legacy] = await Promise.all([
      scanWorkflowDir(this.dataDir),
      scanTemplateDir(this.dataDir, 'workflows'),
      scanTemplateDir(this.dataDir, 'nodes'),
      this.detectLegacy(),
    ])

    if (legacy) {
      warnings.push({
        level: 'hint',
        code: 'legacy_structure',
        message: '检测到 md 版旧结构，未迁移、不读取',
      })
    }
    this.reportIgnored(scan, 'workflows/', warnings)
    this.reportIgnored(templateWorkflows, 'templates/workflows/', warnings)
    this.reportIgnored(templateNodes, 'templates/nodes/', warnings)

    const workflows: WorkflowEntry[] = []
    for (const name of scan.names) {
      workflows.push(await this.describeWorkflow(name, scan))
    }

    return {
      workflows,
      templates: {
        workflows: await this.describeTemplates('workflows', templateWorkflows.names),
        nodes: await this.describeTemplates('nodes', templateNodes.names),
      },
      warnings,
    }
  }

  // ── 写：图级 ────────────────────────────────────────────────

  async create(workflow: string, options: CreateOptions = {}): Promise<Outcome<WriteResult>> {
    return this.withLock(async () => {
      const resolved = this.resolveName(workflow)
      if (!resolved.ok) return resolved
      const requested = resolved.result
      const ready = await this.ensureLayout()
      if (!ready.ok) return ready

      let document: WorkflowDocument
      if (options.from === undefined) {
        document = emptyDocument()
      } else {
        const template = await this.readWorkflowTemplate(options.from)
        if (!template.ok) return template
        document = cloneDocument(template.result)
        // 模板定义的是"节点怎么摆"，但"你上次看到哪"不该继承。
        document.viewport = { x: 0, y: 0, zoom: 1 }
      }

      const warnings: ToolWarning[] = []
      const picked = await this.pickFreeName(requested, 'graphs', warnings)
      if (!picked.ok) return picked
      const name = picked.result

      const file = workflowFile(this.dataDir, name)
      const text = writeDocument(document)
      try {
        await writeFileAtomic(file, text)
      } catch (error) {
        return mapWriteFailure(error, file)
      }
      this.rememberBaseline(name, await hashOf(text), document)
      return ok({
        changed: [
          {
            kind: 'workflow',
            op: 'add',
            id: name,
            detail: { requested, renamed: name !== requested, from: options.from ?? null },
          },
        ],
        warnings,
      })
    })
  }

  async rename(workflow: string, to: string): Promise<Outcome<WriteResult>> {
    return this.withLock(async () => {
      const fromResolved = this.resolveName(workflow)
      if (!fromResolved.ok) return fromResolved
      const toResolved = this.resolveName(to)
      if (!toResolved.ok) return toResolved
      const from = fromResolved.result
      const target = toResolved.result
      const ready = await this.ensureLayout()
      if (!ready.ok) return ready

      const sourceOccupant = await workflowOccupant(this.dataDir, from)
      if (sourceOccupant === null) return fail('not_found', `图 ${from} 不存在`, { workflow: from })
      if (sourceOccupant === 'dir') {
        return fail('not_found', `图 ${from} 不存在（workflows/ 下只有同名目录，那是旧结构）`, {
          workflow: from,
        })
      }
      if (from === target) {
        return fail('invalid_args', `目标图名与原图名相同：${from}`, { workflow: from, to: target })
      }

      const targetOccupant = await workflowOccupant(this.dataDir, target)
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

      const sourceFile = workflowFile(this.dataDir, from)
      const targetFile = workflowFile(this.dataDir, target)
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
        await removeTree(dispatchDir(this.dataDir, from))
      } catch (error) {
        return mapWriteFailure(error, dispatchDir(this.dataDir, from))
      }
      this.dropBaselines(from)
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
    return this.withLock(async () => {
      const resolved = this.resolveName(workflow)
      if (!resolved.ok) return resolved
      const name = resolved.result
      const file = workflowFile(this.dataDir, name)
      if ((await pathKind(file)) !== 'file') {
        return fail('not_found', `图 ${name} 不存在`, { workflow: name })
      }
      try {
        await unlinkFile(file)
        await removeTree(dispatchDir(this.dataDir, name))
      } catch (error) {
        return mapWriteFailure(error, file)
      }
      this.dropBaselines(name)
      return ok({
        changed: [{ kind: 'workflow', op: 'delete', id: name, detail: { dispatchRemoved: true } }],
        warnings: [],
      })
    })
  }

  async saveAsTemplate(
    workflow: string,
    options: SaveAsTemplateOptions = {},
  ): Promise<Outcome<WriteResult>> {
    return this.withLock(async () => {
      const resolved = this.resolveName(workflow)
      if (!resolved.ok) return resolved
      const name = resolved.result
      const ready = await this.ensureLayout()
      if (!ready.ok) return ready

      const file = workflowFile(this.dataDir, name)
      const text = await readFileText(file)
      if (text === null) return fail('not_found', `图 ${name} 不存在`, { workflow: name })
      const parsed = readDocument(text)
      if (parsed.document === null) {
        return fail('blocked', `图 ${name} 有保存级问题，拒绝存为模板`, {
          problems: onlyLevel(parsed.problems, 'save'),
        })
      }
      const errors = appendNoNodes(
        [
          ...onlyLevel(parsed.problems, 'save'),
          ...this.validate(parsed.document, name).filter(
            (problem) => problem.level === 'save' || problem.level === 'compile',
          ),
        ],
        parsed.document,
      )
      if (errors.length > 0) {
        return fail('blocked', `图 ${name} 有错误级问题，拒绝存为模板`, { problems: errors })
      }

      const requestedResolved = this.resolveName(options.to ?? name)
      if (!requestedResolved.ok) return requestedResolved
      const requested = requestedResolved.result
      const warnings: ToolWarning[] = []
      const picked = await this.pickFreeName(requested, 'templates/workflows', warnings)
      if (!picked.ok) return picked
      const templateName = picked.result

      const copy = cloneDocument(parsed.document)
      copy.viewport = { x: 0, y: 0, zoom: 1 }
      const target = templateFile(this.dataDir, 'workflows', templateName)
      try {
        await writeFileAtomic(target, writeDocument(copy))
      } catch (error) {
        return mapWriteFailure(error, target)
      }
      return ok({
        changed: [
          {
            kind: 'workflow',
            op: 'add',
            id: templateName,
            detail: {
              template: 'workflows',
              requested,
              from: name,
              renamed: templateName !== requested,
            },
          },
        ],
        warnings,
      })
    })
  }

  // ── 写：节点与边 ────────────────────────────────────────────

  async writeNode(workflow: string, upsert: NodeUpsert): Promise<Outcome<WriteResult>> {
    return this.mutate(workflow, async (document) => {
      const rawId = normalizeName(upsert.id)
      const idIssue = checkName(rawId)
      if (idIssue !== null) {
        return fail('blocked', `节点 id 不合法：${idIssue.message}`, {
          code: idIssue.code,
          id: upsert.id,
        })
      }
      if (upsert.label !== undefined) {
        const labelIssue = checkLabel(upsert.label)
        if (labelIssue !== null) {
          return fail('blocked', `label 不合法：${labelIssue.message}`, { code: labelIssue.code })
        }
      }
      if (typeof upsert.output === 'string') {
        const outputIssue = checkOutput(upsert.output)
        if (outputIssue !== null) {
          return fail('blocked', `output 不合法：${outputIssue.message}`, {
            code: outputIssue.code,
          })
        }
      }

      const existing = findNode(document, rawId)
      let data: NodeData = existing === undefined ? {} : { ...existing.data }
      if (upsert.fromTemplate !== undefined) {
        const template = await this.readNodeTemplate(upsert.fromTemplate)
        if (!template.ok) return template
        // 节点模板 = `data` 本体；**不复制模板的 `id` 与 `position`**。
        data = { ...template.result }
      }
      if (upsert.content !== undefined) setPromptValue(data, upsert.content)
      if (upsert.label !== undefined)
        setLabelValue(data, upsert.label === '' ? undefined : upsert.label)
      if (upsert.noOutput === true) setOutputValue(data, false)
      else if (upsert.output === null) setOutputValue(data, undefined)
      else if (upsert.output !== undefined) setOutputValue(data, upsert.output)

      const warnings: ToolWarning[] = []
      let position: Point
      if (upsert.position !== undefined) {
        position = upsert.position
      } else if (existing !== undefined) {
        position = existing.position
      } else {
        // 补位由上层跑分层布局；这里先留占位并报提示（position 缺失的补位）。
        position = { x: 0, y: 0 }
        warnings.push({
          level: 'hint',
          code: 'position_filled',
          message: `节点 ${rawId} 未给坐标，已留 (0,0) 占位，待布局补位`,
          nodes: [rawId],
        })
      }

      const node: WorkflowNode = {
        id: existing === undefined ? rawId : existing.id,
        type: NODE_TYPE,
        position: { x: normalizeCoord(position.x), y: normalizeCoord(position.y) },
        data,
      }
      if (existing === undefined) document.nodes = [...document.nodes, node]
      else {
        document.nodes = document.nodes.map((current) =>
          idKey(current.id) === idKey(node.id) ? node : current,
        )
      }
      return {
        ok: true,
        document,
        changed: [
          {
            kind: 'node',
            op: existing === undefined ? 'add' : 'update',
            id: node.id,
            detail: { fromTemplate: upsert.fromTemplate ?? null },
          },
        ],
        warnings,
      }
    })
  }

  async setLabel(workflow: string, node: string, label: string): Promise<Outcome<WriteResult>> {
    return this.mutate(workflow, async (document) => {
      const target = findNode(document, node)
      if (target === undefined) return fail('not_found', `节点 ${node} 不存在`, { node })
      const issue = checkLabel(label)
      if (issue !== null) {
        return fail('blocked', `label 不合法：${issue.message}`, { code: issue.code, node })
      }
      if ((target.data.label ?? '') === label) {
        return { ok: true, document, changed: [], warnings: [] }
      }
      // 改 `label` 是纯 `data` 变更：不碰 edges、不涉及文件名、无连带写入。
      setLabelValue(target.data, label === '' ? undefined : label)
      return {
        ok: true,
        document,
        changed: [{ kind: 'node', op: 'update', id: target.id, detail: { field: 'label' } }],
        warnings: [],
      }
    })
  }

  async deleteNode(workflow: string, node: string): Promise<Outcome<WriteResult>> {
    return this.mutate(workflow, async (document) => {
      const target = findNode(document, node)
      if (target === undefined) return fail('not_found', `节点 ${node} 不存在`, { node })
      // 删节点**必须连带删边**，否则立刻产生悬空 edge、整图不可加载。
      const orphans = document.edges.filter(
        (edge) =>
          idKey(edge.source) === idKey(target.id) || idKey(edge.target) === idKey(target.id),
      )
      const orphanIds = new Set(orphans.map((edge) => edge.id))
      document.nodes = document.nodes.filter((current) => idKey(current.id) !== idKey(target.id))
      document.edges = document.edges.filter((edge) => !orphanIds.has(edge.id))
      return {
        ok: true,
        document,
        changed: [
          {
            kind: 'node',
            op: 'delete',
            id: target.id,
            detail: { edges: orphans.map((edge) => edge.id) },
          },
        ],
        warnings: [],
      }
    })
  }

  async connect(
    workflow: string,
    source: string,
    target: string,
    when?: string,
  ): Promise<Outcome<WriteResult>> {
    return this.mutate(workflow, async (document) => {
      const from = findNode(document, source)
      if (from === undefined) return fail('not_found', `源节点 ${source} 不存在`, { node: source })
      const to = findNode(document, target)
      if (to === undefined) return fail('not_found', `目标节点 ${target} 不存在`, { node: target })

      let whenValue: string | undefined
      if (when !== undefined) {
        const issue = checkWhen(when)
        if (issue !== null) {
          return fail('blocked', `when 不合法：${issue.message}`, { code: issue.code })
        }
        whenValue = when
      }

      // 幂等：同 source + target + when 已存在 ⇒ 不新增、成功、不回报变更。
      const duplicate = document.edges.some(
        (edge) =>
          idKey(edge.source) === idKey(from.id) &&
          idKey(edge.target) === idKey(to.id) &&
          (edge.data?.when ?? undefined) === whenValue,
      )
      if (duplicate) return { ok: true, document, changed: [], warnings: [] }

      const id = makeEdgeId(from.id, to.id, whenValue)
      const edge: WorkflowEdge = {
        id,
        source: from.id,
        target: to.id,
        sourceHandle: null,
        targetHandle: null,
        ...(whenValue === undefined ? {} : { data: { when: whenValue } }),
      }
      document.edges = [...document.edges, edge]
      return { ok: true, document, changed: [{ kind: 'edge', op: 'add', id }], warnings: [] }
    })
  }

  async disconnect(
    workflow: string,
    source: string,
    target: string,
    when?: string,
  ): Promise<Outcome<WriteResult>> {
    return this.mutate(workflow, async (document) => {
      const matches = document.edges.filter(
        (edge) => idKey(edge.source) === idKey(source) && idKey(edge.target) === idKey(target),
      )
      if (matches.length === 0) {
        return fail('not_found', `边 ${source}->${target} 不存在`, { source, target })
      }
      let chosen: WorkflowEdge[]
      if (when !== undefined) {
        const issue = checkWhen(when)
        if (issue !== null) {
          return fail('blocked', `when 不合法：${issue.message}`, { code: issue.code })
        }
        chosen = matches.filter((edge) => (edge.data?.when ?? '') === when)
        if (chosen.length === 0) {
          return fail('not_found', `边 ${source}->${target}#${when} 不存在`, {
            source,
            target,
            when,
          })
        }
      } else {
        if (matches.length > 1) {
          return fail(
            'invalid_args',
            `节点 ${source} 与 ${target} 之间有 ${matches.length} 条边，必须用 when 指定删哪一条`,
            { source, target, count: matches.length },
          )
        }
        chosen = matches
      }
      const ids = new Set(chosen.map((edge) => edge.id))
      document.edges = document.edges.filter((edge) => !ids.has(edge.id))
      return {
        ok: true,
        document,
        changed: chosen.map((edge) => ({
          kind: 'edge' as const,
          op: 'delete' as const,
          id: edge.id,
        })),
        warnings: [],
      }
    })
  }

  // ── 模板 ────────────────────────────────────────────────────

  async readTemplate(
    kind: TemplateKind,
    name: string,
  ): Promise<Outcome<WorkflowTemplate | NodeData>> {
    return kind === 'workflows' ? this.readWorkflowTemplate(name) : this.readNodeTemplate(name)
  }

  private async readWorkflowTemplate(name: string): Promise<Outcome<WorkflowTemplate>> {
    const loaded = await this.loadTemplateText('workflows', name)
    if (!loaded.ok) return loaded
    const parsed = readDocument(loaded.result.text)
    if (parsed.document === null) {
      return fail('blocked', `模板 ${name} 不是一张可读的图`, {
        problems: onlyLevel(parsed.problems, 'save'),
      })
    }
    return ok(parsed.document)
  }

  private async readNodeTemplate(name: string): Promise<Outcome<NodeData>> {
    const loaded = await this.loadTemplateText('nodes', name)
    if (!loaded.ok) return loaded
    const parsed = parseNodeData(loaded.result.text)
    if (hasLevel(parsed.problems, 'save')) {
      return fail('blocked', `节点模板 ${name} 不可读`, {
        problems: onlyLevel(parsed.problems, 'save'),
      })
    }
    return ok(parsed.data)
  }

  async createNodeTemplate(name: string, data: NodeData): Promise<Outcome<WriteResult>> {
    return this.withLock(async () => {
      const resolved = this.resolveName(name)
      if (!resolved.ok) return resolved
      const templateName = resolved.result
      const ready = await this.ensureLayout()
      if (!ready.ok) return ready

      const target = templateFile(this.dataDir, 'nodes', templateName)
      /*
       * 撞名 = **冲突**，不是"改名后接着写"。
       *
       * 与 `create`（建图）刻意不同：那条路上名字常常是自动取的（"未命名"），撞了加序号
       * 是帮忙；这条路上名字是人在对话框里指名输的，静默改名会让人对着列表找不到刚建的那个，
       * 而覆盖别人的模板更不可接受。
       */
      const occupant = await templateOccupant(this.dataDir, 'nodes', templateName)
      if (occupant !== null) {
        return fail(
          'conflict',
          `节点模板 ${templateName} 已存在（${describeOccupant(occupant)}）`,
          {
            template: templateName,
            kind: 'nodes',
            occupant,
          },
        )
      }
      try {
        await writeFileAtomic(target, writeNodeTemplate(data))
      } catch (error) {
        return mapWriteFailure(error, target)
      }
      return ok({
        changed: [
          {
            kind: 'workflow',
            op: 'add',
            id: templateName,
            detail: { template: 'nodes', created: true },
          },
        ],
        warnings: [],
      })
    })
  }

  /** 读出模板文本并做预检：坏的（保存级 / 编译级）一律 `blocked`，绝不复制半成品。 */
  private async loadTemplateText(
    kind: TemplateKind,
    name: string,
  ): Promise<Outcome<{ text: string; problems: ValidationProblem[] }>> {
    const resolved = this.resolveName(name)
    if (!resolved.ok) return resolved
    const text = await readFileText(templateFile(this.dataDir, kind, resolved.result))
    if (text === null) {
      return fail('not_found', `模板 ${kind}/${resolved.result} 不存在`, {
        template: resolved.result,
        kind,
      })
    }
    const problems = this.templateProblems(kind, resolved.result, text)
    const errors = problems.filter(
      (problem) => problem.level === 'save' || problem.level === 'compile',
    )
    if (errors.length > 0) {
      return fail(
        'blocked',
        `模板 ${kind}/${resolved.result} 不可用：${describeProblems(errors)}`,
        {
          template: resolved.result,
          kind,
          problems: errors,
        },
      )
    }
    return ok({ text, problems })
  }

  /** 模板预检：结构 + 注入的 `validateTemplate` + "零节点图模板算编译级"。 */
  private templateProblems(kind: TemplateKind, name: string, text: string): ValidationProblem[] {
    if (kind === 'nodes') {
      const parsed = parseNodeData(text)
      const injected = this.templateValidator?.('nodes', parsed.data) ?? []
      return [...parsed.problems, ...injected]
    }
    const parsed = readDocument(text)
    const problems = [...parsed.problems]
    if (parsed.document !== null) {
      const injected =
        this.templateValidator?.('workflows', parsed.document) ??
        this.validate(parsed.document, name)
      problems.push(...injected)
      return appendNoNodes(problems, parsed.document)
    }
    return problems
  }

  // ── 内部 ────────────────────────────────────────────────────

  /** 一次写类工具调用的公共骨架：锁 + 预检 + 读-改-写。 */
  private async mutate(
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

  private validate(document: WorkflowDocument, workflow: string): ValidationProblem[] {
    return this.validator?.(document, workflow) ?? []
  }

  private resolveName(raw: string): Outcome<string> {
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

  private async occupantOf(space: NameSpace, name: string): Promise<NameOccupant> {
    if (space === 'graphs') return workflowOccupant(this.dataDir, name)
    return templateOccupant(
      this.dataDir,
      space === 'templates/workflows' ? 'workflows' : 'nodes',
      name,
    )
  }

  /** 新建类操作：撞名（**含同名目录**）自动加序号并说明是哪一样占了位。 */
  private async pickFreeName(
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

  private async detectLegacy(): Promise<boolean> {
    const scan = await scanWorkflowDir(this.dataDir)
    if (scan.directories.length > 0) return true
    return (await pathKind(join(this.dataDir, 'nodes'))) === 'dir'
  }

  private reportIgnored(scan: DirScan, label: string, warnings: ToolWarning[]): void {
    for (const name of scan.ignored) {
      warnings.push({
        level: 'hint',
        code: 'stray_entry',
        message: `${label}${name} 不像图文件（非 .json / 隐藏 / .tmp-* / 符号链接），已忽略`,
        workflows: [name],
      })
    }
    for (const name of scan.directories) {
      warnings.push({
        level: 'hint',
        code: 'legacy_structure',
        message: `${label}${name} 是目录：目录不是图文件，已忽略`,
        workflows: [name],
      })
    }
  }

  private async describeWorkflow(name: string, scan: DirScan): Promise<WorkflowEntry> {
    const file = workflowFile(this.dataDir, name)
    let updatedAt = 0
    try {
      updatedAt = (await stat(file)).mtimeMs
    } catch {
      return { name, nodeCount: 0, updatedAt, invalid: true, reason: '文件在扫描后消失' }
    }
    const text = await readFileText(file)
    if (text === null) {
      return { name, nodeCount: 0, updatedAt, invalid: true, reason: '文件在扫描后消失' }
    }
    const parsed = readDocument(text)
    if (parsed.document === null) {
      return {
        name,
        nodeCount: 0,
        updatedAt,
        invalid: true,
        reason: describeProblems(onlyLevel(parsed.problems, 'save')),
      }
    }
    const errors = onlyLevel(this.validate(parsed.document, name), 'save')
    const collides = scan.directories.some((dir) => dir.toLowerCase() === name.toLowerCase())
    if (collides) {
      errors.unshift(
        saveProblem(
          'workflow_dir_collision',
          `workflows/${name}.json 与 workflows/${name}/ 同时存在`,
        ),
      )
    }
    if (errors.length > 0) {
      return {
        name,
        nodeCount: parsed.document.nodes.length,
        updatedAt,
        invalid: true,
        reason: describeProblems(errors),
      }
    }
    return { name, nodeCount: parsed.document.nodes.length, updatedAt }
  }

  private async describeTemplates(
    kind: TemplateKind,
    names: readonly string[],
  ): Promise<TemplateEntry[]> {
    const entries: TemplateEntry[] = []
    for (const name of names) {
      const text = await readFileText(templateFile(this.dataDir, kind, name))
      if (text === null) {
        entries.push({ name, invalid: true, reason: '文件在扫描后消失' })
        continue
      }
      const errors = this.templateProblems(kind, name, text).filter(
        (problem) => problem.level === 'save' || problem.level === 'compile',
      )
      if (errors.length > 0) {
        entries.push({ name, invalid: true, reason: describeProblems(errors) })
      } else {
        entries.push({ name })
      }
    }
    return entries
  }

  private rememberBaseline(name: string, hash: string, document: WorkflowDocument): void {
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

  private baselineFor(name: string, hash: string | null): WorkflowDocument | null {
    if (hash === null) return null
    const entry = this.baselines.get(baselineKey(name, hash))
    return entry === undefined ? null : cloneDocument(entry)
  }

  private dropBaselines(name: string): void {
    const prefix = `${idKey(name)}\u0000`
    for (const key of [...this.baselines.keys()]) {
      if (key.startsWith(prefix)) this.baselines.delete(key)
    }
  }
}

/**
 * 节点模板文件的规范化写出：固定键序（`label` / `prompt` / `output`）、缺省项不写、
 * 末尾一个换行。与 {@link parseNodeData} 是同一套形状——**文件顶层就是 `data` 本体**，
 * 不套 `{ data: … }` 壳。`prompt` 总是写出来（空串也写）：那是这个模板的正文，
 * 缺键与空串在读者眼里是两件事，别让它含糊。
 */
function writeNodeTemplate(data: NodeData): string {
  const out: Record<string, unknown> = {}
  if (data.label !== undefined && data.label !== '') out.label = data.label
  out.prompt = data.prompt ?? ''
  if (data.output !== undefined) out.output = data.output
  return `${JSON.stringify(out, null, 2)}\n`
}

/** 节点模板 = 一个 `data` 本体；这里只做形状归一，规则判定交给校验层。 */
function parseNodeData(text: string): { data: NodeData; problems: ValidationProblem[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      data: {},
      problems: [
        saveProblem(
          'json_parse_failed',
          `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    }
  }
  if (!isRecord(parsed)) {
    return { data: {}, problems: [saveProblem('schema_invalid', '节点模板必须是一个 JSON 对象')] }
  }
  const data: NodeData = {}
  if (typeof parsed.label === 'string') data.label = parsed.label
  if (typeof parsed.prompt === 'string') data.prompt = parsed.prompt
  if (typeof parsed.output === 'string') data.output = parsed.output
  else if (parsed.output === false) data.output = false
  const problems: ValidationProblem[] = []
  if (data.prompt === undefined || data.prompt === '') {
    problems.push({
      level: 'compile',
      code: 'prompt_empty',
      message: '节点模板的 prompt 缺失或为空',
    })
  }
  return { data, problems }
}

/** 建一个仓储。`validate` / `validateTemplate` 由 host 在装配时接上 `shared/validate.ts`。 */
export function createRepository(options: RepositoryOptions): Repository {
  return new FileRepository(options)
}
