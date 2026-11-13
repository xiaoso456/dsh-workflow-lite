/**
 * dsh-workflow-lite — 设置页「监听状态」：每隔几秒问一次 HTTP 触发的端口现在开没开、开在哪。
 *
 * 改了监听地址、端口保存后，负责的进程下一轮（几秒内）才换过去，所以一直问着；页面不可见时停下。
 * 读不到时留着上一次的样子。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useHttpStatus
 */

import { useEffect, useState } from 'react'
import type { TriggerHttpStatus } from '../../shared/wire/trigger.ts'
import { shareSame } from '../model/samePlain.ts'
import type { WorkflowLiteRpc } from '../rpc.ts'
import { useRefresher } from './useRefresher.ts'

/** 多久问一次（比卡片的轮询快一点：刚保存完要尽快看到换过去了）。 */
export const HTTP_STATUS_POLL_MS = 2000

/** `null` = 还没读到。 */
export function useHttpStatus(rpc: WorkflowLiteRpc): TriggerHttpStatus | null {
  const [status, setStatus] = useState<TriggerHttpStatus | null>(null)
  const asker = useRefresher(
    {
      fetch: () => rpc.call('trigger/http', {}),
      apply: (result) =>
        setStatus((previous) => (previous === null ? result : shareSame(previous, result))),
      fail: () => {},
    },
    [rpc],
  )
  useEffect(() => {
    const ask = (): void => {
      if (document.visibilityState !== 'hidden') void asker.run(undefined)
    }
    ask()
    const timer = window.setInterval(ask, HTTP_STATUS_POLL_MS)
    document.addEventListener('visibilitychange', ask)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', ask)
    }
  }, [asker])
  return status
}
