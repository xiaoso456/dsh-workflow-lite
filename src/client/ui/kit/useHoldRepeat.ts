/**
 * dsh-workflow-lite — 按住连续走（数字框的 − / +）：按下先走一步，停 {@link HOLD_DELAY_MS} 后连着走，越走越快。
 * `act` 返回 false（到头了、走不动）就停。键盘（回车 / 空格触发的 click）一次走一步。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/useHoldRepeat
 */

import { useEffect, useRef } from 'react'

/** 按下后多久开始连着走、连着走的起始间隔和最快间隔。 */
const HOLD_DELAY_MS = 400
const REPEAT_FIRST_MS = 120
const REPEAT_FASTEST_MS = 40

export function useHoldRepeat(act: () => boolean): {
  onPointerDown(event: React.PointerEvent<HTMLButtonElement>): void
  onClick(event: React.MouseEvent<HTMLButtonElement>): void
} {
  const latest = useRef(act)
  latest.current = act
  const timer = useRef(0)
  const stop = useRef<() => void>(() => {})
  useEffect(() => () => stop.current(), [])
  return {
    onPointerDown(event) {
      if (event.button !== 0) return
      // 不让按钮抢焦点：正在打字的数字框不失焦（失焦会先把草稿交出去）。
      event.preventDefault()
      stop.current()
      if (!latest.current()) return
      let delay = REPEAT_FIRST_MS
      const tick = (): void => {
        if (!latest.current()) {
          stop.current()
          return
        }
        delay = Math.max(REPEAT_FASTEST_MS, delay * 0.85)
        timer.current = window.setTimeout(tick, delay)
      }
      timer.current = window.setTimeout(tick, HOLD_DELAY_MS)
      // 松开可能在按钮外面、按钮也可能已经因为到头变灰（灰按钮收不到指针事件）：在窗口上等。
      const end = (): void => stop.current()
      window.addEventListener('pointerup', end, { once: true })
      window.addEventListener('pointercancel', end, { once: true })
      window.addEventListener('blur', end, { once: true })
      stop.current = () => {
        window.clearTimeout(timer.current)
        window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', end)
        window.removeEventListener('blur', end)
        stop.current = () => {}
      }
    },
    onClick(event) {
      // 指针按的已经在 pointerdown 里走过了；只有键盘触发的 click（detail = 0）在这里走一步。
      if (event.detail === 0) latest.current()
    },
  }
}
