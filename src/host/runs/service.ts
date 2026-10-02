/**
 * dsh-workflow-lite — 工作流实例的业务面：建实例、列、读、绑定、删、恢复、保存用户的改动。
 *
 * 工具（`compile` / `resume` / `runs`）与画布 RPC（`run/*`）共用这一层。状态文件的读写在这里：
 * 读用 `yaml` 解析后交给 `shared/runState.ts` 校验；用户的改动用 `yaml` 的 Document 接口
 * **只改动过的那几处**——保留主 agent 写的注释与排版。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/service
 */

import { stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { Document, isSeq, parseDocument } from 'yaml'
import { planIdOf, type RunStateSection } from '../../shared/compile.ts'
import { isFile, isStep, readDocument, writeDocument } from '../../shared/model.ts'
import { bindRoot, resolveOutputPath, rootOf, WORKSPACE_ROOT } from '../../shared/outputPaths.ts'
import {
  type EditValue,
  editablePath,
  graphFacts,
  type InstanceRecord,
  type InstanceSummary,
  type InstanceView,
  initialRunState,
  isoNow,
  progressOf,
  type RunState,
  type RunStateIssue,
  type StateEdit,
  validateRunState,
} from '../../shared/runState.ts'
import type { ExecutionMode, ValidationProblem, WorkflowDocument } from '../../shared/types.ts'
import type { RunFileResponse } from '../../shared/wire.ts'
import { type CompileBundle, compileDocument, type PreparedRun } from '../plan.ts'
import {
  ensureDir,
  readFileText,
  removeTree,
  unlinkFile,
  writeFileAtomic,
} from '../store/atomic.ts'
import type { Outcome } from '../store/repository.ts'
import { type RunFileTarget, readRunFile, resolveRunFile } from './files.ts'
import {
  ensureWorkspaceIgnore,
  type InstanceIndex,
  InstanceStore,
  isInstanceId,
  newInstanceId,
  runDir,
  snapshotFile,
  statePathFor,
} from './store.ts'

/** 把一条通知送进会话（`steer`：空闲就开一轮，正在跑就排进下一步）。送到了回 `true`。 */
export type Notify = (session: string, text: string, summary: string) => Promise<boolean>

export interface RunServiceDeps {
  dataDir: () => string
  /** 校验脚本的绝对路径（包里缺它时 `undefined`，计划里就不写校验命令）。 */
  validator: () => string | undefined
  notify?: Notify
}

/** 会话信息：工具从执行上下文取，画布从槽位给。 */
export interface SessionRef {
  id?: string
  cwd?: string
}

/** `run/load` 带 `since` 且文件没变时的回答。 */
export interface Unchanged {
  unchanged: true
  mtime: number
}

/** 保存用户改动的结果。 */
export interface SaveResult {
  /** 通知送到模型了没有；没送到时存进索引，模型下次调用工具时附上。 */
  notified: boolean
  mtime: number
}

/** 保存时字段对不上（用户开始改之后，模型改了同一个字段）。 */
export interface EditConflict {
  path: string[]
  /** 用户以为的旧值。 */
  from: EditValue
  /** 文件里现在的值。 */
  disk: EditValue
}

const fail = <T>(
  code: 'not_found' | 'invalid_args' | 'blocked' | 'conflict' | 'io_error',
  message: string,
  detail?: Record<string, unknown>,
): Outcome<T> => ({
  ok: false,
  error: { code, message, ...(detail === undefined ? {} : { detail }) },
})

function header(validator: string | undefined, statePath: string): string {
  return [
    ' workflow-lite 运行状态（字段含义见 skill workflow-run-state）。',
    ' 执行期间由主 agent 维护；version / instance / workflow / plan / graph / mode 是插件写的，不要改。',
    ' 每次改之前先重新读一遍（用户可能在画布上改过），只改要改的地方。',
    ...(validator === undefined ? [] : [` 改完运行：node "${validator}" "${statePath}"`]),
  ].join('\n')
}

/** 状态 → YAML 文本（长摘要不折行，纯数字的字符串自动加引号）。 */
function stateText(state: RunState, validator: string | undefined, statePath: string): string {
  const doc = new Document(state)
  doc.commentBefore = header(validator, statePath)
  return doc.toString({ lineWidth: 0 })
}

function valueAt(root: unknown, path: readonly string[]): EditValue {
  let cursor: unknown = root
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) return null
    cursor = (cursor as Record<string, unknown>)[key]
  }
  if (cursor === undefined || cursor === null) return null
  if (typeof cursor === 'string' || typeof cursor === 'number') return cursor
  if (Array.isArray(cursor) && cursor.every((item) => typeof item === 'string')) return cursor
  // 布尔、映射这类用户改不到的形状：按字符串比（对不上就是冲突）。
  return JSON.stringify(cursor)
}

function sameValue(a: EditValue, b: EditValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function describeValue(value: EditValue): string {
  if (value === null) return '（空）'
  if (Array.isArray(value)) return value.length === 0 ? '[]' : value.join('、')
  return typeof value === 'string' && value.length > 40
    ? `「${value.slice(0, 40)}…」`
    : String(value)
}

/** 一个字段的改动，写成「status 从 done 改成 pending（要重新执行这一步）」这样的半句。 */
function describeField(edit: StateEdit): string {
  const field = edit.path[edit.path.length - 1] ?? ''
  const change =
    edit.to === null
      ? `删掉了 ${field}（原来是 ${describeValue(edit.from)}）`
      : edit.from === null
        ? `${field} 写成 ${describeValue(edit.to)}`
        : `${field} 从 ${describeValue(edit.from)} 改成 ${describeValue(edit.to)}`
  let intent = ''
  if (field === 'status' && edit.path.length === 3) {
    if (edit.to === 'pending') intent = '（要重新执行这一步）'
    else if (edit.to === 'skipped') intent = '（这一步不再执行）'
    else if (edit.to === 'done') intent = '（视为已完成）'
  }
  if (field === 'status' && edit.path.length === 1) {
    if (edit.to === 'waiting') intent = '（先停下，等用户）'
    else if (edit.to === 'cancelled') intent = '（用户叫停了这次执行）'
    else if (edit.to === 'running') intent = '（继续执行）'
  }
  return `${change}${intent}`
}

/**
 * 改动按对象归成几行写给模型：整体一行、每个步骤一行；同一行里状态在前，连带改的字段跟在后面。
 * 返回的行数就是"改了几处"（用户改一个步骤的状态，连带改了轮次、时间，算一处）。
 */
export function describeEdits(edits: readonly StateEdit[]): string[] {
  const groups = new Map<string, StateEdit[]>()
  for (const edit of edits) {
    const key = edit.path.length === 1 ? '' : (edit.path[1] ?? '')
    groups.set(key, [...(groups.get(key) ?? []), edit])
  }
  return [...groups].map(([key, group]) => {
    const ordered = [
      ...group.filter((edit) => edit.path[edit.path.length - 1] === 'status'),
      ...group.filter((edit) => edit.path[edit.path.length - 1] !== 'status'),
    ]
    return `- ${key === '' ? '整体' : `步骤 ${key}`}：${ordered.map(describeField).join('；')}`
  })
}

/**
 * 画布上点「执行」时发进会话的那句话：短、人看得懂；完整计划由模型调 `resume` 拿
 * （计划在工具结果里，对话里照样看得到）。
 */
export function startPrompt(record: InstanceRecord): string {
  const state = record.statePath === undefined ? '' : '，并按计划里「运行状态」一段维护状态文件'
  return [
    `执行工作流「${record.workflow}」（实例 ${record.id}）。`,
    `请调用 workflow_lite：action=resume，instance=${record.id}，拿到计划后按计划执行${state}。`,
  ].join('\n')
}

/** 快照里的产出根目录定死成这个实例的（见 {@link RunService.prepare}）。 */
function pinRoot(document: WorkflowDocument, id: string): WorkflowDocument {
  return {
    ...document,
    settings: { ...document.settings, outputRoot: bindRoot(rootOf(document.settings), id) },
  }
}

export class RunService {
  readonly store: InstanceStore
  private readonly deps: RunServiceDeps

  constructor(deps: RunServiceDeps) {
    this.deps = deps
    this.store = new InstanceStore(deps.dataDir)
  }

  // ── 建立 ───────────────────────────────────────────────────

  /**
   * 编译成功之后建实例（`compile` 的 `prepareRun`）：
   * 本会话当前实例是同一张图、同一个 `planId`、而且还没开始过时直接复用（模型重复编译不会留下一堆空实例）。
   *
   * 快照里的产出根目录定死：没配就是默认的 `.workflow-lite/runs/<实例 id>/out`，`{instance}` 换成实例 id。
   * 实例的 `planId` 按快照算（`resume` 从快照重编，两边对得上）。
   */
  async prepare(input: {
    workflow: string
    document: WorkflowDocument
    session: SessionRef
    goal?: string
    /** 建状态文件（缺省建）；画布上「执行」一张没开「记录运行状态」的图时为假。 */
    track?: boolean
    /** 复用本会话还没开始过的同一份实例（缺省复用；画布上点「执行」每次都是新的一次）。 */
    reuse?: boolean
  }): Promise<Outcome<PreparedRun>> {
    const dataDir = this.deps.dataDir()
    const mode: ExecutionMode = input.document.settings?.mode ?? 'auto'
    const session = input.session.id
    const track = input.track !== false
    if (session !== undefined && track && input.reuse !== false) {
      const index = await this.store.read()
      const currentId = index.current[session]
      const current = index.instances.find((record) => record.id === currentId)
      if (
        current !== undefined &&
        current.workflow === input.workflow &&
        current.planId === planIdOf(pinRoot(input.document, current.id))
      ) {
        const read = await this.readState(current)
        if (read.state?.status === 'pending' && read.state.log.length === 0) {
          return { ok: true, result: this.prepared(current) }
        }
      }
    }

    const id = newInstanceId()
    const cwd = input.session.cwd
    const statePath = track ? statePathFor(dataDir, id, cwd) : undefined
    const graph = snapshotFile(dataDir, id)
    const snapshot = pinRoot(input.document, id)
    const planId = planIdOf(snapshot)
    try {
      await ensureDir(runDir(dataDir, id))
      await writeFileAtomic(graph, writeDocument(snapshot))
      // 工作区里的隐藏目录：放一个忽略一切的 .gitignore，状态文件与默认产出不进版本库。
      if (cwd !== undefined) await ensureWorkspaceIgnore(cwd)
      if (statePath !== undefined) {
        const state = initialRunState({
          instance: id,
          workflow: input.workflow,
          plan: planId,
          graph,
          mode,
          ...(input.goal === undefined ? {} : { goal: input.goal }),
          now: isoNow(),
          steps: input.document.nodes.filter(isStep).map((node) => node.id),
        })
        await ensureDir(dirname(statePath))
        await writeFileAtomic(statePath, stateText(state, this.deps.validator(), statePath))
      }
    } catch (error) {
      return fail(
        'io_error',
        `建工作流实例失败：${error instanceof Error ? error.message : String(error)}`,
        {
          statePath,
        },
      )
    }
    const record: InstanceRecord = {
      id,
      workflow: input.workflow,
      planId,
      mode,
      ...(input.goal === undefined || input.goal === '' ? {} : { goal: input.goal }),
      ...(cwd === undefined ? {} : { cwd }),
      ...(statePath === undefined ? {} : { statePath }),
      ...(session === undefined ? {} : { session }),
      createdAt: Date.now(),
    }
    await this.store.update((index) => {
      index.instances.push(record)
      if (session !== undefined) index.current[session] = id
    })
    return { ok: true, result: { ...this.prepared(record), document: snapshot } }
  }

  private prepared(record: InstanceRecord): PreparedRun {
    if (record.statePath === undefined) return { info: { instance: record.id } }
    const validator = this.deps.validator()
    const section: RunStateSection = {
      statePath: record.statePath,
      ...(validator === undefined ? {} : { validator }),
    }
    return { section, info: { instance: record.id, statePath: record.statePath } }
  }

  /**
   * 画布上的「执行」：用模板现在的样子建一个新实例（图的快照 + 归属 `session`，开了「记录运行状态」
   * 再建状态文件），设成这个会话的当前实例，回一句发进会话的话——模型据此用 `resume` 拿计划。
   * 图有编译级问题时不建（计划都出不来）。
   */
  async start(input: {
    workflow: string
    document: WorkflowDocument
    problems: readonly ValidationProblem[]
    session: SessionRef & { id: string }
  }): Promise<Outcome<{ instance: InstanceSummary; prompt: string }>> {
    const compiled = await compileDocument(
      this.deps.dataDir(),
      input.workflow,
      input.document,
      input.problems,
      {},
      input.session.cwd,
    )
    if (!compiled.ok) return compiled
    if (compiled.result.problems.length > 0) {
      return fail('blocked', `工作流 ${input.workflow} 有问题，编译不出计划`, {
        problems: compiled.result.problems,
      })
    }
    const prepared = await this.prepare({
      workflow: input.workflow,
      document: input.document,
      session: input.session,
      track: input.document.settings?.runState === true,
      reuse: false,
    })
    if (!prepared.ok) return prepared
    const id = prepared.result.info.instance ?? ''
    const index = await this.store.read()
    const record = index.instances.find((candidate) => candidate.id === id)
    if (record === undefined) return fail('not_found', `实例 ${id} 不存在`)
    return {
      ok: true,
      result: {
        instance: await this.summarize(record, index, input.session.id),
        prompt: startPrompt(record),
      },
    }
  }

  // ── 读 ─────────────────────────────────────────────────────

  private async snapshot(record: InstanceRecord): Promise<WorkflowDocument | null> {
    const text = await readFileText(snapshotFile(this.deps.dataDir(), record.id))
    if (text === null) return null
    const document = readDocument(text).document
    // 早先的快照没定死根目录：那时没配 = 工作区根。
    if (document === null || document.settings?.outputRoot !== undefined) return document
    return { ...document, settings: { ...document.settings, outputRoot: WORKSPACE_ROOT } }
  }

  /** 读并校验状态文件。`document` 给了就对照快照。 */
  private async readState(
    record: InstanceRecord,
    document?: WorkflowDocument | null,
  ): Promise<{
    state: RunState | null
    issues: RunStateIssue[]
    mtime: number
    text: string | null
  }> {
    let mtime = 0
    if (record.statePath === undefined) return { state: null, issues: [], mtime: 0, text: null }
    try {
      mtime = (await stat(record.statePath)).mtimeMs
    } catch {
      return { state: null, issues: [], mtime: 0, text: null }
    }
    const text = await readFileText(record.statePath)
    if (text === null) return { state: null, issues: [], mtime: 0, text: null }
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
      return {
        state: null,
        issues: doc.errors.map((error) => ({
          path: '',
          message: `YAML 写法有误：${error.message}`,
        })),
        mtime,
        text,
      }
    }
    const check = validateRunState(
      doc.toJS(),
      document === undefined || document === null ? undefined : graphFacts(document),
      { instance: record.id, workflow: record.workflow, plan: record.planId },
    )
    return { state: check.state, issues: check.issues, mtime, text }
  }

  private async summarize(
    record: InstanceRecord,
    index: InstanceIndex,
    session: string | undefined,
  ): Promise<InstanceSummary> {
    const read = await this.readState(record)
    const base: InstanceSummary = {
      id: record.id,
      workflow: record.workflow,
      planId: record.planId,
      mode: record.mode,
      ...(record.goal === undefined ? {} : { goal: record.goal }),
      ...(record.cwd === undefined ? {} : { cwd: record.cwd }),
      ...(record.statePath === undefined ? {} : { statePath: record.statePath }),
      ...(record.session === undefined ? {} : { session: record.session }),
      createdAt: record.createdAt,
      current: session !== undefined && index.current[session] === record.id,
    }
    if (record.statePath === undefined) return base
    if (read.text === null) return { ...base, stateProblem: 'missing' }
    if (read.state === null) return { ...base, stateProblem: 'invalid' }
    const progress = progressOf(read.state)
    return {
      ...base,
      status: read.state.status,
      done: progress.done,
      total: progress.total,
      updatedAt: read.state.updatedAt,
    }
  }

  /** 列实例：`all` 为假时只列 `session` 的。新的在前。 */
  async list(session: string | undefined, all: boolean): Promise<InstanceSummary[]> {
    const index = await this.store.read()
    const records = index.instances
      .filter((record) => all || (session !== undefined && record.session === session))
      .sort((a, b) => b.createdAt - a.createdAt)
    return Promise.all(records.map((record) => this.summarize(record, index, session)))
  }

  /** 会话的当前实例 id（没有就 `undefined`）。 */
  async currentOf(session: string): Promise<string | undefined> {
    return (await this.store.read()).current[session]
  }

  /** 读一个实例给画布。`since` 等于文件当前的修改时间时只回"没变"。 */
  async view(
    id: string,
    session: string | undefined,
    since?: number,
  ): Promise<Outcome<InstanceView | Unchanged>> {
    if (!isInstanceId(id)) return fail('invalid_args', `实例 id 不合法：${id}`)
    const index = await this.store.read()
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
    const document = await this.snapshot(record)
    if (document === null) return fail('not_found', `实例 ${id} 的图快照不见了`)
    const read = await this.readState(record, document)
    const files: Record<string, boolean> = {}
    const root = document.settings?.outputRoot
    await Promise.all(
      document.nodes.filter(isFile).map(async (node) => {
        const relative = resolveOutputPath(root, node.data.path)
        const full =
          isAbsolute(relative) || record.cwd === undefined ? relative : join(record.cwd, relative)
        try {
          files[node.id] = (await stat(full)).isFile()
        } catch {
          files[node.id] = false
        }
      }),
    )
    return {
      ok: true,
      result: {
        summary: await this.summarize(record, index, session),
        document,
        state: read.state,
        issues: read.text === null ? [] : read.issues,
        mtime: read.mtime,
        files,
      },
    }
  }

  /** 看实例里的一份产出文件（文件面板与查看框）。 */
  async file(id: string, target: RunFileTarget): Promise<Outcome<RunFileResponse>> {
    if (!isInstanceId(id)) return fail('invalid_args', `实例 id 不合法：${id}`)
    const record = (await this.store.read()).instances.find((candidate) => candidate.id === id)
    if (record === undefined) return fail('not_found', `实例 ${id} 不存在`)
    const document = await this.snapshot(record)
    if (document === null) return fail('not_found', `实例 ${id} 的图快照不见了`)
    const resolved = resolveRunFile(record, document, target)
    if (!resolved.ok) return resolved
    try {
      const found = await readRunFile(resolved.result.full, resolved.result.display)
      // 模型报告的产出可能是相对产出根目录写的：工作区里没有时再到根目录下找。
      if (!found.exists && 'path' in target) {
        const alt = resolveRunFile(record, document, target, true)
        if (alt.ok && alt.result.full !== resolved.result.full) {
          const second = await readRunFile(alt.result.full, alt.result.display)
          if (second.exists) return { ok: true, result: second }
        }
      }
      return { ok: true, result: found }
    } catch (error) {
      return fail(
        'io_error',
        `读文件失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // ── 归属 ───────────────────────────────────────────────────

  /**
   * 设 `session` 的当前实例。实例原本属于别的会话时把它**转过来**（一个实例只属于一个会话）：
   * 原会话的当前实例若是它就清掉，状态文件的 `log` 记一条 `transfer`。
   */
  async bind(id: string, session: string): Promise<Outcome<{ transferred: boolean }>> {
    if (!isInstanceId(id)) return fail('invalid_args', `实例 id 不合法：${id}`)
    let previous: string | undefined
    const found = await this.store.update((index) => {
      const record = index.instances.find((candidate) => candidate.id === id)
      if (record === undefined) return null
      previous = record.session
      if (record.session !== undefined && record.session !== session) {
        if (index.current[record.session] === id) delete index.current[record.session]
      }
      record.session = session
      index.current[session] = id
      return record
    })
    if (found === null) return fail('not_found', `实例 ${id} 不存在`)
    const transferred = previous !== undefined && previous !== session
    if (transferred) {
      // 记一笔就行；状态文件不在或写不进去不影响归属本身。
      await this.appendLog(found, {
        event: 'transfer',
        detail: `从会话 ${previous} 转到会话 ${session}`,
      }).catch(() => {})
    }
    return { ok: true, result: { transferred } }
  }

  /** 删实例记录与快照；`withState` 为真时连工作区里的状态文件一起删。 */
  async remove(id: string, withState: boolean): Promise<Outcome<{ removed: true }>> {
    if (!isInstanceId(id)) return fail('invalid_args', `实例 id 不合法：${id}`)
    const record = await this.store.update((index) => {
      const found = index.instances.find((candidate) => candidate.id === id)
      if (found === undefined) return null
      index.instances = index.instances.filter((candidate) => candidate.id !== id)
      for (const [session, current] of Object.entries(index.current)) {
        if (current === id) delete index.current[session]
      }
      return found
    })
    if (record === null) return fail('not_found', `实例 ${id} 不存在`)
    await removeTree(runDir(this.deps.dataDir(), id))
    if (withState && record.statePath !== undefined) await unlinkFile(record.statePath)
    return { ok: true, result: { removed: true } }
  }

  // ── 恢复 ───────────────────────────────────────────────────

  /**
   * 接着跑一个实例：从快照重建计划（同一个 `planId`；载荷不在就重新物化），带上运行状态段，
   * 再给一份摘要。实例属于别的会话时先转过来。
   */
  async resume(
    id: string | undefined,
    session: SessionRef,
  ): Promise<
    Outcome<
      CompileBundle & { instance: string; statePath?: string; progress: Record<string, unknown> }
    >
  > {
    const index = await this.store.read()
    const target = id ?? (session.id === undefined ? undefined : index.current[session.id])
    if (target === undefined) {
      return fail('not_found', '这个会话没有当前的工作流实例；用 runs 看有哪些，再给 instance')
    }
    const record = index.instances.find((candidate) => candidate.id === target)
    if (record === undefined) return fail('not_found', `实例 ${target} 不存在`)
    const document = await this.snapshot(record)
    if (document === null) return fail('not_found', `实例 ${target} 的图快照不见了`)
    if (session.id !== undefined) await this.bind(record.id, session.id)
    const compiled = await compileDocument(
      this.deps.dataDir(),
      record.workflow,
      document,
      [],
      {
        ...(record.goal === undefined ? {} : { goal: record.goal }),
        prepareRun: async () => ({ ok: true, result: this.prepared(record) }),
      },
      record.cwd ?? session.cwd,
    )
    if (!compiled.ok) return compiled
    const read = await this.readState(record, document)
    const progress: Record<string, unknown> =
      record.statePath === undefined
        ? { tracked: false }
        : read.state === null
          ? { stateProblem: read.text === null ? 'missing' : 'invalid', issues: read.issues }
          : (() => {
              const p = progressOf(read.state)
              const next = Object.entries(read.state.nodes).find(
                ([, node]) => node.status !== 'done' && node.status !== 'skipped',
              )?.[0]
              return {
                status: read.state.status,
                done: p.done,
                total: p.total,
                ...(p.running.length > 0 ? { interrupted: p.running } : {}),
                ...(p.waiting.length > 0 ? { waiting: p.waiting } : {}),
                ...(p.failed.length > 0 ? { failed: p.failed } : {}),
                ...(next === undefined ? {} : { next }),
              }
            })()
    // 还没开始过的（刚从画布上「执行」建出来）不算恢复，不记流水。
    if (read.state !== null && (read.state.status !== 'pending' || read.state.log.length > 0)) {
      await this.appendLog(record, { event: 'resume' }).catch(() => {})
    }
    return {
      ok: true,
      result: {
        ...compiled.result,
        instance: record.id,
        ...(record.statePath === undefined ? {} : { statePath: record.statePath }),
        progress,
      },
    }
  }

  // ── 用户的改动 ─────────────────────────────────────────────

  /**
   * 保存用户在画布上攒的改动：逐条核对"改前"还是文件里的值（对不上整次拒绝、回冲突清单），
   * 只改这几处、追加一条 `edit` 流水、更新 `updatedAt`，校验通过才原子写；然后通知模型。
   */
  async save(
    id: string,
    session: string | undefined,
    edits: readonly StateEdit[],
    note: string | undefined,
  ): Promise<Outcome<SaveResult>> {
    if (!isInstanceId(id)) return fail('invalid_args', `实例 id 不合法：${id}`)
    if (edits.length === 0) return fail('invalid_args', '没有要保存的改动')
    const bad = edits.find((edit) => !editablePath(edit.path))
    if (bad !== undefined)
      return fail('invalid_args', `这个字段不能在画布上改：${bad.path.join('.')}`)
    const index = await this.store.read()
    const record = index.instances.find((candidate) => candidate.id === id)
    if (record === undefined) return fail('not_found', `实例 ${id} 不存在`)
    const statePath = record.statePath
    if (statePath === undefined) return fail('invalid_args', `实例 ${id} 不记运行状态，没有可改的`)
    const document = await this.snapshot(record)
    const text = await readFileText(statePath)
    if (text === null) return fail('not_found', `状态文件不在了：${statePath}`)
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
      return fail('blocked', '状态文件现在的 YAML 写法有误，先等模型修好再改', {
        issues: doc.errors.map((error) => error.message),
      })
    }
    const before = doc.toJS() as unknown
    const conflicts: EditConflict[] = []
    for (const edit of edits) {
      const disk = valueAt(before, edit.path)
      if (!sameValue(disk, edit.from)) conflicts.push({ path: edit.path, from: edit.from, disk })
    }
    if (conflicts.length > 0) {
      return fail('conflict', '有字段在你开始改之后被模型改过了', { conflicts })
    }

    const now = isoNow()
    for (const edit of edits) {
      if (edit.to === null) doc.deleteIn(edit.path)
      else doc.setIn(edit.path, edit.to)
    }
    doc.setIn(['updatedAt'], now)
    const lines = describeEdits(edits)
    const entry: Record<string, string> = {
      at: now,
      event: 'edit',
      by: 'user',
      detail: [
        lines.map((line) => line.slice(2)).join('；'),
        note === undefined || note === '' ? '' : `说明：${note}`,
      ]
        .filter((part) => part !== '')
        .join('。'),
    }
    const log = doc.getIn(['log'], true)
    if (isSeq(log)) {
      log.flow = false
      log.add(doc.createNode(entry))
    } else {
      doc.setIn(['log'], [entry])
    }
    const check = validateRunState(
      doc.toJS(),
      document === null ? undefined : graphFacts(document),
      { instance: record.id, workflow: record.workflow, plan: record.planId },
    )
    if (check.state === null) {
      return fail('blocked', '改完的状态不合法，没有保存', { issues: check.issues })
    }
    try {
      await writeFileAtomic(statePath, doc.toString({ lineWidth: 0 }))
    } catch (error) {
      return fail(
        'io_error',
        `写状态文件失败：${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const mtime = (await stat(statePath)).mtimeMs

    const summary = `用户修改了 ${record.workflow} 的运行状态（${lines.length} 处）`
    const body = [
      `[workflow-lite] 用户在画布上修改了运行状态，已写入 ${statePath}`,
      `实例 ${record.id} · 工作流 ${record.workflow}`,
      '',
      ...lines,
      ...(note === undefined || note.trim() === '' ? [] : ['', `用户的说明：${note.trim()}`]),
      '',
      '请先重新读取状态文件，按最新状态调整接下来的执行：改回 pending 的步骤要重新执行，skipped 的不再执行，顶层是 waiting 就停下来问用户、cancelled 就结束。之后照常维护状态文件（改之前先重新读）。',
    ].join('\n')
    const owner = record.session ?? session
    let notified = false
    if (owner !== undefined && this.deps.notify !== undefined) {
      notified = await this.deps.notify(owner, body, summary).catch(() => false)
    }
    if (!notified) {
      await this.store.update((current) => {
        const target = current.instances.find((candidate) => candidate.id === id)
        if (target === undefined) return
        target.pendingNotice =
          target.pendingNotice === undefined ? body : `${target.pendingNotice}\n\n${body}`
      })
    }
    return { ok: true, result: { notified, mtime } }
  }

  /** 取走这个会话名下所有没送到的通知（模型调用工具时附在返回值里）。 */
  async takeNotices(session: string | undefined): Promise<string[]> {
    if (session === undefined) return []
    const peek = await this.store.read()
    if (
      !peek.instances.some(
        (record) => record.session === session && record.pendingNotice !== undefined,
      )
    ) {
      return []
    }
    return this.store.update((index) => {
      const notices: string[] = []
      for (const record of index.instances) {
        if (record.session !== session || record.pendingNotice === undefined) continue
        notices.push(record.pendingNotice)
        delete record.pendingNotice
      }
      return notices
    })
  }

  /** 插件替用户 / 自己往状态文件追加一条流水（转移、恢复）。文件不合法就不动它。 */
  private async appendLog(
    record: InstanceRecord,
    entry: { event: 'transfer' | 'resume'; detail?: string },
  ): Promise<void> {
    if (record.statePath === undefined) return
    const text = await readFileText(record.statePath)
    if (text === null) return
    const doc = parseDocument(text)
    if (doc.errors.length > 0) return
    const now = isoNow()
    const item = {
      at: now,
      event: entry.event,
      ...(entry.detail === undefined ? {} : { detail: entry.detail }),
    }
    const log = doc.getIn(['log'], true)
    if (!isSeq(log)) return
    log.flow = false
    log.add(doc.createNode(item))
    doc.setIn(['updatedAt'], now)
    if (validateRunState(doc.toJS()).state === null) return
    await writeFileAtomic(record.statePath, doc.toString({ lineWidth: 0 }))
  }
}
