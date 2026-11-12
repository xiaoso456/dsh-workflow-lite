/**
 * dsh-workflow-lite — 等一个值停下来：连续在变的时候先不跟，停了 `ms` 才换成最后那个。
 *
 * 给「换一次很贵」的地方用：刻度盘上滚轮从第 7 版滚到第 1 版，中间几版只在刻度和标题上划过去，
 * 卡片里只载入停下的那一版。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useSettled
 */

import { useEffect, useState } from 'react'

/** `value` 保持 `ms` 没再变才跟上；中途变回现在这个值就不换。 */
export function useSettled<V>(value: V, ms: number): V {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (Object.is(value, settled)) return
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, settled, ms])
  return settled
}
