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
import {
  type InstanceSummary,
  type InstanceView,
  isoNow,
  type NodeStatus,
  type RunState,
  type StateEdit,
} from '../../shared/runState.ts'
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
import { errorCode, errorMessage, type WorkflowLiteRpc } from '../rpc.ts'

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
  discard(): void
  save(): Promise<void>
  reload(): Promise<void>
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
        if (rebased.draft.length !== draftRef.current.length) setDraft(rebased.draft)
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
    [rpc, id, session],
  )

  // 换了实例：清掉上一份的显示，读新的。
  useEffect(() => {
    mtime.current = undefined
    saved.current = []
    setView(null)
    setLastGood(null)
    setOverwritten([])
    const stored = readDraft(id)
    setDraft(stored.edits)
    setNote(stored.note)
    void load(true)
  }, [id, load])

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
      setDraft((current) => setDraftField(current, base, path, to))
    },
    [base],
  )

  const setStatus = useCallback(
    (nodeId: string, status: NodeStatus): void => {
      if (base === null) return
      setDraft((current) => setNodeStatus(current, base, nodeId, status, isoNow()))
    },
    [base],
  )

  const setStatuses = useCallback(
    (ids: readonly string[], status: NodeStatus): void => {
      if (base === null) return
      const now = isoNow()
      setDraft((current) =>
        ids.reduce((next, nodeId) => setNodeStatus(next, base, nodeId, status, now), current),
      )
    },
    [base],
  )

  const rerun = useCallback(
    (ids: readonly string[]): void => {
      if (base === null) return
      setDraft((current) => rerunDraft(current, base, ids, isoNow()))
    },
    [base],
  )

  const undoEdit = useCallback((path: readonly string[]): void => {
    setDraft((current) =>
      current.filter(
        (edit) => edit.path.length !== path.length || edit.path.some((key, i) => key !== path[i]),
      ),
    )
  }, [])

  const resolve = useCallback((conflict: DraftConflict, keep: 'mine' | 'theirs'): void => {
    setDraft((current) => resolveDraft(current, conflict, keep))
    setConflicts((current) => current.filter((item) => item !== conflict))
  }, [])

  const discard = useCallback((): void => {
    setDraft([])
    setNote('')
    setConflicts([])
  }, [])

  const save = useCallback(async (): Promise<void> => {
    if (draftRef.current.length === 0 || saving) return
    setSaving(true)
    const edits = draftRef.current
    try {
      const result = await rpc.call('run/save', {
        id,
        ...(session === undefined ? {} : { session }),
        edits,
        ...(note.trim() === '' ? {} : { note: note.trim() }),
      })
      saved.current = edits
      setOverwritten([])
      setDraft([])
      setNote('')
      setConflicts([])
      flash('ok', result.notified ? t('run.savedNotified') : t('run.savedPending'))
      await load(true)
      onSaved?.()
    } catch (caught) {
      if (errorCode(caught) === 'conflict') {
        // 有字段在开始改之后被模型改过：重新读一遍，冲突会在草稿上标出来。
        await load(true)
        flash('error', t('run.saveConflict'))
      } else {
        flash('error', errorMessage(caught))
      }
    } finally {
      setSaving(false)
    }
  }, [rpc, id, session, note, saving, flash, t, load, onSaved])

  const shown = useMemo(() => (base === null ? null : applyDraft(base, draft)), [base, draft])

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
    discard,
    save,
    reload: () => load(true),
  }
}
