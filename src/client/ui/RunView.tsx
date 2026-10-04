/**
 * dsh-workflow-lite — 工作流实例视图。
 *
 * 和模板是同一张图、同一套画布：每张步骤卡挂上运行状态，走过的线亮、没走过的淡。
 * 状态和图都能改，而且要顺手——卡片上的状态小标一点就改状态，右栏就地改字段；图和模板里一样拖、连、加、删，
 * 右栏切到「编辑」就是模板的属性面板。改动先攒成草稿（「已改 x 处」），确认后一次写进实例
 * （图的快照、状态文件），并以后台通知的形式告诉模型。执行过的步骤不能从图里删（改成「跳过」）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunView
 */

import { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphAnalysis } from '../../shared/graph.ts'
import { analyzeGraph } from '../../shared/graph.ts'
import { idKey, isInput, isResource, isStep } from '../../shared/model.ts'
import { type RunCursor, runCursor } from '../../shared/runCursor.ts'
import {
  graphFacts,
  type NodeStatus,
  type RunState,
  takenEdges,
  validateRunState,
} from '../../shared/runState.ts'
import { applySync, syncOps } from '../../shared/runSync.ts'
import type {
  InputNode,
  NodeData,
  Point,
  ResourceNode,
  StepNode,
  TemplateEntry,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowEntry,
} from '../../shared/types.ts'
import { addFromSource, addOrigin, duplicateEdit } from '../app/addStep.ts'
import type { Desktop } from '../app/desktop.ts'
import { createHostAccess, type HostAccess } from '../app/host.ts'
import type { FileTarget } from '../app/useRunFile.ts'
import { useRunGraph } from '../app/useRunGraph.ts'
import { type Run, type Runs, useRun } from '../app/useRuns.ts'
import type { T } from '../i18n.ts'
import type { Edit } from '../model/editor.ts'
import { fileBaseName } from '../model/fileKind.ts'
import { placeMissing, tidy } from '../model/layout.ts'
import type { StepSource } from '../model/library.ts'
import {
  changeCount,
  downstreamOf,
  editedNodes,
  togglePin,
  withDraftLog,
} from '../model/runDraft.ts'
import { lockedSteps } from '../model/runGraph.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import {
  type AddRequest,
  Canvas,
  type RunDecor,
  type RunMark,
  type RunNodeDecor,
} from './Canvas.tsx'
import { ZoomDock } from './Dock.tsx'
import { FileViewer } from './FileViewer.tsx'
import { Icon } from './Icon.tsx'
import { Inspector } from './Inspector.tsx'
import css from './inspector.module.css'
import { EdgeHead, InputHead, OverviewHead, ResourceHead, StepHead } from './NodeHeads.tsx'
import { cx } from './primitives.tsx'
import { QuickAdd } from './QuickAdd.tsx'
import { DraftBar, type DraftLine, graphLine } from './RunDraftBar.tsx'
import { RunEdgeDetail } from './RunEdge.tsx'
import { RunInputDetail } from './RunInput.tsx'
import { type PanelMode, RunModeSwitch } from './RunModeSwitch.tsx'
import { RunNav } from './RunNav.tsx'
import { Overview, Untracked } from './RunOverview.tsx'
import { RunResourceDetail } from './RunResource.tsx'
import { StatusMenu } from './RunStatusMenu.tsx'
import { RunStepDetail } from './RunStep.tsx'
import { RunTopBar } from './RunTopBar.tsx'
import run from './run.module.css'
import shell from './shell.module.css'
import ui from './ui.module.css'

export interface RunViewProps {
  t: T
  rpc: WorkflowLiteRpc
  session: string | undefined
  id: string
  runs: Runs
  workflows: readonly WorkflowEntry[]
  /** 「我的步骤」（就地添加菜单里列出来）。 */
  templates: readonly TemplateEntry[]
  /** 读一个「我的步骤」的内容；读不到回 `null`。 */
  loadTemplate(name: string): Promise<NodeData | null>
  /** 把一个步骤存成「我的步骤」。 */
  onSaveTemplate(name: string, data: NodeData): Promise<boolean>
  narrow: boolean
  inspectorW: number
  /** 右栏开着没有（点画布空白处收起，顶栏的开关再打开）。 */
  panelOpen: boolean
  onPanel(open: boolean): void
  onOpenRun(id: string): void
  onOpenTemplate(name: string): void
  onOpenHub(): void
  /** 用系统程序打开产出文件；宿主没有桌面能力时不给。 */
  desktop?: Desktop
}

const GAP = 12
/** 改状态小菜单的宽度（与 run.module.css 的 `.menu` 一致）。 */
const MENU_W = 220

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * 实例的快照：只在换实例、或图存了新的一版（planId 变了）时换，轮询不让画布重建。
 * 视口归零：实例视图打开时总是看全图（模板里存的视角不一定合适）。
 */
function useSnapshot(
  id: string,
  document: WorkflowDocument | undefined,
  planId: string | undefined,
): { planId: string; doc: WorkflowDocument } | null {
  const ref = useRef<{ id: string; planId: string; doc: WorkflowDocument } | null>(null)
  if (
    document !== undefined &&
    planId !== undefined &&
    (ref.current === null || ref.current.id !== id || ref.current.planId !== planId)
  ) {
    ref.current = { id, planId, doc: { ...document, viewport: { x: 0, y: 0, zoom: 1 } } }
  }
  return ref.current?.id === id ? ref.current : null
}

export function RunView(props: RunViewProps): React.JSX.Element {
  const { t, id, narrow, inspectorW, panelOpen, onPanel } = props
  const current = useRun(props.rpc, id, props.session, t, () => void props.runs.refresh())
  const summary = current.view?.summary
  const raw = useSnapshot(id, current.view?.document, summary?.planId)
  // 快照里没摆过位置的节点（模型用工具建的图、还没在画布上打开过）：照模板那边的规矩补位。
  const [placed, setPlaced] = useState<{
    key: string
    planId: string
    doc: WorkflowDocument
  } | null>(null)
  useEffect(() => {
    if (raw === null) return
    let live = true
    void placeMissing(raw.doc, analyzeGraph(raw.doc)).then((positions) => {
      if (!live) return
      const moved = Object.keys(positions).length > 0
      setPlaced({
        key: `${id}:${raw.planId}`,
        planId: raw.planId,
        doc: moved
          ? {
              ...raw.doc,
              nodes: raw.doc.nodes.map((node) => {
                const at = positions[node.id]
                return at === undefined ? node : { ...node, position: at }
              }),
            }
          : raw.doc,
      })
    })
    return () => {
      live = false
    }
  }, [raw, id])
  const source = placed !== null && placed.key === `${id}:${raw?.planId}` ? placed : null
  const graph = useRunGraph(id, source, summary?.workflow)
  const doc = graph.doc
  const selection = graph.selection
  const analysis = useMemo(() => (doc === null ? null : analyzeGraph(doc)), [doc])
  const facts = useMemo(() => (doc === null ? null : graphFacts(doc)), [doc])
  /** 叠上草稿、再和改过的图对齐之后的状态：新步骤是待执行，删掉的步骤不在了。 */
  const shown = useMemo(
    () =>
      current.shown === null || facts === null
        ? current.shown
        : applySync(current.shown, syncOps(current.shown, facts)),
    [current.shown, facts],
  )
  /** 文件里的状态里还没有的步骤（图里刚加的）：保存之后才开始记它。 */
  const fresh = useCallback(
    (nodeId: string): boolean =>
      current.shown !== null && current.shown.nodes[nodeId] === undefined,
    [current.shown],
  )
  const flow = useReactFlow()
  const [mode, setMode] = useState<PanelMode>('run')
  const [focusPrompt, setFocusPrompt] = useState(false)
  const [menu, setMenu] = useState<{
    id: string
    x: number
    y: number
    step: 'status' | 'verdict'
  } | null>(null)
  const [quick, setQuick] = useState<
    (AddRequest & { at: Point; bounds: { width: number; height: number } }) | null
  >(null)
  const [keysOpen, setKeysOpen] = useState(false)
  /** 悬停着的文件（画布上的文件卡、右栏的文件行）：画布高亮它和它的上下游。 */
  const [focusFile, setFocusFile] = useState<string | null>(null)
  /** 查看框里打开着的文件。 */
  const [viewer, setViewer] = useState<{
    target: FileTarget
    title: string
    note?: string | undefined
  } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  /** 看实例工作区里的文件夹、Skill（相对路径按实例的工作区，Skill 按实例所属的会话）。 */
  const cwd = summary?.cwd
  const host = useMemo(
    () => createHostAccess(props.rpc, { cwd, session: props.session, desktop: props.desktop }),
    [props.rpc, cwd, props.session, props.desktop],
  )

  const edited = useMemo(() => {
    const set = editedNodes(current.draft)
    for (const change of graph.changes) {
      if (change.object === 'step' && change.kind !== 'removed') set.add(change.id)
    }
    return set
  }, [current.draft, graph.changes])
  const showPanel = panelOpen && !narrow
  const insets = { left: 0, right: showPanel ? inspectorW + GAP : 0 }
  const select = graph.select
  /** 收起右栏：和模板里一样，连选中一起放掉。 */
  const closePanel = useCallback((): void => {
    select(null)
    onPanel(false)
  }, [onPanel, select])
  const insetRight = insets.right

  /** 执行位置：最后执行的、接下来要做的步骤（画布上的小标、右栏总览共用；草稿改动当作已存）。 */
  const draft = current.draft
  const cursor = useMemo(
    () =>
      doc === null || analysis === null || shown === null
        ? null
        : runCursor(doc, withDraftLog(shown, draft), analysis),
    [doc, analysis, shown, draft],
  )

  const decor = useMemo<RunDecor | undefined>(() => {
    if (doc === null) return undefined
    const onStatus = (nodeId: string, anchor: Element): void => {
      if (fresh(nodeId)) {
        current.flash('ok', t('run.freshStep'))
        return
      }
      const root = anchor.closest('[data-testid="wl-root"]')
      if (root === null) return
      const box = root.getBoundingClientRect()
      const rect = anchor.getBoundingClientRect()
      // 菜单贴着小标弹出，但不伸到右栏底下。
      const limit = box.width - insetRight - MENU_W - GAP
      setMenu({
        id: nodeId,
        x: Math.max(GAP, Math.min(rect.left - box.left, limit)),
        y: rect.bottom - box.top + 6,
        step: 'status',
      })
    }
    if (shown === null) {
      return {
        nodes: {},
        taken: new Set(doc.edges.map((edge) => edge.id)),
        files: {},
        onStatus,
      }
    }
    const marks = new Map<string, RunMark>()
    for (const step of cursor?.next ?? []) marks.set(step.node, 'next')
    for (const step of cursor?.last ?? []) marks.set(step.node, 'last')
    const nodes: Record<string, RunNodeDecor> = {}
    for (const [nodeId, node] of Object.entries(shown.nodes)) {
      nodes[nodeId] = {
        status: node.status,
        round: node.round ?? 0,
        edited: edited.has(nodeId),
        mark: marks.get(nodeId),
      }
    }
    return {
      nodes,
      taken: takenEdges(doc, shown),
      files: current.view?.files ?? {},
      onStatus,
    }
  }, [doc, shown, cursor, edited, current.view?.files, insetRight, fresh, current.flash, t])

  const fitAll = useCallback((): void => {
    void flow.fitView({
      duration: 320,
      maxZoom: 1,
      padding: {
        top: '84px',
        bottom: '64px',
        left: '28px',
        right: `${insets.right + 28}px`,
      },
    })
  }, [flow, insets.right])

  const steps = useMemo(
    () => new Set((doc?.nodes ?? []).filter(isStep).map((node) => node.id)),
    [doc],
  )
  const rerunFrom = useCallback(
    (nodeId: string): void => {
      if (doc === null) return
      current.rerun(downstreamOf(doc.edges, steps, nodeId))
    },
    [doc, steps, current],
  )

  // ── 改图 ───────────────────────────────────────────────────

  const locked = useMemo(
    () => lockedSteps(current.view?.state ?? current.lastGood),
    [current.view?.state, current.lastGood],
  )
  const focusCanvas = useCallback((): void => {
    canvasRef.current?.querySelector<HTMLElement>('[data-testid="wl-canvas"]')?.focus()
  }, [])
  /** 所有改图的动作都走这里：执行过的步骤不让删；加了东西、连了线就把右栏切到「编辑」。 */
  const edit = useCallback(
    (next: Edit): void => {
      if (next.type === 'removeNode' && locked(next.id)) {
        current.flash('error', t('run.lockedStep'))
        return
      }
      graph.edit(next)
      if (
        next.type === 'addNode' ||
        next.type === 'addResource' ||
        next.type === 'addInput' ||
        next.type === 'connect'
      ) {
        setMode('edit')
        onPanel(true)
      }
    },
    [locked, current.flash, t, graph.edit, onPanel],
  )
  const addStep = useCallback(
    async (from: StepSource, position: Point, after?: string): Promise<void> => {
      setFocusPrompt(from.kind === 'blank')
      await addFromSource({ t, doc, edit, loadTemplate: props.loadTemplate }, from, position, after)
    },
    [t, doc, edit, props.loadTemplate],
  )
  const requestAdd = useCallback((request: AddRequest): void => {
    const root = canvasRef.current?.closest('[data-testid="wl-root"]')
    if (root === null || root === undefined) return
    const rect = root.getBoundingClientRect()
    setQuick({
      ...request,
      at: { x: request.client.x - rect.left, y: request.client.y - rect.top },
      bounds: { width: rect.width, height: rect.height },
    })
  }, [])
  const duplicate = useCallback(
    (nodeId: string): void => {
      const next = duplicateEdit(doc, nodeId)
      if (next !== null) edit(next)
    },
    [doc, edit],
  )
  const removeSelection = useCallback((): void => {
    if (selection === null) return
    edit(
      selection.kind === 'node'
        ? { type: 'removeNode', id: selection.id }
        : { type: 'removeEdge', id: selection.id },
    )
    focusCanvas()
  }, [selection, edit, focusCanvas])
  const relayout = useCallback((): void => {
    if (doc === null || analysis === null || doc.nodes.length === 0) return
    const sizeOf = (nodeId: string): { width: number; height: number } | undefined => {
      const measured = flow.getInternalNode(nodeId)?.measured
      return measured?.width === undefined || measured.height === undefined
        ? undefined
        : { width: measured.width, height: measured.height }
    }
    const ids = doc.nodes.map((node) => node.id).join('\n')
    void tidy(doc, analysis, sizeOf).then((positions) => {
      // 排版是异步的：这期间加了 / 删了节点就作废。
      if (graph.doc === null || graph.doc.nodes.map((node) => node.id).join('\n') !== ids) return
      edit({ type: 'moveNodes', positions })
      requestAnimationFrame(() => requestAnimationFrame(fitAll))
    })
  }, [doc, analysis, flow, graph.doc, edit, fitAll])

  const pickStatus = (nodeId: string, status: NodeStatus): void => {
    const verdicts = facts?.verdicts[nodeId]
    const node = shown?.nodes[nodeId]
    // 有条件出边的步骤改成「完成」时要一个判定：先问判定，再一起改。
    if (status === 'done' && verdicts !== undefined && node?.verdict === undefined) {
      setMenu((open) => (open === null ? open : { ...open, step: 'verdict' }))
      return
    }
    current.setStatus(nodeId, status)
    setMenu(null)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target
    if (target instanceof HTMLElement && (TYPING.has(target.tagName) || target.isContentEditable)) {
      return
    }
    const key = event.key.toLowerCase()
    const mod = event.ctrlKey || event.metaKey
    if (key === 'escape') {
      if (menu !== null) setMenu(null)
      else if (quick !== null) setQuick(null)
      else closePanel()
      return
    }
    if (mod && (key === 'z' || key === 'y')) {
      event.preventDefault()
      if (key === 'y' || event.shiftKey) graph.redo()
      else graph.undo()
      return
    }
    if (mod && key === 'd') {
      event.preventDefault()
      if (selection?.kind === 'node') duplicate(selection.id)
      return
    }
    if (mod || event.altKey) return
    if (key === 'delete' || key === 'backspace') {
      if (selection === null) return
      event.preventDefault()
      removeSelection()
    } else if (key === 'f') {
      event.preventDefault()
      fitAll()
    } else if (key === 'l') {
      event.preventDefault()
      relayout()
    }
  }

  // ── 草稿 ───────────────────────────────────────────────────

  const graphLines = useMemo<DraftLine[]>(
    () =>
      graph.base === null || doc === null
        ? []
        : graph.changes.map((change) => ({
            key: `${change.object}:${change.kind}:${change.id}`,
            text: graphLine(t, change, graph.base as WorkflowDocument, doc),
            onUndo: () => graph.revert(change),
          })),
    [graph.base, graph.changes, graph.revert, doc, t],
  )
  const count = changeCount(current.draft) + graph.changes.length
  const blocked = useMemo((): string | null => {
    const problem = graph.problems[0]
    if (problem !== undefined) return t('run.graphProblem').replace('{p}', problem.message)
    if (graph.changes.length === 0 || shown === null || facts === null) return null
    const issue = validateRunState(shown, facts).issues[0]
    return issue === undefined
      ? null
      : t('run.stateMismatch').replace('{p}', `${issue.path} ${issue.message}`)
  }, [graph.problems, graph.changes.length, shown, facts, t])
  const save = (): void => {
    const changed = graph.changes.length > 0 && graph.doc !== null && graph.basePlan !== null
    void current
      .save(
        changed && graph.doc !== null && graph.basePlan !== null
          ? { base: graph.basePlan, document: graph.doc }
          : undefined,
      )
      .then((result) => {
        if (result?.planId !== undefined) graph.commit(result.planId)
      })
  }

  const selectedStep =
    selection?.kind === 'node'
      ? doc?.nodes.find((node): node is StepNode => node.id === selection.id && isStep(node))
      : undefined
  const selectedEdge =
    selection?.kind === 'edge' ? doc?.edges.find((edge) => edge.id === selection.id) : undefined
  const selectedFile =
    selection?.kind === 'node'
      ? doc?.nodes.find(
          (node): node is ResourceNode => node.id === selection.id && isResource(node),
        )
      : undefined
  const selectedInput =
    selection?.kind === 'node'
      ? doc?.nodes.find((node): node is InputNode => node.id === selection.id && isInput(node))
      : undefined
  const menuNode = menu === null ? undefined : shown?.nodes[menu.id]
  const nav =
    doc === null || analysis === null ? null : (
      <RunNav
        t={t}
        doc={doc}
        analysis={analysis}
        state={shown}
        selection={selection}
        idle={!showPanel}
        onPick={(next) => {
          setFocusPrompt(false)
          select(next)
          onPanel(true)
        }}
      />
    )
  const tabs = <RunModeSwitch t={t} mode={mode} onChange={setMode} />

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 只在这一层收视图内冒上来的按键
    <div onKeyDown={onKeyDown} style={{ display: 'contents' }}>
      <div className={shell.canvas} ref={canvasRef}>
        {doc !== null && analysis !== null && (
          <Canvas
            t={t}
            doc={doc}
            analysis={analysis}
            loadKey={`run:${id}`}
            selection={selection}
            problems={graph.problems}
            insets={insets}
            onEdit={edit}
            onSelect={(next) => {
              // 点中东西：右栏打开看它；点空白处：右栏收起（和模板一样）。
              setFocusPrompt(false)
              select(next)
              setMenu(null)
              onPanel(next !== null)
            }}
            onRequestAdd={requestAdd}
            onDropSource={(from, at) => void addStep(from, at)}
            onStarter={() => {}}
            focusFile={focusFile}
            onFocusFile={setFocusFile}
            {...(decor === undefined ? {} : { run: decor })}
          />
        )}
      </div>

      <div className={shell.top}>
        <RunTopBar
          {...props}
          summary={summary}
          state={shown}
          nav={nav}
          onTogglePanel={() => {
            if (panelOpen) closePanel()
            else onPanel(true)
          }}
        />
      </div>

      {showPanel &&
        doc !== null &&
        analysis !== null &&
        (mode === 'edit' && selection !== null ? (
          <div className={shell.inspector}>
            <Inspector
              t={t}
              doc={doc}
              analysis={analysis}
              selection={selection}
              focusPrompt={focusPrompt && selection.kind === 'node'}
              onEdit={edit}
              onSelect={(next) => {
                setFocusPrompt(false)
                // 右上角 ✕：和「运行」那边一样收起右栏。
                if (next === null) closePanel()
                else select(next)
              }}
              onSeal={graph.seal}
              onDuplicate={duplicate}
              onRemoveNode={(nodeId) => {
                edit({ type: 'removeNode', id: nodeId })
                focusCanvas()
              }}
              onSaveTemplate={props.onSaveTemplate}
              onFocusFile={setFocusFile}
              host={host}
              tabs={tabs}
            />
          </div>
        ) : (
          <div className={shell.inspector}>
            <RunPanel
              t={t}
              rpc={props.rpc}
              instance={id}
              current={current}
              doc={doc}
              analysis={analysis}
              state={shown}
              fresh={fresh}
              taken={shown === null ? null : (decor?.taken ?? null)}
              cursor={cursor}
              verdicts={facts?.verdicts ?? {}}
              selected={selectedStep ?? null}
              selectedFile={selectedFile ?? null}
              selectedInput={selectedInput ?? null}
              selectedEdge={selectedEdge ?? null}
              tabs={tabs}
              desktop={props.desktop}
              host={host}
              onEditPrompt={(nodeId, prompt) =>
                edit({
                  type: 'patchNode',
                  id: nodeId,
                  patch: { prompt },
                  merge: `${idKey(nodeId)}:prompt`,
                })
              }
              onEdit={edit}
              onSeal={graph.seal}
              onSelect={(nodeId) => select(nodeId === null ? null : { kind: 'node', id: nodeId })}
              onSelectEdge={(edgeId) => select({ kind: 'edge', id: edgeId })}
              onRerun={rerunFrom}
              onFocusFile={setFocusFile}
              onView={(target, title, note) => setViewer({ target, title, note })}
              onClose={closePanel}
            />
          </div>
        ))}

      <ZoomDock t={t} keysOpen={keysOpen} setKeysOpen={setKeysOpen} onFit={fitAll} />

      {menu !== null && menuNode !== undefined && (
        <StatusMenu
          t={t}
          at={menu}
          node={menuNode}
          step={menu.step}
          verdicts={facts?.verdicts[menu.id] ?? []}
          onStatus={(status) => pickStatus(menu.id, status)}
          onVerdict={(verdict) => {
            current.setStatus(menu.id, 'done')
            current.setField(['nodes', menu.id, 'verdict'], verdict)
            setMenu(null)
          }}
          onRerun={() => {
            rerunFrom(menu.id)
            setMenu(null)
          }}
          pinned={shown?.next?.includes(menu.id) === true}
          onPin={() => {
            current.setField(['next'], togglePin(shown?.next ?? [], menu.id))
            setMenu(null)
          }}
          onClose={() => setMenu(null)}
        />
      )}

      {quick !== null && (
        <QuickAdd
          t={t}
          at={quick.at}
          bounds={quick.bounds}
          templates={props.templates}
          origin={addOrigin(doc, quick.from)}
          onClose={() => setQuick(null)}
          onPick={(from) => {
            const request = quick
            setQuick(null)
            void addStep(from, request.flow, request.from)
          }}
        />
      )}

      <Banners t={t} current={current} />

      {viewer !== null && (
        <FileViewer
          t={t}
          rpc={props.rpc}
          instance={id}
          target={viewer.target}
          title={viewer.title}
          note={viewer.note}
          desktop={props.desktop}
          onClose={() => setViewer(null)}
        />
      )}

      {(count > 0 || current.conflicts.length > 0) && (
        <DraftBar
          t={t}
          current={current}
          graph={graphLines}
          count={count}
          blocked={blocked}
          panel={showPanel}
          onSave={save}
          onDiscard={() => {
            current.discard()
            graph.discard()
          }}
        />
      )}

      {current.toast !== null && (
        <div className={shell.toastSeat} key={current.toast.id}>
          <div className={cx(shell.toast, ui.rise)} data-tone={current.toast.tone} role="status">
            <Icon name={current.toast.tone === 'error' ? 'alert' : 'check'} size={14} />
            <span>{current.toast.text}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// 右栏
// ─────────────────────────────────────────────────────────────

function RunPanel(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  current: Run
  doc: WorkflowDocument
  analysis: GraphAnalysis
  /** 叠上草稿、和改过的图对齐之后的状态；不记进度（或读不出来）时为 `null`。 */
  state: RunState | null
  /** 图里刚加、状态里还没有的步骤。 */
  fresh(id: string): boolean
  /** 这次走过的线；不记进度（或状态读不出来）时为 `null`。 */
  taken: ReadonlySet<string> | null
  /** 执行位置；不记进度（或状态读不出来）时为 `null`。 */
  cursor: RunCursor | null
  verdicts: Readonly<Record<string, string[]>>
  selected: StepNode | null
  selectedFile: ResourceNode | null
  selectedInput: InputNode | null
  selectedEdge: WorkflowEdge | null
  /** 选中东西时标题栏里关闭按钮左边的「运行 / 编辑」切换。 */
  tabs: React.ReactNode
  desktop: Desktop | undefined
  host: HostAccess
  /** 改步骤的提示词（改的是这次执行的图，进草稿）。 */
  onEditPrompt(id: string, prompt: string): void
  /** 改图（标题栏里改名字、换外观；和「编辑」那边同一个标题栏）。 */
  onEdit(edit: Edit): void
  onSeal(): void
  onSelect(id: string | null): void
  onSelectEdge(id: string): void
  onRerun(id: string): void
  onFocusFile(id: string | null): void
  onView(target: FileTarget, title: string, note?: string): void
  onClose(): void
}): React.JSX.Element {
  const { t, current, doc, state, selected, selectedFile, selectedInput, selectedEdge } = props
  const summary = current.view?.summary
  const made = current.view?.files ?? {}
  const answers = current.view?.answers
  const labelOf = (id: string): string => {
    const node = doc.nodes.find((candidate) => idKey(candidate.id) === idKey(id))
    return node !== undefined &&
      isStep(node) &&
      node.data.label !== undefined &&
      node.data.label !== ''
      ? node.data.label
      : id
  }
  const viewPath = (path: string): void => props.onView({ path }, fileBaseName(path))
  // 标题栏和「编辑」那边是同一个（同样能改名字、换外观），两边切换时不动。
  const headProps = {
    t,
    extra: props.tabs,
    onClose: props.onClose,
    closeTestId: 'wl-run-panel-close',
  }

  let head: React.ReactNode
  let body: React.ReactNode
  if (selectedEdge !== null) {
    head = <EdgeHead {...headProps} doc={doc} analysis={props.analysis} edge={selectedEdge} />
    body = (
      <RunEdgeDetail
        t={t}
        snapshot={doc}
        analysis={props.analysis}
        edge={selectedEdge}
        state={state}
        taken={props.taken}
        answers={answers}
        desktop={props.desktop}
        onSelectNode={props.onSelect}
      />
    )
  } else if (selectedInput !== null) {
    head = <InputHead {...headProps} node={selectedInput} />
    body = (
      <RunInputDetail
        t={t}
        snapshot={doc}
        input={selectedInput}
        answer={answers?.[selectedInput.id]}
        state={state}
        onSelectStep={props.onSelect}
      />
    )
  } else if (selectedFile !== null) {
    head = (
      <ResourceHead
        {...headProps}
        node={selectedFile}
        onEdit={props.onEdit}
        onSeal={props.onSeal}
      />
    )
    body = (
      <RunResourceDetail
        key={selectedFile.id}
        t={t}
        rpc={props.rpc}
        instance={props.instance}
        host={props.host}
        snapshot={doc}
        resource={selectedFile}
        made={made[selectedFile.id] ?? []}
        state={state}
        version={current.view?.mtime ?? 0}
        desktop={props.desktop}
        onSelectStep={props.onSelect}
        onFocusFile={props.onFocusFile}
        onView={props.onView}
        onError={(text) => current.flash('error', text)}
      />
    )
  } else if (selected !== null) {
    head = <StepHead {...headProps} node={selected} onEdit={props.onEdit} onSeal={props.onSeal} />
    body = (
      <RunStepDetail
        key={selected.id}
        t={t}
        current={current}
        snapshot={doc}
        analysis={props.analysis}
        step={selected}
        state={state}
        fresh={props.fresh(selected.id)}
        taken={props.taken}
        verdicts={props.verdicts[selected.id]}
        answers={answers}
        made={made}
        desktop={props.desktop}
        onRerun={() => props.onRerun(selected.id)}
        onSelectNode={props.onSelect}
        onSelectEdge={props.onSelectEdge}
        onFocusFile={props.onFocusFile}
        onViewPath={viewPath}
        onEditPrompt={(prompt) => props.onEditPrompt(selected.id, prompt)}
        onSeal={props.onSeal}
      />
    )
  } else {
    // 概览没有「编辑」：不给切换。
    head = <OverviewHead {...headProps} extra={undefined} />
    if (state === null && summary !== undefined && summary.statePath === undefined) {
      body = <Untracked t={t} summary={summary} snapshot={doc} />
    } else if (state === null) {
      body = (
        <p className={css.help}>{current.view === null ? t('run.loading') : t('run.noState')}</p>
      )
    } else {
      body = (
        <Overview
          t={t}
          current={current}
          snapshot={doc}
          state={state}
          cursor={props.cursor}
          summary={summary}
          labelOf={labelOf}
          onSelect={props.onSelect}
        />
      )
    }
  }
  const picked = (selected ?? selectedFile ?? selectedInput ?? selectedEdge) !== null
  const overview = !picked && state !== null
  return (
    <aside
      className={cx(ui.panel, css.panel)}
      data-testid="wl-run-panel"
      aria-label={t('run.panel')}
    >
      {head}
      <div className={cx(css.body, overview && run.bodyOverview)}>{body}</div>
    </aside>
  )
}

// ─────────────────────────────────────────────────────────────
// 提示条
// ─────────────────────────────────────────────────────────────

function Banners(props: { t: T; current: Run }): React.JSX.Element | null {
  const { t, current } = props
  const view = current.view
  let tone: 'danger' | 'info' = 'info'
  let text: string | null = null
  let detail: string | null = null
  if (current.error !== null) {
    tone = 'danger'
    text = t('run.loadError')
    detail = current.error
  } else if (view !== null && view.summary.statePath === undefined) {
    // 不记运行状态：没有可报的问题，右栏里有说明。
  } else if (view !== null && view.state === null && view.mtime === 0) {
    tone = 'danger'
    text = t('run.stateMissing')
    detail = view.summary.statePath ?? null
  } else if (view !== null && view.state === null) {
    tone = 'danger'
    text = t('run.stateInvalidLong')
    detail = view.issues
      .slice(0, 3)
      .map((issue) => (issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`))
      .join('；')
  } else if (current.overwritten.length > 0) {
    text = t('run.overwritten')
    detail = current.overwritten.map((path) => path.join('.')).join('、')
  }
  if (text === null) return null
  return (
    <div className={shell.bannerSeat}>
      <div
        className={cx(ui.panel, shell.banner, tone === 'danger' && shell.bannerDanger, ui.rise)}
        role={tone === 'danger' ? 'alert' : 'status'}
        data-testid="wl-run-banner"
      >
        <Icon name={tone === 'danger' ? 'alert' : 'info'} size={15} />
        <span className={shell.bannerText}>
          {text}
          {detail !== null && <span className={shell.bannerIds}> · {detail}</span>}
        </span>
      </div>
    </div>
  )
}
