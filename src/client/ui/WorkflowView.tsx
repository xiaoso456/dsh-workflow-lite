/**
 * dsh-workflow-lite — 工作流视图（会话页的一个 tab）：把发动机、画布与各块面板接起来。
 *
 * 版式：画布铺满，顶栏、步骤库、属性面板、缩放条浮在上面。属性面板只在选中东西时出现。
 * 键盘：快捷键挂在视图根上——视图内任何地方拿到焦点都能冒上来，又出不了这个视图
 * （挂 window 会隔着整页抢宿主的按键）。输入框里一律让开。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/WorkflowView
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { pickTemplateAppearance } from '../../shared/appearance.ts'
import { orderedInputs } from '../../shared/inputs.ts'
import { isInput, isResource, SETTINGS_CONFLICT_ID } from '../../shared/model.ts'
import { stepMemories } from '../../shared/presets.ts'
import type {
  InputAnswer,
  NodeData,
  Point,
  ResourceItem,
  WorkflowDocument,
} from '../../shared/types.ts'
import { addFromSource, addOrigin, duplicateEdit, memoryToggle } from '../app/addStep.ts'
import type { Desktop } from '../app/desktop.ts'
import { createHostAccess } from '../app/host.ts'
import { useMemories } from '../app/memories.ts'
import { afterPaint, revealNode } from '../app/reveal.ts'
import { type SessionBridge, useSessionRows } from '../app/sessions.ts'
import { useColorScheme, useThemeChoice } from '../app/theme.ts'
import { useLatestOutputs } from '../app/useDisplayStats.ts'
import { useMemoryPick } from '../app/useMemoryPick.ts'
import { useRuns } from '../app/useRuns.ts'
import { useWorkflow, type Workflow } from '../app/useWorkflow.ts'
import type { LocaleKey, NS, T } from '../i18n.ts'
import { boardTheme } from '../model/boardTheme.ts'
import { findNode, isDirty, type Selection } from '../model/editor.ts'
import { freeSpot, NODE_H, NODE_W, tidy } from '../model/layout.ts'
import { type LibraryFocus, type StepSource, starterGraph } from '../model/library.ts'
import { nodeTitle } from '../model/nodeName.ts'
import { themeLook, themeStyle } from '../model/themes.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { BoardThemeContext } from './boardFrame.ts'
import { type AddRequest, Canvas } from './Canvas.tsx'
import { ZoomDock } from './Dock.tsx'
import { HubDialog } from './HubDialog.tsx'
import { Icon } from './Icon.tsx'
import { InputsDialog } from './InputsDialog.tsx'
import { Inspector } from './Inspector.tsx'
import { Library } from './Library.tsx'
import { MemoryPicker } from './MemoryPicker.tsx'
import { ExitSeat, expectCanvasMove, SWITCH_HOLD_MS, useSwapHold, useViewGhost } from './motion.tsx'
import { PlanDialog } from './PlanDialog.tsx'
import { cx, ModalHostProvider } from './primitives.tsx'
import { QuickAdd } from './QuickAdd.tsx'
import { TextDialog } from './RunItemDialog.tsx'
import { RunView } from './RunView.tsx'
import { SettingsDialog } from './SettingsDialog.tsx'
import { StepPanel } from './StepPanel.tsx'
import css from './shell.module.css'
import { TipLayer } from './TipLayer.tsx'
import { NO_SLOTS, TopBar, type TopSlots } from './TopBar.tsx'
import ui from './ui.module.css'
import { VersionsDialog } from './VersionsDialog.tsx'

/** 客户端入口注入的业务面。 */
export interface WorkflowViewInjected {
  rpc: WorkflowLiteRpc
  /** 这个 tab 所在的会话。 */
  sessionId?: string
  /** 会话列表与发消息（「执行」用）；宿主缺相应服务时不给。 */
  sessions?: SessionBridge
  /** 用系统程序打开文件；宿主没有桌面能力时不给。 */
  desktop?: Desktop
}

/** 槽位给这个组件的完整 props。 */
export type WorkflowViewProps = PropsRuntime<'conversation.view'> &
  PropsLocale<typeof NS> &
  WorkflowViewInjected

/** 步骤库开没开（跨会话记住）。 */
const LIBRARY_KEY = 'workflow-lite.library'
/** 与 CSS 里的 `@container (max-width: 760px)` 同一个断点。 */
const NARROW = 760
const LIBRARY_W = 216
/** 属性面板宽度：与 CSS 的 `clamp(300px, 30cqw, 360px)` 同一个式子。 */
function inspectorWidth(viewWidth: number): number {
  return Math.min(360, Math.max(300, viewWidth * 0.3))
}
const GAP = 12

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/** 键盘事件是不是打在输入控件里（那里的 Ctrl+Z / Delete 属于文本）。 */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return TYPING.has(target.tagName) || target.isContentEditable
}

function readLibraryPref(): boolean | null {
  try {
    const value = window.localStorage.getItem(LIBRARY_KEY)
    return value === null ? null : value === 'open'
  } catch {
    return null
  }
}

function writeLibraryPref(open: boolean): void {
  try {
    window.localStorage.setItem(LIBRARY_KEY, open ? 'open' : 'closed')
  } catch {
    // 偏好持久化是尽力而为。
  }
}

/** 模板编辑的画布层：卸掉时（切到实例视图）留影子淡出；切工作流时压暗、点不了；内容没来先透明。 */
function CanvasLayer(props: {
  hidden: boolean
  dim: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useViewGhost(ref)
  return (
    <div
      ref={ref}
      className={css.canvas}
      data-hidden={props.hidden || undefined}
      data-dim={props.dim || undefined}
      {...(props.dim ? { inert: '' } : {})}
    >
      {props.children}
    </div>
  )
}

export function WorkflowView(props: WorkflowViewProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <Shell
        rpc={props.rpc}
        t={props.t as T}
        session={props.sessionId}
        openView={props.openView}
        {...(props.sessions === undefined ? {} : { sessions: props.sessions })}
        {...(props.desktop === undefined ? {} : { desktop: props.desktop })}
      />
    </ReactFlowProvider>
  )
}

/** 实例列表多久刷新一次（模型在会话里编译出新实例时，tab 里能看到提示）。 */
const RUNS_REFRESH_MS = 8000
/** 第一次加载最多藏多久（见 `booting`）。 */
const BOOT_VEIL_MS = 400

function Shell(props: {
  rpc: WorkflowLiteRpc
  t: T
  session: string | undefined
  /** 切到本会话的另一个 tab（执行后切到对话看它跑）。 */
  openView(view: string, focus: string): void
  sessions?: SessionBridge
  desktop?: Desktop
}): React.JSX.Element {
  const { t } = props
  const wf = useWorkflow(props.rpc, t)
  const { state, analysis } = wf
  const runs = useRuns(props.rpc, props.session)
  /** 正在看的工作流实例；`null` = 模板编辑。 */
  const [runId, setRunId] = useState<string | null>(null)
  const [hubOpen, setHubOpen] = useState(false)
  /** 从画布顶栏的「导出」进来：工作流中心直接停在「工作流」页、右栏是导出。 */
  const [hubExport, setHubExport] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  /**
   * 第一次加载完成之前先不显示：切回这个标签页时视图整个重新挂载，头几十毫秒是「加载中」的空壳
   * （顶栏只有一半、画布是空的），一闪就变样。画布摆好视角、量完卡片（线跟着定下来）才淡入完整的界面；
   * 慢了（超过 {@link BOOT_VEIL_MS}）再把加载中的样子亮出来，不让人对着空白等。
   */
  const [booting, setBooting] = useState(true)
  useEffect(() => {
    if (state.phase === 'broken') setBooting(false)
  }, [state.phase])
  /** 模板画布摆好了。本会话有当前实例时，实例列表一到就会换成实例视图，这时得等实例的画布摆好才算数。 */
  const [templateSettled, setTemplateSettled] = useState(false)
  useEffect(() => {
    if (templateSettled && runs.loaded && runs.current === undefined) setBooting(false)
  }, [templateSettled, runs.loaded, runs.current])
  useEffect(() => {
    const timer = window.setTimeout(() => setBooting(false), BOOT_VEIL_MS)
    return () => window.clearTimeout(timer)
  }, [])
  /** 磁盘上现在的内容和某一版一样吗；`null` = 不知道（没打开图、还在读）。存盘后、版本对话框开关后重新问一次。 */
  const [matchesVersion, setMatchesVersion] = useState<boolean | null>(null)
  const versionsName = state.phase === 'ready' ? state.name : null
  useEffect(() => {
    if (versionsName === null) {
      setMatchesVersion(null)
      return
    }
    let live = true
    props.rpc.call('graph/versions', { name: versionsName }).then(
      (result) => live && setMatchesVersion(result.versions.some((entry) => entry.current)),
      () => live && setMatchesVersion(null),
    )
    return () => {
      live = false
    }
  }, [props.rpc, versionsName, state.baseHash, versionsOpen])
  /** 本会话刚出现的新实例（模型编译了一次）：模板编辑时顶部提示一下。 */
  const [freshRun, setFreshRun] = useState<string | null>(null)
  const seenCurrent = useRef<string | undefined | null>(null)
  // 打开 tab：本会话有当前实例就直接看它（只在第一次拿到列表时做）。
  useEffect(() => {
    if (!runs.loaded) return
    if (seenCurrent.current === null) {
      seenCurrent.current = runs.current
      if (runs.current !== undefined) setRunId(runs.current)
      return
    }
    if (runs.current !== undefined && runs.current !== seenCurrent.current) {
      if (runId === null) setFreshRun(runs.current)
    }
    seenCurrent.current = runs.current
  }, [runs.loaded, runs.current, runId])
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void runs.refresh()
    }, RUNS_REFRESH_MS)
    return () => window.clearInterval(timer)
  }, [runs.refresh])
  const openRun = useCallback((id: string): void => {
    setFreshRun(null)
    setRunId(id)
  }, [])
  const openTemplate = useCallback(
    (name: string): void => {
      setRunId(null)
      if (state.name !== name) void wf.open(name)
    },
    [state.name, wf],
  )
  /** 实例视图把「重新读这个实例」挂在这里（顶栏的下拉里「从磁盘重新加载」要用）。 */
  const reloadRun = useRef<(() => void) | null>(null)
  // 共用顶栏留给实例视图填的三个位置。
  const [slots, setSlots] = useState<TopSlots>(NO_SLOTS)
  const slotRefs = useMemo(
    () => ({
      trigger: (el: HTMLElement | null) =>
        setSlots((s) => (s.trigger === el ? s : { ...s, trigger: el })),
      left: (el: HTMLElement | null) => setSlots((s) => (s.left === el ? s : { ...s, left: el })),
      right: (el: HTMLElement | null) =>
        setSlots((s) => (s.right === el ? s : { ...s, right: el })),
    }),
    [],
  )
  const newWorkflow = useCallback((): void => {
    setRunId(null)
    void wf.create()
  }, [wf])
  // ── 执行 ────────────────────────────────────────────────────
  const sessionRows = useSessionRows(props.sessions)
  const [starting, setStarting] = useState(false)
  const launchBlocked: LocaleKey | null =
    props.sessions === undefined || !props.sessions.available()
      ? 'launch.noBridge'
      : props.session === undefined
        ? 'launch.noSession'
        : wf.conflict !== null
          ? 'launch.conflict'
          : state.problems.some((p) => p.level === 'save' || p.level === 'compile')
            ? 'launch.fixFirst'
            : null
  /** 本会话的工作区（新建会话建在这里；预览计划也按它写工作区路径）。 */
  const sessionCwd = sessionRows.find((row) => row.id === props.session)?.cwd
  /** 给资源选文件、文件夹、Skill 时看主机（相对路径按本会话的工作区）。 */
  const host = useMemo(
    () =>
      createHostAccess(props.rpc, {
        cwd: sessionCwd,
        session: props.session,
        desktop: props.desktop,
      }),
    [props.rpc, sessionCwd, props.session, props.desktop],
  )
  const canCreate = props.sessions?.canCreate() === true && props.session !== undefined
  /**
   * 执行：先把没存的改动存下去（实例拿磁盘上的那份做快照），要新建会话就先建好，建实例，
   * 再往目标会话发那句话，然后跳过去看它跑。发不出去就把刚建的实例删掉，不留一个没人认领的实例。
   *
   * @param target - 会话 id；`null` = 在本工作区新建一个会话。
   * @param answers - 用户在「执行前填写」里的回答（图里有输入节点时）。
   */
  const startRun = useCallback(
    async (target: string | null, answers?: Record<string, InputAnswer>): Promise<void> => {
      const name = state.name
      const bridge = props.sessions
      if (name === null || bridge === undefined || props.session === undefined) return
      setStarting(true)
      try {
        if (!(await wf.flush())) throw new Error(t('launch.unsaved'))
        const session = target ?? (await bridge.create(props.session, sessionCwd))
        const row = sessionRows.find((candidate) => candidate.id === session)
        const cwd = row?.cwd ?? (target === null ? sessionCwd : undefined)
        const started = await props.rpc.call('run/start', {
          workflow: name,
          session,
          ...(cwd === undefined ? {} : { cwd }),
          ...(answers === undefined ? {} : { answers }),
        })
        try {
          await bridge.deliver(session, started.prompt)
        } catch (error) {
          await props.rpc
            .call('run/delete', { id: started.instance.id, withState: true })
            .catch(() => {})
          throw error
        }
        await runs.refresh()
        if (session === props.session) {
          // 本会话：切到对话 tab 看它跑（回到工作流 tab 时显示的就是这个实例）。
          seenCurrent.current = started.instance.id
          openRun(started.instance.id)
          props.openView('chat', 'workflow-lite:run')
        } else if (!bridge.open(session)) {
          wf.notify(t('launch.sent').replace('{title}', row?.title ?? session))
        }
      } catch (error) {
        wf.notify(`${t('launch.failed')}：${errorMessage(error)}`, 'error')
      } finally {
        setStarting(false)
      }
    },
    [
      state.name,
      props.sessions,
      props.rpc,
      props.session,
      props.openView,
      wf,
      t,
      sessionRows,
      sessionCwd,
      runs,
      openRun,
    ],
  )

  /**
   * 「执行」的入口：图里有输入节点就先弹「执行前填写」，填好再执行；没有就直接执行。
   * 上一次填的回答按工作流记着（只在这个视图里），再执行时预先填好。
   */
  const [asking, setAsking] = useState<{ target: string | null } | null>(null)
  const lastAnswers = useRef(new Map<string, Record<string, InputAnswer>>())
  const launch = useCallback(
    (target: string | null): void => {
      const doc = state.doc
      if (doc?.nodes.some(isInput)) {
        setAsking({ target })
        return
      }
      void startRun(target)
    },
    [state.doc, startRun],
  )

  /** 当前的图（异步排版回来时据此判断图是不是已经变了）。 */
  const docRef = useRef(state.doc)
  docRef.current = state.doc
  /** 展示卡上打开的自定义文字（模板里文件还没生成，只有它能打开）。 */
  const [textView, setTextView] = useState<ResourceItem | null>(null)
  /** 展示卡的「上次执行」：这个工作流最近真的生成了它的实例（看着实例时不问）。 */
  const latestOutputs = useLatestOutputs(
    props.rpc,
    runId === null ? (state.name ?? null) : null,
    state.doc,
  )
  const canvasDisplay = useMemo(
    () => ({
      run: null,
      latest: { rpc: props.rpc, outputs: latestOutputs, openRun },
      open: (node: string, item: number): void => {
        const found = docRef.current?.nodes.find((candidate) => candidate.id === node)
        const entry = found !== undefined && isResource(found) ? found.data.items[item] : undefined
        if (entry?.kind === 'text') setTextView(entry)
      },
    }),
    [props.rpc, latestOutputs, openRun],
  )
  const flow = useReactFlow()
  const rootRef = useRef<HTMLDivElement>(null)
  /** 配色主题（工作流中心「设置」里挑）：亮、暗各一套，写成根节点上的两组变量。 */
  const theme = useThemeChoice()
  const themeVars = useMemo(
    () => themeStyle(theme.light, theme.dark) as React.CSSProperties,
    [theme.light, theme.dark],
  )
  /** 瑞士这类连「形」（直角、无阴影、字体）也带着的主题，要知道此刻是亮还是暗。 */
  const scheme = useColorScheme()
  const look = themeLook(scheme, theme.light)
  /** 看板（画布上的网页）用的主题变量：此刻那一套的实值，字体照视图根上算出来的。 */
  const [font, setFont] = useState<string | undefined>(undefined)
  // 换了「形」（瑞士换字体）要重读。
  useLayoutEffect(() => {
    if (rootRef.current !== null) setFont(getComputedStyle(rootRef.current).fontFamily)
  }, [look])
  const board = useMemo(
    () => boardTheme(scheme, scheme === 'light' ? theme.light : theme.dark, { look, font }),
    [scheme, theme.light, theme.dark, look, font],
  )
  /** 模态框挂载点（就是视图根）：要等根节点挂上才有，所以放 state。 */
  const [modalHost, setModalHost] = useState<HTMLElement | null>(null)
  const [size, setSize] = useState({ width: 1200, height: 800 })
  const narrow = size.width <= NARROW
  const inspectorW = inspectorWidth(size.width)
  const [libraryPref, setLibraryPref] = useState<boolean>(() => readLibraryPref() ?? true)
  /*
   * 窄视图里步骤库是盖在画布上的抽屉：默认关着、开了也只管这一回（不写进偏好），
   * 否则宽屏时"常开"的偏好会让窄屏一进来就被整块盖住。
   */
  const [libraryDrawer, setLibraryDrawer] = useState(false)
  const libraryOpen = narrow ? libraryDrawer : libraryPref
  const [planOpen, setPlanOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [quick, setQuick] = useState<(AddRequest & { at: Point }) | null>(null)
  const [keysOpen, setKeysOpen] = useState(false)
  /** 实例视图的右栏开着没有：一进实例先摊开概览，点画布空白处收起。 */
  const [runPanel, setRunPanel] = useState(true)
  // 换了实例就重新摊开概览。
  useEffect(() => {
    setRunPanel(true)
  }, [runId])
  /** 刚加进来的空白步骤：属性面板出来时把光标放进提示词。 */
  const [focusPrompt, setFocusPrompt] = useState(false)

  useEffect(() => {
    const element = rootRef.current
    setModalHost(element)
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      setSize({ width: element.clientWidth, height: element.clientHeight })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const toggleLibrary = useCallback((): void => {
    if (narrow) {
      setLibraryDrawer((open) => !open)
      return
    }
    setLibraryPref(!libraryPref)
    writeLibraryPref(!libraryPref)
  }, [narrow, libraryPref])

  /** 右侧面板正在看步骤库里的哪一项；与画布上的选中互斥。 */
  const [focus, setFocus] = useState<LibraryFocus | null>(null)

  // 画布上选中了东西（点的，或刚加进来的步骤接管了选中）：右侧面板让给它。
  useEffect(() => {
    if (state.selection !== null) setFocus(null)
  }, [state.selection])

  // 窄视图：右侧（底部抽屉）要出来时把步骤库抽屉收回去，两块不叠在一起。
  useEffect(() => {
    if (narrow && (state.selection !== null || focus !== null)) setLibraryDrawer(false)
  }, [narrow, state.selection, focus])

  const hasInspector = (state.selection !== null || focus !== null) && !narrow
  const insets = {
    left: libraryOpen && !narrow ? LIBRARY_W + GAP : 0,
    right: hasInspector ? inspectorW + GAP : 0,
  }
  const insetsRef = useRef(insets)
  insetsRef.current = insets

  const focusCanvas = useCallback((): void => {
    rootRef.current?.querySelector<HTMLElement>('[data-testid="wl-canvas"]')?.focus()
  }, [])

  const fitAll = useCallback(
    (options: { duration?: number; auto?: boolean } = {}): void => {
      const { left, right } = insetsRef.current
      void flow.fitView({
        duration: options.duration ?? 320,
        maxZoom: 1,
        ...(options.auto === true ? { minZoom: 0.55 } : {}),
        padding: {
          top: '84px',
          bottom: '64px',
          left: `${left + 28}px`,
          right: `${right + 28}px`,
        },
      })
    },
    [flow],
  )

  /** 等新坐标渲染并量完尺寸再看全图。 */
  const fitSoon = useCallback((): void => {
    requestAnimationFrame(() => requestAnimationFrame(() => fitAll({ auto: true })))
  }, [fitAll])

  /** 由「定位」选中的步骤：它已经被摆到可见区中间了。 */
  const revealed = useRef<string | null>(null)

  const locate = useCallback(
    (nodeId: string): void => {
      const doc = state.doc
      if (doc === null) return
      const node = findNode(doc, nodeId)
      if (node === undefined) return
      revealed.current = node.id
      wf.select({ kind: 'node', id: node.id })
      // 把步骤放到"没被浮层盖住的那块"的正中间（选中之后右边会多出属性面板）。
      const left = insetsRef.current.left
      const right = narrow ? 0 : inspectorW + GAP
      const zoom = Math.max(flow.getZoom(), 0.9)
      const shift = (right - left) / 2 / zoom
      // 选中、开右栏那一帧画完再滑（见 afterPaint）。
      afterPaint(() => {
        expectCanvasMove()
        void flow.setCenter(node.position.x + NODE_W / 2 + shift, node.position.y + NODE_H / 2, {
          zoom,
          duration: 360,
        })
      })
    },
    [state.doc, wf, flow, narrow, inspectorW],
  )

  /*
   * 点中的步骤被属性面板盖住了，就把画布往旁边挪一点，让它露出来。
   * 只挪"刚好够"的距离，也不会把它推到左边的步骤库底下去。
   */
  const selectedNode = state.selection?.kind === 'node' ? state.selection.id : null
  useEffect(() => {
    if (selectedNode === null) return
    // 「定位」自己会把它摆到正中间，这里不再叠一次。
    if (revealed.current === selectedNode) {
      revealed.current = null
      return
    }
    return afterPaint(() =>
      revealNode({
        flow,
        root: rootRef.current,
        id: selectedNode,
        narrow,
        panelW: inspectorW,
        leftInset: insetsRef.current.left,
        gap: GAP,
      }),
    )
  }, [selectedNode, narrow, flow, inspectorW])

  const relayout = useCallback((): void => {
    const doc = state.doc
    if (doc === null || analysis === null || doc.nodes.length === 0) return
    // 按卡片量出来的真实尺寸排（步骤卡的高度随描述长短变）。
    const sizeOf = (id: string): { width: number; height: number } | undefined => {
      const measured = flow.getInternalNode(id)?.measured
      return measured?.width === undefined || measured.height === undefined
        ? undefined
        : { width: measured.width, height: measured.height }
    }
    const ids = (nodes: readonly { id: string }[]): string =>
      nodes.map((node) => node.id).join('\n')
    void tidy(doc, analysis, sizeOf).then((positions) => {
      // 排版是异步的（第一次还要加载 ELK）：这期间加了 / 删了节点就作废，别拿旧图的版式盖掉新改动。
      // 只是存盘回执换了个文档对象、节点没变，照常应用。
      const current = docRef.current
      if (current === null || ids(current.nodes) !== ids(doc.nodes)) return
      wf.edit({ type: 'moveNodes', positions })
      fitSoon()
    })
  }, [state.doc, analysis, wf, fitSoon, flow])

  /** 加记忆、换一条记忆：弹「选已有的 / 新建」。 */
  const memoryPick = useMemoryPick({
    t,
    store: host.memories,
    doc: state.doc,
    workflow: state.name,
    root: rootRef,
    edit: wf.edit,
    notify: wf.notify,
  })
  const memories = useMemories(host.memories)
  const openMemoryPick = memoryPick.open

  const addStep = useCallback(
    async (source: StepSource, position: Point, from?: string): Promise<void> => {
      const step = source.kind !== 'resource' && source.kind !== 'input' && source.kind !== 'memory'
      // 新步骤会接管选中；之后任何一次换选中都会把这个标记清掉。
      if (step) setFocusPrompt(source.kind === 'blank')
      await addFromSource(
        {
          t,
          doc: state.doc,
          edit: wf.edit,
          loadTemplate: wf.loadTemplate,
          workflow: state.name,
          pickMemory: (request) =>
            openMemoryPick(
              request.type === 'step'
                ? { kind: 'step', step: request.step }
                : { kind: 'workflow', position: request.position },
            ),
        },
        source,
        position,
        from,
      )
      if (step && source.kind !== 'blank') focusCanvas()
    },
    [t, wf, focusCanvas, state.doc, state.name, openMemoryPick],
  )

  const requestAdd = useCallback((request: AddRequest): void => {
    const root = rootRef.current
    if (root === null) return
    const rect = root.getBoundingClientRect()
    setQuick({
      ...request,
      at: { x: request.client.x - rect.left, y: request.client.y - rect.top },
    })
  }, [])

  const duplicate = useCallback(
    (id: string): void => {
      const original = state.doc === null ? undefined : findNode(state.doc, id)
      const edit = duplicateEdit(state.doc, id, t('node.copySuffix'))
      if (original === undefined || edit === null) return
      wf.edit(edit)
      wf.notify(t('node.copied').replace('{name}', nodeTitle(original)))
    },
    [state.doc, wf, t],
  )

  /** 步骤卡上的记忆开关：开着就关；关着就弹「选已有的 / 新建」，贴着开关。 */
  const toggleMemory = useCallback(
    (step: string, anchor: Element): void => {
      const toggle = memoryToggle(state.doc, state.name, step)
      if (toggle === null) return
      if ('off' in toggle) wf.edit(toggle.off)
      else openMemoryPick({ kind: 'step', step: toggle.pick.step }, anchor)
    },
    [state.doc, state.name, wf, openMemoryPick],
  )

  /** 删一个节点：删完点名告诉一声，并提示能撤销（画布上它会原地淡出）。 */
  const removeNode = useCallback(
    (id: string): void => {
      const node = state.doc === null ? undefined : findNode(state.doc, id)
      wf.edit({ type: 'removeNode', id })
      if (node !== undefined) wf.notify(t('node.removed').replace('{name}', nodeTitle(node)))
    },
    [state.doc, wf, t],
  )

  const removeSelection = useCallback((): void => {
    const selection = state.selection
    if (selection === null) return
    if (selection.kind === 'node') removeNode(selection.id)
    else wf.edit({ type: 'removeEdge', id: selection.id })
    // 删掉的东西带走了焦点：收回画布，紧接着的 Ctrl+Z 才有人接。
    focusCanvas()
  }, [state.selection, wf, focusCanvas, removeNode])

  const select = useCallback(
    (selection: Selection): void => {
      setFocusPrompt(false)
      setFocus(null)
      wf.select(selection)
    },
    [wf],
  )

  /** 正在悬停的资源（画布、面板、交接卡片里都能悬停）：画布据此高亮用到它的步骤。 */
  const [focusFile, setFocusFile] = useState<string | null>(null)
  const onFocusFile = useCallback((id: string | null): void => setFocusFile(id), [])
  // 换了选中，面板整块换掉：悬停着的那一行等不到 pointerleave，高亮跟着收掉。
  useEffect(() => {
    setFocusFile(null)
  }, [state.selection])

  /** 在步骤库里点了一项：放掉画布上的选中，右侧改看它。 */
  const focusLibrary = useCallback(
    (next: LibraryFocus | null): void => {
      if (next !== null) wf.select(null)
      setFocus(next)
    },
    [wf],
  )

  /** 「我的步骤」里还没被占用的文件名：`base`、`base-2`、`base-3`… */
  const freeStepName = useCallback(
    (base: string): string => {
      const taken = new Set((wf.catalog?.templates.nodes ?? []).map((e) => e.name.toLowerCase()))
      if (!taken.has(base.toLowerCase())) return base
      for (let n = 2; ; n += 1) {
        if (!taken.has(`${base}-${n}`.toLowerCase())) return `${base}-${n}`
      }
    },
    [wf.catalog],
  )

  /** 新的「我的步骤」的样子：避开内置步骤和已有的我的步骤，尽量不重样。 */
  const freshTemplateLook = useCallback(
    (): Pick<NodeData, 'icon' | 'color'> =>
      pickTemplateAppearance(wf.catalog?.templates.nodes ?? []),
    [wf.catalog],
  )

  /** 右侧面板里的「添加到画布」：放在没被浮层盖住的那块的正中间，被占了就往下找。 */
  const addToCanvas = useCallback(
    (source: StepSource): void => {
      const root = rootRef.current
      if (root === null || state.doc === null) return
      const box = root.getBoundingClientRect()
      const { left, right } = insetsRef.current
      const center = flow.screenToFlowPosition({
        x: box.left + left + (box.width - left - right) / 2,
        y: box.top + box.height / 2,
      })
      const want = { x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 }
      void addStep(
        source,
        freeSpot(
          state.doc.nodes.map((node) => node.position),
          want,
        ),
      )
    },
    [state.doc, flow, addStep],
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (state.phase !== 'ready' || runId !== null) return
    const typing = isTyping(event.target)
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (key === 'escape') {
      if (typing) return
      if (quick !== null) setQuick(null)
      else select(null)
      return
    }
    if (typing) return
    if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault()
      if (key === 'y' || event.shiftKey) wf.redo()
      else wf.undo()
      return
    }
    if (mod && key === 'd') {
      event.preventDefault()
      if (state.selection?.kind === 'node') duplicate(state.selection.id)
      return
    }
    // 其余修饰键组合留给宿主（浏览器查找之类）。
    if (mod || event.altKey) return
    if (key === 'delete' || key === 'backspace') {
      if (state.selection === null) return
      event.preventDefault()
      removeSelection()
      return
    }
    if (key === 'f') {
      event.preventDefault()
      fitAll()
      return
    }
    if (key === 'l') {
      event.preventDefault()
      relayout()
    }
  }

  const doc = state.doc
  // 切换工作流：加载这一小段旧图留着（压暗），新图到了再换，画布不卸载重建。
  const live = state.phase === 'ready' || state.phase === 'loading'
  const canvasLive =
    state.phase === 'ready' && doc !== null && analysis !== null
      ? { key: `${state.name ?? ''}#${state.loadSeq}`, name: state.name, doc, analysis }
      : null
  const canvasHold = useSwapHold(canvasLive, state.phase === 'loading', SWITCH_HOLD_MS)
  const shown = canvasHold.view
  // 右侧面板（属性 / 步骤详情）开着没有：左下角的图例按剩下的宽度决定摊开还是收成按钮。
  const panelOpen =
    (runId !== null && runPanel && !narrow) ||
    (runId === null &&
      live &&
      (focus !== null || (doc !== null && analysis !== null && state.selection !== null)))
  const hub = hubOpen && (
    <HubDialog
      t={t}
      rpc={props.rpc}
      host={host}
      session={props.session}
      sessionRows={sessionRows}
      sessionsReady={props.sessions?.available() === true}
      runs={runs}
      onOpenRun={openRun}
      onNotice={wf.notify}
      workflows={{
        current: state.name,
        scope: {
          ...(sessionCwd === undefined ? {} : { cwd: sessionCwd }),
          ...(props.session === undefined ? {} : { session: props.session }),
        },
        flush: wf.flush,
        onReload: wf.reload,
        onOpen: openTemplate,
        rename: wf.rename,
        remove: wf.remove,
        onChanged: () => void wf.refreshCatalog(),
      }}
      exportCurrent={hubExport}
      onClose={() => setHubOpen(false)}
    />
  )
  return (
    <BoardThemeContext.Provider value={board}>
      <div
        ref={rootRef}
        className={css.root}
        style={themeVars}
        data-light-theme={theme.light}
        data-dark-theme={theme.dark}
        data-look={look}
        data-testid="wl-root"
        data-workflow-lite-view=""
        data-library={libraryOpen && runId === null ? 'open' : 'closed'}
        data-panel={panelOpen ? 'open' : 'closed'}
        data-mode={runId === null ? 'template' : 'run'}
        data-booting={booting ? 'true' : undefined}
        data-session={props.session}
        role="region"
        aria-label={t('tab.label')}
        onKeyDown={onKeyDown}
      >
        <ModalHostProvider value={modalHost}>
          {runId !== null ? (
            <>
              <RunView
                t={t}
                rpc={props.rpc}
                session={props.session}
                id={runId}
                runs={runs}
                workflows={wf.catalog?.workflows ?? []}
                templates={wf.catalog?.templates.nodes ?? []}
                loadTemplate={wf.loadTemplate}
                onSaveTemplate={wf.saveTemplate}
                narrow={narrow}
                inspectorW={inspectorW}
                panelOpen={runPanel}
                onPanel={setRunPanel}
                onOpenRun={openRun}
                onOpenTemplate={openTemplate}
                slots={slots}
                memories={memories.entries}
                reloadRef={reloadRun}
                onOpenHub={() => {
                  setHubExport(false)
                  setHubOpen(true)
                }}
                onSettled={() => setBooting(false)}
                {...(props.desktop === undefined ? {} : { desktop: props.desktop })}
              />
              {hub}
            </>
          ) : (
            <>
              <CanvasLayer
                hidden={state.phase === 'loading' && shown === null}
                dim={canvasHold.dim}
              >
                {shown !== null && (
                  <Canvas
                    t={t}
                    doc={shown.doc}
                    analysis={shown.analysis}
                    loadKey={shown.key}
                    {...(shown.name === null ? {} : { viewKey: shown.name })}
                    selection={state.selection}
                    problems={state.problems}
                    insets={insets}
                    onEdit={wf.edit}
                    onSeal={wf.seal}
                    onSelect={select}
                    onRequestAdd={requestAdd}
                    onDropSource={(source, at) => void addStep(source, at)}
                    onSettled={() => setTemplateSettled(true)}
                    onStarter={() => {
                      wf.edit({ type: 'addGraph', ...starterGraph(t) })
                      fitSoon()
                    }}
                    focusFile={focusFile}
                    onFocusFile={onFocusFile}
                    onMemory={toggleMemory}
                    memories={memories.entries}
                    workflow={state.name}
                    display={canvasDisplay}
                  />
                )}
              </CanvasLayer>

              {state.phase === 'idle' && wf.catalog !== null && <Welcome t={t} wf={wf} />}
              {state.phase === 'broken' && <Broken t={t} wf={wf} />}

              {live && focus !== null && (
                <div className={css.inspector}>
                  <StepPanel
                    t={t}
                    wf={wf}
                    focus={focus}
                    onFocus={focusLibrary}
                    onAddToCanvas={addToCanvas}
                    onCopyToMine={(seed, id) =>
                      focusLibrary({
                        kind: 'new',
                        seed: { ...seed, ...freshTemplateLook() },
                        name: freeStepName(`my-${id}`),
                      })
                    }
                  />
                </div>
              )}

              {state.phase === 'ready' &&
                focus === null &&
                doc !== null &&
                analysis !== null &&
                state.selection !== null && (
                  <div className={css.inspector}>
                    <Inspector
                      t={t}
                      doc={doc}
                      analysis={analysis}
                      selection={state.selection}
                      focusPrompt={focusPrompt && state.selection.kind === 'node'}
                      onEdit={wf.edit}
                      onSelect={select}
                      onSeal={wf.seal}
                      onDuplicate={duplicate}
                      onRemoveNode={(id) => {
                        removeNode(id)
                        focusCanvas()
                      }}
                      onSaveTemplate={wf.saveTemplate}
                      onFocusFile={onFocusFile}
                      host={host}
                      workflow={state.name}
                      onPickMemory={openMemoryPick}
                    />
                  </div>
                )}

              {live && (
                <ZoomDock
                  t={t}
                  keysOpen={keysOpen}
                  setKeysOpen={setKeysOpen}
                  onFit={() => fitAll()}
                />
              )}

              {wf.conflict !== null && (
                <ExitSeat className={css.bannerSeat} exit="up">
                  <div className={cx(ui.panel, css.banner, css.bannerDanger, ui.rise)} role="alert">
                    <Icon name="alert" size={15} />
                    <span className={css.bannerText}>
                      {t('banner.conflict')}
                      {wf.conflict.length > 0 && (
                        <span className={css.bannerIds}>
                          {' · '}
                          {wf.conflict
                            .map((id) =>
                              id === SETTINGS_CONFLICT_ID ? t('settings.conflict') : id,
                            )
                            .join(', ')}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      className={cx(ui.btn, ui.small, ui.primary)}
                      onClick={wf.keepMine}
                    >
                      {t('banner.keepMine')}
                    </button>
                    <button
                      type="button"
                      className={cx(ui.btn, ui.small, ui.soft)}
                      onClick={wf.reload}
                    >
                      {t('banner.useDisk')}
                    </button>
                  </div>
                </ExitSeat>
              )}
              {wf.conflict === null && !wf.external && freshRun !== null && (
                <ExitSeat className={css.bannerSeat} exit="up">
                  <div
                    className={cx(ui.panel, css.banner, ui.rise)}
                    role="status"
                    data-testid="wl-fresh-run"
                  >
                    <Icon name="play" size={15} />
                    <span className={css.bannerText}>{t('run.freshBanner')}</span>
                    <button
                      type="button"
                      className={cx(ui.btn, ui.small, ui.primary)}
                      onClick={() => openRun(freshRun)}
                    >
                      {t('run.freshOpen')}
                    </button>
                    <button
                      type="button"
                      className={cx(ui.btn, ui.icon, ui.small)}
                      aria-label={t('common.close')}
                      onClick={() => setFreshRun(null)}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                </ExitSeat>
              )}
              {wf.conflict === null && wf.external && (
                <ExitSeat className={css.bannerSeat} exit="up">
                  <div className={cx(ui.panel, css.banner, ui.rise)} role="status">
                    <Icon name="info" size={15} />
                    <span className={css.bannerText}>{t('banner.external')}</span>
                    <button
                      type="button"
                      className={cx(ui.btn, ui.small, ui.soft)}
                      onClick={wf.reload}
                    >
                      {t('banner.reload')}
                    </button>
                  </div>
                </ExitSeat>
              )}

              {memoryPick.pick !== null && (
                <MemoryPicker
                  t={t}
                  at={memoryPick.pick.at}
                  type={memoryPick.pick.type}
                  entries={memoryPick.pick.entries}
                  {...(memoryPick.pick.current === undefined
                    ? {}
                    : { current: memoryPick.pick.current })}
                  busy={memoryPick.busy}
                  onPick={memoryPick.choose}
                  onCreate={memoryPick.create}
                  onClose={memoryPick.close}
                />
              )}

              {textView !== null && (
                <TextDialog
                  t={t}
                  item={textView}
                  desktop={props.desktop}
                  onClose={() => setTextView(null)}
                />
              )}

              {quick !== null && (
                <QuickAdd
                  t={t}
                  at={quick.at}
                  bounds={size}
                  templates={wf.catalog?.templates.nodes ?? []}
                  origin={addOrigin(doc, quick.from)}
                  memory={
                    state.name !== null &&
                    (doc === null ||
                      quick.from === undefined ||
                      stepMemories(doc, quick.from).length === 0)
                  }
                  onClose={() => setQuick(null)}
                  onPick={(source) => {
                    const request = quick
                    setQuick(null)
                    void addStep(source, request.flow, request.from)
                  }}
                />
              )}

              {settingsOpen && state.name !== null && doc !== null && (
                <SettingsDialog
                  t={t}
                  name={state.name}
                  settings={doc.settings}
                  sample={sampleOutput(doc)}
                  onSave={(settings) => {
                    setSettingsOpen(false)
                    wf.edit({ type: 'setSettings', settings })
                  }}
                  onClose={() => setSettingsOpen(false)}
                />
              )}

              {versionsOpen && state.name !== null && (
                <VersionsDialog
                  t={t}
                  rpc={props.rpc}
                  name={state.name}
                  doc={doc}
                  memories={host.memories}
                  desktop={host.desktop}
                  flush={wf.flush}
                  onRestored={wf.reload}
                  onChanged={() => void wf.refreshCatalog()}
                  onClose={() => setVersionsOpen(false)}
                />
              )}

              {asking !== null && state.name !== null && doc !== null && (
                <InputsDialog
                  t={t}
                  name={state.name}
                  inputs={orderedInputs(doc)}
                  initial={lastAnswers.current.get(state.name)}
                  where={
                    asking.target === null
                      ? t('launch.newSession')
                      : asking.target === props.session
                        ? t('launch.here')
                        : (sessionRows.find((row) => row.id === asking.target)?.title ??
                          asking.target)
                  }
                  onSubmit={(answers) => {
                    const target = asking.target
                    if (state.name !== null) lastAnswers.current.set(state.name, answers)
                    setAsking(null)
                    void startRun(target, answers)
                  }}
                  onClose={() => setAsking(null)}
                />
              )}

              {planOpen && state.name !== null && (
                <PlanDialog
                  t={t}
                  name={state.name}
                  build={(full) => wf.buildPlan(full, sessionCwd)}
                  onLocate={locate}
                  onClose={() => {
                    setPlanOpen(false)
                    focusCanvas()
                  }}
                />
              )}

              {hub}

              {wf.toast !== null && (
                <ExitSeat className={css.toastSeat} exit="down" key={wf.toast.id}>
                  <div className={cx(css.toast, ui.rise)} data-tone={wf.toast.tone} role="status">
                    {wf.toast.tone === 'error' ? (
                      <Icon name="alert" size={14} />
                    ) : (
                      <Icon name="check" size={14} />
                    )}
                    <span>{wf.toast.text}</span>
                  </div>
                </ExitSeat>
              )}
            </>
          )}
          {live && (
            <div className={css.library} aria-hidden={!libraryOpen}>
              <Library
                t={t}
                templates={wf.catalog?.templates.nodes ?? []}
                focus={focus}
                onFocus={focusLibrary}
                onNewStep={() =>
                  focusLibrary({
                    kind: 'new',
                    seed: { prompt: '', ...freshTemplateLook() },
                    name: freeStepName('my-step'),
                  })
                }
                onClose={toggleLibrary}
              />
            </div>
          )}
          <div className={css.top}>
            <TopBar
              t={t}
              runId={runId}
              slotRefs={slotRefs}
              versionsPending={matchesVersion !== null && (!matchesVersion || isDirty(state))}
              wf={wf}
              libraryOpen={libraryOpen}
              onToggleLibrary={toggleLibrary}
              onTidy={relayout}
              onLocate={locate}
              onPreview={() => setPlanOpen(true)}
              launch={{
                blocked: launchBlocked,
                starting,
                session: props.session,
                rows: sessionRows,
                canCreate,
                onRun: launch,
              }}
              onSettings={() => setSettingsOpen(true)}
              onVersions={() => setVersionsOpen(true)}
              runs={runs}
              onOpenRun={openRun}
              onOpenHub={() => {
                setHubExport(false)
                setHubOpen(true)
              }}
              onExport={() => {
                setHubExport(true)
                setHubOpen(true)
              }}
              onOpenWorkflow={openTemplate}
              onNewWorkflow={newWorkflow}
              onReloadRun={() => reloadRun.current?.()}
            />
          </div>
        </ModalHostProvider>
        <TipLayer root={modalHost} />
      </div>
    </BoardThemeContext.Provider>
  )
}

/** 设置对话框里拼接预览用的示例：图里第一个相对路径的文件，没有就用 `plan.md`。 */
function sampleOutput(doc: WorkflowDocument): string {
  for (const node of doc.nodes) {
    if (!isResource(node)) continue
    const item = node.data.items.find(
      (candidate) => candidate.kind === 'file' && !/^([A-Za-z]:)?[\\/]/u.test(candidate.value),
    )
    if (item !== undefined && item.value.trim() !== '') return item.value.trim()
  }
  return 'plan.md'
}

// ─────────────────────────────────────────────────────────────
// 整页状态
// ─────────────────────────────────────────────────────────────

function Welcome(props: { t: T; wf: Workflow }): React.JSX.Element {
  const { t, wf } = props
  const recent = [...(wf.catalog?.workflows ?? [])]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5)
  return (
    <div className={css.stage}>
      <div className={cx(ui.panel, css.welcome, ui.rise)} data-testid="wl-welcome">
        <div className={css.welcomeArt} aria-hidden="true">
          <span className={ui.kind} data-kind="scan">
            <Icon name="scan" size={15} />
          </span>
          <Icon name="arrowRight" size={14} />
          <span className={ui.kind} data-kind="implement">
            <Icon name="implement" size={15} />
          </span>
          <Icon name="arrowRight" size={14} />
          <span className={ui.kind} data-kind="review">
            <Icon name="review" size={15} />
          </span>
        </div>
        <h2 className={css.welcomeTitle}>{t('welcome.title')}</h2>
        <p className={css.welcomeBody}>{t('welcome.body')}</p>
        <button
          type="button"
          className={cx(ui.btn, ui.primary)}
          data-testid="wl-welcome-new"
          onClick={() => void wf.create()}
        >
          <Icon name="plus" size={15} />
          {t('wf.new')}
        </button>
        {recent.length > 0 && (
          <div className={css.welcomeList}>
            {recent.map((entry) => (
              <button
                key={entry.name}
                type="button"
                className={ui.menuItem}
                onClick={() => void wf.open(entry.name)}
              >
                <Icon name="folder" size={15} />
                <span className={ui.menuLabel}>{entry.name}</span>
                <span className={ui.menuMeta}>
                  {entry.nodeCount} {t('wf.steps')}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Broken(props: { t: T; wf: Workflow }): React.JSX.Element {
  const { t, wf } = props
  const broken = wf.state.broken
  return (
    <div className={css.stage}>
      <div className={cx(ui.panel, css.broken, ui.rise)} data-testid="wl-broken">
        <div className={css.brokenHead}>
          <span className={css.brokenIcon}>
            <Icon name="alert" size={17} />
          </span>
          <div className={ui.grow}>
            <h2 className={css.brokenTitle}>{t('broken.title')}</h2>
            <p className={css.brokenBody}>{t('broken.body')}</p>
          </div>
          <button type="button" className={cx(ui.btn, ui.soft)} onClick={wf.reload}>
            <Icon name="reload" size={14} />
            {t('banner.reload')}
          </button>
        </div>
        {broken !== null && broken.message !== '' && (
          <p className={css.brokenMessage}>{broken.message}</p>
        )}
        {broken?.raw !== undefined && broken.raw !== null && (
          <pre className={css.raw}>{broken.raw}</pre>
        )}
      </div>
    </div>
  )
}
