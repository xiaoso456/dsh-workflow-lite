/**
 * dsh-workflow-lite — 工作流视图（会话页的一个 tab）：把发动机、画布与各块面板接起来。
 *
 * 版式：画布铺满，顶栏、步骤库、属性面板、缩放条浮在上面。属性面板只在选中东西时出现。
 * 键盘：快捷键挂在视图根上——视图内任何地方拿到焦点都能冒上来，又出不了这个视图
 * （挂 window 会隔着整页抢宿主的按键）。输入框里一律让开。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/WorkflowView
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ReactFlowProvider, useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Point } from '../../../shared/types.ts'
import type { Desktop } from '../../app/desktop.ts'
import type { SessionBridge } from '../../app/sessions.ts'
import { useRuns } from '../../app/useRuns.ts'
import { useWorkflow, type Workflow } from '../../app/useWorkflow.ts'
import type { NS, T } from '../../i18n.ts'
import { isDirty } from '../../model/editor.ts'
import { starterGraph } from '../../model/library.ts'
import type { WorkflowLiteRpc } from '../../rpc.ts'
import { type AddRequest, Canvas } from '../canvas/Canvas.tsx'
import { ZoomDock } from '../chrome/Dock.tsx'
import dock from '../chrome/dock.module.css'
import frame from '../chrome/frame.module.css'
import { Library } from '../editor/Library.tsx'
import { BoardThemeContext } from '../files/boardFrame.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { ModalHostProvider } from '../kit/Modal.tsx'
import type { TopSlots } from '../kit/topSlots.ts'
import ui from '../kit/ui.module.css'
import { ExitSeat, useViewGhost } from '../motion/exits.tsx'
import { SWITCH_HOLD_MS, useSwapHold } from '../motion/swap.tsx'
import { RunView } from '../run/RunView.tsx'
import css from './shell.module.css'
import { TipLayer } from './TipLayer.tsx'
import { NO_SLOTS, TopBar } from './TopBar.tsx'
import { ViewGuard } from './ViewGuard.tsx'
import { Banners } from './workflowView/Banners.tsx'
import { inspectorWidth, NARROW } from './workflowView/geometry.ts'
import { HubLayer } from './workflowView/HubLayer.tsx'
import { handleKeyDown } from './workflowView/handleKeyDown.ts'
import { InspectorPanes } from './workflowView/InspectorPanes.tsx'
import { readLibraryPref } from './workflowView/libraryPref.ts'
import { ShellDialogs } from './workflowView/ShellDialogs.tsx'
import { useBooting } from './workflowView/useBooting.ts'
import { useCanvasDisplay } from './workflowView/useCanvasDisplay.ts'
import { useFreshRun } from './workflowView/useFreshRun.ts'
import { useLaunch } from './workflowView/useLaunch.ts'
import { useMatchesVersion } from './workflowView/useMatchesVersion.ts'
import { usePanelLink } from './workflowView/usePanelLink.ts'
import { useSidePanels } from './workflowView/useSidePanels.ts'
import { useStepEdit } from './workflowView/useStepEdit.ts'
import { useViewport } from './workflowView/useViewport.ts'
import { useViewTheme } from './workflowView/useViewTheme.ts'

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
      className={frame.canvas}
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
    <ViewGuard t={props.t as T}>
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
    </ViewGuard>
  )
}

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
  const { booting, setBooting, setTemplateSettled } = useBooting({ state, runs })
  const matchesVersion = useMatchesVersion({ rpc: props.rpc, state, versionsOpen })
  const { freshRun, setFreshRun, seenCurrent } = useFreshRun({ runs, runId, setRunId })
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
  const {
    sessionRows,
    starting,
    launchBlocked,
    sessionCwd,
    host,
    canCreate,
    startRun,
    asking,
    setAsking,
    lastAnswers,
    launch,
  } = useLaunch({ props, t, wf, runs, openRun, seenCurrent })

  const { docRef, textView, setTextView, canvasDisplay } = useCanvasDisplay({
    rpc: props.rpc,
    state,
    runId,
    openRun,
  })
  const flow = useReactFlow()
  const rootRef = useRef<HTMLDivElement>(null)
  const { theme, themeVars, look, board } = useViewTheme({ rootRef })
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

  const { toggleLibrary, focus, setFocus, insets, insetsRef } = useSidePanels({
    state,
    narrow,
    libraryPref,
    setLibraryPref,
    setLibraryDrawer,
    libraryOpen,
    inspectorW,
  })

  const { focusCanvas, fitAll, fitSoon, locate, relayout } = useViewport({
    flow,
    rootRef,
    insetsRef,
    state,
    analysis,
    wf,
    narrow,
    inspectorW,
    docRef,
  })

  const {
    memoryPick,
    memories,
    openMemoryPick,
    addStep,
    requestAdd,
    duplicate,
    toggleMemory,
    removeNode,
    removeSelection,
    select,
  } = useStepEdit({ t, host, rootRef, wf, state, focusCanvas, setFocusPrompt, setQuick, setFocus })

  const { focusFile, onFocusFile, focusLibrary, freeStepName, freshTemplateLook, addToCanvas } =
    usePanelLink({ wf, state, flow, rootRef, insetsRef, setFocus, addStep })

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void =>
    handleKeyDown(event, {
      state,
      runId,
      quick,
      setQuick,
      select,
      wf,
      duplicate,
      removeSelection,
      fitAll,
      relayout,
    })

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
    <HubLayer
      t={t}
      rpc={props.rpc}
      host={host}
      session={props.session}
      sessionRows={sessionRows}
      sessionsReady={props.sessions?.available() === true}
      runs={runs}
      openRun={openRun}
      wf={wf}
      sessionCwd={sessionCwd}
      hubExport={hubExport}
      onClose={() => setHubOpen(false)}
      openTemplate={openTemplate}
    />
  )
  return (
    <BoardThemeContext.Provider value={board}>
      <div
        ref={rootRef}
        className={cx(css.root, dock.root)}
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

              <InspectorPanes
                t={t}
                wf={wf}
                live={live}
                focus={focus}
                focusPrompt={focusPrompt}
                focusLibrary={focusLibrary}
                addToCanvas={addToCanvas}
                freshTemplateLook={freshTemplateLook}
                freeStepName={freeStepName}
                select={select}
                duplicate={duplicate}
                removeNode={removeNode}
                focusCanvas={focusCanvas}
                onFocusFile={onFocusFile}
                host={host}
                openMemoryPick={openMemoryPick}
              />

              {live && (
                <ZoomDock
                  t={t}
                  keysOpen={keysOpen}
                  setKeysOpen={setKeysOpen}
                  onFit={() => fitAll()}
                />
              )}

              <Banners
                t={t}
                wf={wf}
                freshRun={freshRun}
                openRun={openRun}
                setFreshRun={setFreshRun}
              />

              <ShellDialogs
                t={t}
                rpc={props.rpc}
                desktop={props.desktop}
                session={props.session}
                wf={wf}
                host={host}
                memoryPick={memoryPick}
                textView={textView}
                setTextView={setTextView}
                quick={quick}
                setQuick={setQuick}
                size={size}
                addStep={addStep}
                settingsOpen={settingsOpen}
                setSettingsOpen={setSettingsOpen}
                versionsOpen={versionsOpen}
                setVersionsOpen={setVersionsOpen}
                asking={asking}
                setAsking={setAsking}
                lastAnswers={lastAnswers}
                sessionRows={sessionRows}
                startRun={startRun}
                planOpen={planOpen}
                setPlanOpen={setPlanOpen}
                sessionCwd={sessionCwd}
                locate={locate}
                focusCanvas={focusCanvas}
              />

              {hub}

              {wf.toast !== null && (
                <ExitSeat className={frame.toastSeat} exit="down" key={wf.toast.id}>
                  <div className={cx(frame.toast, ui.rise)} data-tone={wf.toast.tone} role="status">
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
