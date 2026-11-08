/**
 * dsh-workflow-lite — 用户的改动：保存画布上改的状态与图、把改动告诉模型、取走没送到的通知。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/runEdits
 */

import { stat } from 'node:fs/promises'
import { isSeq, parseDocument } from 'yaml'
import { planIdOf } from '../../shared/compile.ts'
import { affectsPlan, describeGraphChange, graphChanges } from '../../shared/graphDiff.ts'
import { writeDocument } from '../../shared/model.ts'
import { runCursor } from '../../shared/runCursor.ts'
import {
  type EditValue,
  editablePath,
  graphFacts,
  type InstanceRecord,
  isoNow,
  type LogEvent,
  type RunState,
  type StateEdit,
  validateRunState,
} from '../../shared/runState.ts'
import { hasHistory, syncOps } from '../../shared/runSync.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import { compileDocument } from '../plan.ts'
import { readFileText, writeFileAtomic } from '../store/atomic.ts'
import type { Outcome } from '../store/repoResult.ts'
import { cursorHint, describeEdits, describeField, groupEdits } from './prompts.ts'
import { fail, type RunCore } from './runCore.ts'
import { isInstanceId, snapshotFile } from './store.ts'

/** 保存用户改动的结果。 */
export interface SaveResult {
  /** 通知送到模型了没有；没送到时存进索引，模型下次调用工具时附上。 */
  notified: boolean
  mtime: number
  /** 改了图时：新图的 planId。 */
  planId?: string
  /** 没有通知模型：只改了不进计划的东西（挪卡片、描述），或者用户选了不通知。 */
  quiet?: true
}

/** 用户在实例视图里改的图：改之前那版的 planId（核对有没有被别处改过）+ 改完的整张图。 */
export interface GraphEdit {
  base: string
  document: WorkflowDocument
}

/** 保存时字段对不上（用户开始改之后，模型改了同一个字段）。 */
export interface EditConflict {
  path: string[]
  /** 用户以为的旧值。 */
  from: EditValue
  /** 文件里现在的值。 */
  disk: EditValue
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

type EditsCore = Pick<
  RunCore,
  'store' | 'deps' | 'serial' | 'problemsOf' | 'answersOf' | 'planOf' | 'snapshot' | 'keepHistory'
>

/** 用户在画布上的改动：保存、通知模型、取走没送到的通知。 */
export class RunEdits {
  private readonly core: EditsCore

  constructor(core: EditsCore) {
    this.core = core
  }

  /**
   * 保存用户在画布上攒的改动：逐条核对"改前"还是文件里的值（对不上整次拒绝、回冲突清单），
   * 只改这几处、追加一条 `edit` 流水、更新 `updatedAt`，校验通过才原子写；然后通知模型
   * （`notify: false` 时不通知、也不暂存通知：模型下次读状态文件或 `resume` 时自己看到）。
   */
  async save(
    id: string,
    session: string | undefined,
    edits: readonly StateEdit[],
    note: string | undefined,
    graph?: GraphEdit,
    options: { notify?: boolean } = {},
  ): Promise<Outcome<SaveResult>> {
    const notify = options.notify !== false
    return this.core.serial(id, async () => {
      if (!isInstanceId(id)) return fail<SaveResult>('invalid_args', `实例 id 不合法：${id}`)
      const index = await this.core.store.read()
      const record = index.instances.find((candidate) => candidate.id === id)
      if (record === undefined) return fail<SaveResult>('not_found', `实例 ${id} 不存在`)
      return graph === undefined
        ? this.saveNow(record, session, edits, note, notify)
        : this.saveGraph(record, session, edits, note, graph, notify)
    })
  }

  private async saveNow(
    record: InstanceRecord,
    session: string | undefined,
    edits: readonly StateEdit[],
    note: string | undefined,
    notify: boolean,
  ): Promise<Outcome<SaveResult>> {
    const id = record.id
    if (edits.length === 0) return fail('invalid_args', '没有要保存的改动')
    const bad = edits.find((edit) => !editablePath(edit.path))
    if (bad !== undefined)
      return fail('invalid_args', `这个字段不能在画布上改：${bad.path.join('.')}`)
    const statePath = record.statePath
    if (statePath === undefined) return fail('invalid_args', `实例 ${id} 不记运行状态，没有可改的`)
    const document = await this.core.snapshot(record)
    const text = await readFileText(statePath)
    if (text === null) return fail('not_found', `状态文件不在了：${statePath}`)
    const doc = parseDocument(text)
    if (doc.errors.length > 0) {
      return fail('blocked', '状态文件现在的 YAML 写法有误，先等模型修好再改', {
        issues: doc.errors.map((error) => error.message),
      })
    }
    const previous = (doc.toJS() as { nodes?: unknown } | null)?.nodes
    const applied = this.applyUserEdits(doc, edits)
    if (!applied.ok) return applied
    const now = isoNow()
    doc.setIn(['updatedAt'], now)
    this.appendUserLog(doc, edits, [], note, now)
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
    // 用户在画布上把步骤标成完成、失败：和模型报的一样，这一轮的产出存一版。
    if (document !== null)
      await this.core.keepHistory(record, document, previous, check.state.nodes)
    const mtime = (await stat(statePath)).mtimeMs
    if (!notify) return { ok: true, result: { notified: false, mtime, quiet: true } }
    const notified = await this.tell(record, session, {
      where: statePath,
      edits,
      graph: [],
      note,
      position:
        document === null ? '' : cursorHint(runCursor(document, check.state), check.state.status),
    })
    return { ok: true, result: { notified, mtime } }
  }

  /** 逐条核对"改前"还是文件里的值，都对上才把改动落到 YAML 上（就地改）。 */
  private applyUserEdits(
    doc: ReturnType<typeof parseDocument>,
    edits: readonly StateEdit[],
  ): Outcome<true> {
    const before = doc.toJS() as unknown
    const conflicts: EditConflict[] = []
    for (const edit of edits) {
      const disk = valueAt(before, edit.path)
      if (!sameValue(disk, edit.from)) conflicts.push({ path: edit.path, from: edit.from, disk })
    }
    if (conflicts.length > 0) {
      return fail('conflict', '有字段在你开始改之后被模型改过了', { conflicts })
    }
    for (const edit of edits) {
      if (edit.to === null) doc.deleteIn(edit.path)
      else doc.setIn(edit.path, edit.to)
    }
    return { ok: true, result: true }
  }

  /**
   * 用户的改动记进流水：图改了记一条（不挂步骤），每个改过的步骤一条，整体的排在后面，指定下一步单记一条 `next`
   * 排在最后；用户的说明跟在最后一条上。
   */
  private appendUserLog(
    doc: ReturnType<typeof parseDocument>,
    edits: readonly StateEdit[],
    graph: readonly string[],
    note: string | undefined,
    now: string,
  ): void {
    // 改了哪个步骤就记在哪个步骤名下（推「运行到哪了」要靠它）。指定下一步单记一条 `next`，排在最后：
    // 它之前做完的步骤，交接都算了结（见 shared/runCursor.ts）。取消指定只是一条普通的改动。
    const pin = edits.find(
      (edit) =>
        edit.path.length === 1 &&
        edit.path[0] === 'next' &&
        Array.isArray(edit.to) &&
        edit.to.length > 0,
    )
    const groups = groupEdits(edits.filter((edit) => edit !== pin)).sort(
      (a, b) => Number(a.node === '') - Number(b.node === ''),
    )
    const items: { node: string; event: LogEvent; text: string }[] = [
      ...(graph.length === 0
        ? []
        : [{ node: '', event: 'edit' as const, text: `改了图：${graph.join('；')}` }]),
      ...groups.map(({ node, text }) => ({ node, event: 'edit' as const, text })),
      ...(pin === undefined
        ? []
        : [{ node: '', event: 'next' as const, text: describeField(pin) }]),
    ]
    const entries = items.map(({ node, event, text }, index) => {
      const round = node === '' ? undefined : doc.getIn(['nodes', node, 'round'])
      const tail = index === items.length - 1 && note !== undefined && note !== ''
      return {
        at: now,
        ...(node === '' ? {} : { node }),
        event,
        ...(typeof round === 'number' ? { round } : {}),
        detail: tail ? `${text}。说明：${note}` : text,
        by: 'user',
      }
    })
    if (entries.length === 0) return
    const log = doc.getIn(['log'], true)
    if (isSeq(log)) {
      log.flow = false
      for (const entry of entries) log.add(doc.createNode(entry))
    } else {
      doc.setIn(['log'], entries)
    }
  }

  /**
   * 保存用户在实例视图里改的图（连同状态的改动）：图快照换成新的，状态跟着对齐（新步骤补上、删掉的去掉、
   * 身份字段 plan 换新，见 `shared/runSync.ts`），任务描述重写，再通知模型去 `resume` 拿新计划。
   *
   * - 图在用户开始改之后被别处改过（`base` 不是现在的 planId）→ `conflict`；
   * - 新图有保存级 / 编译级问题、删了执行过的步骤、改完的状态不合法 → 整次拒绝，什么都不写；
   * - 工作流设置与视口不在实例里改：沿用原快照的；
   * - 只挪了卡片、改了描述这类不进计划的东西：照样保存，不打扰模型。
   */
  private async saveGraph(
    record: InstanceRecord,
    session: string | undefined,
    edits: readonly StateEdit[],
    note: string | undefined,
    graph: GraphEdit,
    notify: boolean,
  ): Promise<Outcome<SaveResult>> {
    const bad = edits.find((edit) => !editablePath(edit.path))
    if (bad !== undefined)
      return fail('invalid_args', `这个字段不能在画布上改：${bad.path.join('.')}`)
    if (edits.length > 0 && record.statePath === undefined) {
      return fail('invalid_args', `实例 ${record.id} 不记运行状态，没有可改的`)
    }
    if (graph.base !== record.planId) {
      return fail('conflict', '这次执行的图在你开始改之后被改过了，重新打开再改', {
        graph: true,
      })
    }
    const document = await this.core.snapshot(record)
    if (document === null) return fail('not_found', `实例 ${record.id} 的图快照不见了`)
    const { settings: _settings, viewport: _viewport, ...rest } = graph.document
    const next: WorkflowDocument = {
      ...rest,
      viewport: document.viewport,
      ...(document.settings === undefined ? {} : { settings: document.settings }),
    }
    const changes = graphChanges(document, next)
    if (changes.length === 0 && edits.length === 0) {
      return fail('invalid_args', '没有要保存的改动')
    }
    const blocking = this.core
      .problemsOf(next, record.workflow)
      .filter((problem) => problem.level === 'save' || problem.level === 'compile')
    if (blocking.length > 0) {
      return fail('blocked', `图里有问题，没有保存：${blocking[0]?.message ?? ''}`, {
        problems: blocking,
      })
    }
    const compiled = await compileDocument(
      this.core.deps.dataDir(),
      record.workflow,
      next,
      [],
      { answers: await this.core.answersOf(record) },
      record.cwd,
    )
    if (!compiled.ok) return compiled
    if (compiled.result.problems.length > 0) {
      return fail(
        'blocked',
        `改完的图出不了计划，没有保存：${compiled.result.problems[0]?.message ?? ''}`,
        { problems: compiled.result.problems },
      )
    }

    const planId = planIdOf(next)
    const facts = graphFacts(next)
    const graphLines = changes
      .filter(affectsPlan)
      .map((change) => describeGraphChange(change, document, next))
    const now = isoNow()
    let stateText: string | null = null
    let state: RunState | null = null
    if (record.statePath !== undefined) {
      const text = await readFileText(record.statePath)
      if (text === null) return fail('not_found', `状态文件不在了：${record.statePath}`)
      const doc = parseDocument(text)
      if (doc.errors.length > 0) {
        return fail('blocked', '状态文件现在的 YAML 写法有误，先等模型修好再改', {
          issues: doc.errors.map((error) => error.message),
        })
      }
      const applied = this.applyUserEdits(doc, edits)
      if (!applied.ok) return applied
      const current = validateRunState(doc.toJS()).state
      if (current === null) return fail('blocked', '状态文件现在不合法，先等模型修好再改')
      const locked = changes.find(
        (change) =>
          change.object === 'step' && change.kind === 'removed' && hasHistory(current, change.id),
      )
      if (locked !== undefined) {
        return fail(
          'invalid_args',
          `步骤 ${locked.id} 已经执行过，不能从图里删；不再做它就改成「跳过」`,
        )
      }
      for (const op of syncOps(current, facts, planId)) {
        if (op.to === null) doc.deleteIn(op.path)
        else doc.setIn(op.path, op.to)
      }
      doc.setIn(['updatedAt'], now)
      this.appendUserLog(doc, edits, graphLines, note, now)
      const checked = validateRunState(doc.toJS(), facts, {
        instance: record.id,
        workflow: record.workflow,
        plan: planId,
      })
      if (checked.state === null) {
        const first = checked.issues[0]
        return fail(
          'blocked',
          `改完的状态和新图对不上，没有保存：${first === undefined ? '' : `${first.path} ${first.message}`}`,
          { issues: checked.issues },
        )
      }
      stateText = doc.toString({ lineWidth: 0 })
      state = checked.state
    }

    const graphPath = snapshotFile(this.core.deps.dataDir(), record.id)
    const previous = await readFileText(graphPath)
    try {
      await writeFileAtomic(graphPath, writeDocument(next))
      if (stateText !== null && record.statePath !== undefined) {
        await writeFileAtomic(record.statePath, stateText)
      }
    } catch (error) {
      // 不留半截：状态没写进去就把快照换回去。
      if (previous !== null) await writeFileAtomic(graphPath, previous).catch(() => {})
      return fail('io_error', `保存失败：${error instanceof Error ? error.message : String(error)}`)
    }
    await this.core.store.update((index) => {
      const entry = index.instances.find((candidate) => candidate.id === record.id)
      if (entry !== undefined) entry.planId = planId
    })
    const updated: InstanceRecord = { ...record, planId }
    // 任务描述换成新图的；写不进去也不要紧，模型 resume 时会再写一遍。
    await this.core.planOf(updated, next, record.cwd).catch(() => undefined)
    const mtime = record.statePath === undefined ? 0 : (await stat(record.statePath)).mtimeMs
    const quiet = !notify || (graphLines.length === 0 && edits.length === 0)
    const notified = quiet
      ? false
      : await this.tell(updated, session, {
          ...(record.statePath === undefined ? {} : { where: record.statePath }),
          edits,
          graph: graphLines,
          note,
          position: state === null ? '' : cursorHint(runCursor(next, state), state.status),
        })
    return {
      ok: true,
      result: { notified, mtime, planId, ...(quiet ? { quiet: true as const } : {}) },
    }
  }

  /**
   * 把用户的改动告诉模型：会话在跑就排进下一步、空闲就开一轮；送不到（会话的 agent 不在）就暂存进索引，
   * 模型下次调用工具时附上。送到了回 `true`。
   */
  private async tell(
    record: InstanceRecord,
    session: string | undefined,
    change: {
      /** 写进了哪个文件（状态文件）；只改了不记状态的实例的图时没有。 */
      where?: string
      edits: readonly StateEdit[]
      /** 图的改动，一处一行（不带「- 」）。 */
      graph: readonly string[]
      note: string | undefined
      position: string
    },
  ): Promise<boolean> {
    const lines = describeEdits(change.edits)
    const graphLines = change.graph.map((line) => `- ${line}`)
    const what = graphLines.length === 0 ? '运行状态' : lines.length === 0 ? '图' : '图与运行状态'
    const summary = `用户修改了 ${record.workflow} 的${what}（${lines.length + graphLines.length} 处）`
    const sections =
      graphLines.length > 0 && lines.length > 0
        ? ['图的改动：', ...graphLines, '', '运行状态的改动：', ...lines]
        : [...graphLines, ...lines]
    const ask =
      graphLines.length === 0
        ? '请先重新读取状态文件，按最新状态调整接下来的执行：用户指定了下一步就先做它，改回 pending 的步骤要重新执行，skipped 的不再执行，顶层是 waiting 就停下来问用户、cancelled 就结束。之后照常维护状态文件（改之前先重新读）。'
        : [
            `图已经变了：先调用 workflow_lite（action=resume，instance=${record.id}）拿最新的计划，按新计划接着做——`,
            '做完的步骤不用重做（除非状态被改回 pending），新加的步骤按计划的顺序补上，删掉的不再做；各步骤的任务描述文件已经换成新的。',
            record.statePath === undefined
              ? ''
              : '用户指定了下一步就先做它，顶层是 waiting 就停下来问用户、cancelled 就结束。之后照常维护状态。',
          ].join('')
    const body = [
      `[workflow-lite] 用户在画布上修改了${what}${change.where === undefined ? '' : `，已写入 ${change.where}`}`,
      `实例 ${record.id} · 工作流 ${record.workflow}`,
      '',
      ...sections,
      ...(change.note === undefined || change.note.trim() === ''
        ? []
        : ['', `用户的说明：${change.note.trim()}`]),
      ...(change.position === '' ? [] : ['', `执行位置：${change.position}`]),
      '',
      ask,
    ].join('\n')
    const owner = record.session ?? session
    let notified = false
    if (owner !== undefined && this.core.deps.notify !== undefined) {
      notified = await this.core.deps.notify(owner, body, summary).catch(() => false)
    }
    if (!notified) {
      await this.core.store.update((current) => {
        const target = current.instances.find((candidate) => candidate.id === record.id)
        if (target === undefined) return
        target.pendingNotice =
          target.pendingNotice === undefined ? body : `${target.pendingNotice}\n\n${body}`
      })
    }
    return notified
  }

  /** 取走这个会话名下所有没送到的通知（模型调用工具时附在返回值里）。 */
  async takeNotices(session: string | undefined): Promise<string[]> {
    if (session === undefined) return []
    const peek = await this.core.store.read()
    if (
      !peek.instances.some(
        (record) => record.session === session && record.pendingNotice !== undefined,
      )
    ) {
      return []
    }
    return this.core.store.update((index) => {
      const notices: string[] = []
      for (const record of index.instances) {
        if (record.session !== session || record.pendingNotice === undefined) continue
        notices.push(record.pendingNotice)
        delete record.pendingNotice
      }
      return notices
    })
  }
}
