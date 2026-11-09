/**
 * dsh-workflow-lite — 实例视图里改图的动作：改、加步骤、就地添加、复制、删、整理。
 * 所有动作都落到 `edit`，执行过的步骤在这里拦下不让删。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/runView/useGraphEdit
 */

import type { ReactFlowInstance } from '@xyflow/react'
import { useCallback, useMemo } from 'react'
import type { GraphAnalysis } from '../../../../shared/graph.ts'
import type { NodeData, Point, WorkflowDocument } from '../../../../shared/types.ts'
import { addFromSource, duplicateEdit } from '../../../app/addStep.ts'
import { revealNode } from '../../../app/reveal.ts'
import { useArrival } from '../../../app/useArrival.ts'
import type { RunGraph } from '../../../app/useRunGraph.ts'
import type { Run } from '../../../app/useRuns.ts'
import type { T } from '../../../i18n.ts'
import { type Edit, findNode, type Selection } from '../../../model/editor.ts'
import { tidy } from '../../../model/layout.ts'
import type { StepSource } from '../../../model/library.ts'
import { nodeTitle } from '../../../model/nodeName.ts'
import { lockedSteps } from '../../../model/runGraph.ts'
import type { AddRequest } from '../../canvas/Canvas.tsx'
import type { PanelMode } from '../RunModeSwitch.tsx'
import { GAP } from './geometry.ts'

export interface GraphEditInput {
  t: T
  canvasRef: React.RefObject<HTMLDivElement | null>
  current: Run
  graph: RunGraph
  doc: WorkflowDocument | null
  analysis: GraphAnalysis | null
  selection: Selection
  flow: ReactFlowInstance
  narrow: boolean
  inspectorW: number
  onPanel(open: boolean): void
  loadTemplate(name: string): Promise<NodeData | null>
  fitAll(): void
  setMode(mode: PanelMode): void
  setFocusPrompt(on: boolean): void
  /** 打开就地添加菜单（实例视图里 `quick` 的 setter）。 */
  setQuick(request: AddRequest & { at: Point; bounds: { width: number; height: number } }): void
}

export function useGraphEdit({
  t,
  canvasRef,
  current,
  graph,
  doc,
  analysis,
  selection,
  flow,
  narrow,
  inspectorW,
  onPanel,
  loadTemplate,
  fitAll,
  setMode,
  setFocusPrompt,
  setQuick,
}: GraphEditInput) {
  const locked = useMemo(
    () => lockedSteps(current.view?.state ?? current.lastGood),
    [current.view?.state, current.lastGood],
  )
  const focusCanvas = useCallback((): void => {
    canvasRef.current?.querySelector<HTMLElement>('[data-testid="wl-canvas"]')?.focus()
  }, [])
  /** 所有改图的动作都走这里：执行过的步骤不让删；加了东西、连了线就把右栏切到「编辑」。 */
  const edit = useCallback(
    (next: Edit): void => {
      if (next.type === 'removeNode' && locked(next.id)) {
        current.flash('error', t('run.lockedStep'))
        return
      }
      graph.edit(next)
      if (
        next.type === 'addNode' ||
        next.type === 'addResource' ||
        next.type === 'addInput' ||
        next.type === 'connect'
      ) {
        setMode('edit')
        onPanel(true)
      }
    },
    [locked, current.flash, t, graph.edit, onPanel],
  )
  const addStep = useCallback(
    async (from: StepSource, position: Point, after?: string): Promise<void> => {
      setFocusPrompt(from.kind === 'blank')
      await addFromSource({ t, doc, edit, loadTemplate }, from, position, after)
    },
    [t, doc, edit, loadTemplate],
  )
  const requestAdd = useCallback((request: AddRequest): void => {
    const root = canvasRef.current?.closest('[data-testid="wl-root"]')
    if (root === null || root === undefined) return
    const rect = root.getBoundingClientRect()
    setQuick({
      ...request,
      at: { x: request.client.x - rect.left, y: request.client.y - rect.top },
      bounds: { width: rect.width, height: rect.height },
    })
  }, [])
  /** 复制之后右栏盖住了新节点，就把画布挪一点（右栏随加东西自动打开）。 */
  const armArrival = useArrival(selection?.kind === 'node' ? selection.id : null, (nodeId) =>
    revealNode({
      flow,
      root: canvasRef.current?.closest('[data-testid="wl-root"]') ?? null,
      id: nodeId,
      narrow,
      panelW: inspectorW,
      leftInset: 0,
      gap: GAP,
    }),
  )
  const duplicate = useCallback(
    (nodeId: string): void => {
      const original = doc === null ? undefined : findNode(doc, nodeId)
      const next = duplicateEdit(doc, nodeId, t('node.copySuffix'))
      if (original === undefined || next === null) return
      armArrival()
      edit(next)
      current.flash('ok', t('node.copied').replace('{name}', nodeTitle(original)))
    },
    [doc, edit, t, armArrival, current.flash],
  )
  /** 删一个节点：删完点名告诉一声，并提示能撤销。执行过的步骤不让删，那边自己会报错，这里不再覆盖它。 */
  const removeNode = useCallback(
    (nodeId: string): void => {
      const node = doc === null ? undefined : findNode(doc, nodeId)
      const blocked = locked(nodeId)
      edit({ type: 'removeNode', id: nodeId })
      if (node !== undefined && !blocked) {
        current.flash('ok', t('node.removed').replace('{name}', nodeTitle(node)))
      }
    },
    [doc, edit, locked, t, current.flash],
  )
  const removeSelection = useCallback((): void => {
    if (selection === null) return
    if (selection.kind === 'node') removeNode(selection.id)
    else edit({ type: 'removeEdge', id: selection.id })
    focusCanvas()
  }, [selection, edit, removeNode, focusCanvas])
  const relayout = useCallback((): void => {
    if (doc === null || analysis === null || doc.nodes.length === 0) return
    const sizeOf = (nodeId: string): { width: number; height: number } | undefined => {
      const measured = flow.getInternalNode(nodeId)?.measured
      return measured?.width === undefined || measured.height === undefined
        ? undefined
        : { width: measured.width, height: measured.height }
    }
    const ids = doc.nodes.map((node) => node.id).join('\n')
    void tidy(doc, analysis, sizeOf).then((positions) => {
      // 排版是异步的：这期间加了 / 删了节点就作废。
      if (graph.doc === null || graph.doc.nodes.map((node) => node.id).join('\n') !== ids) return
      edit({ type: 'moveNodes', positions })
      requestAnimationFrame(() => requestAnimationFrame(fitAll))
    })
  }, [doc, analysis, flow, graph.doc, edit, fitAll])
  return {
    focusCanvas,
    edit,
    addStep,
    requestAdd,
    duplicate,
    removeNode,
    removeSelection,
    relayout,
  }
}
