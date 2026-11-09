/**
 * dsh-workflow-lite — 画布上展示卡的数据：当前的图（给异步排版回来时对照）、自定义文字的查看、「上次执行」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useCanvasDisplay
 */

import { useMemo, useRef, useState } from 'react'
import { isResource } from '../../../../shared/model.ts'
import type { ResourceItem } from '../../../../shared/types.ts'
import { useLatestOutputs } from '../../../app/useDisplayStats.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'

export interface CanvasDisplayInput {
  rpc: WorkflowLiteRpc
  state: Workflow['state']
  runId: string | null
  openRun(id: string): void
}

export function useCanvasDisplay({ rpc, state, runId, openRun }: CanvasDisplayInput) {
  /** 当前的图（异步排版回来时据此判断图是不是已经变了）。 */
  const docRef = useRef(state.doc)
  docRef.current = state.doc
  /** 展示卡上打开的自定义文字（模板里文件还没生成，只有它能打开）。 */
  const [textView, setTextView] = useState<ResourceItem | null>(null)
  /** 展示卡的「上次执行」：这个工作流最近真的生成了它的实例（看着实例时不问）。 */
  const latestOutputs = useLatestOutputs(
    rpc,
    runId === null ? (state.name ?? null) : null,
    state.doc,
  )
  const canvasDisplay = useMemo(
    () => ({
      run: null,
      latest: { rpc: rpc, outputs: latestOutputs, openRun },
      open: (node: string, item: number): void => {
        const found = docRef.current?.nodes.find((candidate) => candidate.id === node)
        const entry = found !== undefined && isResource(found) ? found.data.items[item] : undefined
        if (entry?.kind === 'text') setTextView(entry)
      },
    }),
    [rpc, latestOutputs, openRun],
  )
  return { docRef, textView, setTextView, canvasDisplay }
}
