/**
 * dsh-workflow-lite — 实例服务各部分共用的底座：依赖、每个实例的写入排队、快照与状态文件的读取、摘要、流水。
 *
 * 建立、读取、模型记进度、用户的改动四部分（`runSetup` / `runReader` / `runProgress` / `runEdits`）
 * 各自只取自己要用的那几项（`Pick<RunCore, …>`）；同一个实例的写入都经 `serial` 排在同一条队里。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/runCore
 */

import { stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { Document, isSeq, parseDocument } from 'yaml'
import { readDocument } from '../../shared/model.ts'
import { WORKSPACE_ROOT } from '../../shared/outputPaths.ts'
import { bindDirs } from '../../shared/resources.ts'
import {
  graphFacts,
  type InstanceRecord,
  type InstanceSummary,
  isoNow,
  type NodeRunState,
  progressOf,
  type RunState,
  type RunStateIssue,
  SUMMARY_ISSUES_MAX,
  validateRunState,
} from '../../shared/runState.ts'
import type { InputAnswer, ValidationProblem, WorkflowDocument } from '../../shared/types.ts'
import { type CompileBundle, compileDocument } from '../plan.ts'
import { readFileText, writeFileAtomic } from '../store/atomic.ts'
import { assetsDir, memoriesDir } from '../store/paths.ts'
import type { Outcome } from '../store/repository.ts'
import { itemLocation } from './files.ts'
import { type HistoryItem, historyPlan, RunHistory } from './history.ts'
import {
  answersFile,
  type InstanceIndex,
  InstanceStore,
  instanceDir,
  snapshotFile,
} from './store.ts'

/** 把一条通知送进会话（`steer`：空闲就开一轮，正在跑就排进下一步）。送到了回 `true`。 */
export type Notify = (session: string, text: string, summary: string) => Promise<boolean>

export interface RunServiceDeps {
  dataDir: () => string
  /** 校验一张图（计划的「注意事项」要它）；不给就当没有警告。 */
  validate?: (document: WorkflowDocument, workflow: string) => ValidationProblem[]
  notify?: Notify
}

/** 会话信息：工具从执行上下文取，画布从槽位给。 */
export interface SessionRef {
  id?: string
  cwd?: string
}

export const fail = <T>(
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
export function stateText(state: RunState): string {
  const doc = new Document(state)
  doc.commentBefore = HEADER
  return doc.toString({ lineWidth: 0 })
}

export function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class RunCore {
  readonly store: InstanceStore
  /** 产出的各版（循环迭代时每一轮写成了什么样）。 */
  readonly history: RunHistory
  readonly deps: RunServiceDeps
  /** 每个实例的写入排队（模型的 `state`、用户的保存、插件记流水不会互相覆盖）。 */
  private readonly queues = new Map<string, Promise<unknown>>()

  constructor(deps: RunServiceDeps) {
    this.deps = deps
    this.store = new InstanceStore(deps.dataDir)
    this.history = new RunHistory(deps.dataDir)
  }

  /** 同一个实例的写入一个接一个来。 */
  serial<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const next = previous.then(task, task)
    const settled = next.catch(() => {})
    this.queues.set(id, settled)
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id)
    })
    return next
  }

  problemsOf(document: WorkflowDocument, workflow: string): ValidationProblem[] {
    return this.deps.validate?.(document, workflow) ?? []
  }

  /** 实例建立时用户给的回答（没有输入节点、或文件不在时是空的）。 */
  async answersOf(record: InstanceRecord): Promise<Record<string, InputAnswer>> {
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
  async planOf(
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

  async snapshot(record: InstanceRecord): Promise<WorkflowDocument | null> {
    const text = await readFileText(snapshotFile(this.deps.dataDir(), record.id))
    if (text === null) return null
    const document = readDocument(text).document
    // 早先的快照没定死根目录：那时没配 = 工作区根。
    if (document === null || document.settings?.outputRoot !== undefined) return document
    return { ...document, settings: { ...document.settings, outputRoot: WORKSPACE_ROOT } }
  }

  /** 找文件用的快照：工作流目录、记忆库里的（`{workflow}/…`、`{memory}/…`）换成绝对路径（快照本身不改）。 */
  withAssets(record: InstanceRecord, document: WorkflowDocument): WorkflowDocument {
    const dataDir = this.deps.dataDir()
    return bindDirs(document, {
      workflow: assetsDir(dataDir, record.workflow),
      memory: memoriesDir(dataDir),
    })
  }

  /** 快照里一项（文件）在磁盘上的位置；`located` 是 {@link withAssets} 过的快照。不是路径项是 `null`。 */
  itemFull(
    record: InstanceRecord,
    located: WorkflowDocument,
    node: string,
    item: number,
  ): string | null {
    const location = itemLocation(located, node, item)
    if (location === null) return null
    return isAbsolute(location) || record.cwd === undefined ? location : join(record.cwd, location)
  }

  /**
   * 步骤状态变了：照前后的样子存下这一轮的产出（{@link historyPlan}）。存不下不影响状态本身。
   * 在实例的写入队列里调（和下一次改状态不会交错）。
   */
  async keepHistory(
    record: InstanceRecord,
    document: WorkflowDocument,
    before: unknown,
    after: Readonly<Record<string, NodeRunState>>,
  ): Promise<void> {
    const was = (isRecordLike(before) ? before : {}) as Record<string, NodeRunState>
    const plan = historyPlan(document, was, after)
    const located = this.withAssets(record, document)
    await this.history
      .apply(record.id, plan, ({ node, item }: HistoryItem) =>
        this.itemFull(record, located, node, item),
      )
      .catch(() => {})
  }

  /** 读并校验状态文件。`document` 给了就对照快照。 */
  async readState(
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

  async summarize(
    record: InstanceRecord,
    index: InstanceIndex,
    session: string | undefined,
  ): Promise<InstanceSummary> {
    // 对照快照校验，和打开实例时的结论一致（不给图就查不了 verdict 该不该写）。
    const read = await this.readState(record, await this.snapshot(record))
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
    if (read.state === null) {
      return {
        ...base,
        stateProblem: 'invalid',
        stateIssues: read.issues.slice(0, SUMMARY_ISSUES_MAX),
      }
    }
    const progress = progressOf(read.state)
    return {
      ...base,
      status: read.state.status,
      done: progress.done,
      total: progress.total,
      updatedAt: read.state.updatedAt,
    }
  }

  /** 插件替用户 / 自己往状态文件追加一条流水（转移、恢复）。文件不合法就不动它。 */
  appendLog(
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
