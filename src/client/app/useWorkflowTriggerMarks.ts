/**
 * dsh-workflow-lite — 切换工作流的下拉里要标的那几张（有触发开着、有没看过的失败），见 `model/workflowTriggerMarks.ts`。
 *
 * 不常驻轮询：一进来读一次，之后每次打开下拉再读一次（和下拉里的工作流列表一样）。
 * 读失败就留着上一次的；红点跟着本机记的「看到哪儿了」现算，别处看过了这里马上灭。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useWorkflowTriggerMarks
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TriggerAllResponse } from '../../shared/wire/trigger.ts'
import { shareSame } from '../model/samePlain.ts'
import { type WorkflowTriggerMark, workflowTriggerMarks } from '../model/workflowTriggerMarks.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { useFiresSeen } from './fireSeen.ts'
import { useRefresher } from './useRefresher.ts'

export interface WorkflowTriggerMarks {
  /** 按工作流名；只有要标的才在里面。 */
  marks: ReadonlyMap<string, WorkflowTriggerMark>
  /** 再读一次（打开下拉时）。 */
  refresh(): void
}

const NONE: ReadonlyMap<string, WorkflowTriggerMark> = new Map()

export function useWorkflowTriggerMarks(rpc: WorkflowLiteRpc): WorkflowTriggerMarks {
  const [list, setList] = useState<TriggerAllResponse | null>(null)
  const lister = useRefresher(
    {
      fetch: () => rpc.call('trigger/all', {}),
      apply: (result) =>
        setList((previous) => (previous === null ? result : shareSame(previous, result))),
      fail: () => {},
    },
    [rpc],
  )
  useEffect(() => {
    void lister.run(undefined)
  }, [lister])
  const seen = useFiresSeen()
  const marks = useMemo(
    () => (list === null ? NONE : workflowTriggerMarks(list, seen)),
    [list, seen],
  )
  const refresh = useCallback(() => void lister.run(undefined), [lister])
  return useMemo(() => ({ marks, refresh }), [marks, refresh])
}
