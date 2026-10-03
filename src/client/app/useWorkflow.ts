/**
 * dsh-workflow-lite — 编辑器的"发动机"：加载、自动保存、冲突、目录。
 *
 * 状态放在一个 ref 里同步推进，再镜像进 React state 触发渲染。**不能只靠 React state**：
 * 改完文档要立刻判断"该不该排一次保存"，而 React 的 state 要等下一次渲染才更新——
 * 读到旧值就会把这次排期整个丢掉（改动永远不落盘）。
 *
 * 保存规则：
 * - 改动 → 防抖后写一次；保存中不重入，保存期间来的改动在这笔写完后补排；
 * - 换图 / 页面隐藏 / 卸载 → 立即写，不等防抖；
 * - `broken` 态绝不写盘。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useWorkflow
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyzeGraph, type GraphAnalysis } from '../../shared/graph.ts'
import { checkName, normalizeName } from '../../shared/naming.ts'
import type { NodeData, WorkflowDocument } from '../../shared/types.ts'
import type { GraphListResponse, PlanBuildResponse } from '../../shared/wire.ts'
import type { T } from '../i18n.ts'
import {
  type Action,
  type Edit,
  type EditorState,
  initialState,
  isDirty,
  reduce,
  type Selection,
} from '../model/editor.ts'
import { placeMissing } from '../model/layout.ts'
import { errorCode, errorMessage, type WorkflowLiteRpc, WorkflowLiteRpcError } from '../rpc.ts'

/** 上次打开的工作流（重新进来时接着看它）。 */
const LAST_KEY = 'workflow-lite.last'

/** 目录还没回来时用的防抖窗口（与 host 的默认值一致）。 */
const DEFAULT_DEBOUNCE_MS = 400

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

export interface Workflow {
  state: EditorState
  analysis: GraphAnalysis | null
  catalog: GraphListResponse | null
  /** 磁盘上的版本与本地改动冲突时的冲突 id 清单；`null` = 没有冲突。 */
  conflict: string[] | null
  /** 本地有改动、磁盘又被别处改过。 */
  external: boolean
  toast: Toast | null
  /** 刚建好的工作流名字：顶栏据此直接进入改名。读完即清。 */
  fresh: string | null
  clearFresh(): void
  edit(edit: Edit): void
  select(selection: Selection): void
  undo(): void
  redo(): void
  /** 一次连续输入结束：断开撤销合并。 */
  seal(): void
  open(name: string): Promise<void>
  create(): Promise<void>
  rename(to: string): Promise<boolean>
  remove(name: string): Promise<void>
  reload(): void
  retrySave(): void
  keepMine(): void
  refreshCatalog(): Promise<void>
  /** 预览计划；`cwd` = 执行时的工作区（计划里的工作区路径、任务描述路径按它写）。 */
  buildPlan(full: boolean, cwd?: string): Promise<PlanBuildResponse>
  /** 把待写的改动立刻存下去（「执行」之前：实例要拿磁盘上的那份做快照）。存不下去回 `false`。 */
  flush(): Promise<boolean>
  loadTemplate(name: string): Promise<NodeData | null>
  saveTemplate(name: string, data: NodeData): Promise<boolean>
  /** 读「我的步骤」给人编辑（提示词空着的半成品也能读）。 */
  loadTemplateDraft(name: string): Promise<NodeData | null>
  /** 覆盖保存「我的步骤」；`name` 与 `from` 不同就是改名。成功返回保存后的名字。 */
  updateTemplate(name: string, data: NodeData, from: string): Promise<string | null>
  deleteTemplate(name: string): Promise<boolean>
  notify(text: string, tone?: Toast['tone']): void
}

function readLast(): string | null {
  try {
    const value = window.localStorage.getItem(LAST_KEY)
    return value === null || value === '' ? null : value
  } catch {
    // 隐私模式 / 被策略禁掉：记不住偏好不该让画布打不开。
    return null
  }
}

function writeLast(name: string | null): void {
  try {
    if (name === null) window.localStorage.removeItem(LAST_KEY)
    else window.localStorage.setItem(LAST_KEY, name)
  } catch {
    // 同上：偏好持久化是尽力而为。
  }
}

function sameDocument(a: WorkflowDocument, b: WorkflowDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function conflictIds(error: unknown): string[] {
  if (!(error instanceof WorkflowLiteRpcError)) return []
  const ids = error.details.get('ids')
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export function useWorkflow(rpc: WorkflowLiteRpc, t: T): Workflow {
  const [state, setState] = useState<EditorState>(initialState)
  const stateRef = useRef(state)
  const [catalog, setCatalog] = useState<GraphListResponse | null>(null)
  const [conflict, setConflict] = useState<string[] | null>(null)
  const [external, setExternal] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [fresh, setFresh] = useState<string | null>(null)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debounceMs = useRef(DEFAULT_DEBOUNCE_MS)
  /** 每次 `open` 领一个号；回来时号对不上说明用户已经又换了一张，结果作废。 */
  const loadTicket = useRef(0)
  const toastSeq = useRef(0)
  const tRef = useRef(t)
  tRef.current = t

  const apply = useCallback((action: Action): void => {
    const next = reduce(stateRef.current, action)
    if (next === stateRef.current) return
    stateRef.current = next
    setState(next)
  }, [])

  const notify = useCallback((text: string, tone: Toast['tone'] = 'info'): void => {
    toastSeq.current += 1
    setToast({ id: toastSeq.current, text, tone })
  }, [])

  useEffect(() => {
    if (toast === null) return
    const handle = setTimeout(() => setToast(null), toast.tone === 'error' ? 6000 : 2600)
    return () => clearTimeout(handle)
  }, [toast])

  const fail = useCallback(
    (error: unknown): void => {
      const message = errorMessage(error)
      notify(message === '' ? tRef.current('error.generic') : message, 'error')
    },
    [notify],
  )

  const refreshCatalog = useCallback(async (): Promise<void> => {
    try {
      const list = await rpc.call('graph/list', {})
      debounceMs.current = list.limits.saveDebounceMs
      setCatalog(list)
    } catch (error) {
      fail(error)
    }
  }, [rpc, fail])

  // ── 保存 ────────────────────────────────────────────────────

  const scheduleRef = useRef<() => void>(() => undefined)

  const save = useCallback(
    async (force = false): Promise<void> => {
      const current = stateRef.current
      if (current.phase !== 'ready' || current.name === null || current.doc === null) return
      if (current.saving) return
      // 到点再判一次：防抖期间改动可能已经被撤回去了，别空写。
      if (!force && !isDirty(current)) return
      const { name, rev } = current
      apply({ type: 'saveStarted', rev })
      try {
        const result = await rpc.call('graph/save', {
          name,
          document: current.doc,
          baseHash: current.baseHash,
          ...(force ? { force: true } : {}),
        })
        apply({ type: 'saveDone', baseHash: result.hash })
        setConflict(null)
        setExternal(false)
      } catch (error) {
        if (errorCode(error) === 'conflict') setConflict(conflictIds(error))
        apply({ type: 'saveFailed', message: errorMessage(error) })
        return
      }
      /*
       * 写完回读一次：刷新校验结果（提示词刚补上，那条问题就该消失），并让本地文档与磁盘上
       * **合并后**的结果对齐。回读失败不等于保存失败，所以单独 try。
       * 保存期间又来了改动就**不换文档**——否则磁盘版本会静默吃掉在途改动；那时基线哈希也
       * 留着这次写回的值，不采用回读到的（它对应的文档我们没有拿）。
       */
      try {
        const disk = await rpc.call('graph/load', { name })
        const now = stateRef.current
        if (now.name === name && now.phase === 'ready' && now.doc !== null) {
          const adopt = now.rev === rev && !sameDocument(now.doc, disk.document)
          apply({
            type: 'refreshed',
            problems: disk.problems,
            ...(adopt ? { doc: disk.document, baseHash: disk.hash } : {}),
          })
        }
      } catch {
        // 顺手刷新而已，失败就维持本地状态。
      }
      if (isDirty(stateRef.current)) scheduleRef.current()
    },
    [rpc, apply],
  )

  const schedule = useCallback((): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      void save()
    }, debounceMs.current)
  }, [save])
  scheduleRef.current = schedule

  /** 把待写的改动立刻冲掉（换图、编译、离开之前）。写不完也不无限拖住调用方。 */
  const flush = useCallback(async (): Promise<void> => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const current = stateRef.current
      if (current.saving) {
        await sleep(80)
        continue
      }
      if (current.phase !== 'ready' || !isDirty(current)) return
      await save()
      // 写失败（冲突 / IO）就停手：反复重试只会反复失败，由顶栏的状态提示人来处理。
      if (stateRef.current.saveError !== null) return
    }
  }, [save])

  const flushSaved = useCallback(async (): Promise<boolean> => {
    await flush()
    const current = stateRef.current
    return current.saveError === null && !current.saving && !isDirty(current)
  }, [flush])

  // ── 编辑 ────────────────────────────────────────────────────

  const edit = useCallback(
    (action: Edit): void => {
      const before = stateRef.current
      apply(action)
      if (stateRef.current !== before) schedule()
    },
    [apply, schedule],
  )

  const undo = useCallback((): void => {
    const before = stateRef.current
    apply({ type: 'undo' })
    if (stateRef.current !== before) schedule()
  }, [apply, schedule])

  const redo = useCallback((): void => {
    const before = stateRef.current
    apply({ type: 'redo' })
    if (stateRef.current !== before) schedule()
  }, [apply, schedule])

  const select = useCallback(
    (selection: Selection): void => apply({ type: 'select', selection }),
    [apply],
  )

  const seal = useCallback((): void => apply({ type: 'seal' }), [apply])

  // ── 打开 / 目录操作 ─────────────────────────────────────────

  const open = useCallback(
    async (name: string): Promise<void> => {
      await flush()
      loadTicket.current += 1
      const ticket = loadTicket.current
      setConflict(null)
      setExternal(false)
      apply({ type: 'loading', name })
      try {
        const loaded = await rpc.call('graph/load', { name })
        if (ticket !== loadTicket.current) return
        const blocking = loaded.problems.filter((problem) => problem.level === 'save')
        if (blocking.length > 0) {
          // 保存级破损 ⇒ 只读：留着原文给人看，不写盘。
          apply({
            type: 'broken',
            name: loaded.name,
            message: blocking.map((problem) => problem.message).join('；'),
            raw: loaded.raw ?? null,
            problems: loaded.problems,
          })
          return
        }
        apply({
          type: 'loaded',
          name: loaded.name,
          doc: loaded.document,
          baseHash: loaded.hash,
          problems: loaded.problems,
        })
        writeLast(loaded.name)
      } catch (error) {
        if (ticket !== loadTicket.current) return
        if (errorCode(error) === 'not_found') {
          // 被删或改名了：回到"没打开"，目录重拉一次。
          apply({ type: 'closed' })
          writeLast(null)
          fail(error)
          void refreshCatalog()
          return
        }
        apply({ type: 'broken', name, message: errorMessage(error), raw: null, problems: [] })
      }
    },
    [rpc, apply, flush, fail, refreshCatalog],
  )

  const create = useCallback(async (): Promise<void> => {
    try {
      const created = await rpc.call('graph/create', { name: tRef.current('wf.defaultName') })
      await refreshCatalog()
      await open(created.name)
      setFresh(created.name)
    } catch (error) {
      fail(error)
    }
  }, [rpc, refreshCatalog, open, fail])

  const rename = useCallback(
    async (raw: string): Promise<boolean> => {
      const from = stateRef.current.name
      const to = normalizeName(raw.trim())
      if (from === null || to === '' || to === from) return true
      const problem = checkName(to)
      if (problem !== null) {
        notify(problem.message, 'error')
        return false
      }
      try {
        await flush()
        await rpc.call('graph/rename', { name: from, to })
        apply({ type: 'renamed', name: to })
        writeLast(to)
        await refreshCatalog()
        return true
      } catch (error) {
        fail(error)
        return false
      }
    },
    [rpc, apply, flush, refreshCatalog, notify, fail],
  )

  const remove = useCallback(
    async (name: string): Promise<void> => {
      const current = stateRef.current.name === name
      try {
        if (current) {
          // 正开着的这张：先停掉排着的保存，别在删掉之后又把它写回来。
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = null
          loadTicket.current += 1
        }
        await rpc.call('graph/delete', { name })
        if (current) {
          apply({ type: 'closed' })
          writeLast(null)
        }
        await refreshCatalog()
      } catch (error) {
        fail(error)
      }
    },
    [rpc, apply, refreshCatalog, fail],
  )

  /** 丢掉本地状态，按磁盘上的重新来。 */
  const reload = useCallback((): void => {
    const name = stateRef.current.name
    if (name === null) return
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    // 直接换基线：不经过 `open` 里的 flush（那会把要丢掉的改动先写下去）。
    loadTicket.current += 1
    const ticket = loadTicket.current
    setConflict(null)
    setExternal(false)
    void rpc
      .call('graph/load', { name })
      .then((loaded) => {
        if (ticket !== loadTicket.current) return
        const blocking = loaded.problems.filter((problem) => problem.level === 'save')
        if (blocking.length > 0) {
          apply({
            type: 'broken',
            name: loaded.name,
            message: blocking.map((problem) => problem.message).join('；'),
            raw: loaded.raw ?? null,
            problems: loaded.problems,
          })
          return
        }
        apply({
          type: 'loaded',
          name: loaded.name,
          doc: loaded.document,
          baseHash: loaded.hash,
          problems: loaded.problems,
        })
      })
      .catch(fail)
  }, [rpc, apply, fail])

  const retrySave = useCallback((): void => void save(), [save])
  const keepMine = useCallback((): void => void save(true), [save])

  const buildPlan = useCallback(
    async (full: boolean, cwd?: string): Promise<PlanBuildResponse> => {
      const name = stateRef.current.name
      if (name === null) throw new Error(tRef.current('error.generic'))
      // 编译读的是磁盘：先把改动写下去，预览才是"现在这张图"的计划。
      await flush()
      return rpc.call('plan/build', {
        name,
        ...(full ? { full: true } : {}),
        ...(cwd === undefined ? {} : { cwd }),
      })
    },
    [rpc, flush],
  )

  const loadTemplate = useCallback(
    async (name: string): Promise<NodeData | null> => {
      try {
        return (await rpc.call('graph/nodeTemplate', { name })).data
      } catch (error) {
        fail(error)
        return null
      }
    },
    [rpc, fail],
  )

  const saveTemplate = useCallback(
    async (raw: string, data: NodeData): Promise<boolean> => {
      const name = normalizeName(raw.trim())
      const problem = checkName(name)
      if (problem !== null) {
        notify(problem.message, 'error')
        return false
      }
      try {
        await rpc.call('graph/nodeTemplateCreate', { name, data })
        await refreshCatalog()
        notify(tRef.current('tpl.saved'))
        return true
      } catch (error) {
        fail(error)
        return false
      }
    },
    [rpc, refreshCatalog, notify, fail],
  )

  const loadTemplateDraft = useCallback(
    async (name: string): Promise<NodeData | null> => {
      try {
        return (await rpc.call('graph/nodeTemplateDraft', { name })).data
      } catch (error) {
        fail(error)
        return null
      }
    },
    [rpc, fail],
  )

  const updateTemplate = useCallback(
    async (raw: string, data: NodeData, from: string): Promise<string | null> => {
      const name = normalizeName(raw.trim())
      const problem = checkName(name)
      if (problem !== null) {
        notify(problem.message, 'error')
        return null
      }
      try {
        await rpc.call('graph/nodeTemplateSave', { name, data, from })
        await refreshCatalog()
        notify(tRef.current('step.saved'))
        return name
      } catch (error) {
        fail(error)
        return null
      }
    },
    [rpc, refreshCatalog, notify, fail],
  )

  const deleteTemplate = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        await rpc.call('graph/nodeTemplateDelete', { name })
        await refreshCatalog()
        notify(tRef.current('step.deleted'))
        return true
      } catch (error) {
        fail(error)
        return false
      }
    },
    [rpc, refreshCatalog, notify, fail],
  )

  // ── 生命周期 ────────────────────────────────────────────────

  useEffect(() => {
    void refreshCatalog()
  }, [refreshCatalog])

  /** 进来时自动打开：上次那张还在就开它，否则开最近改过的。 */
  const autoOpened = useRef(false)
  useEffect(() => {
    if (autoOpened.current || catalog === null) return
    autoOpened.current = true
    if (stateRef.current.name !== null || catalog.workflows.length === 0) return
    const last = readLast()
    const target =
      catalog.workflows.find((entry) => entry.name === last) ??
      [...catalog.workflows].sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (target !== undefined) void open(target.name)
  }, [catalog, open])

  // 离开前冲掉：页面隐藏与卸载两条路都走（浏览器不保证 beforeunload 里发得出 RPC）。
  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') void flush()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      void flush()
    }
  }, [flush])

  /**
   * 窗口回到前台时看一眼磁盘（模型可能刚用工具改过这张图）。
   * 本地干净 ⇒ 直接同步过来；本地有改动 ⇒ 只提示，由人决定。
   */
  useEffect(() => {
    const onFocus = (): void => {
      const before = stateRef.current
      if (before.phase !== 'ready' || before.name === null || before.saving) return
      const { name, rev } = before
      void rpc
        .call('graph/load', { name })
        .then((disk) => {
          const now = stateRef.current
          if (now.name !== name || now.phase !== 'ready' || now.saving) return
          if (disk.hash === now.baseHash) return
          if (disk.problems.some((problem) => problem.level === 'save')) return
          if (isDirty(now) || now.rev !== rev) {
            setExternal(true)
            return
          }
          apply({
            type: 'refreshed',
            problems: disk.problems,
            doc: disk.document,
            baseHash: disk.hash,
            external: true,
          })
          notify(tRef.current('banner.synced'))
        })
        .catch(() => {
          // 被删/改名了也不在这里改状态——下一次操作会撞上 not_found。
        })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [rpc, apply, notify])

  const analysis = useMemo(() => (state.doc === null ? null : analyzeGraph(state.doc)), [state.doc])

  // 还没摆过的节点（模型用工具加的、或整张新图）补上坐标。补位是真实改动，会落盘。
  useEffect(() => {
    const current = stateRef.current
    if (current.phase !== 'ready' || current.doc === null || analysis === null) return
    if (current.doc !== state.doc) return
    const doc = current.doc
    let live = true
    void placeMissing(doc, analysis).then((positions) => {
      // 整图重排是异步的：等它的时候图变了（或卸载了）就作废，下一轮会按新图重算。
      if (!live || stateRef.current.doc !== doc || Object.keys(positions).length === 0) return
      edit({ type: 'moveNodes', positions, silent: true })
    })
    return () => {
      live = false
    }
  }, [state.doc, analysis, edit])

  const clearFresh = useCallback((): void => setFresh(null), [])

  return {
    state,
    analysis,
    catalog,
    conflict,
    external,
    toast,
    fresh,
    clearFresh,
    edit,
    select,
    undo,
    redo,
    seal,
    open,
    create,
    rename,
    remove,
    reload,
    retrySave,
    keepMine,
    refreshCatalog,
    buildPlan,
    flush: flushSaved,
    loadTemplate,
    saveTemplate,
    loadTemplateDraft,
    updateTemplate,
    deleteTemplate,
    notify,
  }
}
