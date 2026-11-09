/**
 * dsh-workflow-lite — 磁盘上现在的内容和某一版一样吗：顶栏「版本」按钮据此提示。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useMatchesVersion
 */

import { useEffect, useState } from 'react'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'

export interface MatchesVersionInput {
  rpc: WorkflowLiteRpc
  state: Workflow['state']
  versionsOpen: boolean
}

export function useMatchesVersion({
  rpc,
  state,
  versionsOpen,
}: MatchesVersionInput): boolean | null {
  /** 磁盘上现在的内容和某一版一样吗；`null` = 不知道（没打开图、还在读）。存盘后、版本对话框开关后重新问一次。 */
  const [matchesVersion, setMatchesVersion] = useState<boolean | null>(null)
  const versionsName = state.phase === 'ready' ? state.name : null
  useEffect(() => {
    if (versionsName === null) {
      setMatchesVersion(null)
      return
    }
    let live = true
    rpc.call('graph/versions', { name: versionsName }).then(
      (result) => live && setMatchesVersion(result.versions.some((entry) => entry.current)),
      () => live && setMatchesVersion(null),
    )
    return () => {
      live = false
    }
  }, [rpc, versionsName, state.baseHash, versionsOpen])
  return matchesVersion
}
