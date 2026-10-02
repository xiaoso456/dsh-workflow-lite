/**
 * dsh-workflow-lite — 工作流实例的业务面：建实例、列、读、绑定、删、恢复、保存用户的改动。
 *
 * 工具（`compile` / `resume` / `runs` / `state`）与画布 RPC（`run/*`）共用这一层。状态文件只有插件写：
 * 模型经 `state` 动作改（插件补时间、轮次、流水，改完校验），用户经画布改（逐字段核对冲突）。
 * 同一个实例的写入排队进行，不会互相覆盖。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/service
 */

import { rmdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { Document, isSeq, parseDocument } from 'yaml'
import { planIdOf } from '../../shared/compile.ts'
import { checkAnswers, sameAnswers } from '../../shared/inputs.ts'
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
  type LogEvent,
  NODE_STATUSES,
  type NodeRunState,
  type NodeStatus,
  progressOf,
  RUN_STATUSES,
  type RunLogEntry,
  type RunState,
  type RunStateIssue,
  type RunStatus,
  type StateEdit,
  statusFields,
  validateRunState,
} from '../../shared/runState.ts'
import type {
  ExecutionMode,
  InputAnswer,
  ValidationProblem,
  WorkflowDocument,
} from '../../shared/types.ts'
import type { RunFileResponse } from '../../shared/wire.ts'
import { type CompileBundle, compileDocument } from '../plan.ts'
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
  answersFile,
  ensureWorkspaceIgnore,
  type InstanceIndex,
  InstanceStore,
  instanceDir,
  isInstanceId,
  newInstanceId,
  runDir,
  snapshotFile,
  statePathFor,
  TASKS_DIR,
} from './store.ts'

/** 把一条通知送进会话（`steer`：空闲就开一轮，正在跑就排进下一步）。送到了回 `true`。 */
export type Notify = (session: string, text: string, summary: string) => Promise<boolean>

export interface RunServiceDeps {
  dataDir: () => string
  /** 校验一张图（计划的 ⑥ 段「图的注意事项」要它）；不给就当没有警告。 */
  validate?: (document: WorkflowDocument, workflow: string) => ValidationProblem[]
  notify?: Notify
}

/** 模型经 `state` 动作对一个步骤的改动。 */
export interface NodePatch {
  status?: NodeStatus
  summary?: string
  outputs?: string[]
  verdict?: string
  error?: string
  by?: string
}

/** 模型经 `state` 动作的一次改动；什么都不给 = 只看。 */
export interface StatePatch {
  status?: RunStatus
  /** 空串 = 清掉。 */
  note?: string
  nodes?: Record<string, NodePatch>
  /** 追加一条说明（流水里记成 `note`）。 */
  log?: string
}

/** `state` 动作回给模型的东西：当前状态的要点。 */
export interface StateReport {
  instance: string
  workflow: string
  status: RunStatus
  note?: string
  updatedAt: string
  progress: {
    done: number
    total: number
    running?: string[]
    waiting?: string[]
    failed?: string[]
  }
  nodes: Record<string, NodeRunState>
  /** 最近几条流水。 */
  recentLog: RunLogEntry[]
  /** 这次改了什么（只看时没有）。 */
  applied?: string[]
  /** 这次才开始记状态（实例原本不记）。 */
  created?: true
}

/** `compile` / `resume` 回给模型的东西。 */
export type InstancePlan = CompileBundle & {
  instance: string
  progress: Record<string, unknown>
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

const HEADER = [
  ' workflow-lite 运行状态（字段含义见 skill workflow-run-state）。',
  ' 由插件维护：模型用 workflow_lite 的 state 动作改，用户在画布上改。不要直接编辑这个文件。',
].join('\n')

/** 状态 → YAML 文本（长摘要不折行，纯数字的字符串自动加引号）。 */
function stateText(state: RunState): string {
  const doc = new Document(state)
  doc.commentBefore = HEADER
  return doc.toString({ lineWidth: 0 })
}

/** 整体状态改动记进流水的事件。 */
const RUN_EVENT: Record<RunStatus, LogEvent> = {
  pending: 'note',
  running: 'start',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
  cancelled: 'note',
}

/** 步骤状态改动记进流水的事件。 */
const NODE_EVENT: Record<NodeStatus, LogEvent> = {
  pending: 'note',
  running: 'start',
  waiting: 'waiting',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
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
  const state =
    record.statePath === undefined
      ? ''
      : `，并按计划里「运行状态」一段用 workflow_lite 的 state 动作（instance=${record.id}）记录进度`
  return [
    `执行工作流「${record.workflow}」（实例 ${record.id}）。`,
    `请调用 workflow_lite：action=resume，instance=${record.id}，拿到计划后按计划执行${state}。`,
  ].join('\n')
}

/** 进度摘要（`resume` / `compile` 回给模型）。 */
function progressReport(
  record: InstanceRecord,
  read: { state: RunState | null; text: string | null; issues: RunStateIssue[] },
): Record<string, unknown> {
  if (record.statePath === undefined) return { tracked: false }
  if (read.state === null) {
    return { stateProblem: read.text === null ? 'missing' : 'invalid', issues: read.issues }
  }
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
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
  /** 每个实例的写入排队（模型的 `state`、用户的保存、插件记流水不会互相覆盖）。 */
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(deps: RunServiceDeps) {
    this.deps = deps
    this.store = new InstanceStore(deps.dataDir)
  }

  /** 同一个实例的写入一个接一个来。 */
  private serial<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const next = previous.then(task, task)
    const settled = next.catch(() => {})
    this.queues.set(id, settled)
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id)
    })
    return next
  }

  private problemsOf(document: WorkflowDocument, workflow: string): ValidationProblem[] {
    return this.deps.validate?.(document, workflow) ?? []
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
    /** 用户对输入节点的回答（已核对、补上默认值）；没有输入节点就是空的。 */
    answers?: Readonly<Record<string, InputAnswer>>
    /** 建状态文件（缺省按图的「记录运行状态」开关）。 */
    track?: boolean
    /** 复用本会话还没开始过的同一份实例（缺省复用；画布上点「执行」每次都是新的一次）。 */
    reuse?: boolean
  }): Promise<Outcome<InstanceRecord>> {
    const dataDir = this.deps.dataDir()
    const mode: ExecutionMode = input.document.settings?.mode ?? 'auto'
    const session = input.session.id
    const track = input.track ?? input.document.settings?.runState === true
    if (session !== undefined && track && input.reuse !== false) {
      const index = await this.store.read()
      const currentId = index.current[session]
      const current = index.instances.find((record) => record.id === currentId)
      if (
        current !== undefined &&
        current.workflow === input.workflow &&
        current.planId === planIdOf(pinRoot(input.document, current.id)) &&
        sameAnswers(await this.answersOf(current), input.answers ?? {})
      ) {
        const read = await this.readState(current)
        if (read.state?.status === 'pending' && read.state.log.length === 0) {
          return { ok: true, result: current }
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
      const answers = input.answers ?? {}
      if (Object.keys(answers).length > 0) {
        await writeFileAtomic(answersFile(dataDir, id), `${JSON.stringify(answers, null, 2)}\n`)
      }
      // 工作区里的隐藏目录：放一个忽略一切的 .gitignore，状态、任务描述与默认产出不进版本库。
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
        await writeFileAtomic(statePath, stateText(state))
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
    return { ok: true, result: record }
  }

  /** 实例建立时用户给的回答（没有输入节点、或文件不在时是空的）。 */
  private async answersOf(record: InstanceRecord): Promise<Record<string, InputAnswer>> {
    const text = await readFileText(answersFile(this.deps.dataDir(), record.id))
    if (text === null) return {}
    try {
      const raw: unknown = JSON.parse(text)
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
      const answers: Record<string, InputAnswer> = {}
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string') answers[key] = value
        else if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
          answers[key] = value
        }
      }
      return answers
    } catch {
      return {}
    }
  }

  /** 按实例的快照出计划，把任务描述写进实例目录。 */
  private async planOf(
    record: InstanceRecord,
    document: WorkflowDocument,
    cwd: string | undefined,
  ): Promise<Outcome<CompileBundle>> {
    const where = record.cwd ?? cwd
    return compileDocument(
      this.deps.dataDir(),
      record.workflow,
      document,
      this.problemsOf(document, record.workflow),
      {
        ...(record.goal === undefined ? {} : { goal: record.goal }),
        answers: await this.answersOf(record),
        instance: {
          id: record.id,
          dir: instanceDir(this.deps.dataDir(), record.id, where),
          tracked: record.statePath !== undefined,
        },
      },
      where,
    )
  }

  /**
   * 工具的 `compile`：图编译得出计划就建一个实例（开了「记录运行状态」才有状态；本会话还没开始过的
   * 同一份会复用），回给模型的和 `resume` 一样。编译级问题照常回 `problems`、不建实例。
   */
  async compile(input: {
    workflow: string
    document: WorkflowDocument
    problems: readonly ValidationProblem[]
    session: SessionRef
    goal?: string
    /** 用户对输入节点的回答（输入 id → 回答）；没回答的用默认值。 */
    answers?: unknown
  }): Promise<Outcome<InstancePlan | CompileBundle>> {
    const answers = checkAnswers(input.document, input.answers)
    if (answers.errors.length > 0) {
      return fail('invalid_args', `answers 填得不对：${answers.errors.join('；')}`)
    }
    const check = await compileDocument(
      this.deps.dataDir(),
      input.workflow,
      input.document,
      input.problems,
      { ...(input.goal === undefined ? {} : { goal: input.goal }), answers: answers.answers },
      input.session.cwd,
    )
    if (!check.ok || check.result.problems.length > 0) return check
    const prepared = await this.prepare({
      workflow: input.workflow,
      document: input.document,
      session: input.session,
      ...(input.goal === undefined ? {} : { goal: input.goal }),
      answers: answers.answers,
    })
    if (!prepared.ok) return prepared
    const resumed = await this.resume(prepared.result.id, input.session)
    if (!resumed.ok) return resumed
    // 读入阶段的警告（快照校验不到的那些，比如文件里的问题）也带上。
    const seen = new Set(resumed.result.warnings.map((warning) => JSON.stringify(warning)))
    const extra = check.result.warnings.filter((warning) => !seen.has(JSON.stringify(warning)))
    return {
      ok: true,
      result: { ...resumed.result, warnings: [...resumed.result.warnings, ...extra] },
    }
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
    /** 用户在「执行」前填的回答（输入 id → 回答）。 */
    answers?: unknown
  }): Promise<Outcome<{ instance: InstanceSummary; prompt: string }>> {
    const answers = checkAnswers(input.document, input.answers)
    if (answers.errors.length > 0) {
      return fail('invalid_args', answers.errors.join('；'))
    }
    const compiled = await compileDocument(
      this.deps.dataDir(),
      input.workflow,
      input.document,
      input.problems,
      { answers: answers.answers },
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
      answers: answers.answers,
      reuse: false,
    })
    if (!prepared.ok) return prepared
    const id = prepared.result.id
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
        answers: await this.answersOf(record),
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
    if (withState) {
      // 状态与任务描述一起删；产出（out/）是用户要的东西，留着。
      if (record.statePath !== undefined) await unlinkFile(record.statePath)
      const dir = instanceDir(this.deps.dataDir(), id, record.cwd)
      await removeTree(join(dir, TASKS_DIR))
      await rmdir(dir).catch(() => {})
    }
    return { ok: true, result: { removed: true } }
  }

  // ── 恢复 ───────────────────────────────────────────────────

  /**
   * 接着跑一个实例：从快照重建计划（任务描述不在就重新写），带上运行状态段，
   * 再给一份摘要。实例属于别的会话时先转过来。
   */
  async resume(id: string | undefined, session: SessionRef): Promise<Outcome<InstancePlan>> {
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
    const compiled = await this.planOf(record, document, session.cwd)
    if (!compiled.ok) return compiled
    const read = await this.readState(record, document)
    // 还没开始过的（刚建出来）不算恢复，不记流水。
    if (read.state !== null && (read.state.status !== 'pending' || read.state.log.length > 0)) {
      await this.appendLog(record, { event: 'resume' }).catch(() => {})
    }
    return {
      ok: true,
      result: { ...compiled.result, instance: record.id, progress: progressReport(record, read) },
    }
  }

  // ── 模型记进度 ─────────────────────────────────────────────

  /**
   * 工具的 `state`：看或改一个实例的运行状态。
   *
   * - 不带改动 = 只看；
   * - 改步骤状态时插件补上轮次、开始 / 结束时间（{@link statusFields}），每处状态变化记一条流水，更新 `updatedAt`；
   * - 改完整份校验，不合法就整次拒绝、回问题清单（文件不动）；
   * - 实例原本不记状态（或状态文件不见了）时，按初始状态新建再改。
   */
  async state(
    id: string | undefined,
    session: SessionRef,
    patch: StatePatch,
  ): Promise<Outcome<StateReport>> {
    const index = await this.store.read()
    const target = id ?? (session.id === undefined ? undefined : index.current[session.id])
    if (target === undefined) {
      return fail('not_found', '这个会话没有当前的工作流实例；给 instance，或先 compile / resume')
    }
    if (!isInstanceId(target)) return fail('invalid_args', `实例 id 不合法：${target}`)
    const found = index.instances.find((candidate) => candidate.id === target)
    if (found === undefined) return fail('not_found', `实例 ${target} 不存在`)
    const document = await this.snapshot(found)
    if (document === null) return fail('not_found', `实例 ${target} 的图快照不见了`)
    const facts = graphFacts(document)
    const changing =
      patch.status !== undefined ||
      patch.note !== undefined ||
      patch.log !== undefined ||
      Object.keys(patch.nodes ?? {}).length > 0

    // 步骤 id 先对一遍：大小写不对、写了文件节点都在这里说清楚。
    for (const key of Object.keys(patch.nodes ?? {})) {
      if (facts.steps.includes(key)) continue
      const near = facts.steps.find((step) => step.toLowerCase() === key.toLowerCase())
      return fail(
        'invalid_args',
        near === undefined
          ? `图里没有步骤 ${key}（文件节点不记状态）；步骤有：${facts.steps.join('、')}`
          : `图里没有步骤 ${key}，是不是 ${near}（大小写要一致）`,
      )
    }
    if (!changing && found.statePath === undefined) {
      return fail(
        'not_found',
        `实例 ${target} 不记运行状态；要开始记，带上改动调用 state（比如 status=running）`,
      )
    }

    return this.serial(target, async () => {
      // 排队期间索引可能变了（别的调用先建了状态），重新取一次。
      const record =
        (await this.store.read()).instances.find((candidate) => candidate.id === target) ?? found
      const now = isoNow()
      let created = false
      let raw: unknown = null
      const statePath = record.statePath ?? statePathFor(this.deps.dataDir(), record.id, record.cwd)
      const text = record.statePath === undefined ? null : await readFileText(record.statePath)
      if (text !== null) {
        const doc = parseDocument(text)
        if (doc.errors.length === 0) raw = doc.toJS()
      }
      if (!isRecordLike(raw)) {
        if (!changing) {
          return fail<StateReport>('blocked', `实例 ${target} 的状态文件读不出来`, {
            statePath,
          })
        }
        // 新建（不记状态的实例开始记 / 文件不见了 / 写坏了）：从初始状态起步。
        created = true
        raw = initialRunState({
          instance: record.id,
          workflow: record.workflow,
          plan: record.planId,
          graph: snapshotFile(this.deps.dataDir(), record.id),
          mode: record.mode,
          ...(record.goal === undefined ? {} : { goal: record.goal }),
          now,
          steps: facts.steps,
        })
      }
      const draft = structuredClone(raw) as Record<string, unknown>
      const applied = changing ? this.applyPatch(draft, patch, now) : []
      const check = validateRunState(draft, facts, {
        instance: record.id,
        workflow: record.workflow,
        plan: record.planId,
      })
      if (check.state === null) {
        return fail<StateReport>(
          'invalid_args',
          changing ? '改完的状态不合法，没有保存' : '状态文件现在不合法',
          { issues: check.issues.map((issue) => `${issue.path}: ${issue.message}`) },
        )
      }
      if (changing) {
        try {
          await ensureDir(dirname(statePath))
          if (record.cwd !== undefined) await ensureWorkspaceIgnore(record.cwd)
          await writeFileAtomic(statePath, stateText(check.state))
        } catch (error) {
          return fail<StateReport>(
            'io_error',
            `写状态失败：${error instanceof Error ? error.message : String(error)}`,
          )
        }
        if (record.statePath === undefined) {
          await this.store.update((current) => {
            const entry = current.instances.find((candidate) => candidate.id === record.id)
            if (entry !== undefined) entry.statePath = statePath
          })
        }
      }
      const state = check.state
      const p = progressOf(state)
      return {
        ok: true as const,
        result: {
          instance: record.id,
          workflow: record.workflow,
          status: state.status,
          ...(state.note === undefined ? {} : { note: state.note }),
          updatedAt: state.updatedAt,
          progress: {
            done: p.done,
            total: p.total,
            ...(p.running.length > 0 ? { running: p.running } : {}),
            ...(p.waiting.length > 0 ? { waiting: p.waiting } : {}),
            ...(p.failed.length > 0 ? { failed: p.failed } : {}),
          },
          nodes: state.nodes,
          recentLog: state.log.slice(-5),
          ...(changing ? { applied } : {}),
          ...(created ? { created: true as const } : {}),
        },
      }
    })
  }

  /** 把一次改动落到状态对象上（就地改），回给模型看的改动清单。 */
  private applyPatch(draft: Record<string, unknown>, patch: StatePatch, now: string): string[] {
    const applied: string[] = []
    const log: Record<string, unknown>[] = Array.isArray(draft.log)
      ? (draft.log as Record<string, unknown>[])
      : []
    draft.log = log
    const nodes: Record<string, Record<string, unknown>> = isRecordLike(draft.nodes)
      ? (draft.nodes as Record<string, Record<string, unknown>>)
      : {}
    draft.nodes = nodes

    // 整体开始记在步骤前面，整体收尾（done / failed …）记在步骤后面——流水按发生的顺序读。
    const top = RUN_STATUSES.find((status) => status === draft.status)
    const topChange = patch.status !== undefined && patch.status !== top ? patch.status : undefined
    const recordTop = (status: RunStatus): void => {
      draft.status = status
      applied.push(`整体：${top ?? '（无）'} → ${status}`)
      log.push({
        at: now,
        event: RUN_EVENT[status],
        ...(status === 'cancelled' ? { detail: '整体取消' } : {}),
        ...(status === 'pending' ? { detail: '整体改回待执行' } : {}),
      })
    }
    if (topChange === 'running') recordTop(topChange)

    for (const [id, change] of Object.entries(patch.nodes ?? {})) {
      const node: Record<string, unknown> = isRecordLike(nodes[id]) ? nodes[id] : {}
      nodes[id] = node
      const before = NODE_STATUSES.find((status) => status === node.status) ?? 'pending'
      if (change.status !== undefined && change.status !== before) {
        const fields = statusFields(node as unknown as NodeRunState, change.status, now)
        for (const [key, value] of Object.entries(fields)) {
          if (value === null) delete node[key]
          else node[key] = value
        }
        applied.push(`步骤 ${id}：${before} → ${change.status}`)
      }
      for (const key of ['summary', 'verdict', 'error', 'by'] as const) {
        const value = change[key]
        if (value === undefined) continue
        if (value.trim() === '') delete node[key]
        else node[key] = value
        applied.push(`步骤 ${id}：写了 ${key}`)
      }
      if (change.outputs !== undefined) {
        if (change.outputs.length === 0) delete node.outputs
        else node.outputs = change.outputs
        applied.push(`步骤 ${id}：写了 outputs`)
      }
      if (change.status !== undefined && change.status !== before) {
        const status = change.status
        log.push({
          at: now,
          node: id,
          event: NODE_EVENT[status],
          ...(typeof node.round === 'number' ? { round: node.round } : {}),
          ...(status === 'done' && typeof node.verdict === 'string'
            ? { verdict: node.verdict }
            : {}),
          ...(status === 'failed' && typeof node.error === 'string' ? { detail: node.error } : {}),
          ...(status === 'pending' ? { detail: '改回待执行' } : {}),
        })
      }
    }

    if (topChange !== undefined && topChange !== 'running') recordTop(topChange)
    if (patch.note !== undefined) {
      if (patch.note.trim() === '') delete draft.note
      else draft.note = patch.note
      applied.push('写了 note')
    }
    if (patch.log !== undefined && patch.log.trim() !== '') {
      log.push({ at: now, event: 'note', detail: patch.log })
      applied.push('记了一条说明')
    }
    draft.updatedAt = now
    return applied
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
    return this.serial(id, () => this.saveNow(id, session, edits, note))
  }

  private async saveNow(
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
  private appendLog(
    record: InstanceRecord,
    entry: { event: 'transfer' | 'resume'; detail?: string },
  ): Promise<void> {
    return this.serial(record.id, () => this.appendLogNow(record, entry))
  }

  private async appendLogNow(
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
