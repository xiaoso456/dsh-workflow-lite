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
import { ReactFlowProvider, useReactFlow, useViewport } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isFile, SETTINGS_CONFLICT_ID } from '../../shared/model.ts'
import type { NodeData, Point, WorkflowDocument } from '../../shared/types.ts'
import { useWorkflow, type Workflow } from '../app/useWorkflow.ts'
import type { LocaleKey, NS, T } from '../i18n.ts'
import { findNode, type Selection } from '../model/editor.ts'
import { freeSpot, NODE_H, NODE_W, tidy } from '../model/layout.ts'
import {
  BLANK_ID,
  type LibraryFocus,
  PRESETS,
  presetData,
  type StepSource,
  starterGraph,
} from '../model/library.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { type AddRequest, Canvas } from './Canvas.tsx'
import { freeFilePath } from './Files.tsx'
import { Icon } from './Icon.tsx'
import { Inspector } from './Inspector.tsx'
import { Library } from './Library.tsx'
import { PlanDialog } from './PlanDialog.tsx'
import { cx, ModalHostProvider, Popover } from './primitives.tsx'
import { QuickAdd } from './QuickAdd.tsx'
import { SettingsDialog } from './SettingsDialog.tsx'
import { StepPanel } from './StepPanel.tsx'
import css from './shell.module.css'
import { TopBar } from './TopBar.tsx'
import ui from './ui.module.css'

/** 客户端入口注入的业务面。 */
export interface WorkflowViewInjected {
  rpc: WorkflowLiteRpc
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

const SHORTCUTS: readonly { key: LocaleKey; combos: readonly string[] }[] = [
  { key: 'keys.add', combos: [] },
  { key: 'keys.undo', combos: ['Ctrl', 'Z'] },
  { key: 'keys.redo', combos: ['Ctrl', 'Shift', 'Z'] },
  { key: 'keys.duplicate', combos: ['Ctrl', 'D'] },
  { key: 'keys.delete', combos: ['Delete'] },
  { key: 'keys.deselect', combos: ['Esc'] },
  { key: 'keys.fit', combos: ['F'] },
  { key: 'keys.tidy', combos: ['L'] },
]

export function WorkflowView(props: WorkflowViewProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <Shell rpc={props.rpc} t={props.t as T} />
    </ReactFlowProvider>
  )
}

function Shell(props: { rpc: WorkflowLiteRpc; t: T }): React.JSX.Element {
  const { t } = props
  const wf = useWorkflow(props.rpc, t)
  const { state, analysis } = wf
  const flow = useReactFlow()
  const rootRef = useRef<HTMLDivElement>(null)
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
      void flow.setCenter(node.position.x + NODE_W / 2 + shift, node.position.y + NODE_H / 2, {
        zoom,
        duration: 360,
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
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current
      const element = root?.querySelector(
        `.react-flow__node[data-id="${CSS.escape(selectedNode)}"]`,
      )
      if (root === null || root === undefined || element === null || element === undefined) return
      const box = root.getBoundingClientRect()
      const card = element.getBoundingClientRect()
      const viewport = flow.getViewport()
      let dx = 0
      let dy = 0
      if (narrow) {
        // 窄视图的属性面板是底部抽屉：往上挪。
        const sheetTop = box.bottom - Math.min(box.height * 0.62, 460) - GAP
        const overflow = card.bottom - sheetTop
        const room = card.top - (box.top + 64)
        if (overflow > 0 && room > 0) dy = Math.min(overflow + GAP, room)
      } else {
        const overflow = card.right - (box.right - inspectorW - GAP * 2)
        const room = card.left - (box.left + insetsRef.current.left + GAP)
        if (overflow > 0 && room > 0) dx = Math.min(overflow + GAP, room)
      }
      if (dx === 0 && dy === 0) return
      void flow.setViewport(
        { ...viewport, x: viewport.x - dx, y: viewport.y - dy },
        { duration: 280 },
      )
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedNode, narrow, flow, inspectorW])

  const relayout = useCallback((): void => {
    if (state.doc === null || analysis === null || state.doc.nodes.length === 0) return
    wf.edit({ type: 'moveNodes', positions: tidy(state.doc, analysis) })
    fitSoon()
  }, [state.doc, analysis, wf, fitSoon])

  const addStep = useCallback(
    async (source: StepSource, position: Point, from?: string): Promise<void> => {
      let id: string
      let data: NodeData
      if (source.kind === 'file') {
        // 文件卡：从步骤的「＋」加的就是这一步写的文件；别处加的是一张独立的文件卡。加完选中它，好改路径。
        const doc = state.doc
        if (doc === null) return
        const writer = from === undefined ? undefined : findNode(doc, from)
        const step = writer !== undefined && !isFile(writer) ? writer : undefined
        wf.edit({
          type: 'addFile',
          path: freeFilePath(doc, step === undefined ? t('file.default') : `${step.id}.md`),
          ...(step === undefined ? { position } : { writer: step.id }),
          select: true,
        })
        return
      }
      if (source.kind === 'blank') {
        id = BLANK_ID
        data = { prompt: '' }
      } else if (source.kind === 'preset') {
        const preset = PRESETS.find((candidate) => candidate.id === source.id)
        if (preset === undefined) return
        id = preset.id
        data = presetData(preset, t)
      } else {
        const loaded = await wf.loadTemplate(source.name)
        if (loaded === null) return
        id = source.name
        data = loaded
      }
      // 新步骤会接管选中；之后任何一次换选中都会把这个标记清掉。
      setFocusPrompt(source.kind === 'blank')
      wf.edit({ type: 'addNode', id, data, position, ...(from === undefined ? {} : { from }) })
      if (source.kind !== 'blank') focusCanvas()
    },
    [t, wf, focusCanvas, state.doc],
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
      const node = state.doc === null ? undefined : findNode(state.doc, id)
      if (node === undefined || isFile(node)) return
      wf.edit({
        type: 'addNode',
        id: node.id,
        data: { ...node.data },
        position: { x: node.position.x + 32, y: node.position.y + 32 },
      })
    },
    [state.doc, wf],
  )

  const removeSelection = useCallback((): void => {
    const selection = state.selection
    if (selection === null) return
    wf.edit(
      selection.kind === 'node'
        ? { type: 'removeNode', id: selection.id }
        : { type: 'removeEdge', id: selection.id },
    )
    // 删掉的东西带走了焦点：收回画布，紧接着的 Ctrl+Z 才有人接。
    focusCanvas()
  }, [state.selection, wf, focusCanvas])

  const select = useCallback(
    (selection: Selection): void => {
      setFocusPrompt(false)
      setFocus(null)
      wf.select(selection)
    },
    [wf],
  )

  /** 正在悬停的文件（画布、面板、交接卡片里都能悬停）：画布据此高亮用到它的步骤。 */
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
    if (state.phase !== 'ready') return
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
  return (
    <div
      ref={rootRef}
      className={css.root}
      data-testid="wl-root"
      data-workflow-lite-view=""
      data-library={libraryOpen ? 'open' : 'closed'}
      role="region"
      aria-label={t('tab.label')}
      onKeyDown={onKeyDown}
    >
      <ModalHostProvider value={modalHost}>
        <div className={css.canvas}>
          {state.phase === 'ready' && doc !== null && analysis !== null && (
            <Canvas
              t={t}
              doc={doc}
              analysis={analysis}
              loadKey={`${state.name ?? ''}#${state.loadSeq}`}
              selection={state.selection}
              problems={state.problems}
              insets={insets}
              onEdit={wf.edit}
              onSelect={select}
              onRequestAdd={requestAdd}
              onDropSource={(source, at) => void addStep(source, at)}
              onStarter={() => {
                wf.edit({ type: 'addGraph', ...starterGraph(t) })
                fitSoon()
              }}
              focusFile={focusFile}
              onFocusFile={onFocusFile}
            />
          )}
        </div>

        {state.phase === 'idle' && wf.catalog !== null && <Welcome t={t} wf={wf} />}
        {state.phase === 'broken' && <Broken t={t} wf={wf} />}

        <div className={css.top}>
          <TopBar
            t={t}
            wf={wf}
            libraryOpen={libraryOpen}
            onToggleLibrary={toggleLibrary}
            onTidy={relayout}
            onLocate={locate}
            onPreview={() => setPlanOpen(true)}
            onSettings={() => setSettingsOpen(true)}
          />
        </div>

        {state.phase === 'ready' && (
          <div className={css.library} aria-hidden={!libraryOpen}>
            <Library
              t={t}
              templates={wf.catalog?.templates.nodes ?? []}
              focus={focus}
              onFocus={focusLibrary}
              onNewStep={() =>
                focusLibrary({ kind: 'new', seed: { prompt: '' }, name: freeStepName('my-step') })
              }
              onClose={toggleLibrary}
            />
          </div>
        )}

        {state.phase === 'ready' && focus !== null && (
          <div className={css.inspector}>
            <StepPanel
              t={t}
              wf={wf}
              focus={focus}
              onFocus={focusLibrary}
              onAddToCanvas={addToCanvas}
              onCopyToMine={(seed, id) =>
                focusLibrary({ kind: 'new', seed, name: freeStepName(`my-${id}`) })
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
                  wf.edit({ type: 'removeNode', id })
                  focusCanvas()
                }}
                onSaveTemplate={wf.saveTemplate}
                onFocusFile={onFocusFile}
              />
            </div>
          )}

        {state.phase === 'ready' && (
          <ZoomDock t={t} keysOpen={keysOpen} setKeysOpen={setKeysOpen} onFit={() => fitAll()} />
        )}

        {wf.conflict !== null && (
          <div className={css.bannerSeat}>
            <div className={cx(ui.panel, css.banner, css.bannerDanger, ui.rise)} role="alert">
              <Icon name="alert" size={15} />
              <span className={css.bannerText}>
                {t('banner.conflict')}
                {wf.conflict.length > 0 && (
                  <span className={css.bannerIds}>
                    {' · '}
                    {wf.conflict
                      .map((id) => (id === SETTINGS_CONFLICT_ID ? t('settings.conflict') : id))
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
              <button type="button" className={cx(ui.btn, ui.small, ui.soft)} onClick={wf.reload}>
                {t('banner.useDisk')}
              </button>
            </div>
          </div>
        )}
        {wf.conflict === null && wf.external && (
          <div className={css.bannerSeat}>
            <div className={cx(ui.panel, css.banner, ui.rise)} role="status">
              <Icon name="info" size={15} />
              <span className={css.bannerText}>{t('banner.external')}</span>
              <button type="button" className={cx(ui.btn, ui.small, ui.soft)} onClick={wf.reload}>
                {t('banner.reload')}
              </button>
            </div>
          </div>
        )}

        {quick !== null && (
          <QuickAdd
            t={t}
            at={quick.at}
            bounds={size}
            templates={wf.catalog?.templates.nodes ?? []}
            origin={quickOrigin(doc, quick.from)}
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

        {planOpen && state.name !== null && (
          <PlanDialog
            t={t}
            name={state.name}
            build={wf.buildPlan}
            onLocate={locate}
            onClose={() => {
              setPlanOpen(false)
              focusCanvas()
            }}
          />
        )}

        {wf.toast !== null && (
          <div className={css.toastSeat} key={wf.toast.id}>
            <div className={cx(css.toast, ui.rise)} data-tone={wf.toast.tone} role="status">
              {wf.toast.tone === 'error' ? (
                <Icon name="alert" size={14} />
              ) : (
                <Icon name="check" size={14} />
              )}
              <span>{wf.toast.text}</span>
            </div>
          </div>
        )}
      </ModalHostProvider>
    </div>
  )
}

/** 就地添加菜单从哪儿来：步骤的「＋」、文件卡拖出来的线，或空白处。 */
function quickOrigin(
  doc: WorkflowDocument | null,
  from: string | undefined,
): 'step' | 'file' | 'none' {
  if (doc === null || from === undefined) return 'none'
  const node = findNode(doc, from)
  if (node === undefined) return 'none'
  return isFile(node) ? 'file' : 'step'
}

/** 设置对话框里拼接预览用的示例：图里第一个产出文件，没有就用 `plan.md`。 */
function sampleOutput(doc: WorkflowDocument): string {
  const file = doc.nodes.find(isFile)
  return file === undefined ? 'plan.md' : file.data.path
}

// ─────────────────────────────────────────────────────────────
// 左下角：缩放与快捷键
// ─────────────────────────────────────────────────────────────

function ZoomDock(props: {
  t: T
  keysOpen: boolean
  setKeysOpen: (open: boolean) => void
  onFit: () => void
}): React.JSX.Element {
  const { t } = props
  const flow = useReactFlow()
  const { zoom } = useViewport()
  return (
    <div className={cx(ui.panel, css.dock)}>
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipUp, ui.tipStart)}
        data-tip={t('tool.zoomOut')}
        aria-label={t('tool.zoomOut')}
        onClick={() => void flow.zoomOut({ duration: 200 })}
      >
        <Icon name="minus" size={15} />
      </button>
      <span className={css.zoom}>{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipUp)}
        data-tip={t('tool.zoomIn')}
        aria-label={t('tool.zoomIn')}
        onClick={() => void flow.zoomIn({ duration: 200 })}
      >
        <Icon name="plus" size={15} />
      </button>
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipUp)}
        data-tip={`${t('tool.fit')}  F`}
        aria-label={t('tool.fit')}
        data-testid="wl-fit"
        onClick={props.onFit}
      >
        <Icon name="fit" size={15} />
      </button>
      <span className={ui.divider} />
      <Popover
        open={props.keysOpen}
        onClose={() => props.setKeysOpen(false)}
        up
        label={t('keys.title')}
        className={css.keys}
        trigger={
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipUp)}
            data-tip={t('tool.keys')}
            aria-label={t('tool.keys')}
            aria-expanded={props.keysOpen}
            onClick={() => props.setKeysOpen(!props.keysOpen)}
          >
            <Icon name="keyboard" size={15} />
          </button>
        }
      >
        <p className={css.keysTitle}>{t('keys.title')}</p>
        {SHORTCUTS.map((row) => (
          <div key={row.key} className={css.keysRow}>
            <span>{t(row.key)}</span>
            <span>
              {row.combos.length === 0 ? (
                <span className={ui.kbd}>{t('keys.addCombo')}</span>
              ) : (
                row.combos.map((combo) => (
                  <kbd key={combo} className={ui.kbd}>
                    {combo}
                  </kbd>
                ))
              )}
            </span>
          </div>
        ))}
      </Popover>
      <span className={cx(ui.divider, css.legendDivider)} />
      <LineLegend t={t} />
    </div>
  )
}

/** 图例里的四种线：样本的线型、颜色、箭头与画布上一致。 */
const LEGEND: readonly {
  key: 'flow' | 'produce' | 'update' | 'read'
  label: LocaleKey
  tip: LocaleKey
}[] = [
  { key: 'flow', label: 'legend.flow', tip: 'legend.flowTip' },
  { key: 'produce', label: 'file.produce', tip: 'legend.produceTip' },
  { key: 'update', label: 'file.update', tip: 'legend.updateTip' },
  { key: 'read', label: 'file.read', tip: 'legend.readTip' },
]

/** 左下角常驻的线条图例：四种线各一个小样本，悬停看一句解释。 */
function LineLegend(props: { t: T }): React.JSX.Element {
  const { t } = props
  return (
    <ul className={css.legend} aria-label={t('legend.title')} data-testid="wl-legend">
      {LEGEND.map((item) => (
        <li
          key={item.key}
          className={cx(css.legendItem, ui.tip, ui.tipUp)}
          data-line={item.key}
          data-tip={t(item.tip)}
        >
          <svg width="22" height="10" viewBox="0 0 22 10" aria-hidden="true">
            <line x1="1" y1="5" x2="16" y2="5" />
            <path d="M15 1.8 L21 5 L15 8.2 Z" />
            {item.key === 'update' && <path d="M7 1.8 L1 5 L7 8.2 Z" />}
          </svg>
          <span>{t(item.label)}</span>
        </li>
      ))}
      <li
        className={cx(css.legendItem, ui.tip, ui.tipUp)}
        data-port="in"
        data-tip={t('legend.inTip')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="3.6" />
        </svg>
        <span>{t('legend.in')}</span>
      </li>
      <li
        className={cx(css.legendItem, ui.tip, ui.tipUp, ui.tipEnd)}
        data-port="out"
        data-tip={t('legend.outTip')}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="3.6" />
        </svg>
        <span>{t('legend.out')}</span>
      </li>
    </ul>
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
  const templates = wf.catalog?.templates.workflows.filter((entry) => entry.invalid !== true) ?? []
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
        {(recent.length > 0 || templates.length > 0) && (
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
            {templates.length > 0 && <p className={ui.menuTitle}>{t('wf.fromTemplate')}</p>}
            {templates.map((entry) => (
              <button
                key={entry.name}
                type="button"
                className={ui.menuItem}
                onClick={() => void wf.create(entry.name)}
              >
                <Icon name="bookmark" size={15} />
                <span className={ui.menuLabel}>{entry.name}</span>
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
