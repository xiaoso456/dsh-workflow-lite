/**
 * dsh-workflow-lite — 画布上的连线对象：顺序线、读写线各自的数据、聚光与淡出，以及内容没变就复用上一帧的同一个对象。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/flow/buildEdges
 */

import { MarkerType } from '@xyflow/react'
import { edgeWhen, type GraphAnalysis } from '../../../../shared/graph.ts'
import { idKey, isInput, isResource } from '../../../../shared/model.ts'
import { edgeKind, nodeIndex, resolveHandoff, resourceTitle } from '../../../../shared/resources.ts'
import type { WorkflowDocument } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import type { Selection } from '../../../model/editor.ts'
import { cardSize, RES_H } from '../../../model/layout.ts'
import { samePlain } from '../../../model/samePlain.ts'
import { whenKind } from '../../../model/whenKind.ts'
import { cx } from '../../kit/cx.ts'
import { ACCESS_COLOR, type Access, WHEN_COLOR } from '../../kit/lineColors.ts'
import type { RunDecor } from '../Canvas.tsx'
import css from '../canvas.module.css'
import type { FlowEdge, HandoffActs } from '../types.ts'
import type { CanvasRoutes } from './buildRoutes.ts'
import type { CanvasTexts } from './buildTexts.ts'

/** 比连线对象时不看的键：回调与翻译函数（它们换了就整份缓存作废，见 `edges`）。 */
const EDGE_SKIP: ReadonlySet<string> = new Set(['t', 'onPick', 'acts'])

/** 连线对象缓存连同它是按哪份翻译函数与回调建的（它们换了就整份作废）。 */
export interface EdgeCache {
  t: T
  onPick: unknown
  acts: unknown
  /** 上一次交出去的每条线：内容没变就交回同一个对象，React Flow 不重画这条线。 */
  map: Map<string, FlowEdge>
  /** 上一次交出去的整份数组：一条线都没变时原样交回，React Flow 就不用把所有线再过一遍。 */
  list?: FlowEdge[]
}

export interface EdgesInput {
  doc: WorkflowDocument
  analysis: GraphAnalysis
  selection: Selection
  texts: CanvasTexts
  onPick: (id: string) => void
  acts: HandoffActs
  focusFile: string | null
  hoverEdge: string | null
  routes: CanvasRoutes
  t: T
  run: RunDecor | undefined
  /** 连线对象缓存（传 ref 本身：读写的是调用那一刻的 `.current`）。 */
  edgeCache: React.MutableRefObject<EdgeCache>
}

export function buildEdges({
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
}: EdgesInput): FlowEdge[] {
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
    focusFile !== null ? idKey(focusFile) : selection?.kind === 'node' ? idKey(selection.id) : null
  // 拖卡片时这里每帧都重算：内容没变的线交回上一帧的同一个对象，只有真的动了的线才重画。
  if (
    edgeCache.current.t !== t ||
    edgeCache.current.onPick !== onPick ||
    edgeCache.current.acts !== acts
  ) {
    edgeCache.current = { t, onPick, acts, map: new Map() }
  }
  const previous = edgeCache.current.map
  const next = new Map<string, FlowEdge>()
  const reuse = (built: FlowEdge): FlowEdge => {
    const cached = previous.get(built.id)
    const kept = cached !== undefined && samePlain(cached, built, EDGE_SKIP) ? cached : built
    next.set(built.id, kept)
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
        ...(access === 'update' ? { markerStart: { ...arrow, orient: 'auto-start-reverse' } } : {}),
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
    const when = edgeWhen(edge)
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
  const last = edgeCache.current.list
  if (last?.length === list.length && list.every((edge, i) => edge === last[i])) return last
  edgeCache.current.list = list
  return list
}
