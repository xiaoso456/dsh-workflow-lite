/**
 * dsh-workflow-lite — 自动布局。
 *
 * 整图重排交给 ELK（`elkjs` 的 layered 算法）：分层、同层排序（减少交叉）、算坐标都是它做的。
 * 我们只把自己的版式语法喂给它：
 * - **列 = 执行批次**：用 ELK 的 interactive 分层，按批次给出横坐标，版面本身就在讲执行次序；
 * - **资源挂在写它的步骤下面**：一个步骤和它写的资源在 ELK 眼里是一整块（步骤卡 + 下面竖着一串
 *   资源卡），块的高度随资源卡的高度变，ELK 按真实高度排，谁也压不到谁；资源卡往右缩进，写线从步骤的
 *   写点竖着落下来、分叉进每张资源卡的左边（见 route.ts），不会穿过任何卡片；
 * - 没人写、只被读的资源单独成块，放在第一个读它的步骤的前一列；只被后面的步骤在原文件上更新、
 *   却被前面的步骤读的（共享的状态文档、台账）也一样——它本来就在，是输入；
 * - 读线只拉相邻一列的（或者读它的步骤没别的线拉着）：跨好几列的读线不参与排版，免得把主线挤歪；
 * - 流程线的进出口固定在步骤卡（不是整块）的半高处，ELK 才会把一条链摆成一条直线。
 * - 列距整齐划一；只有相邻两列之间的线上挂着条件牌子 / 交接标记时，把那一处拉开到放得下牌子。
 *
 * 补位（只给个别新节点找地方）仍是同步的就近规则：已经摆好的版面一律不动。
 *
 * `(0,0)` 是"还没摆过"的哨兵值（host 新建节点时的初始坐标），所以版面原点不落在它上面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/layout
 */

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js'
import type { GraphAnalysis } from '../../shared/graph.ts'
import { byId, edgeWhen } from '../../shared/graph.ts'
import { inputReaders } from '../../shared/inputs.ts'
import { idKey, isInput, isResource } from '../../shared/model.ts'
import { edgeKind, nodeIndex, resolveHandoff, resourceGraph } from '../../shared/resources.ts'
import type {
  Point,
  ResourceData,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from '../../shared/types.ts'

/** 步骤卡的宽度（CSS 里写死同一个数）与估算高度。 */
export const NODE_W = 216
export const NODE_H = 96

/** 资源卡的宽度（CSS 里写死同一个数）与紧凑时的高度（只有一项、没起名字：一行，像一张文件卡）。 */
export const RES_W = 200
export const RES_H = 56

/** 资源卡展开时的各段高度（CSS 里写死同样的数）：标题、描述、每一项、"还有 N 项"、上下留白。 */
const RES_HEAD = 38
const RES_DESC = 18
const RES_ROW = 22
const RES_MORE = 20
const RES_PAD = 10
/** 资源卡上最多列几项，再多折成"还有 N 项"。 */
export const RES_SHOWN = 4

/** 资源卡是不是紧凑的一行：没名字、没描述、最多一项。 */
export function isCompactResource(data: ResourceData): boolean {
  return (
    (data.label ?? '').trim() === '' &&
    (data.description ?? '').trim() === '' &&
    data.items.length <= 1
  )
}

/** 资源卡的估算高度（画布量出来之前按它排）。 */
export function resourceHeight(data: ResourceData): number {
  if (isCompactResource(data)) return RES_H
  const rows = Math.max(1, Math.min(data.items.length, RES_SHOWN))
  return (
    RES_HEAD +
    ((data.description ?? '').trim() === '' ? 0 : RES_DESC) +
    rows * RES_ROW +
    (data.items.length > RES_SHOWN ? RES_MORE : 0) +
    RES_PAD
  )
}

/** 输入卡的宽度（CSS 里写死同一个数）与估算高度：挂在读它的步骤旁边。 */
export const INPUT_W = 180
export const INPUT_H = 56

/** 一张卡的标称尺寸（还没量出来时按它算）。 */
export function cardSize(node: WorkflowNode): { w: number; h: number } {
  if (isInput(node)) return { w: INPUT_W, h: INPUT_H }
  return isResource(node) ? { w: RES_W, h: resourceHeight(node.data) } : { w: NODE_W, h: NODE_H }
}

/**
 * 资源卡相对写它的步骤：往右缩进 `RES_DX`（左边要让出树干和拐弯），第一张离步骤底边
 * `RES_DY`，往下每张隔 `RES_GAP`。
 */
export const RES_DX = 84
const RES_DY = 22
const RES_GAP = 14

/** 一块（步骤 + 它的资源）的宽度：块与块等宽，列才对得齐。 */
const BLOCK_W = RES_DX + RES_W
/** 列与列之间留的空（块的右沿到下一列左沿）、同一列里块与块的上下间距。 */
const LAYER_GAP = 64
const BLOCK_GAP = 36

/** 列距（「添加下一步」也按它往右挪一列）与行距。 */
export const COL_STEP = BLOCK_W + LAYER_GAP
export const ROW_STEP = 132

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function boxOf(node: WorkflowNode, at: Point = node.position): Box {
  const size = cardSize(node)
  return { x: at.x, y: at.y, w: size.w, h: size.h }
}

function hits(a: Box, b: Box): boolean {
  const gap = 12
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  )
}

/** 从 `want` 起往下找一个不压住任何已有卡片的位置（按真实尺寸比）。 */
function freeBox(occupied: readonly Box[], want: Box, step: number): Point {
  const spot = { ...want }
  while (occupied.some((box) => hits(box, spot))) spot.y += step
  return { x: spot.x, y: spot.y }
}

/**
 * 一个资源卡该放哪：挂在写它的步骤（没人写就是读它的步骤）下面、往右缩进，被占了就往下找。
 * @param anchor - 写它 / 读它的步骤的坐标；没有就放在版面左下。
 */
export function resourceSpot(
  doc: WorkflowDocument,
  anchor: Point | undefined,
  skip?: string,
  height = RES_H,
): Point {
  const occupied = doc.nodes
    .filter((node) => node.id !== skip && !isUnplaced(node.position))
    .map((node) => boxOf(node))
  const base =
    anchor ??
    (occupied.length === 0
      ? ORIGIN
      : {
          x: Math.min(...occupied.map((box) => box.x)),
          y: Math.max(...occupied.map((box) => box.y + box.h)),
        })
  return freeBox(
    occupied,
    { x: base.x + RES_DX, y: base.y + NODE_H + RES_DY, w: RES_W, h: height },
    RES_H + RES_GAP,
  )
}

/**
 * 一个输入卡该放哪：读它的步骤左边、和步骤上沿对齐，被占了就往下找；没有读它的步骤就放在版面左上方。
 */
export function inputSpot(doc: WorkflowDocument, reader: Point | undefined, skip?: string): Point {
  const occupied = doc.nodes
    .filter((node) => node.id !== skip && !isUnplaced(node.position))
    .map((node) => boxOf(node))
  const base =
    reader ??
    (occupied.length === 0
      ? { x: ORIGIN.x + INPUT_W + LAYER_GAP, y: ORIGIN.y }
      : {
          x: Math.min(...occupied.map((box) => box.x)),
          y: Math.min(...occupied.map((box) => box.y)),
        })
  return freeBox(
    occupied,
    { x: base.x - INPUT_W - LAYER_GAP, y: base.y, w: INPUT_W, h: INPUT_H },
    INPUT_H + RES_GAP,
  )
}

/** 资源卡的锚点：第一个写它的步骤，没有就第一个读它的步骤。 */
function anchorOf(
  doc: WorkflowDocument,
  resourceId: string,
  position: (id: string) => Point | undefined,
): Point | undefined {
  const info = resourceGraph(doc).get(resourceId)
  if (info === undefined) return undefined
  for (const id of [...info.writers.map((writer) => writer.id), ...info.readers]) {
    const at = position(id)
    if (at !== undefined) return at
  }
  return undefined
}

const ORIGIN: Point = { x: 80, y: 80 }

/** 这个节点是不是还没摆过。 */
export function isUnplaced(position: Point): boolean {
  return position.x === 0 && position.y === 0
}

/** 一段文字在线上小牌子里大约多宽（中日韩字按全角算），不超过牌子文字的最大宽度。 */
function textWidth(text: string): number {
  let width = 0
  for (const char of text) width += (char.codePointAt(0) ?? 0) >= 0x2e80 ? 11 : 6.5
  return Math.min(120, width)
}

/**
 * 步骤之间那条线上挂的东西（条件牌子、交接标记）大约多宽；什么都不挂是 0。
 * 「通过 / 未通过」在画布上是翻译过的短词，按三个字算。
 */
function labelWidth(edge: WorkflowEdge, back: boolean): number {
  const when = edgeWhen(edge)
  const handoff = resolveHandoff(edge.data?.handoff)
  const text =
    when === undefined ? 0 : textWidth(when === 'pass' || when === 'fail' ? '未通过' : when)
  const condition = when === undefined && !back ? 0 : 18 + text + (back ? 14 : 0)
  const mark = !handoff.result ? 18 + textWidth('只管先后') : handoff.note === undefined ? 0 : 34
  return Math.max(condition, mark)
}

/** 量出来的卡片尺寸（画布上已经渲染过的卡）；没有就按估算尺寸。 */
export type SizeOf = (id: string) => { width: number; height: number } | undefined

/** ELK 的引擎按需加载：只有真的要整图重排时才初始化（它不小）。 */
let engine: Promise<{ layout(graph: ElkNode): Promise<ElkNode> }> | null = null

function elk(): Promise<{ layout(graph: ElkNode): Promise<ElkNode> }> {
  engine ??= import('elkjs/lib/elk.bundled.js').then((module) => new module.default())
  return engine
}

const ELK_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  // 列 = 执行批次：按我们给的横坐标分层，而不是让 ELK 自己挪。
  'elk.layered.layering.strategy': 'INTERACTIVE',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
  // 线由画布自己画；折线路由不会为了竖段占道把列距撑开，列距才是恒定的。
  'elk.edgeRouting': 'POLYLINE',
  'elk.spacing.nodeNode': String(BLOCK_GAP),
  'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYER_GAP),
  'elk.layered.spacing.edgeNodeBetweenLayers': '0',
  'elk.spacing.edgeNode': '0',
  'elk.spacing.edgeEdge': '0',
  // 不连通的几块也排在同一套列里（分开排各自从第 0 列起，列就对不齐了）。
  'elk.separateConnectedComponents': 'false',
}

/**
 * 整图重排：每个节点都重算，同一张图必然摆成同一版式。
 * @param sizeOf - 卡片的真实尺寸（步骤卡的高度随内容变）；不给就按估算尺寸。
 */
export async function tidy(
  doc: WorkflowDocument,
  analysis: GraphAnalysis,
  sizeOf: SizeOf = () => undefined,
): Promise<Record<string, Point>> {
  const index = nodeIndex(doc)
  const heightOf = (node: WorkflowNode): number => sizeOf(node.id)?.height ?? cardSize(node).h

  // ── 每个步骤在第几列（= 执行批次）──
  const column = new Map<string, number>()
  analysis.batches.forEach((batch, batchIndex) => {
    for (const id of batch.nodes) column.set(idKey(id), batchIndex)
  })
  const steps = doc.nodes.filter((node) => !isResource(node) && !isInput(node))
  // 批次之外的步骤（理论上没有）：排在最后一列之后。
  for (const node of steps) {
    if (!column.has(idKey(node.id))) column.set(idKey(node.id), analysis.batches.length)
  }
  const columnOf = (id: string): number => column.get(idKey(id)) ?? 0

  // ── 资源归谁：最早那一列写它的步骤；没人写就单独成块 ──
  const resources = resourceGraph(doc)
  const owned = new Map<string, WorkflowNode[]>()
  const inputs: { node: WorkflowNode; column: number }[] = []
  const loose: WorkflowNode[] = []
  for (const node of doc.nodes) {
    // 输入节点和没人写的资源一样：单独成块，放在第一个用到它的步骤的前一列。
    if (isInput(node)) {
      const readers = inputReaders(doc, node.id)
      if (readers.length === 0) loose.push(node)
      else inputs.push({ node, column: Math.min(...readers.map(columnOf)) - 1 })
      continue
    }
    if (!isResource(node)) continue
    const info = resources.get(node.id)
    const readers = info?.readers ?? []
    const firstRead = readers.length === 0 ? Infinity : Math.min(...readers.map(columnOf))
    const writers = info?.writers ?? []
    const producers = writers.filter((writer) => !writer.update)
    // 只在原文件上更新、又被更早的步骤读的（共享的状态文档、台账）：它本来就在，算输入；
    // 挂到后面更新它的步骤下面，前面读它的线就全得往回绕。
    const updatedLater =
      producers.length === 0 &&
      writers.length > 0 &&
      firstRead < Math.min(...writers.map((writer) => columnOf(writer.id)))
    if (writers.length > 0 && !updatedLater) {
      const owner = [...(producers.length > 0 ? producers : writers)].sort(
        (a, b) => columnOf(a.id) - columnOf(b.id),
      )[0]?.id as string
      const list = owned.get(idKey(owner)) ?? []
      list.push(node)
      owned.set(idKey(owner), list)
      continue
    }
    if (readers.length === 0) {
      loose.push(node)
      continue
    }
    inputs.push({ node, column: firstRead - 1 })
  }
  // 挂在同一个步骤下面的：它产出的在上，它只是更新的在下。
  for (const [owner, list] of owned) {
    const updates = (card: WorkflowNode): number =>
      resources.get(card.id)?.writers.some((writer) => idKey(writer.id) === owner && !writer.update)
        ? 0
        : 1
    list.sort((a, b) => updates(a) - updates(b))
  }

  // ── 喂给 ELK 的图 ──
  const children: ElkNode[] = []
  const stepHeight = new Map<string, number>()
  for (const node of [...steps].sort(
    (a, b) => columnOf(a.id) - columnOf(b.id) || byId(a.id, b.id),
  )) {
    const height = heightOf(node)
    stepHeight.set(node.id, height)
    const hung = owned.get(idKey(node.id)) ?? []
    const blockH =
      height +
      (hung.length === 0
        ? 0
        : RES_DY +
          hung.reduce((sum, card) => sum + heightOf(card), 0) +
          (hung.length - 1) * RES_GAP)
    children.push({
      id: node.id,
      x: columnOf(node.id) * COL_STEP,
      y: 0,
      width: BLOCK_W,
      height: blockH,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [
        { id: `${node.id}\u0000in`, x: 0, y: height / 2, width: 0, height: 0 },
        { id: `${node.id}\u0000out`, x: BLOCK_W, y: height / 2, width: 0, height: 0 },
      ],
    })
  }
  for (const input of inputs) {
    children.push({
      id: input.node.id,
      x: input.column * COL_STEP,
      y: 0,
      width: BLOCK_W,
      height: heightOf(input.node),
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [
        {
          id: `${input.node.id}\u0000out`,
          x: BLOCK_W,
          y: heightOf(input.node) / 2,
          width: 0,
          height: 0,
        },
      ],
    })
  }

  const edges: ElkExtendedEdge[] = []
  const linked = new Set<string>()
  /** 已经有线拉着的块（线的终点）。 */
  const pulled = new Set<string>()
  const link = (source: string, target: string): void => {
    const key = `${idKey(source)}\u0000${idKey(target)}`
    if (linked.has(key)) return
    linked.add(key)
    pulled.add(idKey(target))
    edges.push({
      id: `e${edges.length}`,
      sources: [`${source}\u0000out`],
      targets: [`${target}\u0000in`],
    })
  }
  // 相邻两列之间的线上挂着牌子时，把这两列拉开到放得下牌子（不压到两头的步骤卡）。
  const pitch = new Map<number, number>()
  const ownerOf = new Map<string, string>()
  for (const [owner, list] of owned) {
    for (const file of list) ownerOf.set(idKey(file.id), owner)
  }
  const stepId = (key: string): string | undefined => index.get(key)?.id
  const inputColumn = new Map(inputs.map((input) => [idKey(input.node.id), input.column]))
  const reads: { from: string; reader: string; span: number }[] = []
  for (const edge of doc.edges) {
    const kind = edgeKind(index, edge)
    if (kind === 'flow') {
      // 回边（循环往回走的线）不参与排版：它们本来就是逆着列走的。
      if (analysis.backEdges.has(edge.id)) continue
      const source = stepId(idKey(edge.source))
      const target = stepId(idKey(edge.target))
      if (source === undefined || target === undefined) continue
      link(source, target)
      const from = columnOf(source)
      const width = labelWidth(edge, false)
      if (width > 0 && columnOf(target) === from + 1) {
        pitch.set(from, Math.max(pitch.get(from) ?? COL_STEP, NODE_W + width + 28))
      }
    } else if (kind === 'read' || kind === 'ask') {
      const reader = stepId(idKey(edge.target))
      if (reader === undefined) continue
      const owner = ownerOf.get(idKey(edge.source))
      const from = owner === undefined ? stepId(idKey(edge.source)) : stepId(owner)
      if (from === undefined) continue
      const fromColumn =
        owner === undefined
          ? (inputColumn.get(idKey(edge.source)) ?? columnOf(reader) - 1)
          : columnOf(from)
      if (fromColumn < columnOf(reader)) {
        reads.push({ from, reader, span: columnOf(reader) - fromColumn })
      }
    }
  }
  /*
   * 读线也拉一把：读的资源在谁那块里，就把那块和读它的步骤摆近一点（只算往右的）。
   * 但只拉相邻一列的，或者读它的步骤除此之外没有别的线拉着：跨好几列的读线在 ELK 眼里是一串占位的
   * 虚节点，会把中间几列的块挤开，主线就被挤得高低不平（这条线画布照样画，只是不参与排版）。
   */
  for (const read of [...reads].sort((a, b) => a.span - b.span)) {
    if (read.span > 1 && pulled.has(idKey(read.reader))) continue
    link(read.from, read.reader)
  }

  const laid = await (await elk()).layout({
    id: 'root',
    layoutOptions: ELK_OPTIONS,
    children,
    edges,
  })

  // ── 从块的位置还原每张卡的位置 ──
  // 横坐标按列直接给（ELK 会为线留出不等的列距，我们要的是整齐的列，只为牌子让位）；纵坐标用 ELK 的。
  const blocks = laid.children ?? []
  const blockColumn = (id: string): number => inputColumn.get(idKey(id)) ?? columnOf(id)
  const firstColumn = Math.min(...blocks.map((block) => blockColumn(block.id)))
  const columnX = (target: number): number => {
    let x = ORIGIN.x
    for (let at = firstColumn; at < target; at += 1) x += pitch.get(at) ?? COL_STEP
    return x
  }
  const minY = Math.min(...blocks.map((block) => block.y ?? 0))
  const placed: Record<string, Point> = {}
  let bottom = ORIGIN.y
  const put = (node: WorkflowNode, x: number, y: number): void => {
    placed[node.id] = { x, y: Math.round(y) }
    bottom = Math.max(bottom, Math.round(y) + heightOf(node))
  }
  for (const block of blocks) {
    const node = index.get(idKey(block.id))
    if (node === undefined) continue
    const x = columnX(blockColumn(block.id))
    const y = (block.y ?? 0) - minY + ORIGIN.y
    if (isResource(node) || isInput(node)) {
      put(node, x + RES_DX, y)
      continue
    }
    put(node, x, y)
    let top = y + (stepHeight.get(node.id) ?? NODE_H) + RES_DY
    for (const card of owned.get(idKey(node.id)) ?? []) {
      put(card, x + RES_DX, top)
      top += heightOf(card) + RES_GAP
    }
  }
  // 谁都不连的资源与输入：在版面下方排成一行。
  loose.forEach((node, slot) => {
    placed[node.id] = { x: ORIGIN.x + slot * (RES_W + 24), y: bottom + 48 }
  })
  return placed
}

/** 两张卡会不会叠在一起（留一点呼吸空间）。 */
function overlaps(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < NODE_W + 24 && Math.abs(a.y - b.y) < NODE_H + 24
}

/** 从 `want` 起往下找一个不压住任何已有卡片的位置。 */
export function freeSpot(occupied: readonly Point[], want: Point): Point {
  let spot = want
  while (occupied.some((point) => overlaps(point, spot))) {
    spot = { x: spot.x, y: spot.y + ROW_STEP }
  }
  return spot
}

/** 「添加下一步」的落点：源步骤的右边一列，被占了就往下找。 */
export function nextTo(doc: WorkflowDocument, source: Point): Point {
  return freeSpot(
    doc.nodes.map((node) => node.position),
    { x: source.x + COL_STEP, y: source.y },
  )
}

/**
 * 给**还没摆过**的节点补坐标（已有坐标的一律不动）。
 *
 * 全都没摆过 ⇒ 整图重排；只有个别没摆过（模型用工具新加了一步）⇒ 挨着它的上游放，
 * 不去动用户已经摆好的版面。
 */
export async function placeMissing(
  doc: WorkflowDocument,
  analysis: GraphAnalysis,
): Promise<Record<string, Point>> {
  const missing = doc.nodes.filter((node) => isUnplaced(node.position))
  if (missing.length === 0) return {}
  if (missing.length === doc.nodes.length) return tidy(doc, analysis)

  const position = new Map<string, Point>()
  for (const node of doc.nodes) {
    if (!isUnplaced(node.position)) position.set(node.id, node.position)
  }
  const bottom = Math.max(...[...position.values()].map((point) => point.y))
  const left = Math.min(...[...position.values()].map((point) => point.x))
  const placed: Record<string, Point> = {}
  const occupied = (): Point[] => [...position.values()]
  // 按批次序走：同一轮里先摆上游，下游才有参照。
  for (const id of analysis.batches.flatMap((batch) => batch.nodes)) {
    if (position.has(id)) continue
    const anchor = (analysis.predecessors.get(id) ?? [])
      .map((predecessor) => position.get(predecessor))
      .find((point) => point !== undefined)
    const want =
      anchor === undefined
        ? { x: left, y: bottom + ROW_STEP }
        : { x: anchor.x + COL_STEP, y: anchor.y }
    const spot = freeSpot([...position.values()], want)
    position.set(id, spot)
    placed[id] = spot
  }
  // 输入卡（模型用工具加的）：放到第一个用到它的步骤左边。
  for (const node of missing) {
    if (placed[node.id] !== undefined || !isInput(node)) continue
    const reader = inputReaders(doc, node.id)
      .map((id) => position.get(id))
      .find((point) => point !== undefined)
    const current: WorkflowDocument = {
      ...doc,
      nodes: doc.nodes.map((item) => ({
        ...item,
        position: position.get(item.id) ?? { x: 0, y: 0 },
      })),
    }
    const spot = inputSpot(current, reader, node.id)
    position.set(node.id, spot)
    placed[node.id] = spot
  }
  // 资源卡（模型用工具加的）：挂到写它的步骤下面。
  for (const node of missing) {
    if (placed[node.id] !== undefined || !isResource(node)) continue
    const anchor = anchorOf(doc, node.id, (id) => position.get(id))
    const current: WorkflowDocument = {
      ...doc,
      nodes: doc.nodes.map((item) => {
        const at = position.get(item.id)
        return at === undefined ? { ...item, position: { x: 0, y: 0 } } : { ...item, position: at }
      }),
    }
    const spot = resourceSpot(current, anchor, node.id, cardSize(node).h)
    position.set(node.id, spot)
    placed[node.id] = spot
  }
  // 批次里没有的步骤（理论上没有）：放到版面下方，别让它留在原点。
  for (const node of missing) {
    if (placed[node.id] !== undefined) continue
    const spot = freeSpot(occupied(), { x: left, y: bottom + ROW_STEP })
    position.set(node.id, spot)
    placed[node.id] = spot
  }
  return placed
}
