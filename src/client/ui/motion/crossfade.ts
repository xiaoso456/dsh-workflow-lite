/**
 * dsh-workflow-lite — 整块换样子的交叉淡：新旧两张快照用 View Transitions 交叉过去（{@link crossfade} / {@link useCrossfade}）。
 *
 * 同一帧里要换的几处合成一次过渡；待换的登记（{@link crossfade} 的队列）整个应用只此一份。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/crossfade
 */

import { type RefObject, useLayoutEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { REDUCED } from './shared.ts'

// ── 整块换样子：新旧两张快照交叉淡（View Transitions） ─────────────

/** 过渡的类型名：CSS 只按它给这一种过渡定样子（ui.module.css 末尾），不碰宿主页面自己的 view transition。 */
const CROSSFADE_TYPE = 'wl-crossfade'

type Crossfade = { target: HTMLElement; apply: () => void }
const crossfades: Crossfade[] = []

type ViewTransitionStart = (options: { update: () => Promise<void>; types: string[] }) => {
  finished: Promise<void>
}

function viewTransitions(): ViewTransitionStart | null {
  const start = (document as unknown as { startViewTransition?: ViewTransitionStart })
    .startViewTransition
  if (typeof start !== 'function') return null
  // 带类型的过渡（Chrome 125+）才用：没有类型就没法只给这一种去掉整页的淡入淡出。
  if (globalThis.CSS?.supports?.('selector(:active-view-transition-type(a))') !== true) return null
  return start.bind(document)
}

function runCrossfades(): void {
  const batch = crossfades.splice(0)
  const start = viewTransitions()
  if (start === null) {
    for (const item of batch) item.apply()
    return
  }
  batch.forEach((item, index) => {
    item.target.style.viewTransitionName = `wl-crossfade-${index}`
  })
  const clear = (): void => {
    for (const item of batch) item.target.style.viewTransitionName = ''
  }
  try {
    const transition = start({
      update: async () => {
        // 新的那张是活的：里面的网页晚一帧换完底色也照样显示出来，不用等。
        flushSync(() => {
          for (const item of batch) item.apply()
        })
      },
      types: [CROSSFADE_TYPE],
    })
    transition.finished.then(clear, clear)
  } catch {
    clear()
    for (const item of batch) item.apply()
  }
}

/**
 * 让一块东西换样子（`apply` 里改状态）时新旧两张快照交叉淡，而不是一下换掉：画布上的展示卡换外观用。
 * 卡片的边框、卡面、垫底都画在卡片自己身上，没法拆成几层各自淡；交给浏览器拍新旧两张快照，
 * 动的只是两张快照的透明度（合成器上跑），页面其余部分照常、不跟着淡。
 *
 * 这是「只动 transform / opacity」之外登记的一处例外：用的是 View Transitions，只在换外观那一下、约 220ms，
 * 同一帧里好几张卡一起换（改了全局外观）合成一次过渡。开了「减少动态效果」、浏览器不支持、目标不在页面上时直接换。
 */
export function crossfade(target: HTMLElement | null, apply: () => void): void {
  if (
    target === null ||
    !target.isConnected ||
    REDUCED?.matches === true ||
    viewTransitions() === null
  ) {
    apply()
    return
  }
  crossfades.push({ target, apply })
  if (crossfades.length === 1) queueMicrotask(runCrossfades)
}

/**
 * 跟着 `value` 走，但换的那一下走 {@link crossfade}：返回此刻该画的值（换之前还是旧的，拍完旧快照才换成新的）。
 */
export function useCrossfade<V>(value: V, target: RefObject<HTMLElement | null>): V {
  const [shown, setShown] = useState(value)
  useLayoutEffect(() => {
    if (Object.is(value, shown)) return
    crossfade(target.current, () => setShown(value))
  }, [value, shown, target])
  return shown
}
