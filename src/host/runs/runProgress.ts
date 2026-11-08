/**
 * dsh-workflow-lite — 模型记进度：工具的 `state` 动作看或改实例的运行状态。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/runProgress
 */

import { dirname } from 'node:path'
import { parseDocument } from 'yaml'
import { type CursorStep, type NextStep, runCursor } from '../../shared/runCursor.ts'
import {
  graphFacts,
  initialRunState,
  isoNow,
  type LogEvent,
  NODE_STATUSES,
  type NodeRunState,
  type NodeStatus,
  progressOf,
  RUN_STATUSES,
  type RunLogEntry,
  type RunStatus,
  statusFields,
  validateRunState,
} from '../../shared/runState.ts'
import { ensureDir, readFileText, writeFileAtomic } from '../store/atomic.ts'
import type { Outcome } from '../store/repoResult.ts'
import { fail, isRecordLike, type RunCore, type SessionRef, stateText } from './runCore.ts'
import { ensureWorkspaceIgnore, isInstanceId, snapshotFile, statePathFor } from './store.ts'

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
  /** 最后执行的步骤（做完了、下游还没接上的；都接上了就是最近做完的那步）。 */
  last: CursorStep[]
  /** 接下来该做的步骤（按图、判定和流水推出来的）。 */
  next: NextStep[]
  /** 最近几条流水。 */
  recentLog: RunLogEntry[]
  /** 这次改了什么（只看时没有）。 */
  applied?: string[]
  /** 这次才开始记状态（实例原本不记）。 */
  created?: true
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

type ProgressCore = Pick<RunCore, 'store' | 'deps' | 'serial' | 'snapshot' | 'keepHistory'>

/** 模型经 `state` 动作看或改一个实例的运行状态。 */
export class RunProgress {
  private readonly core: ProgressCore

  constructor(core: ProgressCore) {
    this.core = core
  }

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
    const index = await this.core.store.read()
    const target = id ?? (session.id === undefined ? undefined : index.current[session.id])
    if (target === undefined) {
      return fail('not_found', '这个会话没有当前的工作流实例；给 instance，或先 compile / resume')
    }
    if (!isInstanceId(target)) return fail('invalid_args', `实例 id 不合法：${target}`)
    const found = index.instances.find((candidate) => candidate.id === target)
    if (found === undefined) return fail('not_found', `实例 ${target} 不存在`)
    const document = await this.core.snapshot(found)
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

    return this.core.serial(target, async () => {
      // 排队期间索引可能变了（别的调用先建了状态），重新取一次。
      const record =
        (await this.core.store.read()).instances.find((candidate) => candidate.id === target) ??
        found
      const now = isoNow()
      let created = false
      let raw: unknown = null
      const statePath =
        record.statePath ?? statePathFor(this.core.deps.dataDir(), record.id, record.cwd)
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
          graph: snapshotFile(this.core.deps.dataDir(), record.id),
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
          await this.core.store.update((current) => {
            const entry = current.instances.find((candidate) => candidate.id === record.id)
            if (entry !== undefined) entry.statePath = statePath
          })
        }
        await this.core.keepHistory(
          record,
          document,
          (raw as { nodes?: unknown }).nodes,
          check.state.nodes,
        )
      }
      const state = check.state
      const p = progressOf(state)
      const cursor = runCursor(document, state)
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
          last: cursor.last,
          next: cursor.next,
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
        // 用户指定的下一步：开始做了（或跳过、改了状态）就划掉，划完删掉这个字段。
        if (change.status !== 'pending' && Array.isArray(draft.next) && draft.next.includes(id)) {
          const rest = (draft.next as unknown[]).filter((item) => item !== id)
          if (rest.length > 0) draft.next = rest
          else delete draft.next
          applied.push(`用户指定的下一步 ${id} 已接上，划掉`)
        }
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
}
