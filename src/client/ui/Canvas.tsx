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
  NodeToolbar,
  Position,
  ReactFlow,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/base.css'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphAnalysis } from '../../shared/graph.ts'
import { idKey, outputSpecs } from '../../shared/model.ts'
import type {
  NodeData,
  OutputSpec,
  Point,
  ValidationProblem,
  WorkflowDocument,
  WorkflowNode,
} from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { type Edit, type Selection, whenOf } from '../model/editor.ts'
import { NODE_H, NODE_W, nextTo } from '../model/layout.ts'
import {
  DND_MIME,
  decodeStepSource,
  kindOf,
  type StepKind,
  type StepSource,
} from '../model/library.ts'
import css from './canvas.module.css'
import { Icon, kindIcon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

/** 「在这里加一个步骤」的请求：屏幕坐标用来摆菜单，画布坐标用来落节点。 */
export interface AddRequest {
  client: Point
  flow: Point
  /** 顺手从这个步骤连过来。 */
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
  /** 在卡片的产出浮窗里点了某个文件（或「添加」）：选中这个步骤并打开那一项的编辑框。 */
  onOpenOutput(nodeId: string, index: number | 'new'): void
}

type Tone = 'ok' | 'warn' | 'error'

interface StepData extends Record<string, unknown> {
  title: string
  kind: StepKind
  excerpt: string
  output: NodeData['output']
  tone: Tone
  note: string
  noPromptText: string
  noFileText: string
  addText: string
  peekText: PeekText
  onAdd: (id: string, anchor: Element) => void
  onOpenOutput: (id: string, index: number | 'new') => void
}

interface PeekText {
  title: string
  hint: string
  noRule: string
  add: string
}

interface LinkData extends Record<string, unknown> {
  when: string | undefined
  back: boolean
  text: string
  onPick: (id: string) => void
}

type StepNode = Node<StepData, 'wfNode'>
type LinkEdge = Edge<LinkData, 'wfEdge'>

const MIN_ZOOM = 0.2
const MAX_ZOOM = 1.5
/** 自动看全图不放大过 100%，也不缩到读不了字。 */
const AUTO_FIT = { minZoom: 0.55, maxZoom: 1 }

// ─────────────────────────────────────────────────────────────
// 步骤卡
// ─────────────────────────────────────────────────────────────

const StepCard = memo(function StepCard(props: NodeProps<StepNode>): React.JSX.Element {
  const { data, id, selected, dragging } = props
  return (
    <div
      className={cx(css.card, selected && css.cardSelected)}
      data-tone={data.tone}
      data-testid="wl-step"
      title={data.note === '' ? undefined : data.note}
    >
      <Handle type="target" position={Position.Left} className={css.handle} />
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
      {data.output === false && (
        <span className={css.cardOutput}>
          <Icon name="file" size={12} />
          <span>{data.noFileText}</span>
        </span>
      )}
      {data.output !== undefined && data.output !== false && (
        <CardOutputs
          id={id}
          specs={outputSpecs(data.output)}
          selected={selected}
          dragging={dragging}
          text={data.peekText}
          onOpen={data.onOpenOutput}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        className={cx(css.handle, css.handleSource)}
        title={data.addText}
        onClick={(event) => data.onAdd(id, event.currentTarget)}
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
  return (
    <>
      <BaseEdge id={id} path={path} interactionWidth={28} {...(markerEnd ? { markerEnd } : {})} />
      {(text !== '' || data?.back === true) && (
        <EdgeLabelRenderer>
          <button
            type="button"
            className={cx(css.linkLabel, 'nodrag', 'nopan')}
            data-when={data?.when === 'pass' || data?.when === 'fail' ? data.when : 'other'}
            data-selected={props.selected === true}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={() => data?.onPick(id)}
          >
            {data?.back === true && <Icon name="loop" size={11} />}
            {text !== '' && <span className={css.linkText}>{text}</span>}
            {/* 长条件在线上只露一截，悬停时弹出全文。 */}
            {text.length > LABEL_FULL_AT && (
              <span className={css.linkTip} role="tooltip">
                {text}
              </span>
            )}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

/** 条件超过这么多字就在线上截断、悬停看全文（与 CSS 里标签的最大宽度大致对应）。 */
const LABEL_FULL_AT = 12

/** 悬停多久才弹出产出浮窗（扫过去不该一路弹）、离开多久才收起（留出移进浮窗的时间）。 */
const PEEK_OPEN_MS = 260
const PEEK_CLOSE_MS = 180
/** 浮窗宽度（与 CSS 的 `.peek` 一致）与估算高度：决定往哪边弹才不被属性面板或画布底边挡住。 */
const PEEK_W = 288
const peekHeight = (count: number): number => 84 + Math.min(count, 4) * 58

/**
 * 卡片底部的产出：第一个文件 + "+N"。
 *
 * 悬停弹出浮窗，列出全部文件与各自的生成规则；点一下就钉住（点别处或取消选中才收起）。
 * 浮窗里点某个文件 = 选中这个步骤并打开那一项的编辑框；「添加」同理。
 * 浮窗走 `NodeToolbar`：它跟着卡片平移缩放，但字号不随缩放变小，也压在别的卡片和连线标签上面。
 */
function CardOutputs(props: {
  id: string
  specs: readonly OutputSpec[]
  selected: boolean
  dragging: boolean
  text: PeekText
  onOpen: (id: string, index: number | 'new') => void
}): React.JSX.Element | null {
  const { id, specs, text } = props
  const [peek, setPeek] = useState<'off' | 'hover' | 'pinned'>('off')
  const [place, setPlace] = useState<{ side: Position; align: 'start' | 'end' }>({
    side: Position.Bottom,
    align: 'start',
  })
  const timer = useRef(0)
  const chipsRef = useRef<HTMLButtonElement>(null)
  const peekRef = useRef<HTMLDivElement>(null)

  const cancel = (): void => window.clearTimeout(timer.current)
  const later = (next: 'off' | 'hover', ms: number): void => {
    cancel()
    timer.current = window.setTimeout(() => {
      if (next === 'hover') settle()
      setPeek(next)
    }, ms)
  }

  /**
   * 弹出前看一眼周围：右边会被属性面板盖住就改成右对齐（往左展开），
   * 下面放不下就弹到卡片上方。没被盖住的那块画布的右边界由画布根节点上的 `data-inset-right` 给出。
   */
  const settle = (): void => {
    const chips = chipsRef.current
    const card = chips?.closest('.react-flow__node')
    const wrap = chips?.closest<HTMLElement>('[data-testid="wl-canvas"]')
    if (card === null || card === undefined || wrap === null || wrap === undefined) return
    const box = card.getBoundingClientRect()
    const area = wrap.getBoundingClientRect()
    const right = area.right - Number(wrap.dataset.insetRight ?? 0) - 8
    const below = area.bottom - box.bottom - 12
    setPlace({
      align: box.left + PEEK_W > right && box.right - PEEK_W > area.left ? 'end' : 'start',
      side:
        below < peekHeight(specs.length) && box.top - area.top > below
          ? Position.Top
          : Position.Bottom,
    })
  }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  // 拖卡片时收起；取消选中时把钉住的也收起。
  useEffect(() => {
    if (!props.dragging) return
    window.clearTimeout(timer.current)
    setPeek('off')
  }, [props.dragging])
  useEffect(() => {
    if (!props.selected) setPeek((current) => (current === 'pinned' ? 'off' : current))
  }, [props.selected])

  // 钉住时：在卡片与浮窗之外按下指针就收起（捕获阶段：React Flow 会拦掉画布上的冒泡）。
  useEffect(() => {
    if (peek !== 'pinned') return
    const onDown = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof globalThis.Node)) return
      if (chipsRef.current?.contains(target) || peekRef.current?.contains(target)) return
      setPeek('off')
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [peek])

  const [first, ...rest] = specs
  if (first === undefined) return null
  const open = (index: number | 'new'): void => {
    cancel()
    setPeek('off')
    props.onOpen(id, index)
  }

  return (
    <>
      <button
        ref={chipsRef}
        type="button"
        className={css.cardOutputs}
        data-testid="wl-card-outputs"
        data-open={peek !== 'off'}
        aria-expanded={peek !== 'off'}
        onPointerEnter={() => {
          if (peek === 'off') later('hover', PEEK_OPEN_MS)
          else cancel()
        }}
        onPointerLeave={() => {
          if (peek === 'hover') later('off', PEEK_CLOSE_MS)
          else if (peek === 'off') cancel()
        }}
        // 不拦冒泡：点产出也会选中这张卡，右边的面板一起出来。
        onClick={() => {
          cancel()
          if (peek === 'off') settle()
          setPeek((current) => (current === 'pinned' ? 'off' : 'pinned'))
        }}
      >
        <span className={css.cardOutput}>
          <Icon name="file" size={12} />
          <span>{first.path}</span>
        </span>
        {rest.length > 0 && <span className={css.cardMore}>+{rest.length}</span>}
      </button>
      <NodeToolbar
        isVisible={peek !== 'off'}
        position={place.side}
        align={place.align}
        offset={6}
        className="nodrag nopan nowheel"
        style={{ zIndex: 30 }}
      >
        <div
          ref={peekRef}
          className={css.peek}
          data-side={place.side}
          data-align={place.align}
          role="group"
          aria-label={text.title}
          data-testid="wl-output-peek"
          onPointerEnter={cancel}
          onPointerLeave={() => {
            if (peek === 'hover') later('off', PEEK_CLOSE_MS)
          }}
        >
          <div className={css.peekHead}>
            <span>{text.title}</span>
            <span className={css.peekCount}>{specs.length}</span>
            <span className={css.peekHint}>{text.hint}</span>
          </div>
          <div className={css.peekList}>
            {specs.map((spec, index) => {
              const rule = spec.rule?.trim() ?? ''
              return (
                <button
                  key={spec.path}
                  type="button"
                  className={css.peekItem}
                  data-testid="wl-peek-item"
                  onClick={() => open(index)}
                >
                  <span className={css.peekIcon}>
                    <Icon name="file" size={13} />
                  </span>
                  <span className={css.peekPath}>{spec.path}</span>
                  <span className={cx(css.peekRule, rule === '' && css.peekRuleEmpty)}>
                    {rule === '' ? text.noRule : rule}
                  </span>
                </button>
              )
            })}
          </div>
          <button
            type="button"
            className={css.peekAdd}
            data-testid="wl-peek-add"
            onClick={() => open('new')}
          >
            <Icon name="plus" size={13} />
            {text.add}
          </button>
        </div>
      </NodeToolbar>
    </>
  )
}

/** `nodeTypes` / `edgeTypes` 必须是稳定引用，否则 React Flow 每次渲染都重建全部节点。 */
const NODE_TYPES = { wfNode: StepCard }
const EDGE_TYPES = { wfEdge: LinkLine }

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
  flow: StepNode
}

export function Canvas(props: CanvasProps): React.JSX.Element {
  const { t, doc, analysis, selection, problems, onEdit, onSelect, onRequestAdd, onDropSource } =
    props
  const flow = useReactFlow<StepNode, LinkEdge>()
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
  const openOutputRef = useRef(props.onOpenOutput)
  openOutputRef.current = props.onOpenOutput
  const onOpenOutput = useCallback(
    (id: string, index: number | 'new'): void => openOutputRef.current(id, index),
    [],
  )

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
      noFileText: t('node.noFile'),
      addText: t('node.add'),
      pass: t('edge.pass'),
      fail: t('edge.fail'),
      peek: {
        title: t('out.peekTitle'),
        hint: t('out.peekHint'),
        noRule: t('out.noRule'),
        add: t('ins.output.add'),
      },
    }),
    [t],
  )

  const nodes = useMemo<StepNode[]>(() => {
    const next = new Map<string, CacheEntry>()
    const selectedId = selection?.kind === 'node' ? idKey(selection.id) : null
    const list = doc.nodes.map((node) => {
      const prompt = node.data.prompt
      const empty = prompt === undefined || prompt.trim() === ''
      const reported = tones.get(idKey(node.id))
      const tone: Tone = empty ? 'error' : (reported?.tone ?? 'ok')
      const note = empty ? texts.noPromptText : (reported?.note ?? '')
      const selected = idKey(node.id) === selectedId
      const moving = dragging[node.id]
      const signature = `${selected}|${tone}|${note}|${texts.addText}`
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
      const built: StepNode = {
        id: node.id,
        type: 'wfNode',
        position: moving ?? node.position,
        selected,
        ...(size === undefined ? {} : { measured: size }),
        data: {
          title:
            node.data.label === undefined || node.data.label === '' ? node.id : node.data.label,
          kind: kindOf(node.id),
          // 写了描述就用描述（那是给人看的一句话），没写才摘提示词。
          excerpt:
            node.data.description !== undefined && node.data.description.trim() !== ''
              ? node.data.description
              : excerptOf(prompt),
          output: node.data.output,
          tone,
          note,
          noPromptText: texts.noPromptText,
          noFileText: texts.noFileText,
          addText: texts.addText,
          peekText: texts.peek,
          onAdd,
          onOpenOutput,
        },
      }
      // 拖动中的对象每帧都不同，不进缓存；松手后按文档里的新坐标重建一次再缓存。
      if (moving === undefined) next.set(node.id, { node, signature, flow: built })
      return built
    })
    cache.current = next
    return list
  }, [doc.nodes, selection, tones, dragging, texts, onAdd, onOpenOutput])

  const edges = useMemo<LinkEdge[]>(() => {
    const selectedId = selection?.kind === 'edge' ? selection.id : null
    return doc.edges.map((edge) => {
      const when = whenOf(edge)
      const back = analysis.backEdges.has(edge.id)
      const selected = edge.id === selectedId
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
        selected,
        className: cx(
          css.link,
          when === 'fail' && css.linkFail,
          when === 'pass' && css.linkPass,
          back && css.linkBack,
        ),
        // 箭头颜色传 CSS 变量：React Flow 把它写进箭头的内联样式，跟着主题与语气走。
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
        data: {
          when,
          back,
          text: when === 'pass' ? texts.pass : when === 'fail' ? texts.fail : (when ?? ''),
          onPick,
        },
      }
    })
  }, [doc.edges, analysis, selection, texts, onPick])

  const onNodesChange = useCallback(
    (changes: NodeChange<StepNode>[]): void => {
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
      <ReactFlow<StepNode, LinkEdge>
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
        isValidConnection={(connection) => connection.source !== connection.target}
        onConnect={(connection) => {
          onEdit({ type: 'connect', source: connection.source, target: connection.target })
        }}
        onConnectEnd={(event, state) => {
          // 线拖到空白处松手：就地加一个步骤并连上。
          if (state.isValid === true || state.fromNode === null) return
          if (state.fromHandle?.type !== 'source') return
          const point = 'changedTouches' in event ? event.changedTouches[0] : event
          if (point === undefined) return
          const target = event.target
          if (!(target instanceof Element) || !target.classList.contains('react-flow__pane')) return
          const client = { x: point.clientX, y: point.clientY }
          const at = flow.screenToFlowPosition(client)
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
