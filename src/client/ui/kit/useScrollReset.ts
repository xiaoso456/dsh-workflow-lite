/**
 * dsh-workflow-lite — 换了一项时把滚动区滚回顶上（工作流中心右栏：换实例、换触发器、换记忆、换页签）。
 *
 * 只在真的滚下去过时才写 `scrollTop`：写它（哪怕本来就是 0）浏览器都要先把样式算好，
 * 换一项的那次提交里右栏整块换了内容，这一写就是当场把整页样式算一遍。滚没滚过看滚动事件（那时读是现成的）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/useScrollReset
 */

import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

/** `key` 变了就把 `ref` 那个滚动区滚回顶上（没滚下去过就不动它）。 */
export function useScrollReset(ref: RefObject<HTMLElement | null>, key: string): void {
  const scrolled = useRef(false)
  // 在文档上捕获（滚动事件不冒泡）：滚动区换了一个元素也照样听得到。
  useEffect(() => {
    const onScroll = (event: Event): void => {
      const box = ref.current
      if (box !== null && event.target === box) scrolled.current = box.scrollTop > 0
    }
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => document.removeEventListener('scroll', onScroll, true)
  }, [ref])
  useLayoutEffect(() => {
    const box = ref.current
    if (box === null || !scrolled.current) return
    scrolled.current = false
    box.scrollTop = 0
  }, [key, ref])
}
