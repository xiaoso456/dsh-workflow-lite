/**
 * dsh-workflow-lite — 工作流实例的建立、归属与恢复：建实例、编译出计划、画布上的「执行」、转会话、删实例、接着跑。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/runSetup
 */

import { rmdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { planIdOf } from '../../shared/compile.ts'
import { checkAnswers, sameAnswers } from '../../shared/inputs.ts'
import { isStep, writeDocument } from '../../shared/model.ts'
import { bindRoot, rootOf } from '../../shared/outputPaths.ts'
import {
  type InstanceRecord,
  type InstanceSummary,
  initialRunState,
  isoNow,
} from '../../shared/runState.ts'
import type {
  ExecutionMode,
  InputAnswer,
  ValidationProblem,
  WorkflowDocument,
} from '../../shared/types.ts'
import { type CompileBundle, compileDocument } from '../plan.ts'
import { ensureDir, removeTree, unlinkFile, writeFileAtomic } from '../store/atomic.ts'
import type { Outcome } from '../store/repoResult.ts'
import { progressReport, startPrompt } from './prompts.ts'
import { fail, type RunCore, type SessionRef, stateText } from './runCore.ts'
import {
  answersFile,
  ensureWorkspaceIgnore,
  instanceDir,
  isInstanceId,
  newInstanceId,
  runDir,
  snapshotFile,
  statePathFor,
  TASKS_DIR,
} from './store.ts'

/** `compile` / `resume` 回给模型的东西。 */
export type InstancePlan = CompileBundle & {
  instance: string
  progress: Record<string, unknown>
}

/** 快照里的产出根目录定死成这个实例的（见 {@link RunService.prepare}）。 */
function pinRoot(document: WorkflowDocument, id: string): WorkflowDocument {
  return {
    ...document,
    settings: { ...document.settings, outputRoot: bindRoot(rootOf(document.settings), id) },
  }
}

type SetupCore = Pick<
  RunCore,
  'store' | 'deps' | 'answersOf' | 'readState' | 'planOf' | 'snapshot' | 'summarize' | 'appendLog'
>

/** 建实例、画布上的「执行」、归属与删除、恢复。 */
export class RunSetup {
  private readonly core: SetupCore

  constructor(core: SetupCore) {
    this.core = core
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
    const dataDir = this.core.deps.dataDir()
    const mode: ExecutionMode = input.document.settings?.mode ?? 'auto'
    const session = input.session.id
    const track = input.track ?? input.document.settings?.runState === true
    if (session !== undefined && track && input.reuse !== false) {
      const index = await this.core.store.read()
      const currentId = index.current[session]
      const current = index.instances.find((record) => record.id === currentId)
      if (
        current !== undefined &&
        current.workflow === input.workflow &&
        current.planId === planIdOf(pinRoot(input.document, current.id)) &&
        sameAnswers(await this.core.answersOf(current), input.answers ?? {})
      ) {
        const read = await this.core.readState(current)
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
    await this.core.store.update((index) => {
      index.instances.push(record)
      if (session !== undefined) index.current[session] = id
    })
    return { ok: true, result: record }
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
      this.core.deps.dataDir(),
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
      this.core.deps.dataDir(),
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
    const index = await this.core.store.read()
    const record = index.instances.find((candidate) => candidate.id === id)
    if (record === undefined) return fail('not_found', `实例 ${id} 不存在`)
    return {
      ok: true,
      result: {
        instance: await this.core.summarize(record, index, input.session.id),
        prompt: startPrompt(record),
      },
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
    const found = await this.core.store.update((index) => {
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
      await this.core
        .appendLog(found, {
          event: 'transfer',
          detail: `从会话 ${previous} 转到会话 ${session}`,
        })
        .catch(() => {})
    }
    return { ok: true, result: { transferred } }
  }

  /** 删实例记录与快照；`withState` 为真时连工作区里的状态文件一起删。 */
  async remove(id: string, withState: boolean): Promise<Outcome<{ removed: true }>> {
    if (!isInstanceId(id)) return fail('invalid_args', `实例 id 不合法：${id}`)
    const record = await this.core.store.update((index) => {
      const found = index.instances.find((candidate) => candidate.id === id)
      if (found === undefined) return null
      index.instances = index.instances.filter((candidate) => candidate.id !== id)
      for (const [session, current] of Object.entries(index.current)) {
        if (current === id) delete index.current[session]
      }
      return found
    })
    if (record === null) return fail('not_found', `实例 ${id} 不存在`)
    await removeTree(runDir(this.core.deps.dataDir(), id))
    if (withState) {
      // 状态与任务描述一起删；产出（out/）是用户要的东西，留着。
      if (record.statePath !== undefined) await unlinkFile(record.statePath)
      const dir = instanceDir(this.core.deps.dataDir(), id, record.cwd)
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
    const index = await this.core.store.read()
    const target = id ?? (session.id === undefined ? undefined : index.current[session.id])
    if (target === undefined) {
      return fail('not_found', '这个会话没有当前的工作流实例；用 runs 看有哪些，再给 instance')
    }
    const record = index.instances.find((candidate) => candidate.id === target)
    if (record === undefined) return fail('not_found', `实例 ${target} 不存在`)
    const document = await this.core.snapshot(record)
    if (document === null) return fail('not_found', `实例 ${target} 的图快照不见了`)
    if (session.id !== undefined) await this.bind(record.id, session.id)
    const compiled = await this.core.planOf(record, document, session.cwd)
    if (!compiled.ok) return compiled
    const read = await this.core.readState(record, document)
    // 还没开始过的（刚建出来）不算恢复，不记流水。
    if (read.state !== null && (read.state.status !== 'pending' || read.state.log.length > 0)) {
      await this.core.appendLog(record, { event: 'resume' }).catch(() => {})
    }
    return {
      ok: true,
      result: {
        ...compiled.result,
        instance: record.id,
        progress: progressReport(record, read, document),
      },
    }
  }
}
