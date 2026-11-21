/**
 * dsh-workflow-lite — 不打开工作流、直接改它里面一张触发卡片（名字、触发方式、开关与设置、过滤、条件与说明、保护）。
 *
 * 工作流中心「触发」页右栏的标题改名、「设置」里的铅笔用；编辑页正开着的那张，调用方先把它没存的改动存下去、改完再让它重新读。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/triggerEdit
 */

import { findNode, isTrigger } from '../../shared/model.ts'
import { patchTriggerData } from '../../shared/trigger.ts'
import type { TriggerData } from '../../shared/types.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { patchWorkflowOnDisk } from './diskPatch.ts'

/**
 * 改 `workflow` 里卡片 `node` 的几项（同 `patchTriggerData`：`undefined` 的键清掉）。
 * 改成了、或者没什么可改的回 `null`；改不成回一句原因。
 */
export function patchTriggerOnDisk(
  rpc: WorkflowLiteRpc,
  workflow: string,
  node: string,
  patch: Partial<TriggerData>,
): Promise<string | null> {
  return patchWorkflowOnDisk(rpc, workflow, (document) => {
    const card = findNode(document, node)
    if (card === undefined || !isTrigger(card)) return null
    const data = patchTriggerData(card.data, patch)
    if (data === null) return null
    return {
      ...document,
      nodes: document.nodes.map((item) => (item === card ? { ...card, data } : item)),
    }
  })
}
