/**
 * dsh-workflow-lite — 画布内部的数据类型：节点、连线交给 React Flow 的 `data`。
 *
 * 卡片（步骤 / 资源 / 输入）和连线组件各自拿到的数据长什么样，都在这里；
 * 画布（Canvas）按文档造出这些对象，卡片、连线只管画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/types
 */

import type { Edge, Node } from '@xyflow/react'
import type { Appearance, StepColor } from '../../../shared/appearance.ts'
import type { ResourceRole } from '../../../shared/resources.ts'
import type { NodeStatus } from '../../../shared/runState.ts'
import type { InputKind, ResourceItem, ResourceKind, ResourceView } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import type { Display } from '../../model/display.ts'
import type { FocusFile } from '../editor/Handoff.tsx'
import type { Access, WhenKind } from './lines/lines.ts'

/** 卡片、连线上的运行标记：最后执行的、接下来要做的。 */
export type RunMark = 'last' | 'next'

export type Tone = 'ok' | 'warn' | 'error'

/** 卡片上的运行状态小标。 */
export interface StepRun {
  status: NodeStatus
  round: number
  edited: boolean
  label: string
  roundText: string
  mark?: RunMark | undefined
  markText: string
}

export interface StepData extends Record<string, unknown> {
  title: string
  /** 挂着读写线的连接点（这些点才显示出来）。 */
  used: readonly string[]
  look: Appearance
  excerpt: string
  tone: Tone
  note: string
  noPromptText: string
  addText: string
  fileText: string
  /** 悬停某个资源时，这个步骤与它的关系；`dim` = 与它无关，淡下去。 */
  role: ResourceRole | null
  roleText: string
  dim: boolean
  onAdd: (id: string, anchor: Element) => void
  /** 这一步开着记忆（写一张记忆卡）。 */
  memory: boolean
  memoryText: string
  /** 一键开关记忆；实例视图里是 `null`（只显示开着的标记）。 */
  onMemory: ((id: string, anchor: Element) => void) | null
  /** 实例视图里的运行状态；模板编辑时为 `null`。 */
  run: StepRun | null
  onRunStatus: (id: string, anchor: Element) => void
}

/** 资源卡上的一项（展开时一行一项）。 */
export interface CardItem {
  kind: ResourceKind
  text: string
  /** 实例视图：这个文件 / 文件夹在不在（模板编辑、不是路径时为 `null`）。 */
  made: boolean | null
}

export interface ResourceCardData extends Record<string, unknown> {
  /** 紧凑的一行（没名字、没描述、最多一项），像一张文件卡；否则是带标题的清单。 */
  compact: boolean
  title: string
  /** 紧凑时的第二行：说明，没有就是完整的路径 / 网址 / 种类。 */
  sub: string
  description: string
  items: CardItem[]
  /** 列不下的还有几项。 */
  more: number
  moreText: string
  countText: string
  emptyText: string
  /** 紧凑时左边的签：文件印扩展名，其余放种类图标；空资源是一叠。 */
  tab: { kind: ResourceKind | 'many'; ext: string }
  /** 记忆卡：步骤记忆 / 工作流记忆；普通资源是 `null`。 */
  memory: 'step' | 'global' | null
  /** 记忆也被别的工作流用着：卡上挂的「共用」小标说的话；没有就是 `null`。 */
  memoryShared: string | null
  /** 卡片的颜色；`null` = 资源卡本来的灰。 */
  tint: StepColor | null
  /** 一条线都没连：交给整个工作流。 */
  shared: boolean
  sharedText: string
  tone: Tone
  note: string
  /** 正在被悬停（或它的上下游正在被看）。 */
  focused: boolean
  dim: boolean
  readText: string
  onFocusFile: FocusFile
  generatedText: string
  /** 开着画布展示：整张卡换成标题行 + 展示区；没开（或没有能展示的项）是 `null`。 */
  display: CardDisplay | null
  /** 拖完右下角：把新的展示设置写进文档。 */
  onView(id: string, view: ResourceView): void
}

/** 展示卡要的东西。 */
export interface CardDisplay {
  info: Display
  item: ResourceItem
  /** 文档里存的展示设置（改尺寸时在它上面改）。 */
  view: ResourceView
  /** 写它的步骤正在跑。 */
  writing: boolean
  /** 文件在不在（实例视图）；模板、不是文件时为 `null`。 */
  made: boolean | null
  /** 类型签上印的字：文件印扩展名，自定义文字是空串（放图标）。 */
  ext: string
  openText: string
  interactText: string
  leaveText: string
  resizeText: string
  /** 按住 Ctrl 拖着缩放时角上的读数：「缩放 {zoom}%」。 */
  zoomText: string
}

export interface LinkData extends Record<string, unknown> {
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
  /** 走廊线两条竖段被分道挪开的距离（和别的颜色的线叠在一起时，见 model/nudge.ts）。 */
  shift: LaneShift | null
  /** 走廊线上牌子中心的 x（和并排的线错开过，见 model/nudge.ts 的 `placeChips`）。 */
  labelX: number | null
  t: T
  onPick: (id: string) => void
  /** 线上交接卡片里就地改说明。 */
  acts: HandoffActs
}

/** 交接卡片里改说明用的两个动作（写进文档的说明 / 一次输入结束）。 */
export interface HandoffActs {
  note(edgeId: string, note: string): void
  seal(): void
}

/** 走廊线右边那条竖段（出口伸出去之后）、左边那条竖段（进入口之前）各挪了多少。 */
export interface LaneShift {
  out: number
  in: number
}

export interface FileLinkData extends Record<string, unknown> {
  kind: 'write' | 'read'
  /** 资源卡的高度（写线绕行时要避开它）。 */
  cardH: number
  access: Access
  /** 线、箭头、光带的颜色（一个 `var(--wl-io-…)`）。 */
  color: string
  /** 与选中 / 悬停的东西相连：描粗、加光晕、光带流动、中点挂上「产出 / 更新 / 读取」的小牌子。 */
  active: boolean
  /** 平时的走法会压到别的卡片时，画布挑的绕行直角折线（含两头）；不用绕就是 `null`。 */
  points: [number, number][] | null
  chipText: string
}

/** 输入卡：问题 + 一行「单选 · 3 个选项 · 必填」。 */
export interface InputCardData extends Record<string, unknown> {
  question: string
  meta: string
  kind: InputKind
  tone: Tone
  note: string
  emptyText: string
  connectText: string
  /** 悬停某个资源时它跟着淡下去（它不是资源的读写方）。 */
  dim: boolean
}

export type StepFlowNode = Node<StepData, 'wfNode'>
export type ResourceFlowNode = Node<ResourceCardData, 'wfResource'>
export type InputFlowNode = Node<InputCardData, 'wfInput'>
export type FlowNode = StepFlowNode | ResourceFlowNode | InputFlowNode
export type LinkEdge = Edge<LinkData, 'wfEdge'>
export type FileEdge = Edge<FileLinkData, 'wfFileLink'>
export type FlowEdge = LinkEdge | FileEdge
