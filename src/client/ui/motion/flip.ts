/**
 * dsh-workflow-lite — 列表的动效：增删筛选时其余项滑到新位置（{@link useFlip}）、
 * 某一项展开收起时后面的项跟着滑（{@link useResizeFlip}）、面包屑从右端增减（{@link useTrail}）。
 *
 * 守 `ui.module.css` 开头那条规矩：只动 `transform` / `opacity`，交给合成器。
 * JS 只在列表内容变了的那一次渲染里读一遍各项的 `offsetTop`，动画本身不占主线程
 * （CSS transition / Web Animations 的 transform 都在合成器上跑）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/flip
 */

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { ghostClone } from '../kit/ghost.ts'
import { EASE, EASE_OUT, fadeAway, leaving, REDUCED, seen } from './shared.ts'
import { swappedAt } from './swap.tsx'

/**
 * 项在列表里的纵向位置（相对列表本身，不是相对页面）。
 *
 * `offsetTop` 是相对最近的定位祖先算的：列表没定位时，列表上面的东西（标题、状态行、刚读完的提示）
 * 一变高，所有项的 `offsetTop` 都跟着变，可它们在列表里根本没动——拿这个比会让整列先往上蹿再滑回来。
 */
function topIn(list: HTMLElement, child: HTMLElement): number {
  return child.offsetParent === list ? child.offsetTop : child.offsetTop - list.offsetTop
}

const FLIP_MS = 240

/** 正在滑的项：位置又变了时，从它此刻看上去的地方接着滑，不是先跳回上一次的起点。 */
const sliding = new WeakMap<HTMLElement, Animation>()

/** 让一项看上去还在 `offset`（新位置之上多少像素）的地方，再滑到新位置。 */
function slide(child: HTMLElement, offset: number): void {
  const running = sliding.get(child)
  let from = offset
  if (running !== undefined && running.playState === 'running') {
    // 还在半路：把它此刻的位移加上（读的是动画的当前值，不是起点）。
    from += new DOMMatrixReadOnly(getComputedStyle(child).transform).m42
    running.cancel()
  }
  if (Math.abs(from) < 0.5) return
  const anim = child.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], {
    duration: FLIP_MS,
    easing: EASE,
  })
  sliding.set(child, anim)
  // 滑动的项盖在新出现 / 正在淡出的项上面（项有不透明底色时像帘子一样把它们盖住再露出来）：
  // 放完（或被下一次滑动接手）再还原。
  child.style.zIndex = '1'
  anim.addEventListener('finish', () => {
    if (sliding.get(child) === anim) child.style.removeProperty('z-index')
  })
}

const ENTER_MS = 240
/** 第一次挂上时各项错开多少、最多错开几项（再往后的和第 12 项一起出来）。 */
const STAGGER_MS = 22
const STAGGER_MAX = 12

/**
 * 列表里带 `data-flip`（值是项的键）的直接子项：`layout`（各项的键连起来）变了，
 * 留下来的项从旧位置滑到新位置；`enter` 时新出现的项从左边淡入——第一次挂上时依次错开。
 * 键没变的项换了个样子（比如改名时换成输入框行）不算新项，不放入场。
 */
export function useFlip(
  ref: RefObject<HTMLElement | null>,
  layout: string,
  options: { enter?: boolean } = {},
): void {
  const tops = useRef<Map<string, number> | null>(null)
  const enter = options.enter === true
  // 只在列表内容变了时量（layout 就是为这个给的）。
  useLayoutEffect(() => {
    const list = ref.current
    if (list === null) return
    const first = tops.current === null
    const still = REDUCED?.matches === true
    const next = new Map<string, number>()
    let index = 0
    for (const child of list.children) {
      if (!(child instanceof HTMLElement)) continue
      const key = child.dataset.flip
      if (key === undefined) continue
      const top = topIn(list, child)
      next.set(key, top)
      const was = tops.current?.get(key)
      if (still) continue
      if (was === undefined) {
        if (enter) {
          child.animate(
            [
              { opacity: 0, transform: 'translateX(-6px)' },
              { opacity: 1, transform: 'none' },
            ],
            {
              duration: ENTER_MS,
              easing: EASE,
              delay: first ? Math.min(index, STAGGER_MAX) * STAGGER_MS : 0,
              fill: 'backwards',
            },
          )
        }
      } else if (was !== top) {
        slide(child, was - top)
      }
      index += 1
    }
    tops.current = next
  }, [layout])
}

/** 最近的滚动 / 裁切祖先（或视口）在视口坐标里的上下边，各放宽 32px。 */
function clipBand(list: HTMLElement): [number, number] {
  let el: HTMLElement | null = list
  while (el !== null && el !== document.documentElement) {
    if (getComputedStyle(el).overflowY !== 'visible') {
      const box = el.getBoundingClientRect()
      return [box.top - 32, box.bottom + 32]
    }
    el = el.parentElement
  }
  return [-32, window.innerHeight + 32]
}

/** 列表自己就是滚动的那一层（项的位置要减去它滚走的部分才是视口里的位置）。 */
function isScroller(list: HTMLElement): boolean {
  return list.scrollHeight > list.clientHeight && getComputedStyle(list).overflowY !== 'visible'
}

/** 一项在列表里占的地方（相对列表的内边距框）：删掉后影子照这个摆回去。 */
interface Slot {
  top: number
  left: number
  width: number
  height: number
}

const LEAVE_MS = 180

/**
 * 删掉的一项：照它被删前的样子复制一份，按原来的位置绝对定位放回列表，原地淡出、略缩，放完就删。
 * 列表要是定位元素（`position: relative`），不然摆不回原处，就不放。
 */
function leaveAt(list: HTMLElement, node: HTMLElement, slot: Slot): void {
  if (getComputedStyle(list).position === 'static') return
  const ghost = ghostClone(node)
  ghost.node.removeAttribute('data-flip')
  ghost.node.removeAttribute('data-selected')
  Object.assign(ghost.node.style, {
    position: 'absolute',
    top: `${slot.top}px`,
    left: `${slot.left}px`,
    width: `${slot.width}px`,
    height: `${slot.height}px`,
    margin: '0',
    boxSizing: 'border-box',
    // 压在滑动的项（z-index 1）下面：它们滑过时盖住淡出中的影子，不叠出重影。
    zIndex: '0',
  })
  leaving.add(ghost.node)
  ghost.place(list)
  const out = fadeAway(ghost.node, { opacity: 1, transform: 'none' }, 'scale(0.97)', LEAVE_MS)
  const drop = (): void => ghost.node.remove()
  out.finished.then(drop, drop)
}

/** 新加的一项：从左边一点淡入（和 {@link useFlip} 的入场一样）。 */
function enterIn(child: Element): void {
  child.animate(
    [
      { opacity: 0, transform: 'translateX(-6px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: ENTER_MS, easing: EASE, fill: 'backwards' },
  )
}

/**
 * 列表里有一项变高变矮（展开、收起、内容换了）或增删了项：它后面的项从旧位置滑到新位置。
 * 和 {@link useFlip} 一样只动 transform，不同的是不用给 `layout`——ResizeObserver 看着每一项，
 * 尺寸一变（布局之后、绘制之前）就比一遍各项的 `offsetTop`；项按元素本身认（React 按 key 留着同一个元素）。
 *
 * - `exit`：删掉的项留个影子原地淡出（见 {@link leaveAt}），列表要 `position: relative`；
 * - `enter`：新加的项从左边淡入（项自己带入场动画的不用开）。
 *
 * 返回一个回调 ref，挂到列表上（列表可以晚挂上、可以换）。项要有不透明的底色：
 * 往下滑的项像帘子一样盖着、再露出上面刚展开的内容。
 */
export function useResizeFlip(
  options: { exit?: boolean; enter?: boolean } = {},
): (list: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null)
  const exit = options.exit === true
  const enter = options.enter === true
  useEffect(() => () => stop.current?.(), [])
  return useCallback(
    (list: HTMLElement | null) => {
      stop.current?.()
      stop.current = null
      if (list === null || typeof ResizeObserver === 'undefined') return
      const measure = (): Map<HTMLElement, Slot> => {
        const slots = new Map<HTMLElement, Slot>()
        for (const child of list.children) {
          if (
            !(child instanceof HTMLElement) ||
            leaving.has(child) ||
            child.hasAttribute('data-no-flip')
          )
            continue
          slots.set(child, {
            top: topIn(list, child),
            left: child.offsetLeft,
            width: child.offsetWidth,
            height: child.offsetHeight,
          })
        }
        return slots
      }
      // 第一次量放到 ResizeObserver 头一回叫的时候（布局刚算完，量起来不花钱）：挂上列表时正在提交，
      // 当场量会逼浏览器先把这一下改脏的整页样式、布局算一遍——换选中时右栏整块换掉，就卡在这里。
      let slots: Map<HTMLElement, Slot> | null = null
      const settle = (): void => {
        const next = measure()
        const before = slots
        slots = next
        // 列表里有 Presence 正在长 / 收（它每一帧都在改布局，后面的项本来就是跟着走的）：不再补位移，
        // 两边叠起来，后面的项会被甩到别的项上面。
        if (
          before === null ||
          REDUCED?.matches === true ||
          list.querySelector('[data-moving]') !== null
        )
          return
        // 只给看得见的项放动画：目录里成百上千行时，屏幕外的项滑不滑看不出来，不白费。
        let band: ReturnType<typeof clipBand> | null = null
        for (const [child, slot] of next) {
          const was = before.get(child)
          if (was === undefined || was.top === slot.top) continue
          band ??= clipBand(list)
          const now = child.getBoundingClientRect()
          const offset = was.top - slot.top
          if (seen(band, now.top, now.height) || seen(band, now.top + offset, now.height)) {
            slide(child, offset)
          }
        }
      }
      const sizes = new ResizeObserver(settle)
      const watch = (): void => {
        for (const child of list.children) {
          if (!leaving.has(child) && !child.hasAttribute('data-no-flip')) sizes.observe(child)
        }
      }
      sizes.observe(list)
      watch()
      const children = new MutationObserver((records) => {
        const still = REDUCED?.matches === true || performance.now() - swappedAt < 80
        // 还没量过（刚挂上）：没有旧位置可比，不放退场 / 入场。
        if (!still && (exit || enter) && slots !== null) {
          const band = clipBand(list)
          const origin = list.getBoundingClientRect().top - (isScroller(list) ? list.scrollTop : 0)
          for (const record of records) {
            if (exit) {
              for (const node of record.removedNodes) {
                // 挪了位置（删了又插回来）的不算删。
                if (!(node instanceof HTMLElement) || node.isConnected || leaving.has(node))
                  continue
                const slot = slots?.get(node)
                if (slot !== undefined && seen(band, origin + slot.top, slot.height)) {
                  leaveAt(list, node, slot)
                }
              }
            }
            if (enter) {
              for (const node of record.addedNodes) {
                if (
                  node instanceof HTMLElement &&
                  !leaving.has(node) &&
                  slots !== null &&
                  !slots.has(node)
                ) {
                  const box = node.getBoundingClientRect()
                  if (seen(band, box.top, box.height)) enterIn(node)
                }
              }
            }
          }
        }
        watch()
        // 删掉一项时其余项的尺寸没变、列表也可能是定高的：ResizeObserver 不一定叫，这里补一次。
        settle()
      })
      children.observe(list, { childList: true })
      stop.current = () => {
        sizes.disconnect()
        children.disconnect()
      }
    },
    [exit, enter],
  )
}

const TRAIL_IN_MS = 260
const TRAIL_OUT_MS = 200

/**
 * 路径栏那样沿一条线、从右端增减的一排（面包屑）：长出一级时新的一级从前一级背后「展开」出来，
 * 缩短时去掉的几级往前一级背后「收」进去——像抽屉拉出、推回，不是淡入淡出。
 *
 * 直接子项是一级一个单元。靠遮挡做出展开感，所以单元要**不透明底色**、`position: relative`，
 * 且越靠前的 `z-index` 越高（前一级盖在后一级上，影子垫在最底下）；整排要 `position: relative`、
 * 自己裁切（`overflow` 不是 visible）。只放 transform 动画，单元本身一次到位（布局不动，不占主线程）。
 * 返回一个回调 ref 挂到这一排上。
 */
export function useTrail(): (row: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  return useCallback((row: HTMLElement | null) => {
    stop.current?.()
    stop.current = null
    if (row === null || typeof MutationObserver === 'undefined') return
    const measure = (): Map<HTMLElement, Slot> => {
      const slots = new Map<HTMLElement, Slot>()
      for (const child of row.children) {
        if (!(child instanceof HTMLElement) || leaving.has(child)) continue
        slots.set(child, {
          top: child.offsetTop,
          left: child.offsetLeft,
          width: child.offsetWidth,
          height: child.offsetHeight,
        })
      }
      return slots
    }
    let slots = measure()
    const watcher = new MutationObserver((records) => {
      const gone: HTMLElement[] = []
      const fresh: HTMLElement[] = []
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node instanceof HTMLElement && !node.isConnected && slots.has(node)) gone.push(node)
        }
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && !leaving.has(node) && !slots.has(node)) {
            fresh.push(node)
          }
        }
      }
      // 第一次装进来（路径栏刚挂上、原来是空的）不放展开。
      if (REDUCED?.matches !== true && slots.size > 0) {
        // 去掉的：留下的那一级（第一个被去掉的单元左边）就是收拢的地方，每个影子往左缩进它背后。
        const gate = Math.min(...gone.map((node) => slots.get(node)?.left ?? 0))
        for (const node of gone) {
          const slot = slots.get(node)
          if (slot === undefined) continue
          const ghost = ghostClone(node)
          ghost.node.removeAttribute('data-trail')
          Object.assign(ghost.node.style, {
            position: 'absolute',
            top: `${slot.top}px`,
            left: `${slot.left}px`,
            width: `${slot.width}px`,
            height: `${slot.height}px`,
            margin: '0',
            boxSizing: 'border-box',
            zIndex: '0',
          })
          leaving.add(ghost.node)
          ghost.place(row)
          const shift = slot.left - gate + slot.width
          const out = ghost.node.animate(
            [{ transform: 'none' }, { transform: `translateX(${-shift}px)` }],
            { duration: TRAIL_OUT_MS, easing: EASE_OUT, fill: 'forwards' },
          )
          const drop = (): void => ghost.node.remove()
          out.finished.then(drop, drop)
        }
        // 新长出的：从前一级背后（第一个新单元左边）向右展开，各自的右缘先对齐那条线。
        if (fresh.length > 0) {
          const origin = Math.min(...fresh.map((node) => node.offsetLeft))
          for (const node of fresh) {
            const shift = node.offsetLeft - origin + node.offsetWidth
            node.animate([{ transform: `translateX(${-shift}px)` }, { transform: 'none' }], {
              duration: TRAIL_IN_MS,
              easing: EASE_OUT,
            })
          }
        }
      }
      slots = measure()
    })
    watcher.observe(row, { childList: true })
    stop.current = () => watcher.disconnect()
  }, [])
}
