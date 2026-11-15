/**
 * dsh-workflow-lite — 「现在」：每隔 `ms` 毫秒换一次，给「还有 3 分 10 秒」「已运行 2 小时」这类会自己走的字用。
 * 页面不可见时停下，回来马上补一次。只该挂在换字的那一小块上，别让整页跟着每秒重画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useNow
 */

import { useEffect, useState } from 'react'

export function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const tick = (): void => {
      if (document.visibilityState !== 'hidden') setNow(Date.now())
    }
    const timer = window.setInterval(tick, ms)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [ms])
  return now
}
