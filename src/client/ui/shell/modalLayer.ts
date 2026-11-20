/**
 * dsh-workflow-lite — 弹窗层：挂在 `body` 下、贴着视图根的一层。模态框、浮层（下拉、确认卡）、悬停提示都挂在这里。
 *
 * 为什么不挂在视图根里：宿主对话流有条带 `:has()` / `:empty` 和兄弟选择符的样式规则，视图里每插拔一个元素，
 * 浏览器都要把整页样式重算一遍（20ms 上下）。弹窗里换内容（工作流中心换一项、下拉展开）要插拔不少元素，
 * 挂在视图外面就只重算弹窗自己。
 *
 * 这一层：
 * - 带视图根的类（`rootClass`）和主题属性（`style` 里的主题变量、亮暗两档主题、瑞士外观），
 *   弹窗里的配色、字体和视图根上那些通用规则（盒模型、按下回弹、焦点框）和原来一样；
 * - 一直贴着视图根的位置和大小：遮罩只盖插件视图，弹窗、提示照旧按视图定位；视图藏起来（切到别的 tab）时跟着藏；
 * - 也带 `data-workflow-lite-view`：弹窗里的东西退场时留的影子按它找挂在哪；
 * - 本身不接指针，只有挂上来的东西接；
 * - 悬停提示另有一个常驻的格子（`tips`，排在最前面）：提示一出一收很频繁，直接挂在这一层下面的话，
 *   每次都紧挨着开着的对话框插拔，会把整个对话框的样式连带重算一遍（工作流中心开着时 5–10ms）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/modalLayer
 */

import { type RefObject, useLayoutEffect, useState } from 'react'
import { CROSSFADE_ABOVE } from '../motion/crossfade.ts'

/** 弹窗层和它里面给悬停提示的格子。 */
export interface ModalLayer {
  /** 模态框、浮层挂在这里。 */
  root: HTMLElement
  /** 悬停提示挂在这里（`display: contents`，定位照样按整层算）。 */
  tips: HTMLElement
}

/** 从视图根抄过来的属性（主题、外观）。 */
const MIRRORED = ['data-light-theme', 'data-dark-theme', 'data-look'] as const

/**
 * 给视图根配一层弹窗层；视图根挂上之前是 `null`。
 * @param rootClass - 视图根的类（主题变量、通用规则都写在它上面）加上这一层自己的定位类。
 */
export function useModalLayer(
  rootRef: RefObject<HTMLElement>,
  rootClass: string,
): ModalLayer | null {
  const [layer, setLayer] = useState<ModalLayer | null>(null)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const el = document.createElement('div')
    el.className = rootClass
    el.dataset.workflowLiteView = ''
    el.dataset.testid = 'wl-layer'
    // 画布上的卡片换样子交叉淡时，这一层跟着拍进去，照旧盖在卡片上面。
    el.setAttribute(CROSSFADE_ABOVE, '')
    const tips = document.createElement('div')
    tips.style.display = 'contents'
    el.append(tips)
    let box = { left: 0, top: 0, width: 0, height: 0 }
    /** 主题跟着视图根换：抄 `style`（主题变量）和那几个属性，再写回自己的位置。 */
    const mirror = (): void => {
      el.style.cssText = root.style.cssText
      for (const name of MIRRORED) {
        const value = root.getAttribute(name)
        if (value === null) el.removeAttribute(name)
        else el.setAttribute(name, value)
      }
      place()
    }
    const place = (): void => {
      el.style.left = `${box.left}px`
      el.style.top = `${box.top}px`
      el.style.width = `${box.width}px`
      el.style.height = `${box.height}px`
      // 视图藏起来了（切到别的 tab）：弹窗层跟着藏，不留在宿主页面上。
      el.hidden = box.width === 0 || box.height === 0
    }
    const measure = (): void => {
      const rect = root.getBoundingClientRect()
      if (
        rect.left === box.left &&
        rect.top === box.top &&
        rect.width === box.width &&
        rect.height === box.height
      ) {
        return
      }
      box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      place()
    }
    // 视图、弹窗里面滚动不挪视图根；只有宿主外层滚了才要再量。
    const onScroll = (event: Event): void => {
      const target = event.target
      if (target instanceof Node && (root.contains(target) || el.contains(target))) return
      measure()
    }
    const attrs = new MutationObserver(mirror)
    attrs.observe(root, { attributes: true, attributeFilter: ['style', ...MIRRORED] })
    // 大小变了（窗口、侧栏、右栏宽度）一定会报；只挪位置不变大小的，靠窗口缩放和宿主滚动时再量一次。
    const sized = new ResizeObserver(measure)
    sized.observe(root)
    window.addEventListener('resize', measure)
    document.addEventListener('scroll', onScroll, { capture: true, passive: true })
    mirror()
    measure()
    document.body.append(el)
    setLayer({ root: el, tips })
    return () => {
      attrs.disconnect()
      sized.disconnect()
      window.removeEventListener('resize', measure)
      document.removeEventListener('scroll', onScroll, { capture: true })
      el.remove()
      setLayer(null)
    }
  }, [rootRef, rootClass])
  return layer
}
