/**
 * dsh-workflow-lite — 自动布局。
 *
 * 整图重排交给 ELK（`elkjs` 的 layered 算法）：分层、同层排序（减少交叉）、算坐标都是它做的。
 * 我们只把自己的版式语法喂给它：
 * - **列 = 执行批次**：用 ELK 的 interactive 分层，按批次给出横坐标，版面本身就在讲执行次序；
 * - **资源挂在写它的步骤下面**：一个步骤和它写的资源在 ELK 眼里是一整块（步骤卡 + 下面竖着一串
 *   资源卡），块的高度随资源卡的高度变，ELK 按真实高度排，谁也压不到谁；资源卡往右缩进，写线从步骤的
 *   写点竖着落下来、分叉进每张资源卡的左边（见 route.ts），不会穿过任何卡片；
 * - **主线拉直**：沿流程线最长的一条路是主线，ELK 优先把它摆成一条水平线，跳过几步的分支从上下绕；
 * - 没人写、只被读的资源单独成块，放在第一个读它的步骤的前一列；
 * - **贯穿好几步的文档**（好几步写它、更新之前就被读、三步以上都读它；三步以上都要的提问也算）
 *   放在主线上方一排，挨着第一个用到它的步骤：读写线走总线（见 bus.ts），从卡片底边落到一条横线上，
 *   再竖着落进每个步骤的上边，不会有线从画布另一头绕回来；
 * - 读线只拉相邻一列的（或者读它的步骤没别的线拉着）：跨好几列的读线不参与排版，免得把主线挤歪；
 * - 流程线的进出口固定在步骤卡（不是整块）的半高处，ELK 才会把一条链摆成一条直线；
 * - **触发卡片**放在主线头一个步骤左边、和它对齐，多了排成几列；**谁都不连的卡**（背景资料、
 *   整个工作流的记忆）放在左上角一排；
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
import { idKey, isInput, isResource, isStep, isTrigger } from '../../shared/model.ts'
import { edgeKind, nodeIndex, resolveHandoff, resourceGraph } from '../../shared/resources.ts'
import type {
  Point,
  ResourceData,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
} from '../../shared/types.ts'
import { displayCardSize, displayOf } from './display.ts'
import { STEP_SPOTS } from './route.ts'

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

/** 资源卡的估算尺寸：展示卡按展示区算，其余宽度固定。 */
export function resourceSize(data: ResourceData): { w: number; h: number } {
  const display = displayOf(data)
  if (display === null) return { w: RES_W, h: resourceHeight(data) }
  const size = displayCardSize(display)
  return { w: Math.max(RES_W, size.w), h: size.h }
}

/** 资源卡的估算高度（画布量出来之前按它排）。 */
export function resourceHeight(data: ResourceData): number {
  const display = displayOf(data)
  if (display !== null) return displayCardSize(display).h
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

/** 触发卡片的宽度（和步骤卡同一副外壳）与估算高度：不连线，自己待在一边。 */
export const TRIGGER_W = NODE_W
export const TRIGGER_H = 108

/** 一张卡的标称尺寸（还没量出来时按它算）。 */
export function cardSize(node: WorkflowNode): { w: number; h: number } {
  if (isInput(node)) return { w: INPUT_W, h: INPUT_H }
  if (isTrigger(node)) return { w: TRIGGER_W, h: TRIGGER_H }
  return isResource(node) ? resourceSize(node.data) : { w: NODE_W, h: NODE_H }
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
 * @param size - 这张卡多大（展示卡比普通资源卡大，按它的真实尺寸找空位）。
 */
export function resourceSpot(
  doc: WorkflowDocument,
  anchor: Point | undefined,
  skip?: string,
  size: { w: number; h: number } = { w: RES_W, h: RES_H },
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
    { x: base.x + RES_DX, y: base.y + NODE_H + RES_DY, w: size.w, h: size.h },
    RES_H + RES_GAP,
  )
}

/**
 * 一个步骤的记忆卡该放哪：和产出一样挂在步骤下面、往右缩进（下面已经挂着产出就接在它们后面）。
 * 只是往下找的时候要越过别的步骤卡，写线就得绕开它——这时改放到步骤上面（写线从上边的写点出去），
 * 上面也不通才退回下面那个位置。
 */
export function memorySpot(doc: WorkflowDocument, step: WorkflowNode): Point {
  const occupied = doc.nodes
    .filter((node) => node.id !== step.id && !isUnplaced(node.position))
    .map((node) => ({ node, box: boxOf(node) }))
  const boxes = occupied.map((item) => item.box)
  const others = occupied.filter((item) => isStep(item.node))
  const x = step.position.x + RES_DX
  // 上边的写点比底边的靠右（见 route.ts 的 STEP_SPOTS），放上面要多缩进那么一截，写线才是一个直角。
  const upX = x + Math.ceil((STEP_SPOTS.fileUp.at - STEP_SPOTS.file.at) * NODE_W)
  // 写线走的那一竖条（步骤的写点 → 记忆卡左边）上有没有别的步骤。
  const blocked = (from: number, to: number): boolean => {
    const band = {
      x: step.position.x,
      y: Math.min(from, to),
      w: upX - step.position.x + RES_W,
      h: Math.abs(to - from),
    }
    return others.some((item) => hits(item.box, band))
  }
  const below = freeBox(
    boxes,
    { x, y: step.position.y + NODE_H + RES_DY, w: RES_W, h: RES_H },
    RES_H + RES_GAP,
  )
  if (!blocked(step.position.y + NODE_H, below.y + RES_H)) return below
  const above = { x: upX, y: step.position.y - RES_DY - RES_H, w: RES_W, h: RES_H }
  while (boxes.some((box) => hits(box, above))) above.y -= RES_H + RES_GAP
  return blocked(above.y, step.position.y) ? below : { x: above.x, y: above.y }
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

/**
 * 新的触发卡片放哪：整张图上面的一排，从最左边起；那里已经有卡片（多半是别的触发卡片）就接在右边。
 * 「整张图」不算已有的触发卡片——否则每加一张就又往上叠一排；图里只有触发卡片时和它们排成一排。
 */
export function triggerSpot(doc: WorkflowDocument, skip?: string): Point {
  const placed = doc.nodes.filter((node) => node.id !== skip && !isUnplaced(node.position))
  const occupied = placed.map((node) => boxOf(node))
  if (occupied.length === 0) return { ...ORIGIN }
  const graph = placed.filter((node) => !isTrigger(node)).map((node) => boxOf(node))
  const y =
    graph.length === 0
      ? Math.min(...occupied.map((box) => box.y))
      : Math.min(...graph.map((box) => box.y)) - TRIGGER_H - BLOCK_GAP
  let x = Math.min(...occupied.map((box) => box.x))
  for (let tries = 0; tries <= occupied.length; tries += 1) {
    const hit = occupied.find(
      (other) =>
        x < other.x + other.w + RES_GAP &&
        other.x < x + TRIGGER_W + RES_GAP &&
        y < other.y + other.h &&
        other.y < y + TRIGGER_H,
    )
    if (hit === undefined) break
    x = hit.x + hit.w + RES_GAP + 10
  }
  return { x, y }
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
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
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

/** 主线上的线：ELK 摆坐标时优先把它们拉直。 */
const SPINE_EDGE: Record<string, string> = {
  'elk.layered.priority.straightness': '100',
}

/** 两张卡之间一条线的键（ELK 里去重、认主线用）。 */
function pairKey(source: string, target: string): string {
  return `${idKey(source)}\u0000${idKey(target)}`
}

/**
 * 主线：沿往前走的流程线能走的最长一条路（按经过的步骤数），平手按 id 挑，同一张图总是同一条。
 * `start` 是它的头一个步骤（没有步骤时为 `undefined`），`edges` 是路上每一段的 {@link pairKey}。
 */
function spineOf(
  doc: WorkflowDocument,
  analysis: GraphAnalysis,
  index: ReturnType<typeof nodeIndex>,
  columnOf: (id: string) => number,
): { start: string | undefined; edges: Set<string> } {
  const next = new Map<string, string[]>()
  for (const edge of doc.edges) {
    if (analysis.backEdges.has(edge.id) || edgeKind(index, edge) !== 'flow') continue
    if (columnOf(edge.target) <= columnOf(edge.source)) continue
    const list = next.get(idKey(edge.source)) ?? []
    if (!list.includes(idKey(edge.target))) list.push(idKey(edge.target))
    next.set(idKey(edge.source), list)
  }
  // 从每个步骤往后最长能走几步（从后往前算）。
  const keys = doc.nodes.filter(isStep).map((node) => idKey(node.id))
  keys.sort((a, b) => columnOf(b) - columnOf(a) || byId(b, a))
  const reach = new Map<string, { length: number; via: string | undefined }>()
  for (const key of keys) {
    let best: { length: number; via: string | undefined } = { length: 0, via: undefined }
    for (const target of [...(next.get(key) ?? [])].sort(byId)) {
      const length = (reach.get(target)?.length ?? 0) + 1
      if (length > best.length) best = { length, via: target }
    }
    reach.set(key, best)
  }
  let start: string | undefined
  for (const key of [...keys].reverse()) {
    if (start === undefined || (reach.get(key)?.length ?? 0) > (reach.get(start)?.length ?? 0)) {
      start = key
    }
  }
  const edges = new Set<string>()
  for (let at = start; at !== undefined; ) {
    const via: string | undefined = reach.get(at)?.via
    if (via !== undefined) edges.add(pairKey(at, via))
    at = via
  }
  return { start: start === undefined ? undefined : index.get(start)?.id, edges }
}

/** 整理时每张卡归到哪儿（步骤自己成块，不在这里）。 */
interface Sorted {
  /** 挂在步骤下面的资源（键是步骤的 idKey）：它产出的在上，它只是更新的在下。 */
  owned: Map<string, WorkflowNode[]>
  /** 单独成块、放进某一列的卡：输入、只被读的资源。 */
  aside: { node: WorkflowNode; column: number }[]
  /** 触发卡片（图里有步骤时）：放在主线头一个步骤左边。 */
  triggers: WorkflowNode[]
  /** 贯穿好几步的文档：主线上方的一排；`first` 是第一个用到它的步骤在第几列，`trunks` 是它要几条干线（读、产出、更新各一条）。 */
  shared: { node: WorkflowNode; first: number; trunks: number }[]
  /** 不和任何步骤相连的卡（背景资料、整个工作流的记忆）：左上角的一排。 */
  background: WorkflowNode[]
}

/**
 * 给每张不是步骤的卡分个去处：
 * - 贯穿好几步的：不止一列的步骤写它（先产出、后面又更新的档案，几步轮流更新的台账、队列），
 *   只被原地更新、又在更新之前就被读的（状态文档），没人写、却有三步以上都读的（规范、清单），
 *   三步以上都要回答的提问——挂在哪一步下面、放在哪一列前面，都会有线从老远绕回来：
 *   放到主线上方，用到它的步骤都在它下面，读写线走总线；
 * - 有步骤整份产出它：挂在最早产出它的步骤下面；只被一个步骤在原文件上更新、之后才被读的也挂在那个步骤下面；
 * - 没人写、只被一两个步骤读的资源和输入：单独成块，放在第一个读它的步骤的前一列；
 * - 触发卡片：放在主线头一个步骤左边（它就是整条线的起点），见 {@link tidy}；
 * - 谁都不连的：左上角一排。
 */
function sortCards(
  doc: WorkflowDocument,
  columnOf: (id: string) => number,
  start: string | undefined,
): Sorted {
  const resources = resourceGraph(doc)
  const sorted: Sorted = { owned: new Map(), aside: [], triggers: [], shared: [], background: [] }
  for (const node of doc.nodes) {
    if (isTrigger(node)) {
      if (start === undefined) sorted.background.push(node)
      else sorted.triggers.push(node)
      continue
    }
    if (isInput(node)) {
      const readers = inputReaders(doc, node.id)
      const first = Math.min(...readers.map(columnOf))
      if (readers.length === 0) sorted.background.push(node)
      else if (readers.length >= LANE_READERS) sorted.shared.push({ node, first, trunks: 1 })
      else sorted.aside.push({ node, column: first - 1 })
      continue
    }
    if (!isResource(node)) continue
    const info = resources.get(node.id)
    const readers = info?.readers ?? []
    const writers = info?.writers ?? []
    const producers = writers.filter((writer) => !writer.update)
    const firstRead = readers.length === 0 ? Infinity : Math.min(...readers.map(columnOf))
    const writeColumns = new Set(writers.map((writer) => columnOf(writer.id)))
    const shared =
      writeColumns.size > 1 ||
      (producers.length === 0 && writers.length > 0 && firstRead < Math.min(...writeColumns)) ||
      (writers.length === 0 && readers.length >= LANE_READERS)
    if (shared) {
      const updates = writers.length - producers.length
      sorted.shared.push({
        node,
        first: Math.min(firstRead, ...writeColumns),
        trunks: [producers.length, updates, readers.length].filter((count) => count > 0).length,
      })
      continue
    }
    if (writers.length > 0) {
      const owner = [...(producers.length > 0 ? producers : writers)].sort(
        (a, b) => columnOf(a.id) - columnOf(b.id),
      )[0]?.id as string
      const list = sorted.owned.get(idKey(owner)) ?? []
      list.push(node)
      sorted.owned.set(idKey(owner), list)
      continue
    }
    if (readers.length === 0) sorted.background.push(node)
    else sorted.aside.push({ node, column: firstRead - 1 })
  }
  for (const [owner, list] of sorted.owned) {
    const updates = (card: WorkflowNode): number =>
      resources.get(card.id)?.writers.some((writer) => idKey(writer.id) === owner && !writer.update)
        ? 0
        : 1
    list.sort((a, b) => updates(a) - updates(b))
  }
  return sorted
}

/** 没人写的文档 / 提问有几步读它就放到主线上方。 */
const LANE_READERS = 3
/**
 * 主线上方那一排的底边离主线多远：总线的干线都在这道缝里（一条干线占一道），跨列的流程线也从这里绕。
 * 干线多了跟着加宽。
 */
const LANE_GAP = 96
const LANE_GAP_PER_TRUNK = 8
/** 左上角那一排（背景资料）和下面隔多远、同一排里卡与卡隔多远。 */
const BAND_GAP = 48
const ROW_GAP = 24

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
  const widthOf = (node: WorkflowNode): number => sizeOf(node.id)?.width ?? cardSize(node).w
  /** 一块的宽度：块与块等宽（列才对得齐），挂着的展示卡比资源卡宽时撑开这一块（这一列跟着变宽）。 */
  const blockWidth = (hung: readonly WorkflowNode[]): number =>
    Math.max(BLOCK_W, ...hung.map((card) => RES_DX + widthOf(card)))
  const blockW = new Map<string, number>()

  // ── 每个步骤在第几列（= 执行批次）──
  const column = new Map<string, number>()
  analysis.batches.forEach((batch, batchIndex) => {
    for (const id of batch.nodes) column.set(idKey(id), batchIndex)
  })
  const steps = doc.nodes.filter(isStep)
  // 批次之外的步骤（理论上没有）：排在最后一列之后。
  for (const node of steps) {
    if (!column.has(idKey(node.id))) column.set(idKey(node.id), analysis.batches.length)
  }
  const columnOf = (id: string): number => column.get(idKey(id)) ?? 0
  const spine = spineOf(doc, analysis, index, columnOf)
  const { owned, aside, triggers, shared, background } = sortCards(doc, columnOf, spine.start)

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
    const width = blockWidth(hung)
    blockW.set(node.id, width)
    children.push({
      id: node.id,
      x: columnOf(node.id) * COL_STEP,
      y: 0,
      width,
      height: blockH,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [
        { id: `${node.id}\u0000in`, x: 0, y: height / 2, width: 0, height: 0 },
        { id: `${node.id}\u0000out`, x: width, y: height / 2, width: 0, height: 0 },
      ],
    })
  }
  for (const card of aside) {
    const width = blockWidth([card.node])
    blockW.set(card.node.id, width)
    children.push({
      id: card.node.id,
      x: card.column * COL_STEP,
      y: 0,
      width,
      height: heightOf(card.node),
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [
        {
          id: `${card.node.id}\u0000out`,
          x: width,
          y: heightOf(card.node) / 2,
          width: 0,
          height: 0,
        },
      ],
    })
  }
  const inElk = new Set(children.map((child) => idKey(child.id)))

  const edges: ElkExtendedEdge[] = []
  const linked = new Set<string>()
  /** 已经有线拉着的块（线的终点）。 */
  const pulled = new Set<string>()
  const link = (source: string, target: string): void => {
    const key = pairKey(source, target)
    if (linked.has(key)) return
    linked.add(key)
    pulled.add(idKey(target))
    edges.push({
      id: `e${edges.length}`,
      sources: [`${source}\u0000out`],
      targets: [`${target}\u0000in`],
      ...(spine.edges.has(key) ? { layoutOptions: SPINE_EDGE } : {}),
    })
  }
  // 相邻两列之间的线上挂着牌子时，把这两列拉开到放得下牌子（不压到两头的步骤卡）。
  const pitch = new Map<number, number>()
  const ownerOf = new Map<string, string>()
  for (const [owner, list] of owned) {
    for (const file of list) ownerOf.set(idKey(file.id), owner)
  }
  const stepId = (key: string): string | undefined => index.get(key)?.id
  const asideColumn = new Map(aside.map((card) => [idKey(card.node.id), card.column]))
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
      // 不在 ELK 里的卡（主线上方那一排）的读线不拉。
      if (from === undefined || !inElk.has(idKey(from))) continue
      const fromColumn =
        owner === undefined
          ? (asideColumn.get(idKey(edge.source)) ?? columnOf(reader) - 1)
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

  const laid =
    children.length === 0
      ? { children: [] }
      : await (await elk()).layout({ id: 'root', layoutOptions: ELK_OPTIONS, children, edges })

  // ── 从块的位置还原每张卡的位置 ──
  // 横坐标按列直接给（ELK 会为线留出不等的列距，我们要的是整齐的列，只为牌子让位）；纵坐标用 ELK 的。
  const blocks = laid.children ?? []
  const blockColumn = (id: string): number => asideColumn.get(idKey(id)) ?? columnOf(id)
  const firstBlock = Math.min(0, ...blocks.map((block) => blockColumn(block.id)))
  /*
   * 触发卡片在最左边那一列再往左：一列放 √n 张，多了往左再开一列（十来张也不会摞成一根长条）。
   * 挨着图的那一列和图隔一个列距，再往左的几列只隔一道缝（它们之间没有线）。
   */
  const perColumn = Math.max(1, Math.ceil(Math.sqrt(triggers.length)))
  const triggerColumns = Math.ceil(triggers.length / perColumn)
  const triggerX = (at: number): number =>
    ORIGIN.x + (triggerColumns - 1 - at) * (TRIGGER_W + BLOCK_GAP)
  const graphLeft =
    triggerColumns === 0 ? ORIGIN.x : triggerX(0) + Math.max(COL_STEP, TRIGGER_W + LAYER_GAP)
  // 有展示卡撑宽了块的列：列距跟着拉开（和挂牌子要的列距取大的）。
  for (const block of blocks) {
    const width = blockW.get(block.id) ?? BLOCK_W
    if (width <= BLOCK_W) continue
    const at = blockColumn(block.id)
    pitch.set(at, Math.max(pitch.get(at) ?? COL_STEP, width + LAYER_GAP))
  }
  const columnX = (target: number): number => {
    let x = graphLeft
    for (let at = firstBlock; at < target; at += 1) x += pitch.get(at) ?? COL_STEP
    return x
  }
  /*
   * 贯穿好几步的文档：主线上方并排一排，底边对齐，各自摆在第一个用到它的步骤正上方，碰上了往右让。
   * 读写线都从卡片底边落到下面的干线上、再落进步骤（总线），所以往左往右都一样短；
   * 只摆一排、不往上叠：叠起来的话，上面那张的竖线要穿过下面那张。
   */
  const lane: { node: WorkflowNode; x: number; h: number }[] = []
  let laneRight = -Infinity
  for (const card of [...shared].sort((a, b) => a.first - b.first || byId(a.node.id, b.node.id))) {
    const x = Math.max(columnX(card.first), laneRight + ROW_GAP)
    lane.push({ node: card.node, x, h: heightOf(card.node) })
    laneRight = x + widthOf(card.node)
  }
  const trunks = shared.reduce((sum, card) => sum + card.trunks, 0)
  // 从上往下三层：左上角的背景资料、主线上方贯穿好几步的文档、ELK 排好的步骤和它们的资源。
  const backgroundH = Math.max(0, ...background.map((card) => heightOf(card)))
  const laneH = Math.max(0, ...lane.map((card) => card.h))
  const laneBottom = ORIGIN.y + (backgroundH === 0 ? 0 : backgroundH + BAND_GAP) + laneH
  const graphTop =
    laneBottom + (laneH === 0 ? 0 : Math.max(LANE_GAP, 56 + trunks * LANE_GAP_PER_TRUNK))

  const placed: Record<string, Point> = {}
  const put = (node: WorkflowNode, x: number, y: number): void => {
    placed[node.id] = { x: Math.round(x), y: Math.round(y) }
  }
  let x = ORIGIN.x
  for (const node of background) {
    put(node, x, ORIGIN.y)
    x += widthOf(node) + ROW_GAP
  }
  for (const card of lane) put(card.node, card.x, laneBottom - card.h)
  const minY = Math.min(...blocks.map((block) => block.y ?? 0))
  for (const block of blocks) {
    const node = index.get(idKey(block.id))
    if (node === undefined) continue
    const blockX = columnX(blockColumn(block.id))
    const y = (block.y ?? 0) - minY + graphTop
    if (isResource(node) || isInput(node)) {
      put(node, blockX + RES_DX, y)
      continue
    }
    put(node, blockX, y)
    let top = y + (stepHeight.get(node.id) ?? NODE_H) + RES_DY
    for (const card of owned.get(idKey(node.id)) ?? []) {
      put(card, blockX + RES_DX, top)
      top += heightOf(card) + RES_GAP
    }
  }
  /*
   * 触发卡片：头一张和主线头一个步骤摆在一条线上（中线对齐），其余的往下排、往左开列；
   * 只往下不往上，碰不到上面的背景资料和共享文档。
   */
  const start = spine.start === undefined ? undefined : placed[spine.start]
  if (start !== undefined) {
    const center = start.y + (stepHeight.get(spine.start as string) ?? NODE_H) / 2
    let top = 0
    triggers.forEach((node, at) => {
      if (at % perColumn === 0) top = center - heightOf(node) / 2
      put(node, triggerX(Math.floor(at / perColumn)), top)
      top += heightOf(node) + BLOCK_GAP
    })
  }
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
    const spot = resourceSpot(current, anchor, node.id, cardSize(node))
    position.set(node.id, spot)
    placed[node.id] = spot
  }
  // 触发卡片（模型用工具加的）：放到整张图上面那一排。
  for (const node of missing) {
    if (placed[node.id] !== undefined || !isTrigger(node)) continue
    const current: WorkflowDocument = {
      ...doc,
      nodes: doc.nodes.map((item) => ({
        ...item,
        position: position.get(item.id) ?? { x: 0, y: 0 },
      })),
    }
    const spot = triggerSpot(current, node.id)
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
