/**
 * dsh-workflow-lite — 画布与右侧面板的联动：悬停的资源、步骤库里点中的一项、「我的步骤」取名与外观、添加到画布。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/usePanelLink
 */

import type { useReactFlow } from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'
import { pickTemplateAppearance } from '../../../../shared/appearance.ts'
import type { NodeData, Point } from '../../../../shared/types.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import { freeSpot, NODE_H, NODE_W } from '../../../model/layout.ts'
import type { LibraryFocus, StepSource } from '../../../model/library.ts'

export interface PanelLinkInput {
  wf: Workflow
  state: Workflow['state']
  flow: ReturnType<typeof useReactFlow>
  rootRef: React.RefObject<HTMLDivElement>
  insetsRef: React.MutableRefObject<{ left: number; right: number }>
  setFocus: React.Dispatch<React.SetStateAction<LibraryFocus | null>>
  addStep(source: StepSource, position: Point, from?: string): Promise<void>
}

export function usePanelLink({
  wf,
  state,
  flow,
  rootRef,
  insetsRef,
  setFocus,
  addStep,
}: PanelLinkInput) {
  /** 正在悬停的资源（画布、面板、交接卡片里都能悬停）：画布据此高亮用到它的步骤。 */
  const [focusFile, setFocusFile] = useState<string | null>(null)
  const onFocusFile = useCallback((id: string | null): void => setFocusFile(id), [])
  // 换了选中，面板整块换掉：悬停着的那一行等不到 pointerleave，高亮跟着收掉。
  useEffect(() => {
    setFocusFile(null)
  }, [state.selection])

  /** 在步骤库里点了一项：放掉画布上的选中，右侧改看它。 */
  const focusLibrary = useCallback(
    (next: LibraryFocus | null): void => {
      if (next !== null) wf.select(null)
      setFocus(next)
    },
    [wf],
  )

  /** 「我的步骤」里还没被占用的文件名：`base`、`base-2`、`base-3`… */
  const freeStepName = useCallback(
    (base: string): string => {
      const taken = new Set((wf.catalog?.templates.nodes ?? []).map((e) => e.name.toLowerCase()))
      if (!taken.has(base.toLowerCase())) return base
      for (let n = 2; ; n += 1) {
        if (!taken.has(`${base}-${n}`.toLowerCase())) return `${base}-${n}`
      }
    },
    [wf.catalog],
  )

  /** 新的「我的步骤」的样子：避开内置步骤和已有的我的步骤，尽量不重样。 */
  const freshTemplateLook = useCallback(
    (): Pick<NodeData, 'icon' | 'color'> =>
      pickTemplateAppearance(wf.catalog?.templates.nodes ?? []),
    [wf.catalog],
  )

  /** 右侧面板里的「添加到画布」：放在没被浮层盖住的那块的正中间，被占了就往下找。 */
  const addToCanvas = useCallback(
    (source: StepSource): void => {
      const root = rootRef.current
      if (root === null || state.doc === null) return
      const box = root.getBoundingClientRect()
      const { left, right } = insetsRef.current
      const center = flow.screenToFlowPosition({
        x: box.left + left + (box.width - left - right) / 2,
        y: box.top + box.height / 2,
      })
      const want = { x: center.x - NODE_W / 2, y: center.y - NODE_H / 2 }
      void addStep(
        source,
        freeSpot(
          state.doc.nodes.map((node) => node.position),
          want,
        ),
      )
    },
    [state.doc, flow, addStep],
  )
  return { focusFile, onFocusFile, focusLibrary, freeStepName, freshTemplateLook, addToCanvas }
}
