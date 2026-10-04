/**
 * dsh-workflow-lite — 工作流实例的两只钩子：
 * - {@link useRuns}：本会话（或全部）的实例列表与当前实例；
 * - {@link useRun}：正在看的那一个实例——轮询状态文件、攒草稿、冲突、保存并通知模型。
 *
 * 只有实例视图轮询（每 2 秒带上次的 mtime 问一次，没变就只回"没变"）；模板编辑照旧不轮询。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useRuns
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isStep } from '../../shared/model.ts'
import {
  type InstanceSummary,
  type InstanceView,
  isoNow,
  type NodeStatus,
  type RunState,
  type StateEdit,
} from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import type { RunSaveResponse } from '../../shared/wire.ts'
import type { T } from '../i18n.ts'
import {
  applyDraft,
  type DraftConflict,
  rebase,
  rerun as rerunDraft,
  resolve as resolveDraft,
  sameValue,
  setField as setDraftField,
  setNodeStatus,
  valueAt,
} from '../model/runDraft.ts'
import type { SideHistory } from '../model/runHistory.ts'
import { errorCode, errorMessage, type WorkflowLiteRpc, WorkflowLiteRpcError } from '../rpc.ts'

/** 实例视图轮询的间隔。 */
export const RUN_POLL_MS = 2000
/** 每几轮轮询整份重读一次（产出文件的生成情况）。 */
const RUN_FULL_EVERY = 4

export interface Runs {
  /** 本会话的实例（新的在前）。 */
  list: InstanceSummary[]
  /** 本会话的当前实例。 */
  current: string | undefined
  /** 第一次拉完没有。 */
  loaded: boolean
  refresh(): Promise<void>
  /** 设本会话的当前实例（别的会话的实例会被转过来）。 */
  bind(id: string): Promise<boolean>
  remove(id: string, withState: boolean): Promise<boolean>
  /** 列全部会话的实例（工作流中心用）。 */
  all(): Promise<InstanceSummary[]>
}

export function useRuns(rpc: WorkflowLiteRpc, session: string | undefined): Runs {
  const [list, setList] = useState<InstanceSummary[]>([])
  const [current, setCurrent] = useState<string | undefined>(undefined)
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    if (session === undefined) {
      setLoaded(true)
      return
    }
    try {
      const result = await rpc.call('run/list', { session })
      setList(result.instances)
      setCurrent(result.current)
    } catch {
      // 列不出来就当没有实例：模板编辑不受影响。
    } finally {
      setLoaded(true)
    }
  }, [rpc, session])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const bind = useCallback(
    async (id: string): Promise<boolean> => {
      if (session === undefined) return false
      try {
        await rpc.call('run/bind', { id, session })
        await refresh()
        return true
      } catch {
        return false
      }
    },
    [rpc, session, refresh],
  )

  const remove = useCallback(
    async (id: string, withState: boolean): Promise<boolean> => {
      try {
        await rpc.call('run/delete', { id, withState })
        await refresh()
        return true
      } catch {
        return false
      }
    },
    [rpc, refresh],
  )

  const all = useCallback(async (): Promise<InstanceSummary[]> => {
    const result = await rpc.call('run/list', {
      ...(session === undefined ? {} : { session }),
      all: true,
    })
    return result.instances
  }, [rpc, session])

  return { list, current, loaded, refresh, bind, remove, all }
}

// ─────────────────────────────────────────────────────────────
// 一个实例
// ─────────────────────────────────────────────────────────────

export interface RunToast {
  id: number
  tone: 'ok' | 'error'
  text: string
}

export interface Run {
  /** 最近一次读到的实例（含快照与校验结论）；第一次读回来之前是 `null`。 */
  view: InstanceView | null
  /** 上一次合法的状态（文件写坏时画布保留它）。 */
  lastGood: RunState | null
  /** 叠上草稿之后的状态：画布与面板显示的就是它。 */
  shown: RunState | null
  draft: StateEdit[]
  conflicts: DraftConflict[]
  /** 保存后又被模型改回去的字段（提示"你的修改可能被模型覆盖了"）。 */
  overwritten: string[][]
  note: string
  setNote(note: string): void
  saving: boolean
  error: string | null
  toast: RunToast | null
  /** 在实例视图底部弹一句话。 */
  flash(tone: RunToast['tone'], text: string): void
  setField(path: string[], to: StateEdit['to']): void
  setStatus(id: string, status: NodeStatus): void
  /** 一次改几个步骤的状态。 */
  setStatuses(ids: readonly string[], status: NodeStatus): void
  rerun(ids: readonly string[]): void
  undoEdit(path: readonly string[]): void
  resolve(conflict: DraftConflict, keep: 'mine' | 'theirs'): void
  /** 状态草稿的撤销栈（图的在 useRunGraph；两边由 useRunHistory 排成一条）。 */
  draftHistory: SideHistory
  undoDraft(): void
  redoDraft(): void
  /** 丢掉重做栈（图那边有了新的一步）。 */
  dropDraftRedo(): void
  discard(): void
  /**
   * 保存草稿并通知模型。改了图就把改完的整张图一起交上去（草稿里删掉了的步骤的状态改动不交）；
   * 存好了回 host 的回执，没存成回 `null`。
   */
  save(graph?: { base: string; document: WorkflowDocument }): Promise<RunSaveResponse | null>
  reload(): Promise<void>
}

/** 状态草稿撤销栈的上限（和图的撤销栈一样）。 */
const DRAFT_HISTORY_LIMIT = 60

interface DraftStacks {
  past: StateEdit[][]
  future: StateEdit[][]
  seq: number
}

function draftKey(id: string): string {
  return `workflow-lite.run-draft.${id}`
}

/** 草稿存在本地：关掉实例视图或切走再回来，接着改。 */
function readDraft(id: string): { edits: StateEdit[]; note: string } {
  try {
    const raw = window.localStorage.getItem(draftKey(id))
    if (raw === null) return { edits: [], note: '' }
    const parsed = JSON.parse(raw) as { edits?: unknown; note?: unknown }
    return {
      edits: Array.isArray(parsed.edits) ? (parsed.edits as StateEdit[]) : [],
      note: typeof parsed.note === 'string' ? parsed.note : '',
    }
  } catch {
    return { edits: [], note: '' }
  }
}

function writeDraft(id: string, edits: StateEdit[], note: string): void {
  try {
    if (edits.length === 0 && note === '') window.localStorage.removeItem(draftKey(id))
    else window.localStorage.setItem(draftKey(id), JSON.stringify({ edits, note }))
  } catch {
    // 尽力而为。
  }
}

export function useRun(
  rpc: WorkflowLiteRpc,
  id: string,
  session: string | undefined,
  t: T,
  onSaved?: () => void,
): Run {
  const [view, setView] = useState<InstanceView | null>(null)
  const [lastGood, setLastGood] = useState<RunState | null>(null)
  const [draft, setDraft] = useState<StateEdit[]>(() => readDraft(id).edits)
  const [note, setNote] = useState(() => readDraft(id).note)
  const [conflicts, setConflicts] = useState<DraftConflict[]>([])
  const [overwritten, setOverwritten] = useState<string[][]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<RunToast | null>(null)
  const mtime = useRef<number | undefined>(undefined)
  /** 刚保存的字段与改前的值：之后如果又变回改前，多半是被模型拿旧内容覆盖了。 */
  const saved = useRef<StateEdit[]>([])
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [stacks, setStacks] = useState<DraftStacks>({ past: [], future: [], seq: 0 })
  const stacksRef = useRef(stacks)
  stacksRef.current = stacks

  /** 换掉草稿，撤销栈另说（refs 先改，同一次事件里接着改也看得到）。 */
  const putDraft = useCallback((next: StateEdit[]): void => {
    draftRef.current = next
    setDraft(next)
  }, [])
  const putStacks = useCallback((next: DraftStacks): void => {
    stacksRef.current = next
    setStacks(next)
  }, [])
  /** 草稿不是用户改的（换实例、模型那边已经一样了、存完、放弃）：撤销栈清空。 */
  const resetDraft = useCallback(
    (next: StateEdit[]): void => {
      putDraft(next)
      putStacks({ past: [], future: [], seq: stacksRef.current.seq })
    },
    [putDraft, putStacks],
  )
  /** 用户改了草稿：改之前的那份进撤销栈。没改出变化就不算一步。 */
  const change = useCallback(
    (update: (current: StateEdit[]) => StateEdit[]): void => {
      const before = draftRef.current
      const next = update(before)
      if (JSON.stringify(next) === JSON.stringify(before)) return
      const old = stacksRef.current
      putStacks({
        past: [...old.past, before].slice(-DRAFT_HISTORY_LIMIT),
        future: [],
        seq: old.seq + 1,
      })
      putDraft(next)
    },
    [putDraft, putStacks],
  )

  useEffect(() => {
    writeDraft(id, draft, note)
  }, [id, draft, note])

  const flash = useCallback((tone: RunToast['tone'], text: string): void => {
    setToast({ id: Date.now(), tone, text })
  }, [])

  useEffect(() => {
    if (toast === null) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const load = useCallback(
    async (force: boolean): Promise<void> => {
      try {
        const result = await rpc.call('run/load', {
          id,
          ...(session === undefined ? {} : { session }),
          ...(force || mtime.current === undefined ? {} : { since: mtime.current }),
        })
        if ('unchanged' in result) return
        mtime.current = result.mtime
        setView(result)
        setError(null)
        const state = result.state
        if (state === null) return
        setLastGood(state)
        const rebased = rebase(draftRef.current, state)
        if (rebased.draft.length !== draftRef.current.length) resetDraft(rebased.draft)
        setConflicts(rebased.conflicts)
        if (saved.current.length > 0) {
          const reverted = saved.current.filter((edit) =>
            sameValue(valueAt(state, edit.path), edit.from),
          )
          if (reverted.length > 0) setOverwritten(reverted.map((edit) => edit.path))
        }
      } catch (caught) {
        setError(errorMessage(caught))
      }
    },
    [rpc, id, session, resetDraft],
  )

  // 换了实例：清掉上一份的显示，读新的。
  useEffect(() => {
    mtime.current = undefined
    saved.current = []
    setView(null)
    setLastGood(null)
    setOverwritten([])
    const stored = readDraft(id)
    resetDraft(stored.edits)
    setNote(stored.note)
    void load(true)
  }, [id, load, resetDraft])

  // 轮询：只在页面可见时问。状态文件没变时只回"没变"；每隔几轮整份重读一次——
  // 产出文件生成没有不会改状态文件的修改时间（尤其是不记进度的实例），靠它跟上。
  useEffect(() => {
    let tick = 0
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      tick += 1
      void load(tick % RUN_FULL_EVERY === 0)
    }, RUN_POLL_MS)
    return () => window.clearInterval(timer)
  }, [load])

  const base = view?.state ?? lastGood

  const setField = useCallback(
    (path: string[], to: StateEdit['to']): void => {
      if (base === null) return
      change((current) => setDraftField(current, base, path, to))
    },
    [base, change],
  )

  const setStatus = useCallback(
    (nodeId: string, status: NodeStatus): void => {
      if (base === null) return
      change((current) => setNodeStatus(current, base, nodeId, status, isoNow()))
    },
    [base, change],
  )

  const setStatuses = useCallback(
    (ids: readonly string[], status: NodeStatus): void => {
      if (base === null) return
      const now = isoNow()
      change((current) =>
        ids.reduce((next, nodeId) => setNodeStatus(next, base, nodeId, status, now), current),
      )
    },
    [base, change],
  )

  const rerun = useCallback(
    (ids: readonly string[]): void => {
      if (base === null) return
      change((current) => rerunDraft(current, base, ids, isoNow()))
    },
    [base, change],
  )

  const undoEdit = useCallback(
    (path: readonly string[]): void => {
      change((current) =>
        current.filter(
          (edit) => edit.path.length !== path.length || edit.path.some((key, i) => key !== path[i]),
        ),
      )
    },
    [change],
  )

  const resolve = useCallback(
    (conflict: DraftConflict, keep: 'mine' | 'theirs'): void => {
      change((current) => resolveDraft(current, conflict, keep))
      setConflicts((current) => current.filter((item) => item !== conflict))
    },
    [change],
  )

  const undoDraft = useCallback((): void => {
    const old = stacksRef.current
    const previous = old.past.at(-1)
    if (previous === undefined) return
    putStacks({
      past: old.past.slice(0, -1),
      future: [draftRef.current, ...old.future],
      seq: old.seq,
    })
    putDraft(previous)
  }, [putDraft, putStacks])

  const redoDraft = useCallback((): void => {
    const old = stacksRef.current
    const next = old.future[0]
    if (next === undefined) return
    putStacks({ past: [...old.past, draftRef.current], future: old.future.slice(1), seq: old.seq })
    putDraft(next)
  }, [putDraft, putStacks])

  const dropDraftRedo = useCallback((): void => {
    const old = stacksRef.current
    if (old.future.length > 0) putStacks({ ...old, future: [] })
  }, [putStacks])

  const discard = useCallback((): void => {
    resetDraft([])
    setNote('')
    setConflicts([])
  }, [resetDraft])

  const save = useCallback(
    async (graph?: {
      base: string
      document: WorkflowDocument
    }): Promise<RunSaveResponse | null> => {
      if ((draftRef.current.length === 0 && graph === undefined) || saving) return null
      setSaving(true)
      const steps =
        graph === undefined
          ? null
          : new Set(graph.document.nodes.filter(isStep).map((node) => node.id))
      const edits =
        steps === null
          ? draftRef.current
          : draftRef.current.filter(
              (edit) => edit.path.length !== 3 || steps.has(edit.path[1] ?? ''),
            )
      try {
        const result = await rpc.call('run/save', {
          id,
          ...(session === undefined ? {} : { session }),
          edits,
          ...(note.trim() === '' ? {} : { note: note.trim() }),
          ...(graph === undefined ? {} : { graph }),
        })
        saved.current = edits
        setOverwritten([])
        resetDraft([])
        setNote('')
        setConflicts([])
        flash(
          'ok',
          result.quiet === true
            ? t('run.savedQuiet')
            : result.notified
              ? t('run.savedNotified')
              : t('run.savedPending'),
        )
        await load(true)
        onSaved?.()
        return result
      } catch (caught) {
        if (
          errorCode(caught) === 'conflict' &&
          !(caught instanceof WorkflowLiteRpcError && caught.details.get('graph') === true)
        ) {
          // 有字段在开始改之后被模型改过：重新读一遍，冲突会在草稿上标出来。
          await load(true)
          flash('error', t('run.saveConflict'))
        } else {
          flash('error', errorMessage(caught))
        }
        return null
      } finally {
        setSaving(false)
      }
    },
    [rpc, id, session, note, saving, flash, t, load, onSaved, resetDraft],
  )

  const shown = useMemo(() => (base === null ? null : applyDraft(base, draft)), [base, draft])
  const draftHistory = useMemo<SideHistory>(
    () => ({ past: stacks.past.length, future: stacks.future.length, seq: stacks.seq }),
    [stacks],
  )

  return {
    view,
    lastGood,
    shown,
    draft,
    conflicts,
    overwritten,
    note,
    setNote,
    saving,
    error,
    toast,
    flash,
    setField,
    setStatus,
    setStatuses,
    rerun,
    undoEdit,
    resolve,
    draftHistory,
    undoDraft,
    redoDraft,
    dropDraftRedo,
    discard,
    save,
    reload: () => load(true),
  }
}
