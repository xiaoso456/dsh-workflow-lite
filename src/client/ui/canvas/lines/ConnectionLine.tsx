/**
 * dsh-workflow-lite — 正在拖的那条连接线：按起点上色，落到能连的点上时预告连上后是哪种线。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/lines/ConnectionLine
 */

import { type ConnectionLineComponentProps, getBezierPath, Position } from '@xyflow/react'
import { createContext, useContext } from 'react'
import { isInput, isResource } from '../../../../shared/model.ts'
import { resourceTitle } from '../../../../shared/resources.ts'
import type { WorkflowNode } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import {
  type DragKind,
  dragKindOf,
  type HandleLink,
  type LinkPreview,
} from '../../../model/connect.ts'
import { NODE_H, NODE_W, RES_H, RES_W } from '../../../model/layout.ts'
import { fileLinkEnds, type Side } from '../../../model/route.ts'
import { Icon } from '../../kit/Icon.tsx'
import { cardKindOf } from '../cards/cardParts.ts'
import type { FlowNode } from '../types.ts'
import css from './connectionLine.module.css'
import { ACCESS_COLOR, WHEN_COLOR } from './lines.ts'
import { linkOf, rectOf, writePath } from './route.ts'

const SIDE_POSITION: Record<Side, Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

/** 拖线时给连接线和画布用的上下文：按当前文档预告「连上会是什么线」。 */
export interface DragContext {
  preview(link: HandleLink): LinkPreview | null
  t: T
}

export const DragInfo = createContext<DragContext | null>(null)

/** 连上后那种线的颜色（新连的流程线没有条件，就是「总是」的蓝）。 */
export const PREVIEW_COLOR: Record<LinkPreview['kind'], string> = {
  flow: WHEN_COLOR.always,
  ...ACCESS_COLOR,
}

const PREVIEW_ICON = {
  flow: 'arrowRight',
  produce: 'pencil',
  update: 'reload',
  read: 'eye',
  ask: 'ask',
} as const

const PREVIEW_TEXT: Record<LinkPreview['kind'], LocaleKey> = {
  flow: 'legend.flow',
  produce: 'file.produce',
  update: 'file.update',
  read: 'file.read',
  ask: 'edge.ask',
}

const DRAG_HINT: Record<DragKind, LocaleKey> = {
  flow: 'link.hintFlow',
  write: 'link.hintWrite',
  read: 'link.hintRead',
  ask: 'link.hintAsk',
  back: 'link.hintBack',
  writeBack: 'link.hintWriteBack',
  readBack: 'link.hintReadBack',
}

/** 拖线起点的颜色：还没落到目标上时，先按起点预告大致是哪种线。 */
export function dragColor(kind: DragKind | null): string {
  if (kind === 'write' || kind === 'writeBack') return ACCESS_COLOR.produce
  if (kind === 'read' || kind === 'readBack') return ACCESS_COLOR.read
  if (kind === 'ask') return ACCESS_COLOR.ask
  return WHEN_COLOR.always
}

function nodeName(node: WorkflowNode): string {
  if (isInput(node)) return node.data.question
  if (isResource(node)) return resourceTitle(node)
  return node.data.label === undefined || node.data.label === '' ? node.id : node.data.label
}

/**
 * 正在拖的那条线。还没落到能连的地方时：按起点上色、虚线，指针旁一句提示该往哪儿拖；
 * 落到能连的连接点上（还没松手）：变成实线、换成连上后那种线的颜色，指针旁预告这条线的含义——
 * 是流程、产出、更新还是读取，数据从谁流向谁。
 */
export function ConnectionLine(props: ConnectionLineComponentProps<FlowNode>): React.JSX.Element {
  const info = useContext(DragInfo)
  const kind = dragKindOf(cardKindOf(props.fromNode.type), props.fromHandle.id)
  const preview =
    info !== null && props.toNode !== null && props.connectionStatus === 'valid'
      ? info.preview(
          linkOf(props.fromNode.id, props.fromHandle, props.toNode.id, props.toHandle?.id),
        )
      : null
  // 落到资源读写的目标上时，按松手后那条线真正的走法画（和 FileLine 同一套端点），所见即所得。
  let ends: {
    from: { x: number; y: number; side: Side }
    to: { x: number; y: number; side: Side }
  } | null = null
  if (preview !== null && preview.kind !== 'flow' && props.toNode !== null) {
    const fileNode = props.fromNode.type === 'wfNode' ? props.toNode : props.fromNode
    const stepNode = fileNode === props.fromNode ? props.toNode : props.fromNode
    const step = rectOf(stepNode, NODE_W, NODE_H)
    const file = rectOf(fileNode, RES_W, RES_H)
    if (step !== null && file !== null) {
      const reading = preview.kind === 'read' || preview.kind === 'ask'
      ends = fileLinkEnds(reading ? 'read' : 'write', step, file)
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
  } else if (preview?.kind === 'read' || preview?.kind === 'ask') {
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
