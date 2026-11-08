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
import {
  Background,
  BackgroundVariant,
  MarkerType,
  type NodeChange,
  ReactFlow,
  useConnection,
  useReactFlow,
  useStore,
} from '@xyflow/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphAnalysis } from '../../../shared/graph.ts'
import { inputKind } from '../../../shared/inputs.ts'
import { type MemoryEntry, memoryTitle } from '../../../shared/memoryLib.ts'
import { idKey, isInput, isResource } from '../../../shared/model.ts'
import { memoryOf } from '../../../shared/presets.ts'
import {
  edgeKind,
  isShared,
  nodeIndex,
  outputResource,
  type ResourceRole,
  resolveHandoff,
  resourceGraph,
  resourceTitle,
  roleOf,
} from '../../../shared/resources.ts'
import type { NodeStatus } from '../../../shared/runState.ts'
import type {
  MemoryType,
  Point,
  ResourceView,
  ValidationProblem,
  WorkflowDocument,
  WorkflowNode,
} from '../../../shared/types.ts'
import { findMemory } from '../../app/memories.ts'
import { recallViewport, rememberViewport } from '../../app/viewport.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { type CardKind, dragKindOf, linkAllowed, previewLink } from '../../model/connect.ts'
import { displayOf } from '../../model/display.ts'
import { type Edit, type Selection, whenOf } from '../../model/editor.ts'
import {
  cardSize,
  isCompactResource,
  NODE_H,
  NODE_W,
  nextTo,
  RES_H,
  RES_SHOWN,
} from '../../model/layout.ts'
import { DND_MIME, decodeStepSource, type StepSource } from '../../model/library.ts'
import { type Chip, nudge, placeChips, type Track } from '../../model/nudge.ts'
import type { Rect } from '../../model/route.ts'
import { DisplayContext, type DisplayEnv } from '../display/displayEnv.ts'
import type { FocusFile } from '../editor/Handoff.tsx'
import { Icon } from '../kit/Icon.tsx'
import { cx } from '../kit/primitives.tsx'
import { freeFilePath, itemText, KIND_LABEL } from '../kit/resourceUi.ts'
import { lookOf } from '../kit/StepMark.tsx'
import ui from '../kit/ui.module.css'
import { setCanvasMoving } from '../motion/canvasMoving.ts'
import { useCanvasExits } from '../motion/exits.tsx'
import { resourceTint } from '../resources/ResourcePresets.tsx'
import css from './canvas.module.css'
import { cardKindOf, RUN_TEXT } from './cards/cardParts.ts'
import { InputCard } from './cards/InputCard.tsx'
import { ResourceCard } from './cards/ResourceCard.tsx'
import { StepCard } from './cards/StepCard.tsx'
import {
  ConnectionLine,
  type DragContext,
  DragInfo,
  dragColor,
  PREVIEW_COLOR,
} from './lines/ConnectionLine.tsx'
import { FileLine } from './lines/FileLine.tsx'
import { StreaksMode } from './lines/FlowStreaks.tsx'
import { LabelLayer } from './lines/LabelLayer.tsx'
import { LinkLine } from './lines/LinkLine.tsx'
import { ACCESS_COLOR, type Access, WHEN_COLOR, whenKind } from './lines/lines.ts'
import { type Corridor, type EdgeRoute, linkOf, routeEdge } from './lines/route.ts'
import type {
  CardDisplay,
  CardItem,
  FlowEdge,
  FlowNode,
  HandoffActs,
  LaneShift,
  ResourceCardData,
  RunMark,
  StepRun,
  Tone,
} from './types.ts'

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

const MARK_TEXT: Record<RunMark, LocaleKey> = { last: 'run.lastRun', next: 'run.nextUp' }

const ROLE_TEXT: Record<ResourceRole, LocaleKey> = {
  producer: 'role.producer',
  updater: 'role.updater',
  reader: 'role.reader',
}

const ACCESS_TEXT: Record<Access, LocaleKey> = {
  produce: 'file.produce',
  update: 'file.update',
  read: 'file.read',
  ask: 'file.ask',
}

const NO_HANDLES: readonly string[] = []

/** 用户开了「减少动态效果」：滚轮缩放直接到位。 */
const REDUCED = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true
const MIN_ZOOM = 0.2
const MAX_ZOOM = 1.5
/** 自动看全图不放大过 100%，也不缩到读不了字。 */
const AUTO_FIT = { minZoom: 0.55, maxZoom: 1 }

/** 文件名的扩展名，大写、最多 4 个字（`review.md` → `MD`）；没有就是空串。 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name
    .slice(dot + 1)
    .toUpperCase()
    .slice(0, 4)
}

/** `nodeTypes` / `edgeTypes` 必须是稳定引用，否则 React Flow 每次渲染都重建全部节点。 */
const NODE_TYPES = { wfNode: StepCard, wfResource: ResourceCard, wfInput: InputCard }
const EDGE_TYPES = { wfEdge: LinkLine, wfFileLink: FileLine }

// ─────────────────────────────────────────────────────────────
// 画布
// ─────────────────────────────────────────────────────────────

/** 提示词压成一行摘要（卡片上最多露两行）。 */
function excerptOf(prompt: string | undefined): string {
  if (prompt === undefined) return ''
  return prompt.replace(/\s+/gu, ' ').trim().slice(0, 160)
}

interface CacheEntry {
  node: WorkflowNode
  signature: string
  flow: FlowNode
}

/** 连线对象的缓存：内容没变就交回同一个对象，React Flow 不重画这条线。 */
interface EdgeCacheEntry {
  signature: string
  flow: FlowEdge
}

/** 连线对象的指纹：除了回调与翻译函数（它们换了就整份缓存作废，见 `edges`）。 */
function edgeSignature(edge: FlowEdge): string {
  return JSON.stringify(edge, (key, value) =>
    key === 't' || key === 'onPick' || key === 'acts' ? undefined : value,
  )
}

export function Canvas(props: CanvasProps): React.JSX.Element {
  const {
    t,
    doc,
    analysis,
    selection,
    problems,
    focusFile: hoveredFile,
    onEdit,
    onSeal,
    onSelect,
    onRequestAdd,
    onDropSource,
    run,
  } = props
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
    map: new Map<string, EdgeCacheEntry>(),
  })
  const docRef = useRef(doc)
  docRef.current = doc
  /** 没在拖卡片时挑好的各条线的走法：拖动中没碰到的线照用（见 `routes`）。 */
  const routeBase = useRef<{
    doc: WorkflowDocument
    sized: number
    routes: Map<string, EdgeRoute | null>
  } | null>(null)

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

  // ── 拖线：只露出能连的连接点，落到目标上时整张卡按连上后的线色亮起来 ──
  // 选择器只吐一个字符串：指针移动不会让画布重渲染，只有起点 / 目标 / 有效性变了才会。
  const dragKey = useConnection((connection) =>
    connection.inProgress
      ? JSON.stringify([
          connection.fromNode.id,
          cardKindOf(connection.fromNode.type),
          connection.fromHandle.id ?? null,
          connection.fromHandle.type,
          connection.toNode?.id ?? null,
          connection.toHandle?.id ?? null,
          connection.isValid === true,
        ])
      : '',
  )
  const dragInfo = useMemo<DragContext>(
    () => ({ preview: (link) => previewLink(doc, link), t }),
    [doc, t],
  )
  const drag = useMemo(() => {
    if (dragKey === '') return null
    const [fromNode, fromCard, fromHandle, fromType, toNode, toHandle, valid] = JSON.parse(
      dragKey,
    ) as [
      string,
      CardKind,
      string | null,
      'source' | 'target',
      string | null,
      string | null,
      boolean,
    ]
    const kind = dragKindOf(fromCard, fromHandle)
    const preview =
      valid && toNode !== null
        ? previewLink(doc, linkOf(fromNode, { id: fromHandle, type: fromType }, toNode, toHandle))
        : null
    return { kind, color: preview === null ? dragColor(kind) : PREVIEW_COLOR[preview.kind] }
  }, [dragKey, doc])
  // 拖线时不做悬停资源的聚光：拖过资源卡不该把别的卡都淡下去。
  // 拖卡片时聚光定在开拖那一刻：拖着的卡从别的资源卡底下钻过时，指针会落到那张卡上，
  // 不定住的话整张画布的线和卡跟着一明一暗，每次都是整页样式重算。
  const dragFocus = useRef<string | null>(null)
  const draggingCard = streakMode === 'hold'
  if (!draggingCard) dragFocus.current = hoveredFile
  const focusFile = drag === null ? (draggingCard ? dragFocus.current : hoveredFile) : null
  const focused = focusFile === null ? undefined : files.get(focusFile)

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

  const texts = useMemo(
    () => ({
      noPromptText: t('node.noPrompt'),
      addText: t('node.add'),
      fileText: t('node.fileHandle'),
      readText: t('res.connectHint'),
      askText: t('input.connectHint'),
      emptyQuestion: t('input.questionEmpty'),
      required: t('input.required'),
      inputKinds: {
        text: t('input.kind.text'),
        textarea: t('input.kind.textarea'),
        choice: t('input.kind.choice'),
        multi: t('input.kind.multi'),
      },
      optionsCount: t('input.optionsCount'),
      otherTag: t('input.otherTag'),
      resEmpty: t('res.cardEmpty'),
      resEmptySub: t('res.cardEmptySub'),
      resShared: t('res.sharedTip'),
      resCount: t('res.itemCount'),
      resMore: t('res.moreItems'),
      kinds: {
        file: t(KIND_LABEL.file),
        folder: t(KIND_LABEL.folder),
        url: t(KIND_LABEL.url),
        skill: t(KIND_LABEL.skill),
        text: t(KIND_LABEL.text),
      },
      pass: t('edge.pass'),
      fail: t('edge.fail'),
      generated: t('run.fileMade'),
      memOn: t('mem.on'),
      memOff: t('mem.off'),
      memTypes: {
        workflow: t('mem.type.workflow'),
        step: t('mem.type.step'),
      } satisfies Record<MemoryType, string>,
      memShared: t('mem.alsoUsed'),
      produce: t(ACCESS_TEXT.produce),
      update: t(ACCESS_TEXT.update),
      read: t(ACCESS_TEXT.read),
      ask: t(ACCESS_TEXT.ask),
      displayOpen: t('display.open'),
      displayInteract: t('display.interact'),
      displayLeave: t('display.leave'),
      displayResize: t('display.resize'),
      displayZoomTag: t('display.zoomTag'),
    }),
    [t],
  )

  /**
   * 每条读写线挂在哪两个连接点上（按两张卡当下的位置挑，见 model/route.ts），
   * 以及每张卡上哪些点挂着线（备用的点只有挂上线才显示）。拖动中的卡按临时坐标算，线实时换点。
   */
  const routes = useMemo(() => {
    const index = nodeIndex(doc)
    const rectFor = (node: WorkflowNode): Rect => {
      const at = dragging[node.id] ?? node.position
      const size = measured.current.get(node.id)
      const nominal = cardSize(node)
      return {
        x: at.x,
        y: at.y,
        w: size?.width ?? nominal.w,
        h: size?.height ?? nominal.h,
      }
    }
    const handles = new Map<string, { source: string; target: string }>()
    const used = new Map<string, string[]>()
    const lanes = new Map<string, number>()
    /** 改走绕行直角折线的读写线：折点（含两头）。 */
    const bends = new Map<string, [number, number][]>()
    const rects = new Map(doc.nodes.map((node) => [idKey(node.id), rectFor(node)]))
    const boxes = [...rects.values()]
    /** 直角走的线（走廊线、绕行折线、写线的树干）：挑完路之后统一分道，不同颜色的不叠在一条道上。 */
    const tracks: Track[] = []
    const corridors = new Map<string, Corridor>()
    // 拖卡片时只给碰到的线重新挑路：两头有被拖的卡、或被拖的卡压到了它松手前的走法。
    // 其余的线沿用松手前那一份（被拖的卡离开后它们可能有更短的走法，松手时整张图重挑一次）。
    const movedIds = new Set(Object.keys(dragging).map(idKey))
    const base = routeBase.current
    const reuse =
      movedIds.size > 0 && base !== null && base.doc === doc && base.sized === sized
        ? base.routes
        : null
    const moved = [...movedIds].flatMap((id) => rects.get(id) ?? [])
    const picked = new Map<string, EdgeRoute | null>()
    for (const edge of doc.edges) {
      const cached = reuse?.get(edge.id)
      const route =
        cached !== undefined &&
        !movedIds.has(idKey(edge.source)) &&
        !movedIds.has(idKey(edge.target)) &&
        (cached === null || !cached.hitBy(moved))
          ? cached
          : routeEdge(edge, edgeKind(index, edge), rects, boxes)
      picked.set(edge.id, route)
      if (route === null) continue
      if (route.lane !== undefined) lanes.set(edge.id, route.lane)
      if (route.corridor !== undefined) corridors.set(edge.id, route.corridor)
      if (route.bend !== undefined) bends.set(edge.id, route.bend)
      if (route.track !== undefined) tracks.push(route.track)
      if (route.handles !== undefined) handles.set(edge.id, route.handles)
      for (const [nodeId, handle] of route.marks ?? []) {
        const list = used.get(idKey(nodeId)) ?? []
        if (!list.includes(handle)) list.push(handle)
        used.set(idKey(nodeId), list)
      }
    }
    if (movedIds.size === 0) routeBase.current = { doc, sized, routes: picked }
    const shifts = new Map<string, LaneShift>()
    for (const [id, points] of nudge(tracks, boxes)) {
      const corridor = corridors.get(id)
      if (corridor === undefined) {
        bends.set(id, points)
        continue
      }
      const [, outer, lane, inner] = points as [number, number][]
      if (outer === undefined || lane === undefined || inner === undefined) continue
      lanes.set(id, lane[1])
      shifts.set(id, { out: outer[0] - corridor.right, in: inner[0] - corridor.left })
    }
    // 并排走同一段走廊的线，牌子沿走廊错开，不一块压住一块。
    const chips: Chip[] = []
    for (const [id, corridor] of corridors) {
      const lane = lanes.get(id)
      if (lane === undefined || corridor.chip === null) continue
      const shift = shifts.get(id)
      const right = corridor.right + (shift?.out ?? 0)
      const left = corridor.left + (shift?.in ?? 0)
      chips.push({
        id,
        y: lane,
        from: left,
        to: right,
        prefer: corridor.back ? left + (right - left) * 0.3 : (left + right) / 2,
        width: corridor.chip,
      })
    }
    const labels = placeChips(chips)
    return { handles, used, lanes, bends, shifts, labels }
  }, [doc, dragging, sized])

  const nodes = useMemo<FlowNode[]>(() => {
    const next = new Map<string, CacheEntry>()
    const selectedId = selection?.kind === 'node' ? idKey(selection.id) : null
    const list = doc.nodes.map((node): FlowNode => {
      const reported = tones.get(idKey(node.id))
      const selected = idKey(node.id) === selectedId
      const moving = dragging[node.id]
      let signature: string
      let build: () => FlowNode
      const used = routes.used.get(idKey(node.id)) ?? NO_HANDLES
      if (isInput(node)) {
        const tone: Tone = reported?.tone ?? 'ok'
        const note = reported?.note ?? ''
        const dim = focusFile !== null
        const kind = inputKind(node.data)
        const question = node.data.question.trim()
        const options = (node.data.options ?? []).filter((option) => option.trim() !== '')
        const meta = [
          texts.inputKinds[kind],
          ...(kind === 'choice' || kind === 'multi'
            ? [texts.optionsCount.replace('{n}', String(options.length))]
            : []),
          ...(node.data.required === true ? [texts.required] : []),
          ...(node.data.other === true && (kind === 'choice' || kind === 'multi')
            ? [texts.otherTag]
            : []),
        ].join(' · ')
        signature = `${selected}|${tone}|${note}|${dim}|${texts.askText}|${meta}`
        build = () => ({
          id: node.id,
          type: 'wfInput',
          position: moving ?? node.position,
          selected,
          data: {
            question,
            meta,
            kind,
            tone,
            note,
            emptyText: texts.emptyQuestion,
            connectText: texts.askText,
            dim,
          },
        })
      } else if (isResource(node)) {
        const isFocus = focusFile !== null && idKey(focusFile) === idKey(node.id)
        const tone: Tone = reported?.tone ?? 'ok'
        const note = reported?.note ?? ''
        const dim = focusFile !== null && !isFocus
        const made = run?.files[node.id]
        const info = files.get(node.id)
        const shared = info !== undefined && isShared(info)
        const memory = memoryOf(node.data)
        const compact = memory !== undefined || isCompactResource(node.data)
        const all = node.data.items
        const first = all[0]
        const items: CardItem[] = all.slice(0, compact ? 1 : RES_SHOWN).map((item, index) => ({
          kind: item.kind,
          text: itemText(item) || '—',
          made: made === undefined ? null : (made[index] ?? null),
        }))
        const firstNote = first?.note?.replace(/\s+/gu, ' ').trim() ?? ''
        const label = node.data.label?.trim() ?? ''
        const entry =
          memory === undefined ? undefined : findMemory(props.memories ?? null, memory.memory)
        const others =
          entry?.usedBy.filter(
            (name) => props.workflow == null || idKey(name) !== idKey(props.workflow),
          ) ?? []
        const title =
          memory !== undefined
            ? entry !== undefined
              ? memoryTitle(entry)
              : label !== ''
                ? label
                : memory.memory || texts.memTypes[memory.type]
            : compact && first === undefined
              ? texts.resEmpty
              : compact && first !== undefined
                ? itemText(first) || texts.kinds[first.kind]
                : resourceTitle(node)
        const sub =
          memory !== undefined
            ? `${texts.memTypes[memory.type]} · ${memory.memory || '—'}`
            : first === undefined
              ? texts.resEmptySub
              : firstNote !== ''
                ? firstNote
                : first.kind === 'file' || first.kind === 'folder' || first.kind === 'url'
                  ? first.value.trim()
                  : texts.kinds[first.kind]
        const ext = first?.kind === 'file' ? extensionOf(itemText(first)) : ''
        const description = (node.data.description ?? '').replace(/\s+/gu, ' ').trim()
        const shownView = memory === undefined ? displayOf(node.data) : null
        const shownItem = shownView === null ? undefined : all[shownView.item]
        const display: CardDisplay | null =
          shownView === null || shownItem === undefined || node.data.view === undefined
            ? null
            : {
                info: shownView,
                item: shownItem,
                view: node.data.view,
                writing:
                  info?.writers.some((writer) => run?.nodes[writer.id]?.status === 'running') ===
                  true,
                made: made === undefined ? null : (made[shownView.item] ?? null),
                ext:
                  shownItem.kind === 'file'
                    ? extensionOf(shownItem.value).toUpperCase().slice(0, 4)
                    : '',
                openText: texts.displayOpen,
                interactText: texts.displayInteract,
                leaveText: texts.displayLeave,
                resizeText: texts.displayResize,
                zoomText: texts.displayZoomTag,
              }
        const data: ResourceCardData = {
          compact,
          title,
          sub,
          description,
          items,
          more: Math.max(0, all.length - RES_SHOWN),
          moreText: texts.resMore.replace('{n}', String(Math.max(0, all.length - RES_SHOWN))),
          countText: texts.resCount.replace('{n}', String(all.length)),
          emptyText: texts.resEmpty,
          tab: { kind: first?.kind ?? 'many', ext },
          memory: memory === undefined ? null : memory.type === 'workflow' ? 'global' : 'step',
          memoryShared:
            others.length === 0 ? null : texts.memShared.replace('{n}', String(others.length)),
          tint: resourceTint(node.data),
          shared,
          sharedText: texts.resShared,
          tone,
          note,
          focused: isFocus,
          dim,
          readText: texts.readText,
          onFocusFile,
          generatedText: texts.generated,
          display,
          onView,
        }
        signature = JSON.stringify([selected, used, { ...data, onFocusFile: null, onView: null }])
        build = () => ({
          id: node.id,
          type: 'wfResource',
          position: moving ?? node.position,
          selected,
          data,
        })
      } else {
        const prompt = node.data.prompt
        const empty = prompt === undefined || prompt.trim() === ''
        const tone: Tone = empty ? 'error' : (reported?.tone ?? 'ok')
        const note = empty ? texts.noPromptText : (reported?.note ?? '')
        const role = focused === undefined ? null : roleOf(focused, node.id)
        const dim = focusFile !== null && role === null
        const state = run?.nodes[node.id]
        const stepRun: StepRun | null =
          state === undefined
            ? null
            : {
                ...state,
                label: t(RUN_TEXT[state.status]),
                roundText: t('run.round').replace('{n}', String(state.round)),
                markText: state.mark === undefined ? '' : t(MARK_TEXT[state.mark]),
              }
        const memoryOn = memorySteps.has(idKey(node.id))
        const memoryText = memoryOn ? texts.memOff : texts.memOn
        signature = `${selected}|${tone}|${note}|${texts.addText}|${texts.fileText}|${role}|${dim}|${used.join(',')}|${memoryOn}|${memoryText}|${memoryToggle}|${stepRun === null ? '' : `${stepRun.status}/${stepRun.round}/${stepRun.edited}/${stepRun.label}/${stepRun.mark}`}`
        build = () => ({
          id: node.id,
          type: 'wfNode',
          position: moving ?? node.position,
          selected,
          data: {
            used,
            title:
              node.data.label === undefined || node.data.label === '' ? node.id : node.data.label,
            look: lookOf(node.id, node.data),
            // 写了描述就用描述（那是给人看的一句话），没写才摘提示词。
            excerpt:
              node.data.description !== undefined && node.data.description.trim() !== ''
                ? node.data.description
                : excerptOf(prompt),
            tone,
            note,
            noPromptText: texts.noPromptText,
            addText: texts.addText,
            fileText: texts.fileText,
            role,
            roleText: role === null ? '' : t(ROLE_TEXT[role]),
            dim,
            onAdd,
            memory: memoryOn,
            memoryText,
            onMemory: memoryToggle ? onMemory : null,
            run: stepRun,
            onRunStatus,
          },
        })
      }
      const cached = cache.current.get(node.id)
      if (
        moving === undefined &&
        cached !== undefined &&
        cached.node === node &&
        cached.signature === signature
      ) {
        next.set(node.id, cached)
        return cached.flow
      }
      const size = measured.current.get(node.id)
      const built = build()
      if (size !== undefined) built.measured = size
      // 拖动中的对象每帧都不同，不进缓存；松手后按文档里的新坐标重建一次再缓存。
      if (moving === undefined) next.set(node.id, { node, signature, flow: built })
      return built
    })
    cache.current = next
    return list
  }, [
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
  ])

  const edges = useMemo<FlowEdge[]>(() => {
    const selectedId = selection?.kind === 'edge' ? selection.id : null
    const index = nodeIndex(doc)
    const nameOf = (id: string): string => {
      const node = index.get(idKey(id))
      if (node === undefined) return id
      if (isResource(node)) return resourceTitle(node)
      if (isInput(node)) return node.data.question
      return node.data.label === undefined || node.data.label === '' ? id : node.data.label
    }
    // 聚光：悬停的资源卡优先，其次是选中的节点。和它相连的线"活"起来（光带流动、标明种类），
    // 其余的线淡下去，一眼看清它从哪儿拿、往哪儿交。
    const spotlight =
      focusFile !== null
        ? idKey(focusFile)
        : selection?.kind === 'node'
          ? idKey(selection.id)
          : null
    // 拖卡片时这里每帧都重算：内容没变的线交回上一帧的同一个对象，只有真的动了的线才重画。
    if (
      edgeCache.current.t !== t ||
      edgeCache.current.onPick !== onPick ||
      edgeCache.current.acts !== acts
    ) {
      edgeCache.current = { t, onPick, acts, map: new Map() }
    }
    const previous = edgeCache.current.map
    const next = new Map<string, EdgeCacheEntry>()
    const reuse = (built: FlowEdge): FlowEdge => {
      const signature = edgeSignature(built)
      const cached = previous.get(built.id)
      const kept = cached !== undefined && cached.signature === signature ? cached.flow : built
      next.set(built.id, { signature, flow: kept })
      return kept
    }
    // 活着的线画在最上面，不被淡下去的线压住：靠每条线的 zIndex，不挪它在数组里的位置——
    // 挪位置会让 React 把一大串线的元素拔下来再插回去，宿主的 `:has()` 规则下每次插拔都是整页样式重算。
    const list = doc.edges.map((edge): FlowEdge => {
      const selected = edge.id === selectedId
      const kind = edgeKind(index, edge)
      const touches =
        spotlight !== null && (idKey(edge.source) === spotlight || idKey(edge.target) === spotlight)
      // 实例视图：走过的线照常、没走过的淡下去；通往正在执行的步骤的线上跑光带。
      const taken = run === undefined || run.taken.has(edge.id)
      const live = run !== undefined && taken && run.nodes[edge.target]?.status === 'running'
      const active = selected || edge.id === hoverEdge || touches || live
      const dim = (spotlight !== null && !touches && !selected) || (!taken && !selected)
      if (kind === 'write' || kind === 'read' || kind === 'ask') {
        const access: Access =
          kind === 'ask'
            ? 'ask'
            : kind === 'read'
              ? 'read'
              : edge.data?.update === true
                ? 'update'
                : 'produce'
        const color = ACCESS_COLOR[access]
        const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14, color }
        return reuse({
          id: edge.id,
          type: 'wfFileLink',
          source: edge.source,
          target: edge.target,
          // 挂在哪两个点上由 routes 按两张卡的位置挑好了。
          sourceHandle: routes.handles.get(edge.id)?.source ?? (kind === 'write' ? 'file' : 'out'),
          targetHandle: routes.handles.get(edge.id)?.target ?? (kind === 'write' ? 'in' : 'read'),
          selected,
          zIndex: active ? 1 : 0,
          className: cx(
            css.fileLink,
            access === 'read' && css.fileLinkRead,
            access === 'ask' && css.fileLinkAsk,
            active && css.linkActive,
            dim && css.linkDim,
          ),
          markerEnd: arrow,
          // 更新 = 读了再写回去：两头都有箭头。
          ...(access === 'update'
            ? { markerStart: { ...arrow, orient: 'auto-start-reverse' } }
            : {}),
          data: {
            kind: kind === 'write' ? 'write' : 'read',
            cardH: (() => {
              const card = index.get(idKey(kind === 'write' ? edge.target : edge.source))
              return card === undefined ? RES_H : cardSize(card).h
            })(),
            access,
            color,
            active,
            chipText: texts[access],
            points: routes.bends.get(edge.id) ?? null,
          },
        })
      }
      const when = whenOf(edge)
      const mode = whenKind(when)
      const back = analysis.backEdges.has(edge.id)
      const handoff = resolveHandoff(edge.data?.handoff)
      // 线色只看条件：选中 / 悬停时描粗、加光晕，不换色——一条线从头到尾就是那一个颜色。
      const color = WHEN_COLOR[mode]
      return reuse({
        id: edge.id,
        type: 'wfEdge',
        source: edge.source,
        target: edge.target,
        sourceHandle: 'out',
        targetHandle: 'in',
        selected,
        zIndex: active ? 1 : 0,
        className: cx(
          css.link,
          back && css.linkBack,
          !handoff.result && css.linkOrderOnly,
          active && css.linkActive,
          dim && css.linkDim,
        ),
        // 箭头颜色传 CSS 变量：React Flow 把它写进箭头的内联样式，跟着主题与语气走。
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
        data: {
          when: mode,
          back,
          text: when === 'pass' ? texts.pass : when === 'fail' ? texts.fail : (when ?? ''),
          handoff:
            !handoff.result || handoff.note !== undefined
              ? {
                  none: !handoff.result,
                  ...(handoff.note === undefined ? {} : { note: handoff.note }),
                }
              : null,
          route: `${nameOf(edge.source)} → ${nameOf(edge.target)}`,
          active,
          color,
          lane: routes.lanes.get(edge.id) ?? null,
          shift: routes.shifts.get(edge.id) ?? null,
          labelX: routes.labels.get(edge.id) ?? null,
          t,
          onPick,
          acts,
        },
      })
    })
    edgeCache.current.map = next
    return list
  }, [doc, analysis, selection, texts, onPick, acts, focusFile, hoverEdge, routes, t, run])

  // 删掉的步骤、资源、连线原地退场（同一份文档里少了的才放，换图不放）。
  const flowIds = useMemo(
    () => [...nodes.map((node) => node.id), ...edges.map((edge) => edge.id)],
    [nodes, edges],
  )
  useCanvasExits(wrapRef, props.loadKey, flowIds)

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]): void => {
      let moved: Record<string, Point> | null = null
      let resized = false
      const settled: Record<string, Point> = {}
      let finished = false
      for (const change of changes) {
        if (change.type === 'dimensions' && change.dimensions !== undefined) {
          const before = measured.current.get(change.id)
          if (
            before === undefined ||
            Math.abs(before.width - change.dimensions.width) > 0.5 ||
            Math.abs(before.height - change.dimensions.height) > 0.5
          ) {
            resized = true
          }
          measured.current.set(change.id, change.dimensions)
          continue
        }
        if (change.type !== 'position' || change.position === undefined) continue
        if (change.dragging === false) {
          finished = true
          settled[change.id] = change.position
        } else {
          moved = { ...(moved ?? draggingRef.current), [change.id]: change.position }
        }
      }
      if (resized) setSized((count) => count + 1)
      if (finished) {
        // 松手：把这次拖拽的终点一次写进文档，同一批里清掉临时坐标。
        onEdit({ type: 'moveNodes', positions: { ...draggingRef.current, ...settled } })
        setDragging({})
        return
      }
      if (moved !== null) setDragging(moved)
    },
    [onEdit],
  )

  // ── 视口：换基线时恢复上次的视角；是默认视角（新图）就看全图 ──
  const insets = useRef(props.insets)
  insets.current = props.insets
  const settled = useRef(props.onSettled)
  settled.current = props.onSettled
  const viewKey = props.viewKey
  useEffect(() => {
    const saved =
      (viewKey === undefined ? null : recallViewport(viewKey)) ?? docRef.current.viewport
    const untouched = saved.x === 0 && saved.y === 0 && saved.zoom === 1
    const settle = (): number =>
      requestAnimationFrame(() => {
        settled.current?.()
      })
    if (!untouched) {
      void flow.setViewport(saved)
      const done = settle()
      return () => cancelAnimationFrame(done)
    }
    if (docRef.current.nodes.length === 0) {
      settled.current?.()
      return
    }
    // 等卡片渲染并量完尺寸再看全图（隔两帧）。
    let second = 0
    let third = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        void flow.fitView({
          ...AUTO_FIT,
          padding: {
            top: '84px',
            bottom: '64px',
            left: `${insets.current.left + 28}px`,
            right: `${insets.current.right + 28}px`,
          },
        })
        third = settle()
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
      cancelAnimationFrame(third)
    }
  }, [props.loadKey, viewKey, flow])

  // ── 从步骤库拖进来 ──────────────────────────────────────────

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes(DND_MIME)) return
    // 不 preventDefault 的话浏览器不认这里是放置区，`drop` 永远不会来。
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      // 解不出自家载荷（外部拖进来的文件、链接）一律安静地忽略。
      const source = decodeStepSource(event.dataTransfer.getData(DND_MIME))
      if (source === null) return
      event.preventDefault()
      const at = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      // 让卡片的中心落在指针上。
      onDropSource(source, { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 })
      wrapRef.current?.focus()
    },
    [flow, onDropSource],
  )

  const focusCanvas = useCallback((): void => wrapRef.current?.focus(), [])

  // 滚轮缩放换成「带缓动」的：d3 默认是每一格滚轮立刻跳一档，这里按光标位置算出目标视口，用 150ms 的过渡滑过去。
  // 目标记在 `pending` 里（连续滚时从目标接着算，不从还在动的中间值算，免得越滚越偏），停 250ms 就放掉。
  // 触控板捏合（带 ctrl）仍交给 d3，它的增量本来就细；`nowheel` 里的（带滚动条的面板）不管。
  useEffect(() => {
    const wrap = wrapRef.current
    if (wrap === null) return
    let pending: { x: number; y: number; zoom: number } | null = null
    let release = 0
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return
      const target = event.target
      if (!(target instanceof Element) || target.closest('.nowheel') !== null) return
      if (!target.closest('.react-flow')) return
      event.preventDefault()
      event.stopPropagation()
      const from = pending ?? flow.getViewport()
      const delta = -event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.002)
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, from.zoom * 2 ** delta))
      if (zoom === from.zoom) return
      const box = wrap.getBoundingClientRect()
      const px = event.clientX - box.left
      const py = event.clientY - box.top
      const k = zoom / from.zoom
      pending = { x: px - (px - from.x) * k, y: py - (py - from.y) * k, zoom }
      void flow.setViewport(pending, { duration: REDUCED ? 0 : 150 })
      window.clearTimeout(release)
      release = window.setTimeout(() => {
        pending = null
      }, 250)
    }
    wrap.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => {
      window.clearTimeout(release)
      wrap.removeEventListener('wheel', onWheel, { capture: true })
    }
  }, [flow])

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
