/**
 * dsh-workflow-lite — 视图被弹窗盖住了没有：盖着的时候背后的东西停下来，揭开再接着走。
 *
 * 弹窗开着时视图在遮罩下面，人看不见，可背后的动画、轮询还在让主线程一帧帧地忙（每帧过一遍在走的动画、
 * 轮询回来重渲染）。所以：
 * - 视图根按 {@link useCoverCount} 数开着几个模态框：模态框挂上时调 {@link CoverHost} 给的函数加一、卸下时减一；
 *   不是 0 就在视图根上标 `data-covered`，CSS 让视图里的动画原地停下（shell.module.css）；
 * - 背后的轮询读 {@link useViewCovered}：盖着就不问，揭开时补问一次；
 * - 模态框里面把它重设成 `false`：弹窗自己的轮询、动画照常（模态框挂在视图外面的弹窗层，但在 React 树里还在视图下面）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/viewCover
 */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

/** 这里是不是被弹窗盖着的视图（弹窗里面是 `false`）。 */
export const ViewCovered = createContext(false)

/** 模态框挂上时调它（盖住视图），返回的函数在卸下时调（揭开）。视图外面没有它。 */
export const CoverHost = createContext<(() => () => void) | null>(null)

export function useViewCovered(): boolean {
  return useContext(ViewCovered)
}

/** 模态框用：挂着的时候算盖住了视图。 */
export function useCoverView(): void {
  const cover = useContext(CoverHost)
  useEffect(() => cover?.(), [cover])
}

/** 视图根用：开着几个模态框，和给模态框的「盖上」。 */
export function useCoverCount(): [covered: boolean, cover: () => () => void] {
  const [count, setCount] = useState(0)
  const cover = useCallback((): (() => void) => {
    setCount((n) => n + 1)
    let done = false
    return () => {
      if (done) return
      done = true
      setCount((n) => n - 1)
    }
  }, [])
  return [count > 0, cover]
}
