/**
 * dsh-workflow-lite — 右栏标题行里那一排标签一行放不下时，前面放几个、后面收成「+N」（TagRow 用）。
 *
 * 排法：标签按原顺序，后面跟「+N」（有收起的才占位）和「+ 标签」。各单元按平时（没悬停）的宽算，
 * 另留出悬停变宽的那一截：悬停最后一个放得下的也不会顶出去。
 * 收起的标签不卸掉，只是挪出排版、藏起来（`data-row-hidden`），宽度照样量得到，放得下了原样露出来。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/workflows/tagFit
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/** 悬停时标签多出来的宽（tags.module.css 里名字右边多让出的 14px）。 */
export const HOVER_GROW = 14

/**
 * 一行宽 `avail`、单元间距 `gap`：前面能放几个标签。全都放得下就是 `chips.length`；
 * 放不下时后面要跟一个宽 `more` 的「+N」。`tail` 是标签后面一直在的（「+ 标签」）。
 */
export function fitTags(
  chips: readonly number[],
  tail: readonly number[],
  more: number,
  gap: number,
  avail: number,
): number {
  const room = avail - HOVER_GROW
  const span = (widths: readonly number[]): number =>
    widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1)
  if (span([...chips, ...tail]) <= room) return chips.length
  let shown = 0
  while (shown < chips.length && span([...chips.slice(0, shown + 1), more, ...tail]) <= room) {
    shown += 1
  }
  return shown
}

/**
 * 量这一排：子项 `data-fit="chip"` 是标签、`data-fit="more"` 是「+N」，别的算在后面一直在的。
 * 这一排和名字在同一行里（父元素，名字是第一个子项）：能用的宽 = 那一行减去名字，
 * 不按这一排眼下的宽——展开时它挪到名字下面占满一行，按那个宽算就成了「都放得下」，一收又放不下，来回跳。
 * 返回一行放得下几个标签；`key` 变了（标签换了）当场重量，那一行、名字变宽变窄（改名时输入框跟着字长）跟着重量。
 * `also` 是同一排上别的回调 ref（useRowSlide），一起挂上。
 */
export function useTagFit(
  key: string,
  count: number,
  also: (row: HTMLElement | null) => void,
): { ref: (row: HTMLElement | null) => void; shown: number } {
  const [shown, setShown] = useState(count)
  const row = useRef<HTMLElement | null>(null)
  const stop = useRef<(() => void) | null>(null)
  const measure = useCallback((): void => {
    const el = row.current
    const line = el?.parentElement
    if (el === null || line === null || line === undefined) return
    const chips: number[] = []
    const tail: number[] = []
    let more = 0
    for (const child of el.children) {
      if (!(child instanceof HTMLElement)) continue
      if (child.dataset.fit === 'chip') chips.push(child.offsetWidth)
      else if (child.dataset.fit === 'more') more = child.offsetWidth
      else if (child.dataset.fit !== 'ghosts') tail.push(child.offsetWidth)
    }
    const lead = line.firstElementChild
    const name = lead instanceof HTMLElement && lead !== el ? lead.offsetWidth : 0
    const lineGap = name > 0 ? Number.parseFloat(getComputedStyle(line).columnGap) || 0 : 0
    // 名字太长时这一排保底的宽（CSS 的 min-width），名字让出来。
    const floor = Number.parseFloat(getComputedStyle(el).minWidth) || 0
    const avail = Math.max(line.clientWidth - name - lineGap, floor)
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0
    setShown(fitTags(chips, tail, more, gap, avail))
  }, [])
  // 标签换了（key）就重量，画出来之前定下来。
  useLayoutEffect(measure, [key, measure])
  useEffect(() => () => stop.current?.(), [])
  const ref = useCallback(
    (el: HTMLElement | null): void => {
      also(el)
      stop.current?.()
      stop.current = null
      row.current = el
      const line = el?.parentElement
      if (el === null || line === null || line === undefined) return
      if (typeof ResizeObserver === 'undefined') return
      const sizes = new ResizeObserver(measure)
      // 那一行和名字：名字在改名时换成输入框（换了一个元素），换了就重新看。
      const watch = (): void => {
        sizes.disconnect()
        sizes.observe(line)
        const lead = line.firstElementChild
        if (lead !== null && lead !== el) sizes.observe(lead)
      }
      watch()
      const swaps = new MutationObserver(() => {
        watch()
        measure()
      })
      swaps.observe(line, { childList: true })
      stop.current = () => {
        sizes.disconnect()
        swaps.disconnect()
      }
    },
    [also, measure],
  )
  return { ref, shown: Math.min(shown, count) }
}
