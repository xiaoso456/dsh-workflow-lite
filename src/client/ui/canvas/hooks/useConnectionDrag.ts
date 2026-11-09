/**
 * dsh-workflow-lite — 拖线时画布要知道的事：拖的是什么线、落到目标上会连成什么颜色，以及悬停资源的聚光。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/hooks/useConnectionDrag
 */

import { useConnection } from '@xyflow/react'
import { useMemo, useRef } from 'react'
import type { ResourceInfo } from '../../../../shared/resources.ts'
import type { WorkflowDocument } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { type CardKind, dragKindOf, previewLink } from '../../../model/connect.ts'
import { cardKindOf } from '../cards/cardParts.ts'
import { type DragContext, dragColor, PREVIEW_COLOR } from '../lines/ConnectionLine.tsx'
import { linkOf } from '../lines/route.ts'

export interface ConnectionDragInput {
  doc: WorkflowDocument
  t: T
  /** 指针悬停的资源卡 id（`props.focusFile`）。 */
  hoveredFile: string | null
  /** 拖卡片时是 'hold'。 */
  streakMode: 'hold' | 'run'
  files: Map<string, ResourceInfo>
}

export function useConnectionDrag({ doc, t, hoveredFile, streakMode, files }: ConnectionDragInput) {
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
  return { dragInfo, drag, focusFile, focused }
}
