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
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
  Handle,
  MarkerType,
  type Node,
  type NodeChange,
  type NodeProps,
  Position,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type {
  Point,
  ValidationProblem,
  WorkflowDocument,
  WorkflowNode,
} from '../../shared/types.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { type Edit, type Selection, whenOf } from '../model/editor.ts'
import { FILE_W, NODE_H, NODE_W, nextTo } from '../model/layout.ts'
import {
  DND_MIME,
  decodeStepSource,
  kindOf,
  type StepKind,
  type StepSource,
} from '../model/library.ts'
import css from './canvas.module.css'
import { baseName, freeFilePath } from './Files.tsx'
import type { FocusFile } from './Handoff.tsx'
import hand from './handoff.module.css'
import { Icon, kindIcon } from './Icon.tsx'
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
}

type Tone = 'ok' | 'warn' | 'error'

interface StepData extends Record<string, unknown> {
  title: string
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
}

interface FileCardData extends Record<string, unknown> {
  name: string
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
}

interface LinkData extends Record<string, unknown> {
  when: string | undefined
  back: boolean
  text: string
  /** 只在不是缺省时画交接标记：附了说明，或只管先后。 */
  handoff: { note?: string; none: boolean } | null
  /** 交接卡片的标题行：「上游 → 下游」。 */
  route: string
  t: T
  onPick: (id: string) => void
}

interface FileLinkData extends Record<string, unknown> {
  kind: 'write' | 'read'
  update: boolean
  dim: boolean
  carry: boolean
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

const MIN_ZOOM = 0.2
const MAX_ZOOM = 1.5
/** 自动看全图不放大过 100%，也不缩到读不了字。 */
const AUTO_FIT = { minZoom: 0.55, maxZoom: 1 }

// ─────────────────────────────────────────────────────────────
// 步骤卡
// ─────────────────────────────────────────────────────────────

const StepCard = memo(function StepCard(props: NodeProps<StepFlowNode>): React.JSX.Element {
  const { data, id, selected } = props
  return (
    <div
      className={cx(css.card, selected && css.cardSelected)}
      data-tone={data.tone}
      data-dim={data.dim}
      data-role={data.role ?? undefined}
      data-testid="wl-step"
      title={data.note === '' ? undefined : data.note}
    >
      {data.role !== null && (
        <span className={css.roleTag} data-role={data.role} data-testid="wl-step-role">
          {data.roleText}
        </span>
      )}
      <Handle id="in" type="target" position={Position.Left} className={css.handle} />
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
        className={cx(css.handle, css.handleSource)}
        title={data.addText}
        onClick={(event) => data.onAdd(id, event.currentTarget)}
      />
      {/* 底边的点：拖到文件卡上 = 写它；拖到空白处 = 就地新建一个产出文件。 */}
      <Handle
        id="file"
        type="source"
        position={Position.Bottom}
        className={cx(css.handle, css.handleFile)}
        title={data.fileText}
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
 * 往回走的线：从出口向右伸出去，拐到一条横向"走廊"上走回来，再从左边进入目标。
 * 两张卡上下错开时走廊在两行中间；挨在同一行时走廊在两张卡下方。
 * @returns `[路径, 标签 x, 标签 y]`（标签落在走廊正中）。
 */
function detour(sx: number, sy: number, tx: number, ty: number): [string, number, number] {
  const apart = Math.abs(ty - sy) > NODE_H + 40
  const lane = apart ? (sy + ty) / 2 : Math.max(sy, ty) + NODE_H / 2 + 44
  const right = sx + ROUTE_PAD
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

const LinkLine = memo(function LinkLine(props: EdgeProps<LinkEdge>): React.JSX.Element {
  const {
    id,
    data,
    markerEnd,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  } = props
  // 往回走的线（循环、或终点在起点左边）用圆角折线绕开卡片；贝塞尔在这种时候会拧成一个结。
  const backwards = targetX < sourceX + 8
  const [path, labelX, labelY] = backwards
    ? detour(sourceX, sourceY, targetX, targetY)
    : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition })
  const text = data?.text ?? ''
  const showWhen = text !== '' || data?.back === true
  const handoff = data?.handoff ?? null
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={28} {...(markerEnd ? { markerEnd } : {})} />
      {(showWhen || handoff !== null) && data !== undefined && (
        <EdgeLabelRenderer>
          {/* 条件在上、交接在下，竖着叠在线的中点：两张卡之间的空隙放不下横排的两块。 */}
          <div
            className={cx(css.linkLabels, 'nodrag', 'nopan')}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {showWhen && (
              <button
                type="button"
                className={css.linkLabel}
                data-when={data.when === 'pass' || data.when === 'fail' ? data.when : 'other'}
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
 * 附了交接说明是一个对话气泡（悬停看说明），只管先后是一个「只管先后」的灰标。点它选中这条线。
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
      {/* 上边接写入（步骤从底边拖下来），右边拖出去是读取。 */}
      <Handle id="in" type="target" position={Position.Top} className={css.handle} />
      <span className={css.fileGlyph}>
        <Icon name="file" size={15} />
      </span>
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
      <Handle
        id="out"
        type="source"
        position={Position.Right}
        className={cx(css.handle, css.handleRead)}
        title={data.readText}
      />
    </div>
  )
})

/**
 * 读写线：写 = 从步骤底边落到文件上沿的虚线；在原文件上更新 = 琥珀色、两头都有箭头（读了再写回去）；
 * 读 = 从文件右边连到步骤的点线。读线真往回走很远时和步骤间的线一样绕开卡片。
 */
const FileLine = memo(function FileLine(props: EdgeProps<FileEdge>): React.JSX.Element {
  const { id, markerEnd, markerStart, sourceX, sourceY, targetX, targetY } = props
  const backwards = props.data?.kind === 'read' && targetX < sourceX - 40
  const [path] = backwards
    ? detour(sourceX, sourceY, targetX, targetY)
    : getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition: props.sourcePosition,
        targetPosition: props.targetPosition,
      })
  return (
    <BaseEdge
      id={id}
      path={path}
      interactionWidth={20}
      {...(markerEnd ? { markerEnd } : {})}
      {...(markerStart ? { markerStart } : {})}
    />
  )
})

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
    focusFile,
    onEdit,
    onSelect,
    onRequestAdd,
    onDropSource,
  } = props
  const flow = useReactFlow<FlowNode, FlowEdge>()
  const wrapRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const [dropping, setDropping] = useState(false)
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

  /** 每份文件谁写、谁读（悬停文件卡时据此标角色）。 */
  const files = useMemo(
    () => fileGraph({ nodes: doc.nodes, edges: doc.edges, viewport: doc.viewport }),
    [doc.nodes, doc.edges],
  )
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
    }),
    [t],
  )

  const nodes = useMemo<FlowNode[]>(() => {
    const next = new Map<string, CacheEntry>()
    const selectedId = selection?.kind === 'node' ? idKey(selection.id) : null
    const list = doc.nodes.map((node): FlowNode => {
      const reported = tones.get(idKey(node.id))
      const selected = idKey(node.id) === selectedId
      const moving = dragging[node.id]
      let signature: string
      let build: () => FlowNode
      if (isFile(node)) {
        const isFocus = focusFile !== null && idKey(focusFile) === idKey(node.id)
        const tone: Tone = reported?.tone ?? 'ok'
        const note = reported?.note ?? ''
        const dim = focusFile !== null && !isFocus
        signature = `${selected}|${tone}|${note}|${isFocus}|${dim}|${texts.readText}`
        build = () => ({
          id: node.id,
          type: 'wfFile',
          position: moving ?? node.position,
          selected,
          data: {
            name: baseName(node.data.path),
            path: node.data.path,
            rule: (node.data.rule ?? '').replace(/\s+/gu, ' ').trim(),
            noRuleText: texts.noRuleText,
            tone,
            note,
            focused: isFocus,
            dim,
            readText: texts.readText,
            onFocusFile,
          },
        })
      } else {
        const prompt = node.data.prompt
        const empty = prompt === undefined || prompt.trim() === ''
        const tone: Tone = empty ? 'error' : (reported?.tone ?? 'ok')
        const note = empty ? texts.noPromptText : (reported?.note ?? '')
        const role = focused === undefined ? null : roleOf(focused, node.id)
        const dim = focusFile !== null && role === null
        signature = `${selected}|${tone}|${note}|${texts.addText}|${texts.fileText}|${role}|${dim}`
        build = () => ({
          id: node.id,
          type: 'wfNode',
          position: moving ?? node.position,
          selected,
          data: {
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
  }, [doc.nodes, selection, tones, dragging, texts, onAdd, onFocusFile, focused, focusFile, t])

  const edges = useMemo<FlowEdge[]>(() => {
    const selectedId = selection?.kind === 'edge' ? selection.id : null
    const index = nodeIndex(doc)
    const nameOf = (id: string): string => {
      const node = index.get(idKey(id))
      if (node === undefined || isFile(node)) return id
      return node.data.label === undefined || node.data.label === '' ? id : node.data.label
    }
    const focusKey = focusFile === null ? null : idKey(focusFile)
    return doc.edges.map((edge): FlowEdge => {
      const selected = edge.id === selectedId
      const kind = edgeKind(index, edge)
      if (kind === 'write' || kind === 'read') {
        const update = kind === 'write' && edge.data?.update === true
        // 悬停某个文件时：连着它的读写线描深，别的淡下去。
        const carry =
          focusKey !== null && (idKey(edge.source) === focusKey || idKey(edge.target) === focusKey)
        const color = selected
          ? 'var(--wl-accent)'
          : update
            ? 'var(--wl-warn)'
            : carry
              ? 'var(--wl-accent)'
              : 'var(--wl-edge)'
        const arrow = { type: MarkerType.ArrowClosed, width: 14, height: 14, color }
        return {
          id: edge.id,
          type: 'wfFileLink',
          source: edge.source,
          target: edge.target,
          // 写：步骤底边 → 文件上沿；读：文件右边 → 步骤左边。
          sourceHandle: kind === 'write' ? 'file' : 'out',
          targetHandle: 'in',
          selected,
          className: cx(
            css.fileLink,
            kind === 'read' && css.fileLinkRead,
            update && css.fileLinkUpdate,
            carry && css.linkCarry,
            focusKey !== null && !carry && css.linkDim,
          ),
          markerEnd: arrow,
          ...(update ? { markerStart: { ...arrow, orient: 'auto-start-reverse' } } : {}),
          data: { kind, update, dim: focusKey !== null && !carry, carry },
        }
      }
      const when = whenOf(edge)
      const back = analysis.backEdges.has(edge.id)
      const handoff = resolveHandoff(edge.data?.handoff)
      const color = selected
        ? 'var(--wl-accent)'
        : when === 'fail'
          ? 'var(--wl-danger)'
          : when === 'pass'
            ? 'var(--wl-ok)'
            : 'var(--wl-edge)'
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
          when === 'fail' && css.linkFail,
          when === 'pass' && css.linkPass,
          back && css.linkBack,
          !handoff.result && css.linkOrderOnly,
          focusKey !== null && css.linkDim,
        ),
        // 箭头颜色传 CSS 变量：React Flow 把它写进箭头的内联样式，跟着主题与语气走。
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
        data: {
          when,
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
          t,
          onPick,
        },
      }
    })
  }, [doc, analysis, selection, texts, onPick, focusFile, t])

  const onNodesChange = useCallback(
    (changes: NodeChange<FlowNode>[]): void => {
      let moved: Record<string, Point> | null = null
      const settled: Record<string, Point> = {}
      let finished = false
      for (const change of changes) {
        if (change.type === 'dimensions' && change.dimensions !== undefined) {
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
      data-dropping={dropping}
      data-inset-right={props.insets.right}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDoubleClick={(event) => {
        // 双击空白处加步骤；双击在卡片或连线上不算。
        const target = event.target
        if (!(target instanceof Element) || !target.classList.contains('react-flow__pane')) return
        const client = { x: event.clientX, y: event.clientY }
        const at = flow.screenToFlowPosition(client)
        onRequestAdd({ client, flow: { x: at.x - NODE_W / 2, y: at.y - NODE_H / 2 } })
      }}
    >
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
        connectionRadius={28}
        proOptions={{ hideAttribution: true }}
        onNodesChange={onNodesChange}
        // 不连自己；文件不能直接连文件（两头都是文件卡的线没有意义）。
        isValidConnection={(connection) => {
          if (connection.source === connection.target) return false
          const index = nodeIndex(docRef.current)
          const source = index.get(idKey(connection.source))
          const target = index.get(idKey(connection.target))
          return !(source !== undefined && target !== undefined && isFile(source) && isFile(target))
        }}
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
          if (!(target instanceof Element) || !target.classList.contains('react-flow__pane')) return
          const client = { x: point.clientX, y: point.clientY }
          const at = flow.screenToFlowPosition(client)
          if (state.fromHandle.id === 'file') {
            onEdit({
              type: 'addFile',
              path: freeFilePath(docRef.current, `${state.fromNode.id}.md`),
              position: { x: at.x - FILE_W / 2, y: at.y },
              writer: state.fromNode.id,
              select: true,
            })
            return
          }
          onRequestAdd({ client, flow: { x: at.x, y: at.y - NODE_H / 2 }, from: state.fromNode.id })
        }}
        onNodeClick={(_event, node) => onSelect({ kind: 'node', id: node.id })}
        onNodeDragStart={(_event, node) => onSelect({ kind: 'node', id: node.id })}
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
          // 只记人动的视口；程序触发的移动（看全图、定位）事件参数是 null。
          if (event !== null) onEdit({ type: 'setViewport', viewport })
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.6} color="var(--wl-dot)" />
      </ReactFlow>

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

      {/* 占位卡常驻 DOM：dragover 里要直接改它的 transform，不能等渲染出来才挂载。 */}
      <div className={css.ghost} ref={ghostRef} data-testid="wl-ghost" aria-hidden="true">
        <span>{t('canvas.drop')}</span>
      </div>
    </div>
  )
}
