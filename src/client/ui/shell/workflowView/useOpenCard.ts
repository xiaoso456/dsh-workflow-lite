/**
 * dsh-workflow-lite — 「打开某个工作流里的某张卡片」：先打开那个工作流，等它加载好了再选中、滑到那张卡片。
 *
 * 工作流中心「触发」页的「在画布上打开」用。换工作流是异步的，所以把要找的卡片先记下来，
 * 图到了（名字对上、加载完）再定位；那张卡片已经不在了就作罢。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useOpenCard
 */

import { useCallback, useEffect, useState } from 'react'
import { findNode } from '../../../../shared/model.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'

export function useOpenCard(input: {
  state: Workflow['state']
  openTemplate(name: string): void
  /** 选中一张卡片并把它滑到画布中间。 */
  locate(node: string): void
}): (workflow: string, node: string) => void {
  const { state, openTemplate, locate } = input
  const [wanted, setWanted] = useState<{ workflow: string; node: string } | null>(null)

  useEffect(() => {
    if (wanted === null || state.phase !== 'ready' || state.name !== wanted.workflow) return
    if (state.doc === null) return
    setWanted(null)
    if (findNode(state.doc, wanted.node) !== undefined) locate(wanted.node)
  }, [wanted, state.phase, state.name, state.doc, locate])

  return useCallback(
    (workflow: string, node: string): void => {
      openTemplate(workflow)
      setWanted({ workflow, node })
    },
    [openTemplate],
  )
}
