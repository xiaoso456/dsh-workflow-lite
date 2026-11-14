/**
 * dsh-workflow-lite — 等一个值停下来：连续在变的时候先不跟，停了 `ms` 才换成最后那个。
 *
 * 给「换一次很贵」的地方用：
 * - 刻度盘上滚轮从第 7 版滚到第 1 版，中间几版只在刻度和标题上划过去，卡片里只载入停下的那一版；
 * - 数字框上连滚、按住 + 连着走，数字一格一格跟着走，下面「接下来 7 天」等停下了只排一次（`leading`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useSettled
 */

import { useEffect, useRef, useState } from 'react'

/**
 * `value` 保持 `ms` 没再变才跟上；中途变回现在这个值就不换。
 * `leading`：歇够了 `ms` 之后的第一下当场跟上（点一下、滚一格不等），接着连续来的才等停下。
 */
export function useSettled<V>(value: V, ms: number, options?: { leading?: boolean }): V {
  const [settled, setSettled] = useState(value)
  const leading = options?.leading === true
  /** 上一次变的时刻（`leading` 用来认「是不是歇够了」）。 */
  const changedAt = useRef(Number.NEGATIVE_INFINITY)
  useEffect(() => {
    if (Object.is(value, settled)) return
    const now = performance.now()
    const rested = now - changedAt.current > ms
    changedAt.current = now
    if (leading && rested) {
      setSettled(value)
      return
    }
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, settled, ms, leading])
  return settled
}
