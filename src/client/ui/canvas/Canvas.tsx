/**
 * dsh-workflow-lite — 画布：把文档画成步骤卡与连线，把指针操作翻译成编辑动作。
 *
 * 文档是事实源，React Flow 只负责渲染与手势：
 * - 节点对象按"文档里的那个节点 + 选中/语气"缓存，没变的节点保持同一个引用，React Flow
 *   就不会重建它的内部状态（尺寸、连接点位置）；
 * - 拖动过程中的坐标只放在本组件的局部状态里，**松手才写进文档**——一次拖拽 = 一次改动、
 *   一条撤销步、一次保存；
 * - 选中态由文档这边说了算，单向告诉 React Flow。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/Canvas
 */

import '@xyflow/react/dist/base.css'
import { Background, BackgroundVariant, ReactFlow, useReactFlow, useStore } from '@xyflow/react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphAnalysis } from '../../../shared/graph.ts'
import type { MemoryEntry } from '../../../shared/memoryLib.ts'
import { idKey } from '../../../shared/model.ts'
import { memoryOf } from '../../../shared/presets.ts'
import { outputResource, resourceGraph } from '../../../shared/resources.ts'
import type { NodeStatus } from '../../../shared/runState.ts'
import type {
  Point,
  ResourceView,
  ValidationProblem,
  WorkflowDocument,
} from '../../../shared/types.ts'
import { useStable } from '../../app/useStable.ts'
import { rememberViewport } from '../../app/viewport.ts'
import type { T } from '../../i18n.ts'
import { linkAllowed } from '../../model/connect.ts'
import { sameRouting } from '../../model/docShape.ts'
import { type Edit, type FocusFile, freeFilePath, type Selection } from '../../model/editor.ts'
import { NODE_H, NODE_W, nextTo, RES_H } from '../../model/layout.ts'
import type { StepSource } from '../../model/library.ts'
import { DisplayContext, type DisplayEnv } from '../display/displayEnv.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { setCanvasMoving } from '../motion/canvasMoving.ts'
import { useCanvasExits } from '../motion/exits.tsx'
import css from './canvas.module.css'
import { InputCard } from './cards/InputCard.tsx'
import { ResourceCard } from './cards/ResourceCard.tsx'
import { StepCard } from './cards/StepCard.tsx'
import { buildEdges } from './flow/buildEdges.ts'
import { buildNodes, type CacheEntry } from './flow/buildNodes.ts'
import { buildRoutes, type RouteBase } from './flow/buildRoutes.ts'
import { buildTexts } from './flow/buildTexts.ts'
import { useConnectionDrag } from './hooks/useConnectionDrag.ts'
import { useNodeChanges } from './hooks/useNodeChanges.ts'
import { useStepDrop } from './hooks/useStepDrop.ts'
import { useViewportRestore } from './hooks/useViewportRestore.ts'
import { MAX_ZOOM, MIN_ZOOM, useWheelZoom } from './hooks/useWheelZoom.ts'
import { ConnectionLine, DragInfo } from './lines/ConnectionLine.tsx'
import { FileLine } from './lines/FileLine.tsx'
import { StreaksMode } from './lines/FlowStreaks.tsx'
import { LabelLayer } from './lines/LabelLayer.tsx'
import { LinkLine } from './lines/LinkLine.tsx'
import type { FlowEdge, FlowNode, HandoffActs, RunMark, Tone } from './types.ts'

/** 「在这里加一个步骤」的请求：屏幕坐标用来摆菜单，画布坐标用来落节点。 */
export interface AddRequest {
  client: Point
  flow: Point
  /** 顺手从这个节点连过来（步骤 = 接一步；资源 = 新步骤读它）。 */
  from?: string
}

export interface CanvasProps {
  t: T
  doc: WorkflowDocument
  analysis: GraphAnalysis
  /** 换了一份基线（打开 / 重新加载）就变：据此重新定视口。 */
  loadKey: string
  /** 图名：给了就把人动过的视口记在浏览器里（见 `app/viewport.ts`），下次打开接着看；不写进图文件。 */
  viewKey?: string
  selection: Selection
  problems: readonly ValidationProblem[]
  /** 自动看全图时四周要让开的浮层宽度。 */
  insets: { left: number; right: number }
  onEdit(edit: Edit): void
  /** 一次连续输入结束：断开撤销合并（线上交接卡片里就地改说明用）。 */
  onSeal(): void
  onSelect(selection: Selection): void
  onRequestAdd(request: AddRequest): void
  onDropSource(source: StepSource, flow: Point): void
  onStarter(): void
  /** 这一份刚载入的图摆好了视角、量好了卡片（头一回看全图 / 恢复视角之后）：之后才画得稳，线不会再挪。 */
  onSettled?(): void
  /** 正在悬停的资源卡 id：用到它的步骤标出角色，其余的淡下去。 */
  focusFile: string | null
  onFocusFile: FocusFile
  /** 工作流实例视图：每张步骤卡挂上运行状态，走过的线亮、没走过的淡。缺省 = 模板编辑。 */
  run?: RunDecor
  /** 步骤卡上的记忆开关（`anchor` 是那个按钮，菜单贴着它弹）；不给就不显示开关（只标出开着记忆的步骤）。 */
  onMemory?: (step: string, anchor: Element) => void
  /** 记忆库（记忆卡显示库里的名称、谁还在用）；没读回来是 `null`。 */
  memories?: readonly MemoryEntry[] | null
  /** 正在编辑的工作流名（「另有几个工作流在用」不算它自己）。 */
  workflow?: string | null
  /** 资源卡的画布展示从哪读、怎么打开（实例视图给出实例）；缺省 = 模板（文件还没生成，只摆占位）。 */
  display?: Omit<DisplayEnv, 't'>
}

/** 实例视图给画布的装饰。 */
export interface RunDecor {
  /**
   * 每个步骤此刻的状态（已经叠上草稿）；`mark` = 执行位置：最后执行的、接下来要做的
   * （见 `shared/runCursor.ts`）。
   */
  nodes: Readonly<Record<string, RunNodeDecor>>
  /** 走过的线。 */
  taken: ReadonlySet<string>
  /** 资源里每个文件、文件夹在不在（资源 id → 按项；不是路径的项为 `null`）。 */
  files: Readonly<Record<string, readonly (boolean | null)[]>>
  /** 点卡片上的状态小标：在它旁边弹出改状态的菜单。 */
  onStatus(id: string, anchor: Element): void
}

export interface RunNodeDecor {
  status: NodeStatus
  round: number
  edited: boolean
  mark?: RunMark | undefined
}

/** `nodeTypes` / `edgeTypes` 必须是稳定引用，否则 React Flow 每次渲染都重建全部节点。 */
const NODE_TYPES = { wfNode: StepCard, wfResource: ResourceCard, wfInput: InputCard }
const EDGE_TYPES = { wfEdge: LinkLine, wfFileLink: FileLine }

// ─────────────────────────────────────────────────────────────
// 画布
// ─────────────────────────────────────────────────────────────

export function Canvas(props: CanvasProps): React.JSX.Element {
  const {
    t,
    selection,
    focusFile: hoveredFile,
    onEdit,
    onSeal,
    onSelect,
    onRequestAdd,
    onDropSource,
    run,
  } = props
  // 只改了文字（打字改提示词、标题……）时画布晚一拍跟上：按键那一帧照旧画上一版，
  // 新的一版放到空闲时重画（React 会在下一次按键时让路）。挪了卡片、改了连线、换了图的照常当场画。
  const live = useMemo(
    () => ({
      doc: props.doc,
      analysis: props.analysis,
      problems: props.problems,
      loadKey: props.loadKey,
    }),
    [props.doc, props.analysis, props.problems, props.loadKey],
  )
  const deferred = useDeferredValue(live)
  const { doc, analysis, problems } =
    deferred.loadKey === live.loadKey && sameRouting(deferred.doc, live.doc) ? deferred : live
  const flow = useReactFlow<FlowNode, FlowEdge>()
  const wrapRef = useRef<HTMLDivElement>(null)
  /** 连线标签层：找一次发给各条线（见 LabelLayer.tsx）。 */
  const flowRoot = useStore((store) => store.domNode)
  const labelLayer = useMemo(
    () => flowRoot?.querySelector<HTMLElement>('.react-flow__edgelabel-renderer') ?? null,
    [flowRoot],
  )
  /** 卡片尺寸量出来 / 变了就加一：线的走法要按真实尺寸重算。 */
  const [sized, setSized] = useState(0)
  /** 拖动中的临时坐标（松手才写进文档）。 */
  const [dragging, setDragging] = useState<Record<string, Point>>({})
  const draggingRef = useRef(dragging)
  draggingRef.current = dragging
  /** 拖卡片时光带先藏着、松手再铺（视口在动时停在原地，见 FlowStreaks）。 */
  const streakMode = Object.keys(dragging).length > 0 ? 'hold' : 'run'
  // 动到一半卸掉了（换视图）：等着画布停下来的活不能一直压着。
  useEffect(() => () => setCanvasMoving(false), [])
  /** React Flow 量出来的卡片尺寸：带回给它，重建节点对象时就不用重新量。 */
  const measured = useRef(new Map<string, { width: number; height: number }>())
  const cache = useRef(new Map<string, CacheEntry>())
  const edgeCache = useRef({
    t,
    onPick: null as unknown,
    acts: null as unknown,
    map: new Map<string, FlowEdge>(),
  })
  /** 最新的文档（画出来的可能晚一拍，见上）：回调里按它找卡片、算位置。 */
  const docRef = useRef(props.doc)
  docRef.current = props.doc
  /** 没在拖卡片时挑好的各条线的走法：拖动中没碰到的线照用（见 `routes`）。 */
  const routeBase = useRef<RouteBase | null>(null)

  /** 每个步骤的语气与悬停说明：空提示词当场就算（不等保存后的校验回来）。 */
  const tones = useMemo(() => {
    const map = new Map<string, { tone: Tone; note: string }>()
    for (const problem of problems) {
      // 建议级（没写产出之类）不在卡片上挂标记：它们不挡任何事，挂上只会让满屏都是黄点。
      if (problem.node === undefined || problem.level === 'hint') continue
      const key = idKey(problem.node)
      const severe = problem.level === 'save' || problem.level === 'compile'
      const previous = map.get(key)
      if (previous?.tone === 'error') continue
      if (!severe && previous !== undefined) continue
      map.set(key, { tone: severe ? 'error' : 'warn', note: problem.message })
    }
    return map
  }, [problems])

  const onAdd = useCallback(
    (id: string, anchor: Element): void => {
      const rect = anchor.getBoundingClientRect()
      const client = { x: rect.right + 10, y: rect.top + rect.height / 2 }
      const source = docRef.current.nodes.find((node) => node.id === id)
      if (source === undefined) return
      // 接在后面的新步骤落在右边一列（被占了就往下找），而不是菜单所在的位置。
      onRequestAdd({ client, flow: nextTo(docRef.current, source.position), from: id })
    },
    [onRequestAdd],
  )

  // 节点对象是缓存的（见上）：回调走 ref，引用永远不变，缓存里的旧节点拿到的也是最新的处理函数。
  const focusFileRef = useRef(props.onFocusFile)
  focusFileRef.current = props.onFocusFile
  const onFocusFile = useCallback((id: string | null): void => focusFileRef.current(id), [])
  const editRef = useRef(props.onEdit)
  editRef.current = props.onEdit
  const onView = useCallback((id: string, view: ResourceView): void => {
    editRef.current({ type: 'patchResource', id, patch: { view } })
  }, [])
  // 展示卡从哪读、怎么打开（模板里只有自定义文字能直接显示）。
  const displayEnv = useMemo(
    (): DisplayEnv => ({
      t,
      run: props.display?.run ?? null,
      latest: props.display?.latest,
      open: props.display?.open,
    }),
    [t, props.display?.run, props.display?.latest, props.display?.open],
  )
  const runStatusRef = useRef(run?.onStatus)
  runStatusRef.current = run?.onStatus
  const onRunStatus = useCallback(
    (id: string, anchor: Element): void => runStatusRef.current?.(id, anchor),
    [],
  )

  /** 每个资源谁写、谁读（悬停资源卡时据此标角色）。 */
  const files = useMemo(
    () => resourceGraph({ nodes: doc.nodes, edges: doc.edges, viewport: doc.viewport }),
    [doc.nodes, doc.edges],
  )

  /** 开着记忆的步骤（写着一张记忆卡的那些，规范大小写）。 */
  const memorySteps = useMemo(() => {
    const keys = new Set<string>()
    for (const info of files.values()) {
      if (memoryOf(info.resource.data) === undefined) continue
      for (const writer of info.writers) keys.add(idKey(writer.id))
    }
    return keys
  }, [files])

  // 记忆开关同样走 ref（节点对象是缓存的）。
  const memoryRef = useRef(props.onMemory)
  memoryRef.current = props.onMemory
  const memoryToggle = props.onMemory !== undefined
  const onMemory = useCallback(
    (id: string, anchor: Element): void => memoryRef.current?.(id, anchor),
    [],
  )

  /** 指针下的那条线：悬停时它也"活"起来，标明是哪种线。 */
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)

  const { dragInfo, drag, focusFile, focused } = useConnectionDrag({
    doc,
    t,
    hoveredFile,
    streakMode,
    files,
  })

  const onPick = useCallback(
    (id: string): void => {
      onSelect({ kind: 'edge', id })
      wrapRef.current?.focus()
    },
    [onSelect],
  )

  const acts = useMemo<HandoffActs>(
    () => ({
      note: (edgeId, note) => {
        const edge = docRef.current.edges.find((candidate) => candidate.id === edgeId)
        if (edge === undefined) return
        onEdit({
          type: 'setHandoff',
          id: edgeId,
          handoff: note.trim() === '' ? undefined : { note },
          merge: `${idKey(edge.source)}->${idKey(edge.target)}:handoff`,
        })
      },
      seal: onSeal,
    }),
    [onEdit, onSeal],
  )

  const texts = useMemo(() => buildTexts(t), [t])

  // 只改了文字（提示词、标题……）时沿用上一份文档算走线：走线只看位置、尺寸、连线，见 `sameRouting`。
  const routeDoc = useStable(doc, sameRouting)
  const routes = useMemo(
    () => buildRoutes({ doc: routeDoc, dragging, sized, measured, routeBase }),
    [routeDoc, dragging, sized],
  )

  const nodes = useMemo<FlowNode[]>(
    () =>
      buildNodes({
        doc,
        selection,
        tones,
        dragging,
        texts,
        onAdd,
        onFocusFile,
        onView,
        focused,
        focusFile,
        routes,
        t,
        run,
        onRunStatus,
        memorySteps,
        memoryToggle,
        onMemory,
        memories: props.memories,
        workflow: props.workflow,
        files,
        cache,
        measured,
      }),
    [
      doc.nodes,
      selection,
      tones,
      dragging,
      texts,
      onAdd,
      onFocusFile,
      focused,
      focusFile,
      routes,
      t,
      run,
      onRunStatus,
      memorySteps,
      memoryToggle,
      onMemory,
      props.memories,
      props.workflow,
    ],
  )

  const edges = useMemo<FlowEdge[]>(
    () =>
      buildEdges({
        doc,
        analysis,
        selection,
        texts,
        onPick,
        acts,
        focusFile,
        hoverEdge,
        routes,
        t,
        run,
        edgeCache,
      }),
    [doc, analysis, selection, texts, onPick, acts, focusFile, hoverEdge, routes, t, run],
  )

  // 删掉的步骤、资源、连线原地退场（同一份文档里少了的才放，换图不放）。
  const flowIds = useMemo(
    () => [...nodes.map((node) => node.id), ...edges.map((edge) => edge.id)],
    [nodes, edges],
  )
  useCanvasExits(wrapRef, props.loadKey, flowIds)

  const onNodesChange = useNodeChanges({
    measured,
    draggingRef,
    setSized,
    setDragging,
    onEdit,
  })

  const viewKey = props.viewKey
  useViewportRestore({ flow, docRef, props, viewKey })

  const { onDragOver, onDrop } = useStepDrop({ wrapRef, flow, onDropSource })

  const focusCanvas = useCallback((): void => wrapRef.current?.focus(), [])

  useWheelZoom({ wrapRef, flow })

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 画布是自定义复合控件（拖放落点 + 键盘入口）
    <div
      className={css.wrap}
      ref={wrapRef}
      // tabIndex=-1：可被脚本/点击聚焦从而收到键盘事件，但不进 Tab 序。
      tabIndex={-1}
      data-testid="wl-canvas"
      data-drag={drag?.kind ?? undefined}
      style={drag === null ? undefined : ({ '--wl-drag': drag.color } as React.CSSProperties)}
      data-inset-right={props.insets.right}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={(event) => {
        // 右键空白处加步骤；右键在卡片或连线上不算（浏览器自己的菜单照旧）。
        const target = event.target
        if (!(target instanceof Element) || !target.classList.contains('react-flow__pane')) return
        event.preventDefault()
        const client = { x: event.clientX, y: event.clientY }
        const at = flow.screenToFlowPosition(client)
        onRequestAdd({ client, flow: { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 } })
      }}
    >
      <LabelLayer.Provider value={labelLayer}>
        <DisplayContext.Provider value={displayEnv}>
          <DragInfo.Provider value={dragInfo}>
            <StreaksMode.Provider value={streakMode}>
              <ReactFlow<FlowNode, FlowEdge>
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                edgeTypes={EDGE_TYPES}
                minZoom={MIN_ZOOM}
                maxZoom={MAX_ZOOM}
                // 选中、删除、键盘都由我们自己的状态机管，关掉内置的那几套免得两边各说各话。
                deleteKeyCode={null}
                selectionKeyCode={null}
                multiSelectionKeyCode={null}
                disableKeyboardA11y
                connectOnClick={false}
                zoomOnDoubleClick={false}
                zoomOnScroll={false}
                elevateNodesOnSelect={false}
                nodeDragThreshold={2}
                connectionRadius={28}
                connectionLineComponent={ConnectionLine}
                proOptions={{ hideAttribution: true }}
                onNodesChange={onNodesChange}
                // 两头的连接点分工要对得上（见 model/connect.ts）：不连自己、资源不连资源、
                // 步骤右边只连步骤、步骤底边只连资源、资源只连步骤。
                isValidConnection={(connection) => linkAllowed(docRef.current, connection)}
                onConnect={(connection) => {
                  onEdit({ type: 'connect', source: connection.source, target: connection.target })
                }}
                onConnectEnd={(event, state) => {
                  // 线拖到空白处松手：就地加一个步骤并连上；从步骤底边拖出来的是新建一个放着产出文件的资源。
                  if (state.isValid === true || state.fromNode === null) return
                  if (state.fromHandle?.type !== 'source') return
                  const point = 'changedTouches' in event ? event.changedTouches[0] : event
                  if (point === undefined) return
                  const target = event.target
                  if (
                    !(target instanceof Element) ||
                    !target.classList.contains('react-flow__pane')
                  )
                    return
                  const client = { x: point.clientX, y: point.clientY }
                  const at = flow.screenToFlowPosition(client)
                  if (state.fromHandle.id === 'file' || state.fromHandle.id === 'fileUp') {
                    onEdit({
                      type: 'addResource',
                      data: outputResource({
                        path: freeFilePath(docRef.current, `${state.fromNode.id}.md`),
                      }),
                      // 松手处就是新资源卡左边的入口：线落在哪，卡就从哪接上。
                      position: { x: at.x, y: at.y - RES_H / 2 },
                      writer: state.fromNode.id,
                      select: true,
                    })
                    return
                  }
                  onRequestAdd({
                    client,
                    flow: { x: at.x, y: at.y - NODE_H / 2 },
                    from: state.fromNode.id,
                  })
                }}
                onNodeClick={(_event, node) => onSelect({ kind: 'node', id: node.id })}
                onNodeDragStart={(_event, node) => onSelect({ kind: 'node', id: node.id })}
                onEdgeMouseEnter={(_event, edge) => setHoverEdge(edge.id)}
                onEdgeMouseLeave={() => setHoverEdge(null)}
                onEdgeClick={(_event, edge) => {
                  onSelect({ kind: 'edge', id: edge.id })
                  // 连线是 SVG，点它之后焦点会掉到 body：收回画布，Delete / Esc 才有人接。
                  focusCanvas()
                }}
                onPaneClick={() => {
                  onSelect(null)
                  focusCanvas()
                }}
                onMoveStart={() => setCanvasMoving(true)}
                onMoveEnd={(event, viewport) => {
                  setCanvasMoving(false)
                  // 只记人动的视口；程序触发的移动（看全图、定位）事件参数是 null。
                  // 视口只记在浏览器里：浏览不改图，不会变成「待保存」。
                  if (event !== null && viewKey !== undefined) rememberViewport(viewKey, viewport)
                }}
              >
                <Background
                  variant={BackgroundVariant.Dots}
                  gap={20}
                  size={1.6}
                  color="var(--wl-dot)"
                />
              </ReactFlow>
            </StreaksMode.Provider>
          </DragInfo.Provider>
        </DisplayContext.Provider>
      </LabelLayer.Provider>

      {doc.nodes.length === 0 && (
        <div className={css.empty} data-testid="wl-empty">
          <div className={cx(ui.panel, css.emptyCard, ui.rise)}>
            <p className={css.emptyTitle}>{t('canvas.emptyTitle')}</p>
            <p className={css.emptyBody}>{t('canvas.emptyBody')}</p>
            <button
              type="button"
              className={cx(ui.btn, ui.soft)}
              data-testid="wl-starter"
              onClick={props.onStarter}
            >
              <Icon name="play" size={13} />
              {t('canvas.starter')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
