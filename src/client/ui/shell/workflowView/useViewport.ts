/**
 * dsh-workflow-lite — 画布视口：看全图、定位到某一步、选中后把步骤从面板底下挪出来、整理排版。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useViewport
 */

import type { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useRef } from 'react'
import { afterPaint, revealNode } from '../../../app/reveal.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import { findNode } from '../../../model/editor.ts'
import { NODE_H, NODE_W, tidy } from '../../../model/layout.ts'
import { AUTO_FIT, fitPadding, useCanvasGeometry } from '../../canvas/hooks/useCanvasGeometry.ts'
import { expectCanvasMove } from '../../motion/canvasMoving.ts'
import { GAP } from './geometry.ts'

export interface ViewportInput {
  flow: ReturnType<typeof useReactFlow>
  rootRef: React.RefObject<HTMLDivElement>
  insetsRef: React.MutableRefObject<{ left: number; right: number }>
  state: Workflow['state']
  analysis: Workflow['analysis']
  wf: Workflow
  narrow: boolean
  inspectorW: number
  /** 当前的图（异步排版回来时据此判断图是不是已经变了）。 */
  docRef: React.MutableRefObject<Workflow['state']['doc']>
}

export function useViewport({
  flow,
  rootRef,
  insetsRef,
  state,
  analysis,
  wf,
  narrow,
  inspectorW,
  docRef,
}: ViewportInput): {
  focusCanvas(): void
  fitAll(options?: { duration?: number; auto?: boolean }): void
  fitSoon(): void
  locate(nodeId: string): void
  relayout(): void
} {
  const { fitDoc, sizeOf } = useCanvasGeometry()
  const focusCanvas = useCallback((): void => {
    rootRef.current?.querySelector<HTMLElement>('[data-testid="wl-canvas"]')?.focus()
  }, [])

  const fitAll = useCallback(
    (options: { duration?: number; auto?: boolean } = {}): void => {
      const doc = docRef.current
      if (doc === null) return
      fitDoc(doc, {
        duration: options.duration ?? 320,
        ...(options.auto === true ? AUTO_FIT : { maxZoom: AUTO_FIT.maxZoom }),
        padding: fitPadding(insetsRef.current),
      })
    },
    [fitDoc],
  )

  /** 等新坐标渲染并量完尺寸再看全图。 */
  const fitSoon = useCallback((): void => {
    requestAnimationFrame(() => requestAnimationFrame(() => fitAll({ auto: true })))
  }, [fitAll])

  /** 由「定位」选中的步骤：它已经被摆到可见区中间了。 */
  const revealed = useRef<string | null>(null)

  const locate = useCallback(
    (nodeId: string): void => {
      const doc = state.doc
      if (doc === null) return
      const node = findNode(doc, nodeId)
      if (node === undefined) return
      revealed.current = node.id
      wf.select({ kind: 'node', id: node.id })
      // 把步骤放到"没被浮层盖住的那块"的正中间（选中之后右边会多出属性面板）。
      const left = insetsRef.current.left
      const right = narrow ? 0 : inspectorW + GAP
      const zoom = Math.max(flow.getZoom(), 0.9)
      const shift = (right - left) / 2 / zoom
      // 选中、开右栏那一帧画完再滑（见 afterPaint）。
      afterPaint(() => {
        expectCanvasMove()
        void flow.setCenter(node.position.x + NODE_W / 2 + shift, node.position.y + NODE_H / 2, {
          zoom,
          duration: 360,
        })
      })
    },
    [state.doc, wf, flow, narrow, inspectorW],
  )

  /*
   * 点中的步骤被属性面板盖住了，就把画布往旁边挪一点，让它露出来。
   * 只挪"刚好够"的距离，也不会把它推到左边的步骤库底下去。
   */
  const selectedNode = state.selection?.kind === 'node' ? state.selection.id : null
  useEffect(() => {
    if (selectedNode === null) return
    // 「定位」自己会把它摆到正中间，这里不再叠一次。
    if (revealed.current === selectedNode) {
      revealed.current = null
      return
    }
    return afterPaint(() =>
      revealNode({
        flow,
        root: rootRef.current,
        id: selectedNode,
        narrow,
        panelW: inspectorW,
        leftInset: insetsRef.current.left,
        gap: GAP,
      }),
    )
  }, [selectedNode, narrow, flow, inspectorW])

  const relayout = useCallback((): void => {
    const doc = state.doc
    if (doc === null || analysis === null || doc.nodes.length === 0) return
    // 按卡片量出来的真实尺寸排（步骤卡的高度随描述长短变）。
    const ids = (nodes: readonly { id: string }[]): string =>
      nodes.map((node) => node.id).join('\n')
    void tidy(doc, analysis, sizeOf).then((positions) => {
      // 排版是异步的（第一次还要加载 ELK）：这期间加了 / 删了节点就作废，别拿旧图的版式盖掉新改动。
      // 只是存盘回执换了个文档对象、节点没变，照常应用。
      const current = docRef.current
      if (current === null || ids(current.nodes) !== ids(doc.nodes)) return
      wf.edit({ type: 'moveNodes', positions })
      fitSoon()
    })
  }, [state.doc, analysis, wf, fitSoon, sizeOf])
  return { focusCanvas, fitAll, fitSoon, locate, relayout }
}
