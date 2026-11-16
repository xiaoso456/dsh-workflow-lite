/**
 * dsh-workflow-lite — 不打开工作流、直接改盘上的图：读出来、改一处、带着读到时的哈希写回去
 * （中间被别处改过就照常走冲突合并）。
 *
 * 只有挡保存的问题（`level: 'save'`，文件格式坏了）才不写，和编辑页一样；图里有警告、提示、
 * 编译不过的地方照样能改（比如某一步还没写提示词，不妨碍给触发卡片改名）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/diskPatch
 */

import type { WorkflowDocument } from '../../shared/types.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'

/**
 * 读 `workflow`，交给 `change` 改；它回 `null` 就是没什么可改的，不写。
 * 改成了、或者没什么可改的回 `null`；改不成回一句原因。
 */
export async function patchWorkflowOnDisk(
  rpc: WorkflowLiteRpc,
  workflow: string,
  change: (document: WorkflowDocument) => WorkflowDocument | null,
): Promise<string | null> {
  try {
    const loaded = await rpc.call('graph/load', { name: workflow })
    const blocking = loaded.problems.find((problem) => problem.level === 'save')
    if (blocking !== undefined) return blocking.message
    const document = change(loaded.document)
    if (document === null) return null
    await rpc.call('graph/save', { name: workflow, document, baseHash: loaded.hash })
    return null
  } catch (error) {
    return errorMessage(error)
  }
}
