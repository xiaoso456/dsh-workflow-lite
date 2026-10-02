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
 * @module @xiaoso/dsh-workflow-lite/client/ui/Canvas
 */

import {
  Background,
  BackgroundVariant,
  BaseEdge,
  type ConnectionLineComponentProps,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  Handle,
  type InternalNode,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  useConnection,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  edgeKind,
  type FileRole,
  fileGraph,
  nodeIndex,
  resolveHandoff,
  roleOf,
} from '../../shared/files.ts'
import type { GraphAnalysis } from '../../shared/graph.ts'
import { idKey, isFile } from '../../shared/model.ts'
import type { NodeStatus } from '../../shared/runState.ts'
import type {
  Point,
  ValidationProblem,
  WorkflowDocument,
  WorkflowNode,
} from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import {
  type DragKind,
  dragKindOf,
  type HandleLink,
  type LinkPreview,
  linkAllowed,
  previewLink,
} from '../model/connect.ts'
import { type Edit, type Selection, whenOf } from '../model/editor.ts'
import { FILE_H, FILE_W, NODE_H, NODE_W, nextTo } from '../model/layout.ts'
import {
  DND_MIME,
  decodeStepSource,
  kindOf,
  type StepKind,
  type StepSource,
} from '../model/library.ts'
import {
  bezierBlocked,
  FILE_SPOTS,
  fileLinkEnds,
  flowBlocked,
  flowPath,
  freeLane,
  LOOP_REACH,
  nearestLane,
  type OrthoRoute,
  orthoRoute,
  pointsBlocked,
  type Rect,
  routeFileLink,
  type Side,
  type Spot,
  STEP_SPOTS,
  type StepFileHandle,
  spotOf,
  writePoints,
} from '../model/route.ts'
import css from './canvas.module.css'
import { baseName, freeFilePath } from './Files.tsx'
import { FlowStreaks } from './FlowStreaks.tsx'
import type { FocusFile } from './Handoff.tsx'
import hand from './handoff.module.css'
import { Icon, type IconName, kindIcon } from './Icon.tsx'
import { ACCESS_COLOR, type Access, WHEN_COLOR, type WhenKind, whenKind } from './lines.ts'
import { cx, useFloat } from './primitives.tsx'
import ui from './ui.module.css'

/** 「在这里加一个步骤」的请求：屏幕坐标用来摆菜单，画布坐标用来落节点。 */
export interface AddRequest {
  client: Point
  flow: Point
  /** 顺手从这个节点连过来（步骤 = 接一步；文件 = 新步骤读它）。 */
  from?: string
}

export interface CanvasProps {
  t: T
  doc: WorkflowDocument
  analysis: GraphAnalysis
  /** 换了一份基线（打开 / 重新加载）就变：据此重新定视口。 */
  loadKey: string
  selection: Selection
  problems: readonly ValidationProblem[]
  /** 自动看全图时四周要让开的浮层宽度。 */
  insets: { left: number; right: number }
  onEdit(edit: Edit): void
  onSelect(selection: Selection): void
  onRequestAdd(request: AddRequest): void
  onDropSource(source: StepSource, flow: Point): void
  onStarter(): void
  /** 正在悬停的文件卡 id：用到它的步骤标出角色，其余的淡下去。 */
  focusFile: string | null
  onFocusFile: FocusFile
  /**
   * 工作流实例视图：图不能改（不能拖、连、删、加），每张步骤卡挂上运行状态，走过的线亮、没走过的淡。
   * 缺省 = 模板编辑。
   */
  run?: RunDecor
}

/** 实例视图给画布的装饰。 */
export interface RunDecor {
  /** 每个步骤此刻的状态（已经叠上草稿）。 */
  nodes: Readonly<Record<string, { status: NodeStatus; round: number; edited: boolean }>>
  /** 走过的线。 */
  taken: ReadonlySet<string>
  /** 文件节点对应的文件在不在。 */
  files: Readonly<Record<string, boolean>>
  /** 点卡片上的状态小标：在它旁边弹出改状态的菜单。 */
  onStatus(id: string, anchor: Element): void
}

type Tone = 'ok' | 'warn' | 'error'

/** 卡片上的运行状态小标。 */
interface StepRun {
  status: NodeStatus
  round: number
  edited: boolean
  label: string
  roundText: string
}

interface StepData extends Record<string, unknown> {
  title: string
  /** 挂着读写线的连接点（这些点才显示出来）。 */
  used: readonly string[]
  kind: StepKind
  excerpt: string
  tone: Tone
  note: string
  noPromptText: string
  addText: string
  fileText: string
  /** 悬停某个文件时，这个步骤与它的关系；`dim` = 与它无关，淡下去。 */
  role: FileRole | null
  roleText: string
  dim: boolean
  onAdd: (id: string, anchor: Element) => void
  /** 实例视图里的运行状态；模板编辑时为 `null`。 */
  run: StepRun | null
  onRunStatus: (id: string, anchor: Element) => void
}

interface FileCardData extends Record<string, unknown> {
  name: string
  /** 挂着线的连接点（备用的那几个点只有挂上线才显示）。 */
  used: readonly string[]
  path: string
  rule: string
  noRuleText: string
  tone: Tone
  note: string
  /** 正在被悬停（或它的上下游正在被看）。 */
  focused: boolean
  dim: boolean
  readText: string
  onFocusFile: FocusFile
  /** 实例视图：这份文件已经生成了没有（模板编辑时为 `null`）。 */
  generated: boolean | null
  generatedText: string
}

interface LinkData extends Record<string, unknown> {
  /** 条件的种类：决定线色（见 lines.ts）。 */
  when: WhenKind
  back: boolean
  text: string
  /** 只在不是缺省时画交接标记：附了说明，或只管先后。 */
  handoff: { note?: string; none: boolean } | null
  /** 交接卡片的标题行：「上游 → 下游」。 */
  route: string
  /** 和选中（或悬停）的东西相连：线上有光带沿着方向流动。只管先后的线不流动——它什么都不交。 */
  active: boolean
  /** 线色（按条件分，一个 `var(--wl-flow-…)`）：箭头、光带、光晕、线上的牌子都用它。 */
  color: string
  /** 横着走的走廊 y（画布按卡片位置挑的）：往回走的线，或往右走却会压到卡片的线；其余是 `null`。 */
  lane: number | null
  t: T
  onPick: (id: string) => void
}

interface FileLinkData extends Record<string, unknown> {
  kind: 'write' | 'read'
  access: Access
  /** 线、箭头、光带的颜色（一个 `var(--wl-io-…)`）。 */
  color: string
  /** 与选中 / 悬停的东西相连：描粗、加光晕、光带流动、中点挂上「产出 / 更新 / 读取」的小牌子。 */
  active: boolean
  /** 平时的走法会压到别的卡片时，画布挑的绕行直角折线（含两头）；不用绕就是 `null`。 */
  points: [number, number][] | null
  chipText: string
}

type StepFlowNode = Node<StepData, 'wfNode'>
type FileFlowNode = Node<FileCardData, 'wfFile'>
type FlowNode = StepFlowNode | FileFlowNode
type LinkEdge = Edge<LinkData, 'wfEdge'>
type FileEdge = Edge<FileLinkData, 'wfFileLink'>
type FlowEdge = LinkEdge | FileEdge

const ROLE_TEXT: Record<FileRole, LocaleKey> = {
  producer: 'role.producer',
  updater: 'role.updater',
  reader: 'role.reader',
}

const ACCESS_TEXT: Record<Access, LocaleKey> = {
  produce: 'file.produce',
  update: 'file.update',
  read: 'file.read',
}

const ACCESS_ICON = { produce: 'pencil', update: 'reload', read: 'eye' } as const

/** 运行状态的图标与文案。 */
const RUN_ICON: Record<NodeStatus, IconName> = {
  pending: 'clock',
  running: 'play',
  waiting: 'hourglass',
  done: 'check',
  failed: 'alert',
  skipped: 'skip',
}

export const RUN_TEXT: Record<NodeStatus, LocaleKey> = {
  pending: 'run.status.pending',
  running: 'run.status.running',
  waiting: 'run.status.waiting',
  done: 'run.status.done',
  failed: 'run.status.failed',
  skipped: 'run.status.skipped',
}

const NO_HANDLES: readonly string[] = []

const MIN_ZOOM = 0.2
const MAX_ZOOM = 1.5
/** 自动看全图不放大过 100%，也不缩到读不了字。 */
const AUTO_FIT = { minZoom: 0.55, maxZoom: 1 }

// ─────────────────────────────────────────────────────────────
// 步骤卡
// ─────────────────────────────────────────────────────────────

/** 上下边上的连接点沿边摆在几成处：交给 CSS 变量，样式表据此定位（拖线时也要用它放回圆点）。 */
function spotVar(spot: Spot): React.CSSProperties {
  return { '--wl-at': spot.at } as React.CSSProperties
}

const StepCard = memo(function StepCard(props: NodeProps<StepFlowNode>): React.JSX.Element {
  const { data, id, selected } = props
  return (
    <div
      className={cx(css.card, selected && css.cardSelected)}
      data-tone={data.tone}
      data-dim={data.dim}
      data-role={data.role ?? undefined}
      data-run={data.run?.status}
      data-testid="wl-step"
      title={data.note === '' ? undefined : data.note}
    >
      {data.run !== null && (
        <button
          type="button"
          className={cx(css.runChip, 'nodrag')}
          data-status={data.run.status}
          data-edited={data.run.edited}
          data-testid="wl-run-chip"
          aria-haspopup="menu"
          onClick={(event) => {
            event.stopPropagation()
            data.onRunStatus(id, event.currentTarget)
          }}
        >
          <Icon name={RUN_ICON[data.run.status]} size={11} />
          <span>{data.run.label}</span>
          {data.run.round > 1 && <span className={css.runRound}>{data.run.roundText}</span>}
        </button>
      )}
      {data.role !== null && (
        <span className={css.roleTag} data-role={data.role} data-testid="wl-step-role">
          {data.roleText}
        </span>
      )}
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        className={cx(css.handle, css.handleIn, css.hStepIn)}
      />
      <div className={css.cardHead}>
        <span className={ui.kind} data-kind={data.kind}>
          <Icon name={kindIcon(data.kind)} size={15} />
        </span>
        <span className={css.cardTitle}>{data.title}</span>
        {data.tone !== 'ok' && (
          <span className={css.cardFlag} data-tone={data.tone}>
            <Icon name="alert" size={13} />
          </span>
        )}
      </div>
      {data.excerpt === '' ? (
        <p className={cx(css.cardBody, css.cardBodyEmpty)}>{data.noPromptText}</p>
      ) : (
        <p className={css.cardBody}>{data.excerpt}</p>
      )}
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className={cx(css.handle, css.handleOut, css.handleSource)}
        title={data.addText}
        onClick={(event) => data.onAdd(id, event.currentTarget)}
      />
      {/* 底边偏左的方点（文件树的树干）：拖到文件卡上 = 写它；拖到空白处 = 就地新建一个产出文件。
          其余读写点平时不露，有线挂上才显示（线挂在哪个点上见 model/route.ts）。 */}
      <Handle
        id="file"
        type="source"
        position={Position.Bottom}
        className={cx(css.handle, css.handleOut, css.handleFile, css.spotted)}
        style={spotVar(STEP_SPOTS.file)}
        data-used={data.used.includes('file')}
        title={data.fileText}
      />
      <Handle
        id="fileUp"
        type="source"
        position={Position.Top}
        className={cx(css.handle, css.handleOut, css.handleFileUp, css.handleAux, css.spotted)}
        style={spotVar(STEP_SPOTS.fileUp)}
        data-used={data.used.includes('fileUp')}
      />
      <Handle
        id="read"
        type="target"
        position={Position.Bottom}
        className={cx(css.handle, css.handleIn, css.hRead, css.handleAux, css.spotted)}
        style={spotVar(STEP_SPOTS.read)}
        data-used={data.used.includes('read')}
      />
      <Handle
        id="readTop"
        type="target"
        position={Position.Top}
        className={cx(css.handle, css.handleIn, css.hReadTop, css.handleAux, css.spotted)}
        style={spotVar(STEP_SPOTS.readTop)}
        data-used={data.used.includes('readTop')}
      />
    </div>
  )
})

// ─────────────────────────────────────────────────────────────
// 连线
// ─────────────────────────────────────────────────────────────

/** 折线从连接点伸出去多远再拐弯。 */
const ROUTE_PAD = 26
const ROUTE_RADIUS = 12

/** 把一串直角折点连成圆角路径。 */
function roundedPath(points: readonly [number, number][]): string {
  const first = points[0]
  if (first === undefined) return ''
  let d = `M ${first[0]} ${first[1]}`
  for (let index = 1; index < points.length - 1; index += 1) {
    const [px, py] = points[index - 1] as [number, number]
    const [cx, cy] = points[index] as [number, number]
    const [nx, ny] = points[index + 1] as [number, number]
    // 圆角半径不超过相邻两段各自的一半，短段也不会被拐穿。
    const r = Math.min(
      ROUTE_RADIUS,
      Math.hypot(cx - px, cy - py) / 2,
      Math.hypot(nx - cx, ny - cy) / 2,
    )
    const inX = cx - Math.sign(cx - px) * r
    const inY = cy - Math.sign(cy - py) * r
    const outX = cx + Math.sign(nx - cx) * r
    const outY = cy + Math.sign(ny - cy) * r
    d += ` L ${inX} ${inY} Q ${cx} ${cy} ${outX} ${outY}`
  }
  const last = points[points.length - 1] as [number, number]
  return `${d} L ${last[0]} ${last[1]}`
}

/**
 * 写线：从步骤的写点竖着出去、横着进文件卡左边的直角折线（折点见 route.ts 的 `writePoints`）。
 * @returns `[路径, 标签 x, 标签 y]`：标签落在竖段（树干）的中间，绕行时落在横走的那段中间。
 */
function writePath(
  sourceX: number,
  sourceY: number,
  sourcePosition: Position,
  targetX: number,
  targetY: number,
): [string, number, number] {
  const points = writePoints(
    { x: sourceX, y: sourceY, side: sourcePosition === Position.Top ? 'top' : 'bottom' },
    { x: targetX, y: targetY },
    FILE_H,
  )
  const path = roundedPath(points)
  if (points.length === 3) return [path, sourceX, (sourceY + targetY) / 2]
  const [ax, ay] = points[1] as [number, number]
  const [bx] = points[2] as [number, number]
  return [path, (ax + bx) / 2, ay]
}

/**
 * 画布挑好的绕行折线（见 route.ts 的 `orthoRoute`）：两头换成 React Flow 量出来的连接点坐标
 * （和按卡片尺寸算的可能差一两个像素），伸出去的那一小段跟着对齐，线才严丝合缝地接在点上。
 * @returns `[路径, 标签 x, 标签 y]`：标签落在最长那一段的中间。
 */
function routedPath(
  points: readonly [number, number][],
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): [string, number, number] {
  const fixed = points.map((point) => [...point] as [number, number])
  const snap = (end: number, next: number, x: number, y: number): void => {
    const at = fixed[end] as [number, number]
    const near = fixed[next] as [number, number] | undefined
    if (near !== undefined) {
      // 伸出去的那段是竖的就对齐 x，横的就对齐 y。
      if (near[0] === at[0]) near[0] = x
      else near[1] = y
    }
    fixed[end] = [x, y]
  }
  snap(0, 1, sourceX, sourceY)
  snap(fixed.length - 1, fixed.length - 2, targetX, targetY)
  let best = 0
  let mid: [number, number] = [sourceX, sourceY]
  for (let index = 1; index < fixed.length; index += 1) {
    const [ax, ay] = fixed[index - 1] as [number, number]
    const [bx, by] = fixed[index] as [number, number]
    const length = Math.abs(bx - ax) + Math.abs(by - ay)
    if (length > best) {
      best = length
      mid = [(ax + bx) / 2, (ay + by) / 2]
    }
  }
  return [roundedPath(fixed), mid[0], mid[1]]
}

/** 往回走的线从哪儿开始找走廊：两张卡上下错开时从两行中间找，挨在同一行时从两张卡下方找。 */
function laneStart(sy: number, ty: number): number {
  return Math.abs(ty - sy) > NODE_H + 40 ? (sy + ty) / 2 : Math.max(sy, ty) + NODE_H / 2 + 18
}

/**
 * 往回走的线：从出口向右伸出去，拐到一条横向"走廊"上走回来，再从左边进入目标。
 * 走廊由画布按卡片的位置挑（`freeLane`：不压到任何卡片，包括步骤下面挂着的文件卡）；
 * 右边那条竖段让过出口下面那串文件卡多伸出来的一截。
 * @returns `[路径, 标签 x, 标签 y]`（标签落在走廊正中）。
 */
function detour(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  lane: number,
): [string, number, number] {
  const right = sx + LOOP_REACH
  const left = tx - ROUTE_PAD
  const path = roundedPath([
    [sx, sy],
    [right, sy],
    [right, lane],
    [left, lane],
    [left, ty],
    [tx, ty],
  ])
  // 标签放在走廊偏目标的一侧：正中间常常正好压在别的线的标签上。
  return [path, left + (right - left) * 0.3, lane]
}

/**
 * 往右走、但贝塞尔会压到中间某张卡片的线（跨列的线最常见）：改走直角，先横着出去到列间的空当，
 * 竖着到一条不压卡片的走廊，横着过去，再竖着对齐入口进去。
 * @returns `[路径, 标签 x, 标签 y]`（标签落在走廊正中）。
 */
function bypass(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  lane: number,
): [string, number, number] {
  const right = sx + LOOP_REACH
  const left = tx - ROUTE_PAD
  const points: [number, number][] = [
    [sx, sy],
    [right, sy],
    [right, lane],
    [left, lane],
    [left, ty],
    [tx, ty],
  ]
  // 走廊正好和某一头齐平时，那一头的拐弯就省掉（不留零长的段）。
  const kept = points.filter((point, index) => {
    const previous = points[index - 1]
    const next = points[index + 1]
    if (previous === undefined || next === undefined) return true
    const straight =
      (previous[0] === point[0] && point[0] === next[0]) ||
      (previous[1] === point[1] && point[1] === next[1])
    return !straight
  })
  return [roundedPath(kept), (right + left) / 2, lane]
}

const LinkLine = memo(function LinkLine(props: EdgeProps<LinkEdge>): React.JSX.Element {
  const { id, data, markerEnd, sourceX, sourceY, targetX, targetY } = props
  // 往回走的线（循环、或终点在起点左边）用圆角折线绕开卡片；贝塞尔在这种时候会拧成一个结。
  const backwards = targetX < sourceX + 8
  const lane = data?.lane ?? null
  const [path, labelX, labelY] = backwards
    ? detour(sourceX, sourceY, targetX, targetY, lane ?? laneStart(sourceY, targetY))
    : lane === null
      ? flowPath(sourceX, sourceY, targetX, targetY)
      : bypass(sourceX, sourceY, targetX, targetY, lane)
  const text = data?.text ?? ''
  const showWhen = text !== '' || data?.back === true
  const handoff = data?.handoff ?? null
  const color = data?.color ?? WHEN_COLOR.always
  return (
    <>
      <path
        d={path}
        className={css.halo}
        data-active={data?.active === true}
        style={{ stroke: color }}
      />
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={28}
        style={{ stroke: color }}
        {...(markerEnd ? { markerEnd } : {})}
      />
      {data !== undefined && (
        <FlowStreaks path={path} color={color} active={data.active && handoff?.none !== true} />
      )}
      {(showWhen || handoff !== null) && data !== undefined && (
        <EdgeLabelRenderer>
          {/* 条件在上、交接在下，竖着叠在线的中点：两张卡之间的空隙放不下横排的两块。
              两块都和线同色。 */}
          <div
            className={cx(css.linkLabels, 'nodrag', 'nopan')}
            style={
              {
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                '--wl-chip': color,
              } as React.CSSProperties
            }
          >
            {showWhen && (
              <button
                type="button"
                className={css.linkLabel}
                data-when={data.when}
                data-selected={props.selected === true}
                onClick={() => data.onPick(id)}
              >
                {data.back && <Icon name="loop" size={11} />}
                {text !== '' && <span className={css.linkText}>{text}</span>}
                {/* 长条件在线上只露一截，悬停时弹出全文。 */}
                {text.length > LABEL_FULL_AT && (
                  <span className={css.linkTip} role="tooltip">
                    {text}
                  </span>
                )}
              </button>
            )}
            {handoff !== null && (
              <HandoffMark
                edgeId={id}
                handoff={handoff}
                route={data.route}
                t={data.t}
                selected={props.selected === true}
                onPick={data.onPick}
              />
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

/** 交接卡片：悬停多久才弹出（扫过画布不该一路弹）、离开多久才收。 */
const MARK_OPEN_MS = 220
const MARK_CLOSE_MS = 200
const MARK_CARD_W = 300

/**
 * 步骤之间的线上的交接标记——只在不是缺省时出现（缺省就是交执行结果，画出来只会满屏都是）：
 * 附了交接说明是一个对话气泡（悬停看说明），只管先后是一个虚线框的「只管先后」。点它选中这条线。
 * 颜色跟着线走（父层给的 `--wl-chip`）。
 */
function HandoffMark(props: {
  edgeId: string
  handoff: { note?: string; none: boolean }
  route: string
  t: T
  selected: boolean
  onPick: (id: string) => void
}): React.JSX.Element {
  const { handoff, t } = props
  const float = useFloat<HTMLButtonElement>({
    openMs: MARK_OPEN_MS,
    closeMs: MARK_CLOSE_MS,
    width: MARK_CARD_W,
  })
  return (
    <>
      <button
        ref={float.anchorRef}
        type="button"
        className={hand.mark}
        data-none={handoff.none}
        data-selected={props.selected}
        data-open={float.state !== 'off'}
        data-testid="wl-handoff-mark"
        data-edge={props.edgeId}
        aria-label={`${t('hand.title')} · ${props.route}`}
        {...(handoff.none ? {} : float.hoverProps)}
        onClick={() => {
          float.setState('off')
          props.onPick(props.edgeId)
        }}
        onKeyDown={float.onKeyDown}
      >
        {handoff.none ? (
          <span>{t('hand.flowOnly')}</span>
        ) : (
          <>
            <Icon name="result" size={12} />
            <span className={hand.markDot} />
          </>
        )}
      </button>
      {float.render({
        className: hand.card,
        testId: 'wl-handoff-card',
        label: t('hand.title'),
        children: (
          <>
            <div className={hand.cardHead}>
              <span className={hand.cardIcon}>
                <Icon name="result" size={14} />
              </span>
              <span className={hand.cardTitle}>{t('hand.note')}</span>
              <span className={hand.cardRoute}>{props.route}</span>
            </div>
            <div className={hand.detailNote}>{handoff.note}</div>
            <p className={hand.cardFoot}>{t('hand.editHint')}</p>
          </>
        ),
      })}
    </>
  )
}

/** 条件超过这么多字就在线上截断、悬停看全文（与 CSS 里标签的最大宽度大致对应）。 */
const LABEL_FULL_AT = 12

// ─────────────────────────────────────────────────────────────
// 文件卡与读写线
// ─────────────────────────────────────────────────────────────

/**
 * 文件卡：一份独立的文件。左边的点接「步骤 → 文件」（写），右边的点拖出去连到步骤（读）。
 * 悬停时画布高亮所有写它、读它的步骤。
 */
/** 文件名的扩展名，大写、最多 4 个字（`review.md` → `MD`）；没有就是空串。 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name
    .slice(dot + 1)
    .toUpperCase()
    .slice(0, 4)
}

/** 文件卡左侧的类型签：印扩展名，没有扩展名就放一个文件图标。 */
function FileTab(props: { name: string }): React.JSX.Element {
  const ext = extensionOf(props.name)
  return (
    <span className={css.fileTab} data-long={ext.length > 3} aria-hidden="true">
      {ext === '' ? <Icon name="file" size={14} /> : ext}
    </span>
  )
}

const FileCard = memo(function FileCard(props: NodeProps<FileFlowNode>): React.JSX.Element {
  const { data, id, selected } = props
  return (
    <div
      className={cx(css.fileCard, selected && css.cardSelected)}
      data-focused={data.focused}
      data-dim={data.dim}
      data-tone={data.tone}
      data-testid="wl-file"
      title={data.note === '' ? data.path : `${data.path}\n${data.note}`}
      onPointerEnter={() => data.onFocusFile(id)}
      onPointerLeave={() => data.onFocusFile(null)}
    >
      {/* 和步骤卡一样左进右出：左边接写入（写线从步骤的写点落下来、横着进来），右边拖出去是读取。 */}
      <Handle
        id="in"
        type="target"
        position={Position.Left}
        className={cx(css.handle, css.handleIn, css.hFileIn)}
      />
      <FileTab name={data.name} />
      <span className={css.fileText}>
        <span className={css.fileName}>{data.name}</span>
        <span className={cx(css.fileRule, data.rule === '' && css.fileRuleEmpty)}>
          {data.rule === '' ? data.path : data.rule}
        </span>
      </span>
      {data.tone !== 'ok' && (
        <span className={css.cardFlag} data-tone={data.tone}>
          <Icon name="alert" size={12} />
        </span>
      )}
      {data.generated === true && (
        <span className={css.fileMade} title={data.generatedText} data-testid="wl-file-made">
          <Icon name="check" size={12} />
        </span>
      )}
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className={cx(css.handle, css.handleOut, css.handleRead)}
        title={data.readText}
      />
    </div>
  )
})

const SIDE_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

/** 卡片在画布上的矩形（还没量出尺寸时按标称尺寸算）。 */
function rectOf(node: InternalNode | undefined, width: number, height: number): Rect | null {
  if (node === undefined) return null
  const at = node.internals.positionAbsolute
  return {
    x: at.x,
    y: at.y,
    w: node.measured.width ?? width,
    h: node.measured.height ?? height,
  }
}

/**
 * 读写线：「左右走流程，上下走文件」——两头都落在真实的连接点上；挂哪个点由画布按两张卡
 * 当下的位置挑（见 `route.ts`），拖动卡片时线会跟着换到合适的点。
 * 三种各有颜色与线型：产出 = 金色实线，在原文件上更新 = 洋红实线、两头箭头，读取 = 青色虚线。
 * 与选中的东西相连时描粗、加光晕、光带按数据方向流动，中点挂一个小牌子写明是哪种。
 */
const FileLine = memo(function FileLine(props: EdgeProps<FileEdge>): React.JSX.Element {
  const { id, data, markerEnd, markerStart } = props
  // 写线走直角（文件挂在步骤下面，几条写线共用一根树干再分叉）；读线是贝塞尔曲线。
  const points = data?.points ?? null
  const [path, labelX, labelY] =
    points !== null
      ? routedPath(points, props.sourceX, props.sourceY, props.targetX, props.targetY)
      : data?.kind === 'write'
        ? writePath(
            props.sourceX,
            props.sourceY,
            props.sourcePosition,
            props.targetX,
            props.targetY,
          )
        : getBezierPath(props)
  const active = data?.active === true
  const color = data?.color ?? ACCESS_COLOR.produce
  return (
    <>
      {/* 光晕常驻、平时透明：活起来时淡入，不活了淡出，不会一闪而现。 */}
      <path d={path} className={css.halo} data-active={active} style={{ stroke: color }} />
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={20}
        style={{ stroke: color }}
        {...(markerEnd ? { markerEnd } : {})}
        {...(markerStart ? { markerStart } : {})}
      />
      <FlowStreaks path={path} color={color} active={active} />
      {data !== undefined && (
        <EdgeLabelRenderer>
          {/* 不接指针：点在小牌子上等于点在线上（下面就是线的命中区），悬停也不会被它打断。
              常驻、平时透明，和光晕一样淡入淡出。 */}
          <span
            className={css.ioChip}
            data-access={data.access}
            data-active={active}
            aria-hidden={!active}
            data-testid="wl-io-chip"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            <Icon name={ACCESS_ICON[data.access]} size={11} />
            {data.chipText}
          </span>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

/** 拖线时给连接线和画布用的上下文：按当前文档预告「连上会是什么线」。 */
interface DragContext {
  preview(link: HandleLink): LinkPreview | null
  t: T
}

const DragInfo = createContext<DragContext | null>(null)

/** 连上后那种线的颜色（新连的流程线没有条件，就是「总是」的蓝）。 */
const PREVIEW_COLOR: Record<LinkPreview['kind'], string> = {
  flow: WHEN_COLOR.always,
  ...ACCESS_COLOR,
}

const PREVIEW_ICON = {
  flow: 'arrowRight',
  produce: 'pencil',
  update: 'reload',
  read: 'eye',
} as const

const PREVIEW_TEXT: Record<LinkPreview['kind'], LocaleKey> = {
  flow: 'legend.flow',
  produce: 'file.produce',
  update: 'file.update',
  read: 'file.read',
}

const DRAG_HINT: Record<DragKind, LocaleKey> = {
  flow: 'link.hintFlow',
  write: 'link.hintWrite',
  read: 'link.hintRead',
  back: 'link.hintBack',
  writeBack: 'link.hintWriteBack',
  readBack: 'link.hintReadBack',
}

/** 拖线起点的颜色：还没落到目标上时，先按起点预告大致是哪种线。 */
function dragColor(kind: DragKind | null): string {
  if (kind === 'write' || kind === 'writeBack') return ACCESS_COLOR.produce
  if (kind === 'read' || kind === 'readBack') return ACCESS_COLOR.read
  return WHEN_COLOR.always
}

function nodeName(node: WorkflowNode): string {
  if (isFile(node)) return baseName(node.data.path)
  return node.data.label === undefined || node.data.label === '' ? node.id : node.data.label
}

/** 把一次拖线摆正成 source → target（倒着从入口拖时两头对调）。 */
function linkOf(
  fromNode: string,
  fromHandle: { id?: string | null; type: 'source' | 'target' },
  toNode: string,
  toHandle: string | null | undefined,
): HandleLink {
  return fromHandle.type === 'source'
    ? {
        source: fromNode,
        sourceHandle: fromHandle.id ?? null,
        target: toNode,
        targetHandle: toHandle,
      }
    : {
        source: toNode,
        sourceHandle: toHandle,
        target: fromNode,
        targetHandle: fromHandle.id ?? null,
      }
}

/**
 * 正在拖的那条线。还没落到能连的地方时：按起点上色、虚线，指针旁一句提示该往哪儿拖；
 * 落到能连的连接点上（还没松手）：变成实线、换成连上后那种线的颜色，指针旁预告这条线的含义——
 * 是流程、产出、更新还是读取，数据从谁流向谁。
 */
function ConnectionLine(props: ConnectionLineComponentProps<FlowNode>): React.JSX.Element {
  const info = useContext(DragInfo)
  const kind = dragKindOf(props.fromNode.type === 'wfFile', props.fromHandle.id)
  const preview =
    info !== null && props.toNode !== null && props.connectionStatus === 'valid'
      ? info.preview(
          linkOf(props.fromNode.id, props.fromHandle, props.toNode.id, props.toHandle?.id),
        )
      : null
  // 落到文件读写的目标上时，按松手后那条线真正的走法画（和 FileLine 同一套端点），所见即所得。
  let ends: {
    from: { x: number; y: number; side: Side }
    to: { x: number; y: number; side: Side }
  } | null = null
  if (preview !== null && preview.kind !== 'flow' && props.toNode !== null) {
    const fileNode = props.fromNode.type === 'wfFile' ? props.fromNode : props.toNode
    const stepNode = fileNode === props.fromNode ? props.toNode : props.fromNode
    const step = rectOf(stepNode, NODE_W, NODE_H)
    const file = rectOf(fileNode, FILE_W, FILE_H)
    if (step !== null && file !== null) {
      ends = fileLinkEnds(preview.kind === 'read' ? 'read' : 'write', step, file)
    }
  }
  let path: string
  if (ends === null) {
    ;[path] = getBezierPath({
      sourceX: props.fromX,
      sourceY: props.fromY,
      sourcePosition: props.fromPosition,
      targetX: props.toX,
      targetY: props.toY,
      targetPosition: props.toPosition,
    })
  } else if (preview?.kind === 'read') {
    ;[path] = getBezierPath({
      sourceX: ends.from.x,
      sourceY: ends.from.y,
      sourcePosition: SIDE_POSITION[ends.from.side],
      targetX: ends.to.x,
      targetY: ends.to.y,
      targetPosition: SIDE_POSITION[ends.to.side],
    })
  } else {
    ;[path] = writePath(
      ends.from.x,
      ends.from.y,
      SIDE_POSITION[ends.from.side],
      ends.to.x,
      ends.to.y,
    )
  }
  const color = preview === null ? dragColor(kind) : PREVIEW_COLOR[preview.kind]
  // 预告条的落点：落到卡片上时居中贴在那张卡的上方（不挡卡片内容）；否则在指针正上方。
  const target =
    preview === null || props.toNode === null ? null : rectOf(props.toNode, NODE_W, NODE_H)
  const seat =
    target === null
      ? { x: props.toX, y: props.toY - 14 }
      : { x: target.x + target.w / 2, y: target.y - 10 }
  return (
    <g>
      <path
        d={path}
        className={css.connection}
        data-snapped={preview !== null}
        style={{ stroke: color }}
      />
      {info !== null && (preview !== null || kind !== null) && (
        <foreignObject
          x={seat.x - 160}
          y={seat.y - 30}
          width={320}
          height={30}
          className={css.previewSeat}
        >
          {preview === null ? (
            <span className={css.preview} data-testid="wl-link-preview">
              {kind !== null && info.t(DRAG_HINT[kind])}
            </span>
          ) : (
            <span
              className={css.preview}
              data-kind={preview.kind}
              data-testid="wl-link-preview"
              style={{ '--wl-chip': color } as React.CSSProperties}
            >
              <span className={css.previewKind}>
                <Icon name={PREVIEW_ICON[preview.kind]} size={11} />
                {info.t(PREVIEW_TEXT[preview.kind])}
              </span>
              <span className={css.previewRoute}>
                {nodeName(preview.source)} → {nodeName(preview.target)}
              </span>
              {preview.exists && <span className={css.previewMuted}>{info.t('link.exists')}</span>}
            </span>
          )}
        </foreignObject>
      )}
    </g>
  )
}

/** `nodeTypes` / `edgeTypes` 必须是稳定引用，否则 React Flow 每次渲染都重建全部节点。 */
const NODE_TYPES = { wfNode: StepCard, wfFile: FileCard }
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

export function Canvas(props: CanvasProps): React.JSX.Element {
  const {
    t,
    doc,
    analysis,
    selection,
    problems,
    focusFile: hoveredFile,
    onEdit,
    onSelect,
    onRequestAdd,
    onDropSource,
    run,
  } = props
  const readOnly = run !== undefined
  const flow = useReactFlow<FlowNode, FlowEdge>()
  const wrapRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const [dropping, setDropping] = useState(false)
  /** 卡片尺寸量出来 / 变了就加一：线的走法要按真实尺寸重算。 */
  const [sized, setSized] = useState(0)
  /** 拖动中的临时坐标（松手才写进文档）。 */
  const [dragging, setDragging] = useState<Record<string, Point>>({})
  const draggingRef = useRef(dragging)
  draggingRef.current = dragging
  /** React Flow 量出来的卡片尺寸：带回给它，重建节点对象时就不用重新量。 */
  const measured = useRef(new Map<string, { width: number; height: number }>())
  const cache = useRef(new Map<string, CacheEntry>())
  const docRef = useRef(doc)
  docRef.current = doc

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
  const runStatusRef = useRef(run?.onStatus)
  runStatusRef.current = run?.onStatus
  const onRunStatus = useCallback(
    (id: string, anchor: Element): void => runStatusRef.current?.(id, anchor),
    [],
  )

  /** 每份文件谁写、谁读（悬停文件卡时据此标角色）。 */
  const files = useMemo(
    () => fileGraph({ nodes: doc.nodes, edges: doc.edges, viewport: doc.viewport }),
    [doc.nodes, doc.edges],
  )

  /** 指针下的那条线：悬停时它也"活"起来，标明是哪种线。 */
  const [hoverEdge, setHoverEdge] = useState<string | null>(null)

  // ── 拖线：只露出能连的连接点，落到目标上时整张卡按连上后的线色亮起来 ──
  // 选择器只吐一个字符串：指针移动不会让画布重渲染，只有起点 / 目标 / 有效性变了才会。
  const dragKey = useConnection((connection) =>
    connection.inProgress
      ? JSON.stringify([
          connection.fromNode.id,
          connection.fromNode.type === 'wfFile',
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
    const [fromNode, fromFile, fromHandle, fromType, toNode, toHandle, valid] = JSON.parse(
      dragKey,
    ) as [
      string,
      boolean,
      string | null,
      'source' | 'target',
      string | null,
      string | null,
      boolean,
    ]
    const kind = dragKindOf(fromFile, fromHandle)
    const preview =
      valid && toNode !== null
        ? previewLink(doc, linkOf(fromNode, { id: fromHandle, type: fromType }, toNode, toHandle))
        : null
    return { kind, color: preview === null ? dragColor(kind) : PREVIEW_COLOR[preview.kind] }
  }, [dragKey, doc])
  // 拖线时不做悬停文件的聚光：拖过文件卡不该把别的卡都淡下去。
  const focusFile = drag === null ? hoveredFile : null
  const focused = focusFile === null ? undefined : files.get(focusFile)

  const onPick = useCallback(
    (id: string): void => {
      onSelect({ kind: 'edge', id })
      wrapRef.current?.focus()
    },
    [onSelect],
  )

  const texts = useMemo(
    () => ({
      noPromptText: t('node.noPrompt'),
      addText: t('node.add'),
      fileText: t('node.fileHandle'),
      readText: t('file.connectHint'),
      noRuleText: t('file.noRule'),
      pass: t('edge.pass'),
      fail: t('edge.fail'),
      generated: t('run.fileMade'),
      produce: t(ACCESS_TEXT.produce),
      update: t(ACCESS_TEXT.update),
      read: t(ACCESS_TEXT.read),
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
      return {
        x: at.x,
        y: at.y,
        w: size?.width ?? (isFile(node) ? FILE_W : NODE_W),
        h: size?.height ?? (isFile(node) ? FILE_H : NODE_H),
      }
    }
    const handles = new Map<string, { source: string; target: string }>()
    const used = new Map<string, string[]>()
    const lanes = new Map<string, number>()
    /** 改走绕行直角折线的读写线：折点（含两头）。 */
    const bends = new Map<string, [number, number][]>()
    const rects = new Map(doc.nodes.map((node) => [idKey(node.id), rectFor(node)]))
    const boxes = [...rects.values()]
    const mark = (nodeId: string, handle: string): void => {
      const list = used.get(idKey(nodeId)) ?? []
      if (!list.includes(handle)) list.push(handle)
      used.set(idKey(nodeId), list)
    }
    for (const edge of doc.edges) {
      const kind = edgeKind(index, edge)
      if (kind === 'flow') {
        // 往回走的线（终点在出口左边）：挑一条不压到任何卡片的走廊。
        const from = rects.get(idKey(edge.source))
        const to = rects.get(idKey(edge.target))
        if (from === undefined || to === undefined) continue
        const sx = from.x + from.w
        const sy = from.y + from.h / 2
        const ty = to.y + to.h / 2
        if (to.x >= sx + 8) {
          // 往右走：贝塞尔压到中间的卡片（跨列时常见）才改走直角，挑离终点那一行最近的走廊。
          const others = boxes.filter((box) => box !== from && box !== to)
          if (flowBlocked(others, sx, sy, to.x, ty)) {
            lanes.set(edge.id, nearestLane(others, sx + LOOP_REACH, to.x - ROUTE_PAD, ty))
          }
          continue
        }
        lanes.set(edge.id, freeLane(boxes, to.x - ROUTE_PAD, sx + LOOP_REACH, laneStart(sy, ty)))
        continue
      }
      if (kind !== 'write' && kind !== 'read') continue
      const stepId = kind === 'write' ? edge.source : edge.target
      const fileId = kind === 'write' ? edge.target : edge.source
      const stepBox = rects.get(idKey(stepId))
      const fileBox = rects.get(idKey(fileId))
      if (stepBox === undefined || fileBox === undefined) continue
      const route = routeFileLink(kind, stepBox, fileBox)
      let stepHandle: StepFileHandle = route.step
      // 平时的走法（写 = 树干直角，读 = 贝塞尔）压到别的卡片时，改走绕开卡片的直角折线；
      // 上下两个点都试一试，挑便宜的那条。
      const skip = [stepBox, fileBox]
      const fileEnd = spotOf(fileBox, FILE_SPOTS[route.file])
      const stepEnd = spotOf(stepBox, STEP_SPOTS[route.step])
      const simple = kind === 'write' ? writePoints(stepEnd, fileEnd, fileBox.h) : null
      const blocked =
        simple === null
          ? fileBox.x + fileBox.w / 2 > stepBox.x + stepBox.w / 2 ||
            bezierBlocked(fileEnd, stepEnd, boxes, skip)
          : simple.length !== 3 || pointsBlocked(simple, boxes, skip)
      if (blocked) {
        const options: StepFileHandle[] =
          kind === 'write' ? ['file', 'fileUp'] : ['read', 'readTop']
        let best: { handle: StepFileHandle; route: OrthoRoute } | null = null
        for (const handle of options) {
          const end = spotOf(stepBox, STEP_SPOTS[handle])
          const found =
            kind === 'write'
              ? orthoRoute(end, fileEnd, boxes, stepBox, fileBox)
              : orthoRoute(fileEnd, end, boxes, fileBox, stepBox)
          if (found !== null && (best === null || found.cost < best.route.cost)) {
            best = { handle, route: found }
          }
        }
        if (best !== null) {
          stepHandle = best.handle
          bends.set(edge.id, best.route.points)
        }
      }
      handles.set(
        edge.id,
        kind === 'write'
          ? { source: stepHandle, target: route.file }
          : { source: route.file, target: stepHandle },
      )
      mark(stepId, stepHandle)
      mark(fileId, route.file)
    }
    return { handles, used, lanes, bends }
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
      if (isFile(node)) {
        const isFocus = focusFile !== null && idKey(focusFile) === idKey(node.id)
        const tone: Tone = reported?.tone ?? 'ok'
        const note = reported?.note ?? ''
        const dim = focusFile !== null && !isFocus
        const generated = run === undefined ? null : (run.files[node.id] ?? false)
        signature = `${selected}|${tone}|${note}|${isFocus}|${dim}|${texts.readText}|${used.join(',')}|${generated}`
        build = () => ({
          id: node.id,
          type: 'wfFile',
          position: moving ?? node.position,
          selected,
          data: {
            name: baseName(node.data.path),
            used,
            path: node.data.path,
            rule: (node.data.rule ?? '').replace(/\s+/gu, ' ').trim(),
            noRuleText: texts.noRuleText,
            tone,
            note,
            focused: isFocus,
            dim,
            readText: texts.readText,
            onFocusFile,
            generated,
            generatedText: texts.generated,
          },
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
              }
        signature = `${selected}|${tone}|${note}|${texts.addText}|${texts.fileText}|${role}|${dim}|${used.join(',')}|${stepRun === null ? '' : `${stepRun.status}/${stepRun.round}/${stepRun.edited}/${stepRun.label}`}`
        build = () => ({
          id: node.id,
          type: 'wfNode',
          position: moving ?? node.position,
          selected,
          data: {
            used,
            title:
              node.data.label === undefined || node.data.label === '' ? node.id : node.data.label,
            kind: kindOf(node.id),
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
  ])

  const edges = useMemo<FlowEdge[]>(() => {
    const selectedId = selection?.kind === 'edge' ? selection.id : null
    const index = nodeIndex(doc)
    const nameOf = (id: string): string => {
      const node = index.get(idKey(id))
      if (node === undefined || isFile(node)) return id
      return node.data.label === undefined || node.data.label === '' ? id : node.data.label
    }
    // 聚光：悬停的文件卡优先，其次是选中的节点。和它相连的线"活"起来（光带流动、标明种类），
    // 其余的线淡下去，一眼看清它从哪儿拿、往哪儿交。
    const spotlight =
      focusFile !== null
        ? idKey(focusFile)
        : selection?.kind === 'node'
          ? idKey(selection.id)
          : null
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
      if (kind === 'write' || kind === 'read') {
        const access: Access =
          kind === 'read' ? 'read' : edge.data?.update === true ? 'update' : 'produce'
        const color = ACCESS_COLOR[access]
        const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14, color }
        return {
          id: edge.id,
          type: 'wfFileLink',
          source: edge.source,
          target: edge.target,
          // 挂在哪两个点上由 routes 按两张卡的位置挑好了。
          sourceHandle: routes.handles.get(edge.id)?.source ?? (kind === 'write' ? 'file' : 'out'),
          targetHandle: routes.handles.get(edge.id)?.target ?? (kind === 'write' ? 'in' : 'read'),
          selected,
          className: cx(
            css.fileLink,
            access === 'read' && css.fileLinkRead,
            active && css.linkActive,
            dim && css.linkDim,
          ),
          markerEnd: arrow,
          // 更新 = 读了再写回去：两头都有箭头。
          ...(access === 'update'
            ? { markerStart: { ...arrow, orient: 'auto-start-reverse' } }
            : {}),
          data: {
            kind,
            access,
            color,
            active,
            chipText: texts[access],
            points: routes.bends.get(edge.id) ?? null,
          },
        }
      }
      const when = whenOf(edge)
      const mode = whenKind(when)
      const back = analysis.backEdges.has(edge.id)
      const handoff = resolveHandoff(edge.data?.handoff)
      // 线色只看条件：选中 / 悬停时描粗、加光晕，不换色——一条线从头到尾就是那一个颜色。
      const color = WHEN_COLOR[mode]
      return {
        id: edge.id,
        type: 'wfEdge',
        source: edge.source,
        target: edge.target,
        sourceHandle: 'out',
        targetHandle: 'in',
        selected,
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
          t,
          onPick,
        },
      }
    })
    // 活着的线画在最上面，不被淡下去的线压住。
    return [
      ...list.filter((edge) => edge.data?.active !== true),
      ...list.filter((edge) => edge.data?.active === true),
    ]
  }, [doc, analysis, selection, texts, onPick, focusFile, hoverEdge, routes, t, run])

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
  useEffect(() => {
    const saved = docRef.current.viewport
    const untouched = saved.x === 0 && saved.y === 0 && saved.zoom === 1
    if (!untouched) {
      void flow.setViewport(saved)
      return
    }
    if (docRef.current.nodes.length === 0) return
    // 等卡片渲染并量完尺寸再看全图（隔两帧）。
    let second = 0
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
      })
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [props.loadKey, flow])

  // ── 从步骤库拖进来 ──────────────────────────────────────────

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes(DND_MIME)) return
    // 不 preventDefault 的话浏览器不认这里是放置区，`drop` 永远不会来。
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    // 指针坐标不进 state（每秒几十次）：直接改占位卡的 transform。
    const ghost = ghostRef.current
    if (ghost !== null) {
      const rect = event.currentTarget.getBoundingClientRect()
      ghost.style.transform = `translate3d(${event.clientX - rect.left}px, ${
        event.clientY - rect.top
      }px, 0) translate(-50%, -50%)`
    }
    setDropping(true)
  }, [])

  const onDragLeave = useCallback((event: React.DragEvent<HTMLDivElement>): void => {
    // 在子元素之间移动也会冒 dragleave：只有真的离开容器才收起占位卡。
    const related = event.relatedTarget
    if (related instanceof globalThis.Node && event.currentTarget.contains(related)) return
    setDropping(false)
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>): void => {
      setDropping(false)
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

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 画布是自定义复合控件（拖放落点 + 键盘入口）
    <div
      className={css.wrap}
      ref={wrapRef}
      // tabIndex=-1：可被脚本/点击聚焦从而收到键盘事件，但不进 Tab 序。
      tabIndex={-1}
      data-testid="wl-canvas"
      data-readonly={readOnly}
      data-dropping={dropping}
      data-drag={drag?.kind ?? undefined}
      style={drag === null ? undefined : ({ '--wl-drag': drag.color } as React.CSSProperties)}
      data-inset-right={props.insets.right}
      onDragOver={readOnly ? undefined : onDragOver}
      onDragLeave={readOnly ? undefined : onDragLeave}
      onDrop={readOnly ? undefined : onDrop}
      onDoubleClick={(event) => {
        // 双击空白处加步骤；双击在卡片或连线上不算。实例视图里图不能改。
        if (readOnly) return
        const target = event.target
        if (!(target instanceof Element) || !target.classList.contains('react-flow__pane')) return
        const client = { x: event.clientX, y: event.clientY }
        const at = flow.screenToFlowPosition(client)
        onRequestAdd({ client, flow: { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 } })
      }}
    >
      <DragInfo.Provider value={dragInfo}>
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
          elevateNodesOnSelect={false}
          nodeDragThreshold={2}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          connectionRadius={28}
          connectionLineComponent={ConnectionLine}
          proOptions={{ hideAttribution: true }}
          onNodesChange={onNodesChange}
          // 两头的连接点分工要对得上（见 model/connect.ts）：不连自己、文件不连文件、
          // 步骤右边只连步骤、步骤底边只连文件、文件只连步骤。
          isValidConnection={(connection) => linkAllowed(docRef.current, connection)}
          onConnect={(connection) => {
            onEdit({ type: 'connect', source: connection.source, target: connection.target })
          }}
          onConnectEnd={(event, state) => {
            // 线拖到空白处松手：就地加一个步骤并连上；从步骤底边拖出来的是新建一个产出文件。
            if (state.isValid === true || state.fromNode === null) return
            if (state.fromHandle?.type !== 'source') return
            const point = 'changedTouches' in event ? event.changedTouches[0] : event
            if (point === undefined) return
            const target = event.target
            if (!(target instanceof Element) || !target.classList.contains('react-flow__pane'))
              return
            const client = { x: point.clientX, y: point.clientY }
            const at = flow.screenToFlowPosition(client)
            if (state.fromHandle.id === 'file' || state.fromHandle.id === 'fileUp') {
              onEdit({
                type: 'addFile',
                path: freeFilePath(docRef.current, `${state.fromNode.id}.md`),
                // 松手处就是新文件卡左边的入口：线落在哪，卡就从哪接上。
                position: { x: at.x, y: at.y - FILE_H / 2 },
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
          onMoveEnd={(event, viewport) => {
            // 只记人动的视口；程序触发的移动（看全图、定位）事件参数是 null。实例的快照不写回。
            if (event !== null && !readOnly) onEdit({ type: 'setViewport', viewport })
          }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.6} color="var(--wl-dot)" />
        </ReactFlow>
      </DragInfo.Provider>

      {doc.nodes.length === 0 && !readOnly && (
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

      {/* 占位卡常驻 DOM：dragover 里要直接改它的 transform，不能等渲染出来才挂载。 */}
      <div className={css.ghost} ref={ghostRef} data-testid="wl-ghost" aria-hidden="true">
        <span>{t('canvas.drop')}</span>
      </div>
    </div>
  )
}
