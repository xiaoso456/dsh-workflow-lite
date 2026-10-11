/**
 * dsh-workflow-lite — 「新节点到了」：复制之后选中跳到新节点上，等它渲染并量完尺寸，回调一次（借它把被右栏盖住的新卡挪出来）。
 * 新节点的 id 是 reducer 里才定下来的，所以先 `arm()`，等选中变化再认领。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/useArrival
 */

import { useCallback, useEffect, useRef } from 'react'

/** 武装之后多久还没等到新选中就作废（这次改动其实没生效）。 */
const ARM_MS = 600

export function useArrival(selectedId: string | null, onArrive: (id: string) => void): () => void {
  const armed = useRef<number | null>(null)
  const callback = useRef(onArrive)
  callback.current = onArrive

  const arm = useCallback((): void => {
    if (armed.current !== null) window.clearTimeout(armed.current)
    armed.current = window.setTimeout(() => {
      armed.current = null
    }, ARM_MS)
  }, [])

  useEffect(() => {
    if (armed.current === null || selectedId === null) return
    window.clearTimeout(armed.current)
    armed.current = null
    const frame = requestAnimationFrame(() => callback.current(selectedId))
    return () => cancelAnimationFrame(frame)
  }, [selectedId])

  return arm
}
