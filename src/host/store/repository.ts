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
 *
 * 实现按职责拆在旁边几个文件里，这里只留对外的 `Repository` 接口和装配：
 * `repoCore`（锁、`mutate` / `persist`、校验、名字、基线）、`repoWorkflows`（读 / 整图保存 / 建 / 改名 / 删）、
 * `repoList`（列举）、`repoVersions`（版本与导入）、`repoNodes`（节点与边）、`repoTemplates`（节点模板）。
 * 所有写仍然只经核心的同一把锁和同一条 `mutate` 路径。
 * @module @xiaoso/dsh-workflow-lite/host/store/repository
 */

import type {
  Handoff,
  ListResult,
  NodeData,
  ValidationProblem,
  VersionEntry,
  WorkflowDocument,
  WriteResult,
} from '../../shared/types.ts'
// 只借类型：仓储不运行时依赖校验层，装配时把 `validateDocument` 注入进来即可。
import type { ValidationReport } from '../../shared/validate.ts'
import { type DocumentValidator, RepoCore } from './repoCore.ts'
import { WorkflowLister } from './repoList.ts'
import {
  type InputUpsert,
  type MemoryCardRequest,
  type NodeUpsert,
  NodeWriter,
  type ResourceUpsert,
  type SettingsPatch,
} from './repoNodes.ts'
import type { Outcome } from './repoResult.ts'
import { TemplateStore } from './repoTemplates.ts'
import { type ImportRequest, type ImportResult, VersionStore } from './repoVersions.ts'
import {
  type LoadResult,
  type SaveOptions,
  type SaveResult,
  WorkflowStore,
} from './repoWorkflows.ts'

export interface RepositoryOptions {
  /** 数据根目录（Config 的 `dataDir`，默认 `~/.dsh/workflow-lite`）。 */
  dataDir: string
  /** 见 {@link DocumentValidator}。 */
  validate?: DocumentValidator
}

export interface Repository {
  readonly dataDir: string
  /** 首次启动按需创建 `workflows/` 与 `templates/nodes/`（**不建 `.dispatch/`**）。 */
  ensureLayout(): Promise<Outcome<{ created: string[] }>>
  load(workflow: string): Promise<LoadResult>
  save(workflow: string, next: WorkflowDocument, options: SaveOptions): Promise<Outcome<SaveResult>>
  list(): Promise<ListResult>
  create(workflow: string): Promise<Outcome<WriteResult>>
  rename(workflow: string, to: string): Promise<Outcome<WriteResult>>
  remove(workflow: string): Promise<Outcome<WriteResult>>
  /** 列一个工作流存下的版本（新的在前），标出哪个和磁盘上现在的内容一样。 */
  listVersions(workflow: string): Promise<Outcome<VersionEntry[]>>
  /** 把磁盘上现在的样子存成新版本。和已有的某个版本内容一样就不存（`invalid_args`，`detail.same`）。 */
  saveVersion(workflow: string, note: string): Promise<Outcome<VersionEntry>>
  /** 读一个版本的整张图（切换前看看会变什么）。 */
  readVersion(
    workflow: string,
    n: number,
  ): Promise<Outcome<{ entry: VersionEntry; document: WorkflowDocument }>>
  /**
   * 切到某个版本：现在的内容还没存成版本时先自动存一份（`saved`），再把那个版本写回工作流。
   * 回新的整图哈希。
   */
  restoreVersion(
    workflow: string,
    n: number,
  ): Promise<Outcome<{ hash: string; saved: VersionEntry | null }>>
  /** 改版本说明。 */
  noteVersion(workflow: string, n: number, note: string): Promise<Outcome<VersionEntry>>
  deleteVersion(workflow: string, n: number): Promise<Outcome<{ removed: true }>>
  /**
   * 导入一个工作流包里的版本（见 `host/pack/importer.ts`）：
   * - `new`：建一张新工作流，版本保留包里的编号；名字被占了报 `conflict`；
   * - `merge`：并入已有的那张，和已有版本内容一样的不再存（`duplicates`），其余接着最大编号往上数；
   *   **不自动存**本机现在的内容（前端事先提醒过）。
   * 两种都把 `current` 写成工作流现在的内容。检查都过了才调 `prepare`（解压资料、装 skill），它失败就整个停下。
   */
  importWorkflow(request: ImportRequest): Promise<Outcome<ImportResult>>
  /** 读一个节点模板的 `data` 本体（拿去用：半成品一律挡掉）。 */
  readTemplate(name: string): Promise<Outcome<NodeData>>
  /**
   * 新建一个节点模板文件（`templates/nodes/<名>.json`）。
   *
   * 名字撞了报 `conflict`：**不覆盖、也不自动加序号**——名字是人在对话框里指着输的，
   * 悄悄改名会让他找不到刚建的那个。
   */
  createNodeTemplate(name: string, data: NodeData): Promise<Outcome<WriteResult>>
  /**
   * 读一个节点模板给人**编辑**：只挡保存级（文件坏了），提示词还空着之类的编译级问题照样给出来——
   * 半成品正是要打开来改的。（`readTemplate` 是"拿去用"的那条路，半成品一律挡掉。）
   */
  readNodeTemplateDraft(name: string): Promise<Outcome<NodeData>>
  /**
   * 覆盖保存一个**已存在**的节点模板；给了 `from` 且与 `name` 不同就是"改名并保存"：
   * 新名字被占用报 `conflict`（不覆盖别人的），写好新文件再删旧文件。
   */
  saveNodeTemplate(name: string, data: NodeData, from?: string): Promise<Outcome<WriteResult>>
  /** 删除一个节点模板文件。不存在报 `not_found`。 */
  deleteNodeTemplate(name: string): Promise<Outcome<WriteResult>>
  writeNode(workflow: string, upsert: NodeUpsert): Promise<Outcome<WriteResult>>
  writeResource(workflow: string, upsert: ResourceUpsert): Promise<Outcome<WriteResult>>
  /** 加一张记忆卡（库里那一条由调用方先备好）。步骤不存在、已经有记忆了就拒绝。 */
  addMemory(workflow: string, request: MemoryCardRequest): Promise<Outcome<WriteResult>>
  writeInput(workflow: string, upsert: InputUpsert): Promise<Outcome<WriteResult>>
  setLabel(workflow: string, node: string, label: string): Promise<Outcome<WriteResult>>
  /** 改工作流设置（产出根目录、执行方式、复用执行者、设定目标、记录运行状态）；给了的字段才改。 */
  configure(workflow: string, patch: SettingsPatch): Promise<Outcome<WriteResult>>
  deleteNode(workflow: string, node: string): Promise<Outcome<WriteResult>>
  connect(
    workflow: string,
    source: string,
    target: string,
    when?: string,
    handoff?: Handoff | false | null,
    update?: boolean,
  ): Promise<Outcome<WriteResult>>
  disconnect(
    workflow: string,
    source: string,
    target: string,
    when?: string,
  ): Promise<Outcome<WriteResult>>
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

/** 建一个仓储。`validate` 由 host 在装配时接上 `shared/validate.ts`。 */
export function createRepository(options: RepositoryOptions): Repository {
  const core = new RepoCore(options.dataDir, options.validate)
  const workflows = new WorkflowStore(core)
  const lister = new WorkflowLister(core)
  const versions = new VersionStore(core)
  const templates = new TemplateStore(core)
  const nodes = new NodeWriter(core, templates)
  return {
    dataDir: core.dataDir,
    ensureLayout: () => core.ensureLayout(),
    load: (workflow) => workflows.load(workflow),
    save: (workflow, next, saveOptions) => workflows.save(workflow, next, saveOptions),
    list: () => lister.list(),
    create: (workflow) => workflows.create(workflow),
    rename: (workflow, to) => workflows.rename(workflow, to),
    remove: (workflow) => workflows.remove(workflow),
    listVersions: (workflow) => versions.listVersions(workflow),
    saveVersion: (workflow, note) => versions.saveVersion(workflow, note),
    readVersion: (workflow, n) => versions.readVersion(workflow, n),
    restoreVersion: (workflow, n) => versions.restoreVersion(workflow, n),
    noteVersion: (workflow, n, note) => versions.noteVersion(workflow, n, note),
    deleteVersion: (workflow, n) => versions.deleteVersion(workflow, n),
    importWorkflow: (request) => versions.importWorkflow(request),
    readTemplate: (name) => templates.readTemplate(name),
    createNodeTemplate: (name, data) => templates.createNodeTemplate(name, data),
    readNodeTemplateDraft: (name) => templates.readNodeTemplateDraft(name),
    saveNodeTemplate: (name, data, from) => templates.saveNodeTemplate(name, data, from),
    deleteNodeTemplate: (name) => templates.deleteNodeTemplate(name),
    writeNode: (workflow, upsert) => nodes.writeNode(workflow, upsert),
    writeResource: (workflow, upsert) => nodes.writeResource(workflow, upsert),
    addMemory: (workflow, request) => nodes.addMemory(workflow, request),
    writeInput: (workflow, upsert) => nodes.writeInput(workflow, upsert),
    setLabel: (workflow, node, label) => nodes.setLabel(workflow, node, label),
    configure: (workflow, patch) => nodes.configure(workflow, patch),
    deleteNode: (workflow, node) => nodes.deleteNode(workflow, node),
    connect: (workflow, source, target, when, handoff, update) =>
      nodes.connect(workflow, source, target, when, handoff, update),
    disconnect: (workflow, source, target, when) =>
      nodes.disconnect(workflow, source, target, when),
  }
}
