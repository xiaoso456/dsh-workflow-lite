/**
 * dsh-workflow-lite — 最近的输出有新的一条从上面进来时，正在看的那一块不往下挪。
 *
 * 新的在上面：来一条，下面的都往下一格。在最上面看着（没展开、没往下翻）时就该这样，新来的一眼看得见；
 * 但展开着一条在读、或者已经往下翻了，眼前的字一下子跳下去一行。这时把外面的滚动框往下卷同样多，眼前的不动。
 *
 * 浏览器自带的滚动锚定帮不上：行按位置挂着（见 OutputList），新来一条是每一格换字，元素本身没挪。
 * 所以按条（`data-id`）记下眼前第一条离滚动框顶多远，换了一批之后在画出来之前把差的卷回去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/output/useKeepReading
 */

import { type RefObject, useEffect, useLayoutEffect, useRef } from 'react'

interface Anchor {
  id: string
  /** 这一条的顶离滚动框顶多远。 */
  offset: number
}

/** 谁在滚：列表自己（工作流中心），或往外第一个自己滚的祖先（画布上的面板）。 */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let node: HTMLElement | null = el; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
}

/**
 * `listRef` 是列表（直接子元素里每条一个 `[data-id]`）；`entries` 换了一批时对一次；
 * `reading` 是有没有展开着的条（展开着就算在读，哪怕没往下翻）。
 */
export function useKeepReading(
  listRef: RefObject<HTMLElement | null>,
  entries: unknown,
  reading: boolean,
): void {
  const anchor = useRef<Anchor | null>(null)
  const readingRef = useRef(reading)
  readingRef.current = reading
  // 列表挂着期间滚动框不换，找一次就记下。
  const scrollerRef = useRef<HTMLElement | null>(null)
  const scroller = (): HTMLElement | null => {
    const list = listRef.current
    if (list !== null && scrollerRef.current === null) scrollerRef.current = scrollerOf(list)
    return scrollerRef.current
  }

  const note = (): void => {
    anchor.current = null
    const list = listRef.current
    const box = scroller()
    if (list === null || box === null) return
    const top = box.getBoundingClientRect().top
    // 列表顶还看得见、也没展开着的：在最上面看着，新来的照常把下面的推下去。
    const atTop = box === list ? list.scrollTop < 1 : list.getBoundingClientRect().top >= top
    if (!readingRef.current && atTop) return
    for (const row of list.querySelectorAll<HTMLElement>(':scope > [data-id]')) {
      const rect = row.getBoundingClientRect()
      if (rect.bottom > top) {
        anchor.current = { id: row.dataset.id ?? '', offset: rect.top - top }
        return
      }
    }
  }

  // 换了一批：眼前那一条要是挪了，把差的卷回去，再按新的样子记一次。
  useLayoutEffect(() => {
    const was = anchor.current
    const list = listRef.current
    const box = scroller()
    if (was !== null && list !== null && box !== null) {
      const row = list.querySelector<HTMLElement>(`:scope > [data-id="${CSS.escape(was.id)}"]`)
      if (row !== null) {
        const drift = row.getBoundingClientRect().top - box.getBoundingClientRect().top - was.offset
        if (Math.abs(drift) >= 1) box.scrollTop += drift
      }
    }
    note()
  }, [entries])

  // 展开、收起一条：读不读的判断变了，重记。
  useLayoutEffect(() => note(), [reading])

  // 往下翻：眼前那一条变了，重记。
  useEffect(() => {
    const box = scroller()
    if (box === null) return
    box.addEventListener('scroll', note, { passive: true })
    return () => box.removeEventListener('scroll', note)
  }, [listRef])
}
