/**
 * dsh-workflow-lite — 滚轮改值（数字框、下拉、时刻共用）：指针停在控件上滚一格走一步。
 *
 * 守两条，免得滚着页面经过控件时把值改了：
 * - 页面（或别的滚动区）刚被滚轮滚过（{@link PAGE_GRACE_MS} 内），这一下照样交给页面；
 * - 鼠标一格（像素位移 ≥ {@link WHEEL_NOTCH}）走一步；触控板一次只给几个像素，累积满一格才走一步，一抹不会走十几步。
 * 收下的那一下 `preventDefault` + `stopPropagation`：页面不滚，画布也不跟着缩放。按着 Ctrl 的是浏览器缩放，不收。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/wheelStep
 */

import { useCallback, useEffect, useRef } from 'react'

/** 一格滚轮折成多少像素算一步。 */
export const WHEEL_NOTCH = 50
/** 页面滚过之后多久之内，滚轮还算在滚页面。 */
export const PAGE_GRACE_MS = 400

/** 一次滚轮事件的纵向位移折成像素（按行、按页的换算成常见值）。 */
export function wheelPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * 40
  if (deltaMode === 2) return deltaY * 400
  return deltaY
}

/**
 * 这一下走不走：`acc` 是之前攒下的位移。一格（≥ {@link WHEEL_NOTCH}）当场走一步、清掉攒的；
 * 小位移攒到一格再走。往上滚（位移为负）是 +1。
 */
export function wheelStep(acc: number, pixels: number): { dir: 1 | -1 | 0; acc: number } {
  if (Math.abs(pixels) >= WHEEL_NOTCH) return { dir: pixels < 0 ? 1 : -1, acc: 0 }
  const next = acc + pixels
  if (Math.abs(next) >= WHEEL_NOTCH) return { dir: next < 0 ? 1 : -1, acc: 0 }
  return { dir: 0, acc: next }
}

/** 页面最近一次被滚轮滚（不是被哪个控件收下）的时刻。 */
let pageWheelAt = Number.NEGATIVE_INFINITY
let watching = false

function watchPage(): void {
  if (watching) return
  watching = true
  // 控件收下的那一下停在控件上（stopPropagation），到得了这里的都是在滚页面。
  document.addEventListener(
    'wheel',
    () => {
      pageWheelAt = performance.now()
    },
    { passive: true },
  )
}

/**
 * 给一个控件接上滚轮：返回回调 ref，挂到要响应滚轮的那块元素上。
 * `onStep(dir, big)`：往上一格 dir = 1；按着 Shift 是 `big`（数字一次走 10 这类）。`enabled` 为假时不收（交给页面）。
 */
export function useWheelStep<E extends HTMLElement>(
  onStep: (dir: 1 | -1, big: boolean) => void,
  enabled = true,
): (el: E | null) => void {
  const latest = useRef({ onStep, enabled })
  latest.current = { onStep, enabled }
  const detach = useRef<(() => void) | null>(null)
  useEffect(() => () => detach.current?.(), [])
  return useCallback((el: E | null) => {
    detach.current?.()
    detach.current = null
    if (el === null) return
    watchPage()
    let acc = 0
    const onWheel = (event: WheelEvent): void => {
      if (!latest.current.enabled || event.ctrlKey) return
      if (performance.now() - pageWheelAt < PAGE_GRACE_MS) return
      event.preventDefault()
      event.stopPropagation()
      // Shift + 滚轮在有的系统上被换成横向滚动：两个方向取大的那个。
      const raw = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
      const step = wheelStep(acc, wheelPixels(raw, event.deltaMode))
      acc = step.acc
      if (step.dir !== 0) latest.current.onStep(step.dir, event.shiftKey)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    detach.current = () => el.removeEventListener('wheel', onWheel)
  }, [])
}
