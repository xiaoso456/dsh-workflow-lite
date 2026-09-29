/**
 * dsh-workflow-lite — 工作流画布（会话页 tab）。
 *
 * 事实源是磁盘上的那份 JSON：进来 `graph/load`，改动防抖 400ms 后 `graph/save`，
 * **离开前必定 flush**（卸载 / 页面隐藏都算）——没落盘的改动不该随组件一起没。
 *
 * 图逻辑全在 `core/state.ts`（纯函数、有单测），目标合法性全在 `shared/wire.ts`，
 * 这个文件只管接线与渲染。三栏：左＝节点库与校验，中＝画布，右＝属性；底下是编译预览。
 *
 * @module @xiaoso/dsh-workflow-lite/client/components/CanvasView
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  Background,
  BackgroundVariant,
  Controls,
  type EdgeChange,
  type Edge as FlowEdge,
  type Node as FlowNode,
  MarkerType,
  type NodeChange,
  ReactFlow,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { analyzeGraph, byId } from '../../shared/graph.ts'
import { displayName, idKey } from '../../shared/model.ts'
import { checkName } from '../../shared/naming.ts'
import type { NodeData, Point, TemplateEntry } from '../../shared/types.ts'
import type { GraphListResponse } from '../../shared/wire.ts'
import { readDragPayload } from '../core/dnd.ts'
import type { LocaleKey, NS } from '../core/locales.ts'
import {
  groupNodeTemplates,
  NODE_PRESETS,
  type NodePreset,
  readCollapsed,
  writeCollapsed,
} from '../core/presets.ts'
import { type WorkflowLiteRpc, WorkflowLiteRpcError } from '../core/rpc.ts'
import {
  avoidOverlap,
  type CanvasState,
  duplicateNode,
  findNode,
  initialCanvasState,
  isTypingTarget,
  layoutAll,
  layoutMissing,
  NODE_FOOTPRINT_H,
  NODE_FOOTPRINT_W,
  needsSave,
  reduce,
  uniqueNodeId,
} from '../core/state.ts'
import { decideSave, statusKey } from '../core/sync.ts'
import css from './CanvasView.module.css'
import {
  type EdgeEditorView,
  type EdgeView,
  type GraphSummary,
  Inspector,
  PlanBlock,
} from './Inspector.tsx'
import { type CardData, WorkflowNodeCard } from './NodeCard.tsx'
import { Palette, ValidationPanel } from './Palette.tsx'
import ui from './ui.module.css'

/** 客户端入口注入的业务面。 */
export interface CanvasViewInjected {
  rpc: WorkflowLiteRpc
}

/** 槽位给这个组件的完整 props。 */
export type CanvasViewProps = PropsRuntime<'conversation.view'> &
  PropsLocale<typeof NS> &
  CanvasViewInjected

/** `nodeTypes` 必须是稳定引用，否则 React Flow 每帧重建全部节点。 */
const NODE_TYPES = { wfNode: WorkflowNodeCard }

/** 保存防抖（配置键 `saveDebounceMs` 的默认值，画布侧照默认值跑）。 */
const DEBOUNCE_MS = 400

/** 超 `maxNodes` 时的网格假位：不跑自动布局，但坐标仍存盘。 */
const GRID_COLUMNS = 4

/** `when` 的预置词下拉（`VERDICT` 约定）。 */
const WHEN_PRESETS = ['pass', 'fail']

/**
 * 边的可点区域宽度（画布单位）。
 *
 * React Flow 会给每条边额外画一条**透明宽路径**（`.react-flow__edge-interaction`）来扩大
 * 命中区，默认 20。可真正描出来的线只有 1.5px 宽，20 在缩放后也就十来个屏幕像素——
 * 用户得对准到像素级才点得中（"点边选中"这条路径因此几乎不可用）。28 让"大致点在线上"就中。
 *
 * 它是 **edge 自己的属性**（`EdgeBase.interactionWidth`），不是 `<ReactFlow>` 的 prop，
 * 所以写在 `flowEdges` 里逐条带上。
 */
const EDGE_INTERACTION_WIDTH = 28

/**
 * 快捷键说明表。
 *
 * 它不是装饰：本轮才加上的 `Ctrl+Z` / `Delete` / `/` 在界面上**没有任何别的痕迹**，
 * 没这张表就等于没做——用户不会去猜一个编辑器里有哪些键。
 * 键位本身写在这里（不是 locale），因为 `Ctrl+Z` 不该被翻译成别的键。
 */
const SHORTCUT_ROWS: readonly { key: LocaleKey; combos: readonly string[] }[] = [
  { key: 'shortcut.undo', combos: ['Ctrl+Z'] },
  { key: 'shortcut.redo', combos: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { key: 'shortcut.delete', combos: ['Delete'] },
  { key: 'shortcut.escape', combos: ['Esc'] },
  { key: 'shortcut.filter', combos: ['/'] },
  { key: 'shortcut.fit', combos: ['F'] },
  { key: 'shortcut.relayout', combos: ['L'] },
]

/** 上次打开的图（A16）。多张图是常态，重挂载时不能只看"目录里恰好一张"。 */
const LAST_GRAPH_KEY = 'workflow-lite.lastGraph'

/**
 * 卡片操作簇的兜底：`cardActions` 是从同一份文档算出来的，理论上不会缺项。
 * 真缺了也渲染得出来，只是那个节点没有操作可点；不该为一张卡的边界情况抛异常。
 */
const NO_CARD_ACTIONS: CardData['actions'] = {
  duplicate: () => undefined,
  remove: () => undefined,
}

/** 错误对象上 host 给的 code（`blocked` / `conflict` / `not_found`…）。 */
function codeOf(error: unknown): string | undefined {
  if (error instanceof Error && error.name !== '' && error.name !== 'Error') return error.name
  return undefined
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 从 `conflict` 错误的 `detail.ids` 里取出冲突 id 清单（拿不到就给空表）。 */
function conflictIdsOf(error: unknown): string[] {
  if (!(error instanceof WorkflowLiteRpcError)) return []
  const ids = error.details.ids
  if (!Array.isArray(ids)) return []
  return ids.filter((id): id is string => typeof id === 'string')
}

/** 网格假位：行优先，坐标归一化交给 `withNodePosition`。 */
function gridFallback(document: { nodes: { id: string; position: Point }[] }): Map<string, Point> {
  const placed = new Map<string, Point>()
  document.nodes.forEach((node, index) => {
    if (node.position.x !== 0 || node.position.y !== 0) return
    placed.set(node.id, {
      x: 120 + (index % GRID_COLUMNS) * 260,
      y: 80 + Math.floor(index / GRID_COLUMNS) * 140,
    })
  })
  return placed
}

/** 新节点落点：从第一个空位起按网格铺，避免盖住已有节点。 */
function nextPosition(count: number): Point {
  return {
    x: 120 + (count % GRID_COLUMNS) * 260,
    y: 80 + Math.floor(count / GRID_COLUMNS) * 140,
  }
}

/**
 * 拿一次 `localStorage`。**读取这个属性本身就可能抛**（隐私模式 / 被策略禁掉），
 * 所以连它一起包进去——调用方拿到 `null` 就当"这台机器没地方存偏好"。
 */
function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * 读 localStorage。隐私模式 / 被策略禁掉 / 配额满都只是"没有这个东西"，
 * **绝不把异常抛进渲染**：记不住偏好不该让画布打不开。
 */
function readStored(key: string): string | null {
  try {
    return safeStorage()?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** 写 localStorage；写失败（同上）只是这次偏好丢了，功能照用。 */
function writeStored(key: string, value: string): void {
  try {
    safeStorage()?.setItem(key, value)
  } catch {
    // 故意吞掉：偏好持久化是尽力而为。
  }
}

/** 上次打开的图名；空串与缺失同义（都当"没有"）。 */
function readLastGraph(): string | null {
  const raw = readStored(LAST_GRAPH_KEY)
  return raw === null || raw === '' ? null : raw
}

/**
 * 按契约的 testid 找元素并聚焦。
 *
 * 跨组件的焦点转移（空态按钮 → 节点库输入框、`/` → 筛选框）只有这一个口子：
 * 走 testid 而不是 ref，是因为它是一个**冻结的稳定钩子**（跨组件的契约），
 * 不依赖另一个组件的内部结构。
 */
function focusTestId(testId: string): void {
  const target = window.document.querySelector(`[data-testid="${testId}"]`)
  if (target instanceof HTMLElement) target.focus()
}

/**
 * 画布本体。
 * @param props - 槽位 props + 注入的 rpc + 词典。
 */
export function CanvasView(props: CanvasViewProps): React.JSX.Element {
  const { rpc, t } = props
  const [state, dispatch] = useReducer(reduce, initialCanvasState)
  const [catalog, setCatalog] = useState<GraphListResponse | null>(null)
  const [plan, setPlan] = useState<{ text: string; blocked: boolean; id: string } | null>(null)
  const [planTab, setPlanTab] = useState<'dispatch' | 'full'>('dispatch')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [external, setExternal] = useState(false)
  const [conflict, setConflict] = useState<{ message: string; ids: string[] } | null>(null)
  const [flow, setFlow] = useState<ReactFlowInstance<FlowNode, FlowEdge> | null>(null)
  const [collapsed, setCollapsed] = useState<readonly string[]>(() => readCollapsed(safeStorage()))
  const [filter, setFilter] = useState('')
  /** 有没有东西正拖在画布上。**一次拖拽只变两次**，指针坐标不走 state（见 `onDragOver`）。 */
  const [dropActive, setDropActive] = useState(false)
  /** 快捷键说明是否展开。 */
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  /** 落点标记。`dragover` 里直接改它的 `style.transform`，绕开 React 渲染。 */
  const dropMarkerRef = useRef<HTMLDivElement>(null)
  const lastEditAt = useRef<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  /** 最新的 `schedule`（`save` 要用它补排一次，但 `schedule` 依赖 `save` ⇒ 破环靠 ref）。 */
  const scheduleRef = useRef<((reason: 'edit' | 'settled' | 'leaving' | 'manual') => void) | null>(
    null,
  )

  /**
   * 新节点落点：看得见的地方优先（视口中心）。
   *
   * 拿到中心之后还要过一道 `avoidOverlap`："点一下节点库条目"这个动作没有指针位置，
   * 连点两次就会得到**逐像素重合的两个节点**——上面那个看得见，下面那个既看不见也点不中，
   * 界面还不会说“这里有两个”（独立审计 P3）。拖放进来的落点不走这里，那是用户明确指的。
   */
  const newPosition = useCallback((): Point => {
    const document = stateRef.current.document
    const rect = canvasRef.current?.getBoundingClientRect()
    if (flow !== null && rect !== undefined) {
      const center = flow.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      })
      if (document === null) return center
      /*
       * 把**可见区**交给避让：候选会被夹进这个区间，于是新节点一定完整落在画布上。
       *
       * 为什么区间是**不对称**的：`node.position` 是卡片的**左上角**。一张宽 `W` 的卡
       * 要完整落在以 `center` 为中心、半宽 `halfW` 的可见区里，左上角得落在
       * `[center.x - halfW, center.x + halfW - W]`——右边界要多减一个卡宽。
       * （第一版写成了对称的 `halfW - W/2`，两头都错：既拒掉合法的左向槽位、
       * 又在右向放松半张卡，最后把避让逼成"永远放中心"。）
       */
      const { zoom } = flow.getViewport()
      const safeZoom = zoom > 0 ? zoom : 1
      const halfW = rect.width / (2 * safeZoom)
      const halfH = rect.height / (2 * safeZoom)
      return avoidOverlap(document, center, 4, {
        minX: -halfW,
        maxX: Math.max(-halfW, halfW - NODE_FOOTPRINT_W),
        minY: -halfH,
        maxY: Math.max(-halfH, halfH - NODE_FOOTPRINT_H),
      })
    }
    return nextPosition(document?.nodes.length ?? 0)
  }, [flow])

  /** 落盘（唯一的写路径）。`force` = 「保留我的」（冲突也写）。 */
  const save = useCallback(
    async (force = false): Promise<void> => {
      const current = stateRef.current
      if (current.name === null || current.document === null || current.blocked) return
      /*
       * **到点再判一次有没有要写的**。`decideSave` 那一层判的是"该不该排期"，
       * 那时 `stateRef` 刚被 `mutate` 推过一步（见 `mutate` 的注释）；而防抖期间用户
       * 可能又把改动撤回去了（比如拖到同一个位置、或撤销回基线）。真正写之前用**此刻**
       * 的 state 再问一遍，能拦下这种空写——"只在改动块写盘"这条才真的成立。
       * `force`（冲突里选「保留我的」）不受这条限制。
       */
      if (!force && !needsSave(current)) return
      // 这次保存对应哪个版本：保存期间又来改动的话，回读就不能换掉本地文档。
      const seqAtStart = current.editSeq
      dispatch({ type: 'saveStarted', seq: seqAtStart })
      try {
        const result = await rpc.call('graph/save', {
          name: current.name,
          document: current.document,
          baseHash: current.baseHash,
          ...(force ? { force: true } : {}),
        })
        dispatch({ type: 'saveSucceeded', baseHash: result.hash })
        /*
         * 这里**故意不再** `historyBreak`。
         *
         * 曾经在这里断一次，理由是"这一轮连续编辑到此为止"。但保存跟着 400ms 防抖跑，
         * 一次拖拽（每帧一个 `moveNode`）很容易被一笔中途落地的写切断合并键，于是
         * "一次拖拽 = 一次撤销"退化成"一次 Ctrl+Z 只退到中间某一帧"——实测停在第一帧的
         * 位移上，8 次跑里红了 2 次。
         *
         * 合并链该由"**一次交互结束**"来断（拖拽松手 `onNodeDragStop`、输入失焦 `focusout`），
         * 不是由"恰好写了一次盘"来断——后者是时机，不是语义。
         */
        setConflict(null)
        setExternal(false)
        // 写完回读一次：既刷新校验面板（prompt 刚补上，编译级问题就该消失），
        // 又让本地文档与磁盘上**合并后**的结果对齐。
        //
        // 回读**单独** try：它失败不等于保存失败。两者合在一个 try 里的话，
        // 一次读失败会被报成"保存出错"（假的），而且下面那句补排会被 catch 吃掉——
        // 保存期间来的改动就再也没人排期了（真实的数据丢失路径）。
        let untouched = false
        try {
          const fresh = await rpc.call('graph/load', { name: current.name })
          untouched = stateRef.current.editSeq === seqAtStart
          dispatch({
            type: 'refreshed',
            baseHash: fresh.hash,
            problems: fresh.problems,
            warnings: fresh.warnings,
            // **保存期间又来改动就不换文档**——否则磁盘版本会静默吃掉在途改动。
            ...(untouched ? { document: fresh.document } : {}),
          })
        } catch {
          // 回读只是"顺手刷新"：失败就维持本地状态，**不能**把它当成保存失败。
          // 但补排依旧要做——不然在途改动就永远不落盘了。
          untouched = stateRef.current.editSeq === seqAtStart
        }
        // 保存期间的改动没赶上这次写（也在途时 `decideSave` 会拒绝重入），补排一次。
        if (!untouched) scheduleRef.current?.('edit')
      } catch (error) {
        if (codeOf(error) === 'conflict') {
          setConflict({ message: messageOf(error), ids: conflictIdsOf(error) })
          dispatch({ type: 'saveFailed', message: t('error.conflict') })
          return
        }
        dispatch({ type: 'saveFailed', message: messageOf(error) })
      }
    },
    [rpc, t],
  )

  /** 排一次防抖写；离开时立刻写。 */
  const schedule = useCallback(
    (reason: 'edit' | 'settled' | 'leaving' | 'manual'): void => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
      const decision = decideSave({
        state: stateRef.current,
        reason,
        debounceMs: DEBOUNCE_MS,
        lastEditAt: lastEditAt.current,
        now: Date.now(),
      })
      if (decision.kind === 'none') return
      if (decision.kind === 'now') {
        void save()
        return
      }
      timer.current = setTimeout(() => {
        void save()
      }, decision.delayMs)
    },
    [save],
  )
  scheduleRef.current = schedule

  /**
   * 改一下文档：标时间、改状态、排一次防抖写。
   *
   * ⚠️ **`stateRef.current` 必须在这里手动推到"改完之后"的样子**，不能等渲染。
   * `dispatch` 是异步的（React 18 在事件处理函数返回后才重渲染），而 `schedule` 紧接着
   * 同步执行——它读 `stateRef.current` 只会读到**旧** state。旧 state 里 `dirty` 还是
   * `false`（上一次保存刚清过），于是 `decideSave` 走 `needsSave` 不成立那一支，
   * 返回 `{kind:'none'}`，**这次改动的排期整个被丢掉**。
   *
   * 后果是真实的数据丢失："点一下节点库条目"只发一次 `mutate`，之后没有别的改动，
   * 于是那个节点永远不会落盘（顶栏就一直停在「有未保存的改动」）——真浏览器验收
   * 抓到了这个（拖进来的节点在界面上在、`graph/load` 里不在）。拖拽之所以看着没事，
   * 是因为它每帧都发一次 `mutate`，第二次就赶上了已经变脏的 state。
   *
   * 用 `reduce` 预算一步是安全的：它是纯函数、确定性，且 React 会把同一个 action
   * 作用在真实的上一个 state 上，得到同一个结果（同一 tick 里多次 `mutate` 也同序累加）。
   */
  const mutate = useCallback(
    (action: Parameters<typeof reduce>[1]): void => {
      lastEditAt.current = Date.now()
      stateRef.current = reduce(stateRef.current, action)
      dispatch(action)
      schedule('edit')
    },
    [schedule],
  )

  /**
   * 断开历史合并链：下一次改动必定新开一条。
   *
   * 拖拽结束、输入失焦、保存成功三处都要发：不补的话一次拖拽会拆成一帧一条，
   * 一次连续打字也会拆成一个字符一条，撤销栈会瞬间被冲干净。
   */
  const breakHistory = useCallback((): void => {
    dispatch({ type: 'historyBreak' })
  }, [])

  /**
   * 输入类控件失焦 = 一次"连续输入"结束：断开合并链，下一次改动必开新条目。
   *
   * 挂原生 `focusout` 而不是 JSX 的 `onBlur`：属性面板的输入框归另一位实现者，
   * 契约里没有"失焦回调"这个口子，而 `focusout` 会从任意后代冒上来。
   * 挂在根节点上还顺带覆盖了节点库的输入框（对它们而言是空操作，无害）。
   */
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const onFocusOut = (event: FocusEvent): void => {
      if (isTypingTarget(event.target)) breakHistory()
    }
    root.addEventListener('focusout', onFocusOut)
    return () => root.removeEventListener('focusout', onFocusOut)
  }, [breakHistory])

  /**
   * 点画布就把键盘焦点收进画布容器。
   *
   * 节点和边自己不可靠地拿焦点，不这样做的话 `Ctrl+Z` / `Delete` / `Esc` 会落到会话页别处。
   * 用**原生** mousedown：React Flow 在自己的按下处理里可能 `stopPropagation`，
   * 走 React 合成事件有被截断的风险；原生监听在容器上先于宿主根节点触发，截不断。
   * 挂在根节点（而不是画布）是为了让监听活过"只读错误态"那次重挂载。
   *
   * 判类型用 `Element` 而不是 `HTMLElement`：**边是 SVG**（`<path>` / `<g>`），
   * 不是 `HTMLElement`。早先卡在 `HTMLElement` 上，于是"点一条边"这条路上根本不收焦点，
   * 紧接着的 `Delete` / `Esc` 全部落到 `<body>` 上——快捷键处理器挂在视图根节点上，
   * 事件从 body 出发永远冒不到它。选中一条边之后按 `Delete` 删不掉、按 `Esc` 也取消不了，
   * 就是这一条造成的（真浏览器验收第 29c-6 步实测到的）。
   */
  useEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      // 按钮与输入框要自己留着焦点，别抢。
      if (target.closest('button, input, textarea, select') !== null) return
      const canvas = canvasRef.current
      if (canvas === null || !canvas.contains(target)) return
      canvas.focus()
    }
    root.addEventListener('mousedown', onMouseDown)
    return () => root.removeEventListener('mousedown', onMouseDown)
  }, [])

  // 离开前 flush：卸载 + 页面隐藏两条路都要走（浏览器不保证 onbeforeunload 里能发 RPC）。
  useEffect(() => {
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') schedule('leaving')
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      schedule('leaving')
    }
  }, [schedule])

  const refreshCatalog = useCallback(async (): Promise<void> => {
    try {
      setCatalog(await rpc.call('graph/list', {}))
    } catch (error) {
      dispatch({ type: 'loadFailed', message: messageOf(error) })
    }
  }, [rpc])

  useEffect(() => {
    void refreshCatalog()
  }, [refreshCatalog])

  /**
   * 切图之前把当前图**待写的改动冲掉**。
   *
   * 不冲会**静默丢改动**：改动 → 排了一个 400ms 的防抖写 → 在这 400ms 里用图选择器切走
   * → `loaded` 把 `dirty` 清成 false、本地文档整份换掉 ⇒ 那次改动**再也没人去写**，
   * 而且界面上一点提示都没有（状态还显示“就绪”）。实测复现：加一个节点后立刻切图再切回，
   * 节点在 DOM 与 `graph/load` 里都没了。
   *
   * （“切走 → 立即写”当时只盖住了卸载/页面隐藏两条路，
   * “在视图内换图”这条没盖——“切走”不只指离开这个 tab。）
   *
   * 写两轮是因为“切图的那一瞬已经有一笔写在途”这种情形：等它落地后可能又有新的脏
   * （在途期间的改动会被 `saveSucceeded` 正确地保留成脏），得再写一次。
   * 上限 4 轮，写不完也不能把切图无限拖住。
   */
  const flushBeforeSwitch = useCallback(async (): Promise<void> => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const current = stateRef.current
      if (current.status === 'saving') {
        await new Promise((resolve) => setTimeout(resolve, 150))
        continue
      }
      if (!needsSave(current)) return
      await save()
    }
  }, [save])

  const open = useCallback(
    async (name: string): Promise<void> => {
      // 换图之前先冲掉当前图待写的改动（同一个图名不算换图：重命名/重新加载不走这里）。
      const current = stateRef.current.name
      if (current !== null && current !== name) await flushBeforeSwitch()
      dispatch({ type: 'loadStarted' })
      try {
        const loaded = await rpc.call('graph/load', { name })
        const blocking = loaded.problems.filter((problem) => problem.level === 'save')
        if (blocking.length > 0) {
          // 保存级破损 ⇒ **只读错误态**：留着原文给人改，不写盘。
          dispatch({
            type: 'loadFailed',
            message: blocking.map((problem) => problem.message).join('；'),
            ...(loaded.raw === undefined ? {} : { raw: loaded.raw }),
            problems: loaded.problems,
          })
          return
        }
        setExternal(false)
        setConflict(null)
        dispatch({
          type: 'loaded',
          name: loaded.name,
          document: loaded.document,
          baseHash: loaded.hash,
          problems: loaded.problems,
          warnings: loaded.warnings,
        })
        // A16：打开成功才写"上次打开的图"，失败的图名不该留在这里当地雷。
        writeStored(LAST_GRAPH_KEY, loaded.name)
      } catch (error) {
        dispatch({ type: 'loadFailed', message: messageOf(error) })
      }
    },
    [rpc, flushBeforeSwitch],
  )

  /**
   * 挂载后自动进图（A16）。
   *
   * 优先恢复上次打开的那张：只要它还在目录里。旧规则（"恰好一张才自动开"）
   * 只在没有记忆可用时兜底：**多张图是常态，单张才是特例**，按旧规则重挂载就是空画布。
   */
  useEffect(() => {
    if (state.name !== null || catalog === null) return
    const last = readLastGraph()
    if (last !== null && catalog.workflows.some((entry) => entry.name === last)) {
      void open(last)
      return
    }
    const first = catalog.workflows[0]
    if (catalog.workflows.length === 1 && first !== undefined) void open(first.name)
  }, [catalog, state.name, open])

  const analysis = useMemo(
    () => (state.document === null ? null : analyzeGraph(state.document)),
    [state.document],
  )

  /** 超 `maxNodes` 的判据来自 host：`list` 里那张图的节点数与 `maxNodes` 比。 */
  const maxNodes = catalog?.limits.maxNodes ?? Number.POSITIVE_INFINITY
  const overLimit = state.document !== null && state.document.nodes.length > maxNodes

  /**
   * 位置补位：只在**没摆过**的节点上跑，并且**回写**——补位是真实改动，
   * 由防抖写落盘。跑一次就够了：写完之后文档里就没有 `(0,0)` 了。
   */
  const unplacedKey = useMemo(() => {
    if (state.document === null) return ''
    return state.document.nodes
      .filter((node) => node.position.x === 0 && node.position.y === 0)
      .map((node) => node.id)
      .sort(byId)
      .join(',')
  }, [state.document])

  useEffect(() => {
    const document = stateRef.current.document
    if (document === null || analysis === null || unplacedKey === '') return
    const positions =
      document.nodes.length > maxNodes
        ? gridFallback(document)
        : layoutMissing(document, analysis.batches)
    if (positions.size === 0) return
    mutate({ type: 'setPositions', positions: Object.fromEntries(positions) })
  }, [unplacedKey, analysis, maxNodes, mutate])

  /** 卡片语气：有错误级问题 ⇒ 红、只有警告 ⇒ 黄、干净 ⇒ 绿。 */
  const toneByNode = useMemo(() => {
    const tone = new Map<string, 'ok' | 'warn' | 'invalid'>()
    for (const problem of state.problems) {
      if (problem.node === undefined) continue
      const key = idKey(problem.node)
      const severe = problem.level === 'save' || problem.level === 'compile'
      const next = severe ? 'invalid' : 'warn'
      if (tone.get(key) === 'invalid') continue
      tone.set(key, next)
    }
    return tone
  }, [state.problems])

  /** 复制一个节点：新 id 加序号、位置右下偏移 24px、**不带边**（边是两节点之间的事）。 */
  const duplicateById = useCallback(
    (id: string): void => {
      const document = stateRef.current.document
      if (document === null) return
      const copy = duplicateNode(document, id)
      if (copy === null) return
      // 走 `addNode` 那条统一路径：`duplicateNode` 只给新节点的参数，
      // 选中、脏标记、撤销栈这些事都归 `addNode` 管，不另开一条入口。
      mutate({ type: 'addNode', id: copy.id, data: copy.data, position: copy.position })
    },
    [mutate],
  )

  const duplicateSelected = useCallback((): void => {
    const selected = stateRef.current.selected
    if (selected !== null) duplicateById(selected)
  }, [duplicateById])

  /**
   * 删掉选中的节点。
   *
   * 末尾把焦点收回画布：工具条那个按钮点完之后会因为 `selected` 没了而变 `disabled`，
   * 焦点会掉到 `<body>`——而快捷键处理器在视图内（事件冒泡不到），于是「删完按 `Ctrl+Z`
   * 撤回来」这条最自然的路径会没反应。收回焦点后它才成立。
   */
  const deleteSelected = useCallback((): void => {
    const selected = stateRef.current.selected
    if (selected === null) return
    mutate({ type: 'deleteNode', id: selected })
    canvasRef.current?.focus()
  }, [mutate])

  /**
   * 删掉选中的边（`Delete` / `Backspace`）。
   *
   * 删边走的是 `disconnect`——它要 `source` / `target` / `when` 三个量，而选中的只有一个
   * id，所以在这里从文档里把它找回来。选中态由 reducer 在 `disconnect` 里清掉。
   * 末尾把焦点收回画布：与 `deleteSelected` 同一个理由（不然接着按 `Ctrl+Z` 没反应）。
   */
  const deleteSelectedEdge = useCallback((): void => {
    const current = stateRef.current
    if (current.document === null || current.selectedEdge === null) return
    const edge = current.document.edges.find((candidate) => candidate.id === current.selectedEdge)
    if (edge === undefined) return
    mutate({
      type: 'disconnect',
      source: edge.source,
      target: edge.target,
      ...(edge.data?.when === undefined ? {} : { when: edge.data.when }),
    })
    canvasRef.current?.focus()
  }, [mutate])

  /**
   * 节点卡的操作簇。
   *
   * 只在**节点集合**变化时重建：拖一个节点会每帧改文档，若把回调跟着文档重建，
   * 全图每张卡每帧都会拿到新 `data`，多出来的重渲染是白给的。
   */
  const nodeIdsKey = useMemo(
    () =>
      (state.document?.nodes ?? [])
        .map((node) => node.id)
        .sort(byId)
        .join('\u0000'),
    [state.document],
  )

  const cardActions = useMemo(() => {
    const actions = new Map<string, CardData['actions']>()
    if (nodeIdsKey !== '') {
      for (const id of nodeIdsKey.split('\u0000')) {
        actions.set(id, {
          duplicate: () => duplicateById(id),
          // 同上：删完把焦点收回画布。这里是卡片上的按钮，它自己会因为节点没了而随卡一起
          // 从 DOM 里消失，焦点同样会掉到 `<body>`。
          remove: () => {
            mutate({ type: 'deleteNode', id })
            canvasRef.current?.focus()
          },
        })
      }
    }
    return actions
  }, [nodeIdsKey, duplicateById, mutate])

  /** 图 → React Flow 的节点（每次渲染现算；磁盘上不存 React Flow 的形状）。 */
  const flowNodes = useMemo<FlowNode<CardData>[]>(() => {
    const document = state.document
    if (document === null || analysis === null) return []
    const fallback = overLimit ? gridFallback(document) : layoutMissing(document, analysis.batches)
    return document.nodes.map((node) => {
      const prompt = node.data.prompt
      const invalid = prompt === undefined || prompt === ''
      const tone = toneByNode.get(idKey(node.id))
      const data: CardData = {
        label: displayName(node.id, node.data.label),
        upstream: (analysis.predecessors.get(node.id) ?? []).length,
        downstream: (analysis.successors.get(node.id) ?? []).length,
        ...(node.data.output === undefined ? {} : { output: node.data.output }),
        state: invalid || tone === 'invalid' ? 'invalid' : tone === 'warn' ? 'warn' : 'ok',
        unplaced: overLimit && (node.position.x === 0 || node.position.y === 0),
        invalidText: t('node.invalid'),
        unplacedText: t('canvas.unplaced'),
        actions: cardActions.get(node.id) ?? NO_CARD_ACTIONS,
        duplicateText: t('node.duplicate'),
        removeText: t('node.remove'),
        actionsText: t('node.actions'),
      }
      return {
        id: node.id,
        type: 'wfNode',
        position: fallback.get(node.id) ?? node.position,
        /*
         * 选中环由**我们的选中态**说了算。
         *
         * React Flow 把选中状态存在自己的内部节点上，而且只在"用户对象还是同一个引用"时
         * 才保留它（`adoptUserNodes` 的 `checkEquality`）。我们每次改文档都会重建这整个数组
         * ⇒ 内部节点被重建 ⇒ `selected` 回到 `undefined` ⇒ **选中的节点环自己消失了**，
         * 而右栏还写着那个节点的属性（两处说法不一致）。
         *
         * 所以显式带上 `selected`：选中是哪一边改的（点节点 / 点边 / 点空白 / Esc）最后都
         * 落到状态机上，由状态机把"谁被选中"单方向地告诉画布。
         */
        selected: node.id === state.selected,
        data,
      }
    })
  }, [state.document, state.selected, analysis, toneByNode, overLimit, t, cardActions])

  const flowEdges = useMemo<FlowEdge[]>(() => {
    if (state.document === null || analysis === null) return []
    return [...state.document.edges]
      .sort((a, b) => byId(a.id, b.id))
      .map((edge) => {
        const when = edge.data?.when
        const back = analysis.backEdges.has(edge.id)
        return {
          id: edge.id,
          source: edge.source,
          target: edge.target,
          label: when ?? '',
          // 可点区域比描出来的线宽得多：点边选中不必像素级对准（见常量注释）。
          interactionWidth: EDGE_INTERACTION_WIDTH,
          /*
           * 同节点那一侧：选中高亮由我们的 `selectedEdge` 驱动，不靠 React Flow 的内部状态。
           * 在这条路径上尤其要紧：改 `when` 会换掉边的 id，内部选中会立刻失效，
           * 而右栏那块编辑区还开着（reducer 把选中搬到了新 id 上）。
           */
          selected: edge.id === state.selectedEdge,
          /*
           * 三个语气类是**可叠加**的，不是三选一。
           *
           * 早先写成 `back ? edgeBack : when==='fail' ? edgeFail : edge`——于是
           * `A->B#fail` 再加上 `B->A` 成环时，那条 fail 边同时是回边，只套上了虚线、
           * **丢掉危险色**。而"fail 就回退重试"正是最常见的闭环写法，红色语义恰好在
           * 这一格被虚线吃掉（真浏览器验收量到：`dash=5px,4px` 但 stroke 是普通描边色）。
           *
           * 现在叠着用，两条规则管的是**不同属性**（虚线管 `stroke-dasharray`、fail 管 `stroke`），
           * 所以叠加不会互相覆盖。
           */
          className: [css.edge, back ? css.edgeBack : '', when === 'fail' ? css.edgeFail : '']
            .filter((name) => name !== '')
            .join(' '),
          /*
           * 箭头。没有它就只能靠节点卡上那行 `↑0 ↓1` 反推谁指向谁——独立审计 P16
           * 实测画布上的边是一条无箭头线，方向完全看不出来。
           *
           * `color` 传 CSS 变量字符串是**有意**的：React Flow 把它写进箭头
           * `<polyline>` 的**内联样式**（`style={{stroke, fill}}`），而 `var()` 在内联样式里
           * 按元素继承的自定义属性求值——所以箭头跟着主题与边的语气色走，
           * 不需要在 JS 里读一遍计算样式（那还得跟着主题变化重算）。
           */
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 12,
            height: 12,
            color: when === 'fail' ? 'var(--wl-danger)' : 'var(--wl-border-strong)',
          },
        }
      })
  }, [state.document, state.selectedEdge, analysis])

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]): void => {
      for (const change of changes) {
        switch (change.type) {
          case 'position':
            if (change.position !== undefined) {
              // 同一个节点的连续移动由状态机的合并键并成一条历史：一次拖拽 = 一次撤销。
              mutate({ type: 'moveNode', id: change.id, position: change.position })
            }
            break
          case 'remove':
            mutate({ type: 'deleteNode', id: change.id })
            break
          case 'select':
            if (change.selected === true) dispatch({ type: 'select', node: change.id })
            break
          default:
            break
        }
      }
    },
    [mutate],
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange<FlowEdge>[]): void => {
      for (const change of changes) {
        if (change.type === 'select') {
          /*
           * React Flow 自己也会发 select 变更（点边、框选、点空白后的收尾）。
           *
           * **只认"选中"，不认"取消选中"**：一次点边会先给旧边发 `selected: false`、
           * 再给新边发 `selected: true`，跟着 false 走会在中间态把刚选上的边又清掉。
           * "取消选中"有更明确的来源（点空白、点节点），不靠这个顺序里的半边。
           */
          if (change.selected === true) dispatch({ type: 'select', edge: change.id })
          continue
        }
        if (change.type !== 'remove') continue
        const edge = stateRef.current.document?.edges.find(
          (candidate) => candidate.id === change.id,
        )
        if (edge === undefined) continue
        mutate({
          type: 'disconnect',
          source: edge.source,
          target: edge.target,
          ...(edge.data?.when === undefined ? {} : { when: edge.data.when }),
        })
      }
    },
    [mutate],
  )

  const selected =
    state.document !== null && state.selected !== null
      ? findNode(state.document, state.selected)
      : undefined

  /** 当前选中的边 id（`Delete` 要它判"有没有边可删"；与节点选中态互斥，最多一个非空）。 */
  const selectedEdge = state.selectedEdge

  /**
   * 按 `idKey` 索引的显示名表。
   *
   * 右栏不论是"节点那张出入边列表"还是"边编辑区"，都要写「显示名（id）」，与画布
   * 卡片同一口径。显示名在这里查一次带上，**不把整份文档传进右栏**——右栏的入参只管
   * "这一条边 / 这一个节点是什么"。按 `idKey` 索引：图内的身份判定就是大小写不敏感那一套。
   */
  const labelByKey = useMemo(() => {
    const labels = new Map<string, string>()
    for (const node of state.document?.nodes ?? []) {
      labels.set(idKey(node.id), node.data.label ?? '')
    }
    return labels
  }, [state.document])

  /** 选中节点的入/出边视图（另一端的 id + 显示名 + 是否回边）。 */
  const edgeViews = useMemo<{ incoming: EdgeView[]; outgoing: EdgeView[] }>(() => {
    const document = state.document
    if (document === null || selected === undefined || analysis === null) {
      return { incoming: [], outgoing: [] }
    }
    const key = idKey(selected.id)
    const incoming: EdgeView[] = []
    const outgoing: EdgeView[] = []
    for (const edge of [...document.edges].sort((a, b) => byId(a.id, b.id))) {
      const back = analysis.backEdges.has(edge.id)
      if (idKey(edge.target) === key) {
        incoming.push({
          edge,
          other: edge.source,
          otherLabel: labelByKey.get(idKey(edge.source)) ?? '',
          back,
        })
      }
      if (idKey(edge.source) === key) {
        outgoing.push({
          edge,
          other: edge.target,
          otherLabel: labelByKey.get(idKey(edge.target)) ?? '',
          back,
        })
      }
    }
    return { incoming, outgoing }
  }, [state.document, selected, analysis, labelByKey])

  /**
   * 选中边给右栏的呈现信息（两端各自的显示名 + 是否回边）。
   *
   * 选中态由画布发起：点在节点上就是节点、点在边上就是这条边、点空白就两个都不选，
   * 右栏只是把当前的选中反映出来。
   */
  const edgeEditor = useMemo<EdgeEditorView | undefined>(() => {
    const document = state.document
    if (document === null || state.selectedEdge === null) return undefined
    const edge = document.edges.find((candidate) => candidate.id === state.selectedEdge)
    if (edge === undefined) return undefined
    return {
      edge,
      sourceLabel: labelByKey.get(idKey(edge.source)) ?? '',
      targetLabel: labelByKey.get(idKey(edge.target)) ?? '',
      back: analysis?.backEdges.has(edge.id) ?? false,
    }
  }, [state.document, state.selectedEdge, labelByKey, analysis])

  /** 未选中节点时右栏的整图概览（`planId` 空串表示还没编译过，由面板自己显示占位）。 */
  const graphSummary = useMemo<GraphSummary>(
    () => ({
      name: state.name ?? '',
      nodes: state.document?.nodes.length ?? 0,
      edges: state.document?.edges.length ?? 0,
      batches: analysis?.batches.length ?? 0,
      planId: plan?.id ?? '',
    }),
    [state.name, state.document, analysis, plan],
  )

  const buildPlan = useCallback(
    async (full: boolean): Promise<void> => {
      const name = stateRef.current.name
      if (name === null || stateRef.current.blocked) return
      try {
        const result = await rpc.call('plan/build', { name, full })
        setPlan({ text: result.plan, blocked: result.problems.length > 0, id: result.planId })
      } catch (error) {
        setPlan({ text: messageOf(error), blocked: true, id: '' })
      }
    },
    [rpc],
  )

  useEffect(() => {
    if (state.name !== null && !state.blocked) void buildPlan(planTab === 'full')
  }, [state.name, state.blocked, planTab, buildPlan])

  // 焦点检查：只做提示，**不自动重载**——正看着的图突然自己变了更糟。
  useEffect(() => {
    if (state.name === null || state.blocked) return
    const onFocus = (): void => {
      const current = stateRef.current
      if (current.name === null) return
      void rpc
        .call('graph/load', { name: current.name })
        .then((fresh) => {
          if (fresh.hash !== current.baseHash) setExternal(true)
        })
        .catch(() => {
          // 图被删/改名了也不在这里改状态——下一次操作前会撞上 not_found。
        })
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [rpc, state.name, state.blocked])

  // ── 动作 ────────────────────────────────────────────────────

  /**
   * 加一个节点。`at` 是拖放落点（flow 坐标）；不给就落在视野中心。
   * 落点坐标的归一化在 `withNewNode` 里做，这里不重复。
   */
  const addNode = useCallback(
    (base: string, data: NodeData, at?: Point): void => {
      const document = stateRef.current.document
      if (document === null) return
      const id = uniqueNodeId(document, base)
      mutate({ type: 'addNode', id, data, position: at ?? newPosition() })
      dispatch({ type: 'select', node: id })
      // 加完把键盘焦点收到画布上：紧跟着的 Ctrl+Z / Delete / 拖节点都作用在画布上。
      // 焦点在输入框里时不抢：节点库的 id 输入框就是靠这条保住"敲一个再敲一个"。
      if (!isTypingTarget(window.document.activeElement)) canvasRef.current?.focus()
    },
    [mutate, newPosition],
  )

  const addPreset = useCallback(
    (preset: NodePreset, at?: Point): void => {
      addNode(
        preset.id,
        {
          label: t(preset.labelKey),
          prompt: t(preset.promptKey),
          ...(preset.output === undefined ? {} : { output: preset.output }),
        },
        at,
      )
    },
    [addNode, t],
  )

  const addTemplate = useCallback(
    (entry: TemplateEntry, at?: Point): void => {
      void rpc
        .call('graph/nodeTemplate', { name: entry.name })
        .then((result) => addNode(entry.name, result.data, at))
        .catch((error: unknown) => {
          dispatch({ type: 'loadFailed', message: messageOf(error) })
        })
    },
    [rpc, addNode],
  )

  /** 节点库的「新建空白节点」：id 由那一栏的输入框给，这里只管落点。 */
  const createBlank = useCallback(
    (base: string): void => {
      const id = base.trim()
      if (id === '') return
      /*
       * 名字不合法就**直接不动**，绝不走 `loadFailed`。
       *
       * `loadFailed` 在 reducer 里是**无条件** `blocked: true` 的（它表达的是"这张图读不出来"），
       * 拿它报一个输入校验错误会把整张图打进只读错误态、画布整块消失（独立审计 P1）。
       * 输入框那边自己会就地报红（它先跑 `checkName`），所以这里到不了；
       * 留着这一支只是把"非法输入 ≠ 图坏了"这条界线写在代码里。
       */
      if (checkName(id) !== null) return
      addNode(id, { prompt: '' })
    },
    [addNode],
  )

  const createGraph = useCallback(
    async (from?: string): Promise<void> => {
      try {
        const created = await rpc.call('graph/create', {
          name: from ?? 'untitled',
          ...(from === undefined ? {} : { from }),
        })
        await refreshCatalog()
        await open(created.name)
      } catch (error) {
        dispatch({ type: 'loadFailed', message: messageOf(error) })
      }
    },
    [rpc, refreshCatalog, open],
  )

  const commitRename = useCallback(
    async (from: string, to: string): Promise<void> => {
      setRenaming(null)
      if (to === '' || to === from) return
      const problem = checkName(to)
      if (problem !== null) {
        dispatch({ type: 'loadFailed', message: problem.message })
        return
      }
      try {
        await rpc.call('graph/rename', { name: from, to })
        await refreshCatalog()
        await open(to)
      } catch (error) {
        dispatch({ type: 'loadFailed', message: messageOf(error) })
      }
    },
    [rpc, refreshCatalog, open],
  )

  const removeGraph = useCallback(
    async (name: string): Promise<void> => {
      if (!window.confirm(t('confirm.remove'))) return
      try {
        await rpc.call('graph/delete', { name })
        dispatch({ type: 'closed' })
        setPlan(null)
        await refreshCatalog()
      } catch (error) {
        dispatch({ type: 'loadFailed', message: messageOf(error) })
      }
    },
    [rpc, refreshCatalog, t],
  )

  const reload = useCallback((): void => {
    const current = stateRef.current
    if (current.name === null) return
    if (current.dirty && !window.confirm(t('confirm.discard'))) return
    void open(current.name)
  }, [open, t])

  /** 显式重排：整图重算一次坐标，然后落盘。 */
  const relayout = useCallback((): void => {
    const document = stateRef.current.document
    if (document === null || analysis === null) return
    const positions = layoutAll(document, analysis.batches)
    mutate({ type: 'setPositions', positions: Object.fromEntries(positions) })
    setTimeout(() => flow?.fitView({ padding: 0.2, duration: 220 }), 0)
  }, [analysis, mutate, flow])

  /** 折叠组：受控状态在画布（它才是跨重挂载活下来的那一层），持久化跟着一起写。 */
  const toggleGroup = useCallback((groupKey: string): void => {
    setCollapsed((current) => {
      const next = current.includes(groupKey)
        ? current.filter((key) => key !== groupKey)
        : [...current, groupKey]
      // 写在 updater 里：持久化的值与新的 state 永远是同一份，不会错位。
      writeCollapsed(safeStorage(), next)
      return next
    })
  }, [])

  /** 「全部展开 / 全部收起」：组键清单由面板算好整份交过来，这里只负责存。 */
  const setCollapsedAll = useCallback((next: readonly string[]): void => {
    setCollapsed(next)
    writeCollapsed(safeStorage(), next)
  }, [])

  const focusLibraryFilter = useCallback((): void => {
    focusTestId('wl-library-filter')
  }, [])

  const focusNewNodeInput = useCallback((): void => {
    focusTestId('wl-new-node-input')
  }, [])

  const templateGroups = useMemo(
    () => groupNodeTemplates(catalog?.templates.nodes ?? []),
    [catalog],
  )

  // ── 拖放落点 ─────────────────────────────────────────

  /**
   * 拖拽经过画布。
   *
   * `dragover` 每秒约 60 次，所以指针坐标**绝不进 state**：那会每帧重渲染整张图。
   * 落点标记是常驻 DOM，这里只改它的 `transform`（不触发重排）；
   * state 只在"有没有东西拖在画布上"这一件事上变，一次拖拽就两次。
   */
  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    // 不 preventDefault 的话浏览器不认这里是放置区，`drop` 永远不会来。
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    const marker = dropMarkerRef.current
    if (marker !== null) {
      const rect = event.currentTarget.getBoundingClientRect()
      marker.style.transform = `translate3d(${event.clientX - rect.left}px, ${
        event.clientY - rect.top
      }px, 0)`
    }
    setDropActive(true)
  }, [])

  /**
   * 只在**真的离开画布容器**时才收高亮。
   *
   * 在子元素（节点、React Flow 的各个 pane）之间移动也会冒 `dragleave`，
   * 不比 `relatedTarget` 的话高亮就会一路闪。
   */
  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    const related = event.relatedTarget
    if (related instanceof Node && event.currentTarget.contains(related)) return
    setDropActive(false)
  }, [])

  /**
   * 松手。
   *
   * 解不出自家载荷（外部拖进来的文件、链接、别的东西）一律**静默丢掉**：
   * 画布不是通用放置区，接进来一个来历不明的对象只会造出非法节点。
   */
  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      event.preventDefault()
      setDropActive(false)
      const payload = readDragPayload(event.dataTransfer)
      if (payload === null || flow === null) return
      const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      if (payload.kind === 'preset') {
        const preset = NODE_PRESETS.find((candidate) => candidate.id === payload.id)
        if (preset !== undefined) addPreset(preset, at)
        return
      }
      const entry = (catalog?.templates.nodes ?? []).find(
        (candidate) => candidate.name === payload.name,
      )
      if (entry !== undefined) addTemplate(entry, at)
    },
    [flow, addPreset, addTemplate, catalog],
  )

  // ── 键盘 ────────────────────────────────────────────

  /**
   * 快捷键处理器挂在**根节点**上，不挂 window、也不只挂画布容器。
   *
   * 挂 window 会隔着整页抢宿主别的按键（搜索、切换视图）——不能那么干。
   * 只挂画布容器也不行：工具条（撤销/重做/布局/适应/删除选中）是画布的**兄弟**，
   * 点过它们之后焦点在按钮上，事件冒不到画布容器，于是「点了撤销，再按 `Ctrl+Z` 没反应」。
   * 挂在根节点上：视图内任何地方拿到焦点（工具条、节点库、属性面板）都能冒上来，
   * 同时又出不了这个视图。
   *
   * 输入框里一律让开（`isTypingTarget`）：在那里按 `Ctrl+Z` 该撤文本、按 `Delete` 该删字符。
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      const typing = isTypingTarget(event.target)
      const mod = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      // Esc 是"往下退一步"：取消选中（节点与边一起）。在输入框里则不管——那是输入框自己的事
      //（重命名输入框自己处理 Esc，属性面板的文本框里 Esc 不该把选中的节点/边掉）。
      if (key === 'escape') {
        if (!typing) dispatch({ type: 'select' })
        return
      }

      if (mod && !typing && (key === 'z' || key === 'y')) {
        // `Ctrl+Y` 与 `Ctrl+Shift+Z` 都是重做，`Ctrl+Z` 是撤销。
        event.preventDefault()
        mutate({ type: key === 'y' || event.shiftKey ? 'redo' : 'undo' })
        return
      }

      // 修饰键组合留给宿主（Ctrl+F 是浏览器查找之类），输入框里一切从简。
      if (mod || typing || event.altKey) return

      switch (key) {
        case 'delete':
        case 'backspace': {
          // 边与节点是互斥的选中态，所以最多只有一个非空；优先级只影响"都有"这种不该出现的状态。
          if (selectedEdge !== null) {
            event.preventDefault()
            deleteSelectedEdge()
            return
          }
          if (selected === undefined) return
          event.preventDefault()
          deleteSelected()
          return
        }
        case '/': {
          event.preventDefault()
          focusLibraryFilter()
          return
        }
        case 'f': {
          event.preventDefault()
          flow?.fitView({ padding: 0.2, duration: 220 })
          return
        }
        case 'l': {
          event.preventDefault()
          relayout()
          return
        }
        default:
          return
      }
    },
    [
      selected,
      selectedEdge,
      deleteSelected,
      deleteSelectedEdge,
      focusLibraryFilter,
      flow,
      relayout,
      mutate,
    ],
  )

  const blockedNotice = state.blocked
  return (
    <div
      className={css.root}
      data-testid="wl-root"
      data-workflow-lite-view=""
      ref={rootRef}
      /*
       * 有名字的 landmark，而不是一个裸 `<div>`。
       *
       * 两个理由：① 快捷键处理器挂在这一层（见 `onKeyDown` 的注释），而"可交互的元素必须
       * 有合适的 role"是条真规矩——与其用 `biome-ignore` 压掉，不如把它该有的语义写上；
       * ② 读屏软件现在能把这一整块念成"工作流 区域"，而不是一个匿名容器。
       */
      role="region"
      aria-label={t('tab.label')}
      onKeyDown={onKeyDown}
    >
      <datalist id="workflow-lite-when">
        {WHEN_PRESETS.map((preset) => (
          <option key={preset} value={preset} />
        ))}
      </datalist>

      <header className={css.bar}>
        {renaming === null ? (
          <>
            <span className={css.label}>{t('picker.label')}</span>
            <select
              className={ui.select}
              data-testid="wl-graph-select"
              value={state.name ?? ''}
              onChange={(event) => {
                const name = event.target.value
                if (name !== '') void open(name)
              }}
            >
              <option value="">{t('picker.empty')}</option>
              {(catalog?.workflows ?? []).map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}（{entry.nodeCount}）{entry.invalid === true ? ' ⚠' : ''}
                </option>
              ))}
            </select>
            <button type="button" className={ui.button} onClick={() => void createGraph()}>
              {t('picker.new')}
            </button>
            <select
              className={ui.select}
              value=""
              onChange={(event) => {
                const from = event.target.value
                if (from !== '') void createGraph(from)
              }}
            >
              <option value="">{t('picker.fromTemplate')}</option>
              {(catalog?.templates.workflows ?? []).map((entry) => (
                <option key={entry.name} value={entry.name} disabled={entry.invalid === true}>
                  {entry.name}
                  {entry.invalid === true ? ' ⚠' : ''}
                </option>
              ))}
            </select>
            {state.name !== null && (
              <>
                <button
                  type="button"
                  className={ui.button}
                  onClick={() => setRenaming(state.name ?? '')}
                >
                  {t('picker.rename')}
                </button>
                <button
                  type="button"
                  className={[ui.button, ui.buttonDanger].join(' ')}
                  onClick={() => void removeGraph(state.name ?? '')}
                >
                  {t('picker.remove')}
                </button>
              </>
            )}
            <button type="button" className={ui.button} onClick={reload}>
              {t('picker.reload')}
            </button>
          </>
        ) : (
          <>
            <span className={css.label}>{t('picker.rename')}</span>
            <input
              className={ui.input}
              defaultValue={renaming}
              // biome-ignore lint/a11y/noAutofocus: 重命名是就地编辑，光标就该落在这里
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') void commitRename(renaming, event.currentTarget.value)
                if (event.key === 'Escape') setRenaming(null)
              }}
            />
            <button
              type="button"
              className={ui.button}
              onClick={(event) => {
                const input = event.currentTarget.previousElementSibling
                void commitRename(renaming, input instanceof HTMLInputElement ? input.value : '')
              }}
            >
              {t('picker.renameCommit')}
            </button>
            <button type="button" className={ui.button} onClick={() => setRenaming(null)}>
              {t('picker.renameCancel')}
            </button>
          </>
        )}
        <span className={css.barSpacer} />
        <span
          className={[ui.status, statusTone(state)].join(' ')}
          data-testid="wl-status"
          role="status"
          aria-live="polite"
        >
          {t(statusKey(state))}
        </span>
        {state.error !== null && <span className={ui.problem}>{state.error}</span>}
      </header>

      {external && !blockedNotice && (
        <div className={ui.banner}>
          <span>{t('external.changed')}</span>
          <button type="button" className={ui.button} onClick={reload}>
            {t('picker.reload')}
          </button>
        </div>
      )}

      {conflict !== null && (
        <div className={[ui.banner, ui.bannerDanger].join(' ')}>
          <span>
            {t('conflict.prompt')} {conflict.ids.join('、')}
          </span>
          <button type="button" className={ui.button} onClick={() => void save(true)}>
            {t('conflict.keepMine')}
          </button>
          <button type="button" className={ui.button} onClick={reload}>
            {t('conflict.useDisk')}
          </button>
        </div>
      )}

      {blockedNotice && (
        <>
          <div className={[ui.banner, ui.bannerDanger].join(' ')}>
            <span>{t('blocked.readonly')}</span>
          </div>
          <div className={css.body}>
            <aside className={css.side}>
              <ValidationPanel t={t} problems={state.problems} onLocate={() => undefined} />
            </aside>
            <div className={css.canvasWrap}>
              <pre className={css.raw}>{state.raw ?? ''}</pre>
            </div>
            <aside className={css.inspector} data-testid="wl-inspector">
              <p className={ui.muted}>{t('panel.empty')}</p>
            </aside>
          </div>
        </>
      )}

      {!blockedNotice && (
        <div className={css.body}>
          <aside className={css.side}>
            <Palette
              t={t}
              disabled={state.document === null}
              presets={NODE_PRESETS}
              templates={templateGroups}
              collapsed={collapsed}
              onToggleGroup={toggleGroup}
              onSetCollapsed={setCollapsedAll}
              filter={filter}
              onFilter={setFilter}
              onAddPreset={addPreset}
              onAddTemplate={addTemplate}
              onCreateBlank={createBlank}
            />
            <ValidationPanel
              t={t}
              problems={state.problems}
              onLocate={(node) => {
                dispatch({ type: 'select', node })
                flow?.fitView({ nodes: [{ id: node }], padding: 0.5, duration: 220 })
              }}
            />
          </aside>

          <div className={css.canvasWrap}>
            <div className={css.canvasBar}>
              <button
                type="button"
                className={ui.button}
                data-testid="wl-undo"
                disabled={state.past.length === 0}
                title={t('toolbar.undoTitle')}
                onClick={() => mutate({ type: 'undo' })}
              >
                ↶ {t('toolbar.undo')}
              </button>
              <button
                type="button"
                className={ui.button}
                data-testid="wl-redo"
                disabled={state.future.length === 0}
                title={t('toolbar.redoTitle')}
                onClick={() => mutate({ type: 'redo' })}
              >
                ↷ {t('toolbar.redo')}
              </button>
              <span className={css.divider} />
              <button
                type="button"
                className={ui.button}
                data-testid="wl-layout"
                disabled={state.document === null}
                onClick={relayout}
              >
                {t('canvas.layout')}
              </button>
              <button
                type="button"
                className={ui.button}
                data-testid="wl-fit"
                disabled={flow === null}
                onClick={() => flow?.fitView({ padding: 0.2, duration: 220 })}
              >
                {t('canvas.fit')}
              </button>
              <span className={css.divider} />
              <button
                type="button"
                className={[ui.button, ui.buttonDanger].join(' ')}
                data-testid="wl-delete"
                disabled={selected === undefined}
                onClick={deleteSelected}
              >
                {t('canvas.deleteNode')}
              </button>
              <span className={css.barSpacer} />
              {overLimit && <span className={ui.problemWarn}>{t('canvas.noFitForHuge')}</span>}
              <button
                type="button"
                className={ui.iconButton}
                data-testid="wl-shortcuts"
                title={t('toolbar.shortcuts')}
                aria-label={t('toolbar.shortcuts')}
                aria-expanded={shortcutsOpen}
                aria-controls="workflow-lite-shortcuts"
                onClick={() => setShortcutsOpen((open) => !open)}
              >
                ?
              </button>
              {shortcutsOpen && (
                <div
                  id="workflow-lite-shortcuts"
                  className={css.shortcutPanel}
                  role="group"
                  aria-label={t('shortcut.title')}
                >
                  <div className={css.shortcutHead}>
                    <span>{t('shortcut.title')}</span>
                    <button
                      type="button"
                      className={ui.iconButton}
                      aria-label={t('shortcut.close')}
                      onClick={() => setShortcutsOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <dl className={css.shortcutList}>
                    {SHORTCUT_ROWS.map((row) => (
                      <div key={row.key} className={css.shortcutRow}>
                        <dt>{t(row.key)}</dt>
                        <dd>
                          {row.combos.map((combo) => (
                            <kbd key={combo} className={ui.kbd}>
                              {combo}
                            </kbd>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>

            {/* biome-ignore lint/a11y/noStaticElementInteractions: 画布是自定义复合控件（拖放落点 + 键盘入口），不是可点的静态元素 */}
            <div
              className={[css.canvas, dropActive ? css.canvasDrop : ''].join(' ')}
              data-testid="wl-canvas"
              ref={canvasRef}
              // tabIndex=-1：容器可被脚本/点击聚焦，从而收到键盘事件，但不进 Tab 序。
              tabIndex={-1}
              title={t('canvas.hint')}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <ReactFlow
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={NODE_TYPES}
                /*
                 * 关掉 React Flow 自带的水印（右下角那块）。
                 *
                 * 它是 `rgba(255,255,255,.5)` 的浅底色 + 一个 "React Flow" 链接，钉在画布右下角。
                 * 在深色主题下它就是一块发白的方块、看着像渲染坏了（用户截图圈出来的就是它）；
                 * 而且它是个可聚焦的 `<a>`，混在 Tab 序里（独立审计 P18 也记了这条）。
                 *
                 * **要知道的取舍**：xyflow 的文档把"去掉署名"和 Pro 订阅挂在一起（MIT 许可证本身
                 * 并不要求保留它）。这里按用户"这块是坏的"的判断关掉；若要恢复署名，
                 * 把这个 prop 去掉即可，或改成在"关于"里写一行。
                 */
                proOptions={{ hideAttribution: true }}
                onInit={setFlow}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={(connection) => {
                  if (connection.source === null || connection.target === null) return
                  mutate({
                    type: 'connect',
                    source: connection.source,
                    target: connection.target,
                  })
                }}
                onMoveEnd={(_event, viewport) => mutate({ type: 'setViewport', viewport })}
                onNodeDragStop={() => {
                  // 一次拖拽到此为止：断开合并，下一条改动是新的一条历史。
                  breakHistory()
                  schedule('settled')
                }}
                onNodeClick={(_event, node) => dispatch({ type: 'select', node: node.id })}
                /*
                 * 点边 = 选中这条边（`select` 的语义会把节点选中态一并放掉）。
                 *
                 * 还得**把键盘焦点收进画布**：边是 SVG，mousedown 之后浏览器会把焦点清成
                 * `<body>`（边那个 `<g>` 不被当成可聚焦元素），而快捷键处理器挂在视图根节点上——
                 * 事件从 body 出发永远冒不到它，于是"选中边之后按 Delete / Esc"会整个没反应。
                 * 在 click 里补一下焦点（而不是在 mousedown 里）：click 在浏览器的默认焦点
                 * 行为之后跑，不会被覆盖。
                 */
                onEdgeClick={(_event, edge) => {
                  dispatch({ type: 'select', edge: edge.id })
                  canvasRef.current?.focus()
                }}
                /* 点空白 = 节点与边都不选（右栏回到整图概览），同样把焦点收回画布。 */
                onPaneClick={() => {
                  dispatch({ type: 'select' })
                  canvasRef.current?.focus()
                }}
                fitView
              >
                <Background variant={BackgroundVariant.Dots} gap={16} />
                {/* 控件放右上：会话页底部浮着输入框，放左下会被盖住。 */}
                <Controls position="top-right" showInteractive={false} />
              </ReactFlow>
              {flowNodes.length === 0 && (
                <div className={css.canvasEmpty}>
                  <p className={css.canvasEmptyTitle}>{t('canvas.emptyTitle')}</p>
                  <p className={ui.muted}>{t('canvas.emptyBody')}</p>
                  <button
                    type="button"
                    className={ui.button}
                    data-testid="wl-empty-action"
                    onClick={focusNewNodeInput}
                  >
                    {t('canvas.emptyAction')}
                  </button>
                </div>
              )}
              {/*
                落点标记常驻 DOM，只在拖拽时可见：`dragover` 里要用 ref 直接改 transform，
                元素必须已经在树上，不能等 state 渲染出来才挂载。
              */}
              <div
                className={css.dropMarker}
                data-testid="wl-drop-marker"
                ref={dropMarkerRef}
                hidden={!dropActive}
              >
                {/* 文案跟着落点一起走：松手之前就告诉人"会放在这里"。 */}
                <span className={css.dropMarkerText}>{t('canvas.dropHere')}</span>
              </div>
            </div>
          </div>

          <aside className={css.inspector} data-testid="wl-inspector">
            <Inspector
              t={t}
              node={selected}
              /*
               * 边被选中时右栏换成边编辑区。这一项是新增的（不改变任何已有项的含义）。
               * `undefined` = 没选边，右栏回到"节点属性"或"整图概览"。
               */
              edge={edgeEditor}
              summary={graphSummary}
              problems={state.problems}
              incoming={edgeViews.incoming}
              outgoing={edgeViews.outgoing}
              onLabel={(value) => {
                if (selected === undefined) return
                // 同一个节点的连续输入由状态机的合并键并成一条（输入失焦时断链）。
                mutate({ type: 'setNodeData', id: selected.id, data: { label: value } })
              }}
              onOutput={(value) => {
                if (selected === undefined) return
                mutate({
                  type: 'setNodeData',
                  id: selected.id,
                  data: {
                    output: value === '' ? undefined : value === 'false' ? false : value,
                  },
                })
              }}
              onPrompt={(value) => {
                if (selected === undefined) return
                mutate({ type: 'setNodeData', id: selected.id, data: { prompt: value } })
              }}
              onDuplicate={duplicateSelected}
              onDelete={deleteSelected}
              onSetWhen={(view, to) =>
                mutate({
                  type: 'setEdgeWhen',
                  source: view.edge.source,
                  target: view.edge.target,
                  ...(view.edge.data?.when === undefined ? {} : { from: view.edge.data.when }),
                  ...(to === '' ? {} : { to }),
                })
              }
              onDisconnect={(view) =>
                mutate({
                  type: 'disconnect',
                  source: view.edge.source,
                  target: view.edge.target,
                  ...(view.edge.data?.when === undefined ? {} : { when: view.edge.data.when }),
                })
              }
            />
            <PlanBlock t={t} plan={plan} tab={planTab} onTab={setPlanTab} />
          </aside>
        </div>
      )}
    </div>
  )
}

/** 状态点的语气类。 */
function statusTone(state: CanvasState): string {
  if (state.blocked || state.status === 'error') return ui.statusError
  if (state.status === 'saving' || state.status === 'loading') return ui.statusBusy
  if (state.dirty) return ui.statusDirty
  if (state.status === 'saved' || state.status === 'idle') return ui.statusOk
  return ''
}
