/**
 * dsh-workflow-lite — 实例快照的补位：快照里没摆过位置的节点，照模板那边的规矩补上位置。
 * 补位是异步的（要排版），所以结果带着「哪个实例的哪一版」的键，对不上就当还没好。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/runView/usePlacedSnapshot
 */

import { useEffect, useState } from 'react'
import { analyzeGraph } from '../../../../shared/graph.ts'
import type { WorkflowDocument } from '../../../../shared/types.ts'
import { placeMissing } from '../../../model/layout.ts'

export interface PlacedSnapshotInput {
  id: string
  /** `useSnapshot` 给的快照；还没读回来是 `null`。 */
  raw: { planId: string; doc: WorkflowDocument } | null
}

export function usePlacedSnapshot({
  id,
  raw,
}: PlacedSnapshotInput): { key: string; planId: string; doc: WorkflowDocument } | null {
  // 快照里没摆过位置的节点（模型用工具建的图、还没在画布上打开过）：照模板那边的规矩补位。
  const [placed, setPlaced] = useState<{
    key: string
    planId: string
    doc: WorkflowDocument
  } | null>(null)
  useEffect(() => {
    if (raw === null) return
    let live = true
    void placeMissing(raw.doc, analyzeGraph(raw.doc)).then((positions) => {
      if (!live) return
      const moved = Object.keys(positions).length > 0
      setPlaced({
        key: `${id}:${raw.planId}`,
        planId: raw.planId,
        doc: moved
          ? {
              ...raw.doc,
              nodes: raw.doc.nodes.map((node) => {
                const at = positions[node.id]
                return at === undefined ? node : { ...node, position: at }
              }),
            }
          : raw.doc,
      })
    })
    return () => {
      live = false
    }
  }, [raw, id])
  const source = placed !== null && placed.key === `${id}:${raw?.planId}` ? placed : null
  return source
}
