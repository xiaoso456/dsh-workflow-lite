/**
 * dsh-workflow-lite — 细滚动条（`scrollbar-width: thin`）在这台机器上有多宽，写在视图根上的 `--wl-scrollbar`。
 *
 * 列表、页面一直给滚动条留着位置（`scrollbar-gutter: stable`，行数变了滚动条出来、没了，内容都不左右跳）；
 * 跟它们上下排在一起、自己不滚的条（工作流中心左栏的搜索那一行和底栏、「触发」页右栏的头部）在右边留同样宽的位置，
 * 左右边才对得齐。不用 `overflow: hidden` 加 `scrollbar-gutter` 去留：那些条里有不走 portal 的浮层（Popover），
 * 会被裁掉，焦点进了浮层还会把整条卷上去。
 *
 * 量一次；浏览器缩放时（设备像素比变了，滚动条的 CSS 宽度跟着变）再量。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/scrollbarWidth
 */

import { type RefObject, useLayoutEffect } from 'react'

/** 量一下：在 `root` 里放一块看不见的、带细滚动条的小块，宽度减去内容宽度就是滚动条的宽度。 */
function measure(root: HTMLElement): number {
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:absolute;top:0;left:0;width:100px;height:40px;overflow-y:scroll;' +
    'scrollbar-width:thin;visibility:hidden;pointer-events:none'
  root.appendChild(probe)
  const width = probe.offsetWidth - probe.clientWidth
  probe.remove()
  return width
}

/** 把细滚动条的宽度写到 `rootRef` 上（`--wl-scrollbar`），缩放后跟着更新。 */
export function useScrollbarWidth(rootRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const root = rootRef.current
    if (root === null) return
    const write = (): void => {
      root.style.setProperty('--wl-scrollbar', `${String(measure(root))}px`)
    }
    write()
    if (typeof matchMedia !== 'function') return
    // 设备像素比一变就再量一次，换成新的比值接着等下一次变。
    let query: MediaQueryList | null = null
    const onChange = (): void => {
      write()
      watch()
    }
    const watch = (): void => {
      query?.removeEventListener('change', onChange)
      query = matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`)
      query.addEventListener('change', onChange)
    }
    watch()
    return () => query?.removeEventListener('change', onChange)
  }, [rootRef])
}
