/**
 * dsh-workflow-lite — 影子：复制一块界面放退场动画（模态框关掉、整块视图被换掉）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/ghost
 */

/** 模态框关掉时淡出的时长。 */
const MODAL_EXIT_MS = 320
export const REDUCED_MOTION = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null

/** 一块界面此刻样子的复制品（纯 DOM，不归 React 管），放退场动画用。 */
export interface Ghost {
  node: HTMLElement
  /** 挂到 `parent` 里，再把复制时记下的滚动位置、输入框里的字抄回去。 */
  place(parent: Node): void
}

/**
 * 复制一块界面当影子：
 *
 * - 影子不接指针、不进无障碍树，也不带 `data-testid` / `id` / `role`：后面的界面马上能点，查找也找不到它；
 * - 影子里的入场动画、过渡都关掉（写在行内），不然复制出来的元素会把入场重放一遍；
 * - 滚动位置、输入框里的字在复制时记下、挂上后照抄，放动画时不跳；
 *   iframe 不复制（挂上就会重新加载页面），换成同样大小的空块。
 */
export function ghostClone(node: HTMLElement): Ghost {
  const clone = node.cloneNode(true) as HTMLElement
  const from = [node, ...node.querySelectorAll<HTMLElement>('*')]
  const to = [clone, ...clone.querySelectorAll<HTMLElement>('*')]
  const scrolls = from.map((source) => [source.scrollTop, source.scrollLeft] as const)
  const values = from.map((source) =>
    source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement
      ? source.value
      : null,
  )
  const frames = [...node.querySelectorAll('iframe')]
  clone.querySelectorAll('iframe').forEach((frame, index) => {
    const blank = document.createElement('div')
    const source = frames[index]
    blank.style.cssText = `width:${source?.offsetWidth ?? 0}px;height:${source?.offsetHeight ?? 0}px`
    frame.replaceWith(blank)
  })
  for (const element of to) {
    for (const name of ['data-testid', 'id', 'role', 'aria-modal', 'tabindex']) {
      element.removeAttribute(name)
    }
    // 写在行内：压得过各处带属性选择器的入场 / 退场规则。
    element.style.animation = 'none'
    element.style.transition = 'none'
  }
  clone.style.pointerEvents = 'none'
  clone.setAttribute('aria-hidden', 'true')
  clone.setAttribute('inert', '')
  return {
    node: clone,
    place(parent) {
      parent.appendChild(clone)
      to.forEach((target, index) => {
        const [top, left] = scrolls[index] ?? [0, 0]
        if (top !== 0) target.scrollTop = top
        if (left !== 0) target.scrollLeft = left
        const value = values[index]
        if (
          value != null &&
          (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)
        ) {
          target.value = value
        }
      })
    },
  }
}

/**
 * 模态框关掉后的退场：把它此刻的样子复制一份放回原处，遮罩淡出、卡片缩回触发它的控件（`folded` 是缩进去的变换），放完就删。
 * 起点取关掉那一刻的实际变换和透明度（弹出到一半就关，影子从那半截接着收，不是先跳到满尺寸再缩）。
 */
export function ghostOut(node: HTMLElement, parent: Node | null, folded: string | null): void {
  if (parent === null || REDUCED_MOTION?.matches === true) return
  const liveCard = node.firstElementChild
  const scrimOpacity = getComputedStyle(node).opacity
  const card = liveCard === null ? null : getComputedStyle(liveCard)
  const cardFrom = { transform: card?.transform ?? 'none', opacity: card?.opacity ?? '1' }
  const ghost = ghostClone(node)
  ghost.place(parent)
  const clone = ghost.node
  const timing = {
    duration: MODAL_EXIT_MS,
    easing: 'cubic-bezier(0.32, 0.72, 0, 1)',
    fill: 'forwards',
  } as const
  // 遮罩淡出。
  const fade = clone.animate([{ opacity: scrimOpacity }, { opacity: 0 }], {
    ...timing,
    easing: 'ease-out',
  })
  // 有触发控件：缩回它的位置（先缩，后半段才淡出，看得清往哪儿收）；没有：原地略缩、下沉、淡出。
  clone.firstElementChild?.animate(
    folded === null
      ? [cardFrom, { transform: 'translateY(16px) scale(0.86)', opacity: 0 }]
      : [cardFrom, { opacity: 1, offset: 0.6 }, { transform: folded, opacity: 0 }],
    { ...timing, easing: folded === null ? timing.easing : 'cubic-bezier(0.4, 0, 0.2, 1)' },
  )
  const drop = (): void => clone.remove()
  fade.finished.then(drop, drop)
}

/**
 * 整块视图（画布）被换掉时的退场：把它此刻的样子复制一份放进视图根、盖在新视图下面的面板之上，
 * 淡出后删掉——旧画布和新画布交叉淡过去，不是一下换掉。
 */
export function ghostFade(node: HTMLElement, parent: Node | null, ms = 240): void {
  if (parent === null || REDUCED_MOTION?.matches === true) return
  const ghost = ghostClone(node)
  ghost.node.style.zIndex = '1'
  ghost.place(parent)
  const fade = ghost.node.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: ms,
    easing: 'linear',
    fill: 'forwards',
  })
  const drop = (): void => ghost.node.remove()
  fade.finished.then(drop, drop)
}
