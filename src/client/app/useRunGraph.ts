/**
 * dsh-workflow-lite — 实例视图里改图：一份只在本地的编辑器（和模板编辑同一个状态机），不自动存。
 *
 * 图的改动和状态的改动攒在同一条草稿栏里（「已改 x 处」），用户点「保存并通知模型」才一起交给 host。
 * 改到一半切走再回来接着改：改过的图按实例存在浏览器里，基线（planId）对不上就作废。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useRunGraph
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { type GraphChange, graphChanges } from '../../shared/graphDiff.ts'
import type { ValidationProblem, WorkflowDocument } from '../../shared/types.ts'
import { validateDocument } from '../../shared/validate.ts'
import { type Edit, initialState, reduce, type Selection } from '../model/editor.ts'
import { revertChange } from '../model/runGraph.ts'

export interface RunGraph {
  /** 改到现在的图；基线还没到时是 `null`。 */
  doc: WorkflowDocument | null
  /** 改之前那版。 */
  base: WorkflowDocument | null
  /** 改之前那版的 planId（保存时交给 host 核对）。 */
  basePlan: string | null
  selection: Selection
  /** 比基线改了什么（一处一项，按 `shared/graphDiff.ts` 数）。 */
  changes: GraphChange[]
  /** 改完的图保存不了的问题（保存级、编译级）：画布上标红，保存按钮按住。 */
  problems: ValidationProblem[]
  edit(edit: Edit): void
  select(selection: Selection): void
  seal(): void
  undo(): void
  redo(): void
  /** 单独撤回清单里的一处。 */
  revert(change: GraphChange): void
  /** 放弃图的全部改动。 */
  discard(): void
  /** 存好了：改到现在的图就是新的基线（`planId` 是 host 回的新图的）。 */
  commit(planId: string): void
}

function storeKey(id: string): string {
  return `workflow-lite.run-graph.${id}`
}

function readStored(id: string): { base: string; doc: WorkflowDocument } | null {
  try {
    const raw = window.localStorage.getItem(storeKey(id))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { base?: unknown; doc?: unknown }
    if (typeof parsed.base !== 'string' || typeof parsed.doc !== 'object' || parsed.doc === null) {
      return null
    }
    return { base: parsed.base, doc: parsed.doc as WorkflowDocument }
  } catch {
    return null
  }
}

function writeStored(id: string, value: { base: string; doc: WorkflowDocument } | null): void {
  try {
    if (value === null) window.localStorage.removeItem(storeKey(id))
    else window.localStorage.setItem(storeKey(id), JSON.stringify(value))
  } catch {
    // 尽力而为。
  }
}

/** 实例的图校验不看节点数上限（建实例时已经过了一遍，上限由 host 再把关）。 */
const NO_LIMIT = Number.MAX_SAFE_INTEGER

export function useRunGraph(
  id: string,
  /** host 给的快照（已补好位置）与它的 planId；还没读回来是 `null`。 */
  source: { planId: string; doc: WorkflowDocument } | null,
  workflow: string | undefined,
): RunGraph {
  const [state, dispatch] = useReducer(reduce, initialState)
  const [base, setBase] = useState<{ id: string; planId: string; doc: WorkflowDocument } | null>(
    null,
  )
  const loaded = useRef<string | null>(null)
  const selectionRef = useRef(state.selection)
  selectionRef.current = state.selection

  /** 换一份基线：历史从头开始，选中的东西还在就留着。 */
  const reset = useCallback((doc: WorkflowDocument, planId: string): void => {
    dispatch({ type: 'loaded', name: planId, doc, baseHash: planId, problems: [] })
    dispatch({ type: 'select', selection: selectionRef.current })
  }, [])

  useEffect(() => {
    if (source === null) return
    const key = `${id}:${source.planId}`
    if (loaded.current === key) return
    const sameInstance = loaded.current?.startsWith(`${id}:`) === true
    loaded.current = key
    setBase({ id, planId: source.planId, doc: source.doc })
    if (!sameInstance) selectionRef.current = null
    reset(source.doc, source.planId)
    const stored = readStored(id)
    if (stored?.base === source.planId) dispatch({ type: 'replaceDoc', doc: stored.doc })
    else if (stored !== null) writeStored(id, null)
  }, [id, source, reset])

  const current = base?.id === id ? base : null
  const doc = current === null ? null : state.doc

  useEffect(() => {
    if (current === null || doc === null) return
    writeStored(id, doc === current.doc ? null : { base: current.planId, doc })
  }, [id, current, doc])

  const changes = useMemo(
    () => (current === null || doc === null ? [] : graphChanges(current.doc, doc)),
    [current, doc],
  )
  const problems = useMemo(() => {
    if (doc === null || changes.length === 0) return []
    const report = validateDocument(doc, {
      workflowName: workflow ?? 'workflow',
      maxNodes: NO_LIMIT,
    })
    return [...report.save, ...report.compile]
  }, [doc, changes.length, workflow])

  const edit = useCallback((next: Edit): void => dispatch(next), [])
  const select = useCallback(
    (selection: Selection): void => dispatch({ type: 'select', selection }),
    [],
  )
  const seal = useCallback((): void => dispatch({ type: 'seal' }), [])
  const undo = useCallback((): void => dispatch({ type: 'undo' }), [])
  const redo = useCallback((): void => dispatch({ type: 'redo' }), [])
  const revert = useCallback(
    (change: GraphChange): void => {
      if (current === null || doc === null) return
      dispatch({ type: 'replaceDoc', doc: revertChange(current.doc, doc, change) })
    },
    [current, doc],
  )
  const discard = useCallback((): void => {
    if (current !== null) reset(current.doc, current.planId)
  }, [current, reset])
  const commit = useCallback(
    (planId: string): void => {
      if (doc === null) return
      loaded.current = `${id}:${planId}`
      setBase({ id, planId, doc })
      writeStored(id, null)
      reset(doc, planId)
    },
    [id, doc, reset],
  )

  return {
    doc,
    base: current?.doc ?? null,
    basePlan: current?.planId ?? null,
    selection: current === null ? null : state.selection,
    changes,
    problems,
    edit,
    select,
    seal,
    undo,
    redo,
    revert,
    discard,
    commit,
  }
}
