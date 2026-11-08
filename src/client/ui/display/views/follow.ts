/**
 * dsh-workflow-lite — 展示区里内容的几个共用件：裁内容那层的溢出量、跟着末尾走、和上一份比出新加的几项，以及卡片里最多排的行数。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/follow
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import css from '../display.module.css'

/** 纯文本在卡片里最多排多少行：卡片是预览，一屏只看得到几十行；整份在「打开」里看。表格同理。 */
export const WRAP_LINES = 1000

/**
 * 裁内容的那层（和展示区一样大）：量内容是不是真的超出了、超出的是哪一边（内容、字号、卡片大小变了都重量）。
 * `pin` 为真时停在最底下（日志跟着末尾）：没进交互时裁的就是这层，量完顺手拉到底。
 */
export function useOverflow(
  pin: boolean,
): [React.RefObject<HTMLDivElement>, { x: boolean; y: boolean }] {
  const clip = useRef<HTMLDivElement>(null)
  const [over, setOver] = useState({ x: false, y: false })
  const pinned = useRef(pin)
  pinned.current = pin
  useLayoutEffect(() => {
    const element = clip.current
    if (element === null) return
    const measure = (): void => {
      const x = element.scrollWidth > element.clientWidth + 1
      const y = element.scrollHeight > element.clientHeight + 1
      setOver((last) => (last.x === x && last.y === y ? last : { x, y }))
      if (pinned.current) element.scrollTop = element.scrollHeight
    }
    measure()
    // 量自己（卡片大小、进出交互）和里面那层（字号、图片加载完撑高）。
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (element.firstElementChild !== null) observer.observe(element.firstElementChild)
    return () => observer.disconnect()
  }, [])
  return [clip, over]
}

/**
 * 跟着末尾走（日志）：没进交互时裁的那层停在底下；进了交互展示区自己滚——一进来先到底，
 * 之后人还在底下（差一点也算）才跟着新内容往下走，往上翻着看时不拽回来。
 */
export function useFollow(
  clip: React.RefObject<HTMLDivElement>,
  follow: boolean,
  interactive: boolean,
  content: unknown,
): void {
  const atBottom = useRef(true)
  const scroller = (): HTMLElement | null =>
    interactive ? (clip.current?.closest<HTMLElement>(`.${css.body}`) ?? null) : clip.current
  // 记住人在不在底下（进了交互才会自己滚）。
  useEffect(() => {
    if (!follow || !interactive) return
    const element = scroller()
    if (element === null) return
    const onScroll = (): void => {
      atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  })
  // 进出交互、开始跟随：回到底下。
  useLayoutEffect(() => {
    atBottom.current = true
    const element = scroller()
    if (follow && element !== null) element.scrollTop = element.scrollHeight
  }, [follow, interactive])
  // 新内容来了（`content` 只是「变了」的信号）：人在底下才跟。
  useLayoutEffect(() => {
    const element = scroller()
    if (follow && element !== null && atBottom.current) element.scrollTop = element.scrollHeight
  }, [content])
}

/** 这一份比上一份新加了什么：哪几项（行号或表格行号），连同一个交替的记号（每次更新换一个，高亮从头再淡一次）。 */
export interface Marks {
  items: ReadonlySet<number>
  parity: 0 | 1
}

/**
 * 内容变了（现在的文件更新了）：和上一份比出新的几项。比在渲染里做（不是等画完再补），新的行一出现就带着高亮，不闪一下。
 * 第一份不标；看旧版时卡片整个换一层（见 {@link RunFileView}），也不标。
 */
export function useMarks<V>(
  value: V,
  diff: (before: V, after: V) => ReadonlySet<number>,
): Marks | null {
  const [seen, setSeen] = useState<{ value: V; marks: Marks | null }>({ value, marks: null })
  if (seen.value !== value) {
    const items = diff(seen.value, value)
    const parity: 0 | 1 = seen.marks?.parity === 0 ? 1 : 0
    const next = { value, marks: items.size === 0 ? null : { items, parity } }
    setSeen(next)
    return next.marks
  }
  return seen.marks
}
