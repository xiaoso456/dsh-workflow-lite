/**
 * dsh-workflow-lite — 出现 / 消失的动效：卸掉时留影子放退场（{@link useExit} / {@link ExitSeat}）、
 * 画布上节点和连线被删的影子（{@link useCanvasExits} / {@link useLineExit}）、宽度跟着内容滑（{@link useGlide}）、
 * 整张画布换视图（{@link useViewGhost}）、折叠区展开收起（{@link Presence}）。只动 `transform` / `opacity`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/exits
 */

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { cx } from '../kit/cx.ts'
import { ghostClone, ghostFade } from '../kit/ghost.ts'
import css from './exits.module.css'
import { EASE, fadeAway, leaving, REDUCED } from './shared.ts'

/** 退场：往哪边走、走多久（都是入场的反方向）。 */
const EXITS = {
  /** 底部轻提示、草稿栏：往下沉、略缩。 */
  down: { frames: 'translateY(8px) scale(0.97)', ms: 220 },
  /** 顶部提示条：往上收。 */
  up: { frames: 'translateY(-8px) scale(0.98)', ms: 200 },
  /** 就地弹出的菜单：原地缩回、淡出（缩向 CSS 里的 transform-origin）。 */
  shrink: { frames: 'scale(0.95)', ms: 140 },
  /** 从右边拉出来的抽屉：退回右边。 */
  right: { frames: 'translateX(16px)', ms: 180 },
} as const

type Exit = keyof typeof EXITS

/**
 * 卸掉时留个影子放退场：照它此刻的样子复制一份放回原处（定位方式由它自己的类决定），动完就删。
 * `inner`：动里面那一层——外面那层带着定位用的 transform（居中的 `translateX(-50%)`）时用，两个 transform 不打架。
 * 不动里面那层时，从它此刻的 transform、透明度接着走（入场还没放完就关也不跳）。
 */
function leave(node: HTMLElement, parent: Node, exit: Exit, inner: boolean): void {
  if (REDUCED?.matches === true || !parent.isConnected) return
  const live = inner ? (node.firstElementChild ?? node) : node
  const style = getComputedStyle(live)
  const base = style.transform === 'none' ? '' : `${style.transform} `
  const opacity = Number(style.opacity)
  const ghost = ghostClone(node)
  ghost.place(parent)
  const target = inner ? (ghost.node.firstElementChild ?? ghost.node) : ghost.node
  const { frames, ms } = EXITS[exit]
  const out = fadeAway(
    target,
    { opacity, transform: base === '' ? 'none' : base },
    `${base}${frames}`,
    ms,
  )
  const drop = (): void => ghost.node.remove()
  out.finished.then(drop, drop)
}

/**
 * 给按条件挂的一块加退场（就地菜单、抽屉、草稿栏）：返回的 ref 挂到它的根上，卸掉时留影子放 `exit`。
 * 调用方照常按条件挂，不用等动画。
 */
export function useExit<E extends HTMLElement>(
  exit: Exit,
  options: { inner?: boolean } = {},
): RefObject<E> {
  const ref = useRef<E>(null)
  const inner = options.inner === true
  useLayoutEffect(() => {
    const node = ref.current
    const parent = node?.parentNode ?? null
    return () => {
      if (node !== null && parent !== null) leave(node, parent, exit, inner)
    }
  }, [exit, inner])
  return ref as RefObject<E>
}

/**
 * 卸掉时留个影子放退场的一块（轻提示、提示条）：调用方照常按条件挂、按 key 换，不用等动画。
 * 动的是里面那一层——外面这层常带着居中用的 `translateX(-50%)`，两个 transform 不打架。
 * 换了一条（key 变了）时旧的影子往外走、新的照常浮进来，两条错开。
 */
export function ExitSeat(props: {
  className: string
  exit: Exit
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useExit<HTMLDivElement>(props.exit, { inner: true })
  return (
    <div ref={ref} className={props.className}>
      {props.children}
    </div>
  )
}

const VANISH_MS = 200

/**
 * 画布上删掉的步骤、资源、连线：留个影子原地退场（步骤卡缩小淡出，连线和线上的小牌子淡出），不是一下没了。
 *
 * 只在"同一份文档里少了几个 id"时放（`loadKey` 没变）：换工作流、换实例时整张图换掉，不放。
 * React Flow 删 DOM 的时机由它自己定（可能晚一次提交），所以这里先记下哪些 id 没了，
 * 再用 MutationObserver 等那些元素真的被摘掉，照它们最后的样子复制影子放回原处。
 *
 * 认元素：节点外壳、连线 `<g>` 上的 `data-id`（React Flow 加的），线上小牌子写 `data-vanish`。
 */
export function useCanvasExits(
  root: RefObject<HTMLElement | null>,
  loadKey: string,
  ids: readonly string[],
): void {
  const last = useRef<{ loadKey: string; ids: Set<string> } | null>(null)
  const armed = useRef<{ ids: Set<string>; until: number } | null>(null)
  useLayoutEffect(() => {
    const now = new Set(ids)
    const was = last.current
    last.current = { loadKey, ids: now }
    if (was === null || was.loadKey !== loadKey) return
    const gone = [...was.ids].filter((id) => !now.has(id))
    if (gone.length > 0) armed.current = { ids: new Set(gone), until: performance.now() + 500 }
  }, [loadKey, ids])
  useEffect(() => {
    const host = root.current
    if (host === null) return
    const watch = new MutationObserver((records) => {
      const arm = armed.current
      if (arm === null) return
      if (performance.now() > arm.until) {
        armed.current = null
        return
      }
      if (REDUCED?.matches === true) return
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof Element) || node.isConnected || leaving.has(node)) continue
          const id =
            node.getAttribute('data-id') ??
            node.getAttribute('data-vanish') ??
            node.querySelector(':scope > [data-id]')?.getAttribute('data-id') ??
            null
          if (id === null || !arm.ids.has(id)) continue
          vanish(node, record.target, record.nextSibling)
        }
      }
    })
    watch.observe(host, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [root])
}

/** 照摘掉的元素复制一份放回原处（还在原来的兄弟之间），放退场，放完删。 */
function vanish(node: Element, parent: Node, before: Node | null): void {
  const ghost = ghostClone(node as HTMLElement)
  ghost.node.removeAttribute('data-id')
  ghost.node.removeAttribute('data-vanish')
  leaving.add(ghost.node)
  ghost.place(parent)
  if (before !== null && before.parentNode === parent) parent.insertBefore(ghost.node, before)
  // 节点外壳带着定位用的 translate：缩放放在里面那张卡上。
  const card = node.classList.contains('react-flow__node')
    ? (ghost.node.firstElementChild ?? ghost.node)
    : null
  const out =
    card === null
      ? ghost.node.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: VANISH_MS,
          easing: 'linear',
          fill: 'forwards',
        })
      : fadeAway(card, { opacity: 1, transform: 'none' }, 'scale(0.92)', VANISH_MS)
  const drop = (): void => ghost.node.remove()
  out.finished.then(drop, drop)
}

/** 药丸变宽 / 变窄的时长；变窄前先等一会（名字换了、状态字换了，别马上缩，等视线落稳再收）。 */
const GLIDE_GROW_MS = 280
const GLIDE_SHRINK_MS = 340
const GLIDE_HOLD_MS = 260

/**
 * 宽度随内容变的药丸（顶栏左边：名字、状态字一换，宽度就变）：不让宽度跳，只靠 transform 展开收缩。
 * 药丸里放一块 `data-glide-surface`（绝对定位铺满、左边为原点的底面：边框、底色、阴影都画在它上面），
 * 以及要跟着挪的 `data-glide` 小件（被挤到新位置的图标、状态按钮）：
 * 宽度一变，底面从旧宽度 `scaleX` 过渡到新宽度，小件从旧位置 `translateX` 滑到新位置；
 * 变宽立刻展开，变窄先停 `hold`（默认 {@link GLIDE_HOLD_MS}）毫秒再收；宽度是被布局挤变的、
 * 没有"等视线落稳"的需要时传 0（缩放条：右面板一开图例就收成按钮）。上一段还没放完就变了，从看上去的地方接着走。
 * 返回回调 ref，挂到药丸上。
 */
export function useGlide(hold: number = GLIDE_HOLD_MS): (pill: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  return useCallback(
    (pill: HTMLElement | null) => {
      stop.current?.()
      stop.current = null
      if (pill === null || typeof ResizeObserver === 'undefined') return
      let width = pill.offsetWidth
      /** 各小件上次落定的位置（相对药丸左边）。 */
      let spots = new Map<HTMLElement, number>()
      const running = new Map<HTMLElement, Animation>()
      const surface = (): HTMLElement | null => pill.querySelector('[data-glide-surface]')
      const items = (): HTMLElement[] => [...pill.querySelectorAll<HTMLElement>('[data-glide]')]
      const leftOf = (el: HTMLElement, origin: number): number =>
        el.getBoundingClientRect().left - origin
      const remember = (): void => {
        const origin = pill.getBoundingClientRect().left
        spots = new Map(items().map((el) => [el, leftOf(el, origin)]))
      }
      remember()

      const sizes = new ResizeObserver(() => {
        const next = pill.offsetWidth
        if (next === width) return
        const was = width
        width = next
        const base = surface()
        if (REDUCED?.matches === true || base === null) {
          remember()
          return
        }
        const origin = pill.getBoundingClientRect().left
        // 先读旧动画此刻的位移 / 缩放，再清掉它。起点是「旧布局 + 此刻的位移」：
        // 布局已经是新的了，直接量元素现在的位置会把新布局也算进去（宽度会被放大）。
        const shift = (el: HTMLElement): number =>
          running.has(el) ? new DOMMatrixReadOnly(getComputedStyle(el).transform).m41 : 0
        const seen = new Map<HTMLElement, number>()
        for (const el of items()) {
          const before = spots.get(el)
          if (before !== undefined) seen.set(el, before + shift(el))
        }
        const seenWidth = running.has(base)
          ? new DOMMatrixReadOnly(getComputedStyle(base).transform).a * was
          : was
        for (const anim of running.values()) anim.cancel()
        running.clear()

        const shrink = seenWidth > next
        const timing = {
          duration: shrink ? GLIDE_SHRINK_MS : GLIDE_GROW_MS,
          delay: shrink ? hold : 0,
          easing: EASE,
          fill: 'backwards' as const,
        }
        if (Math.abs(seenWidth / next - 1) > 0.002) {
          running.set(
            base,
            base.animate(
              [{ transform: `scaleX(${seenWidth / next})` }, { transform: 'none' }],
              timing,
            ),
          )
        }
        const fresh = new Map<HTMLElement, number>()
        for (const el of items()) {
          const now = leftOf(el, origin)
          fresh.set(el, now)
          const from = seen.get(el) ?? spots.get(el)
          if (from === undefined || Math.abs(from - now) < 0.5) continue
          running.set(
            el,
            el.animate(
              [{ transform: `translateX(${from - now}px)` }, { transform: 'none' }],
              timing,
            ),
          )
        }
        spots = fresh
        for (const [el, anim] of running) {
          const forget = (): void => {
            if (running.get(el) === anim) running.delete(el)
          }
          anim.finished.then(forget, forget)
        }
      })
      sizes.observe(pill)
      stop.current = () => {
        sizes.disconnect()
        for (const anim of running.values()) anim.cancel()
      }
    },
    [hold],
  )
}

/**
 * 画布这一整块要被卸掉时（模板编辑 ↔ 实例视图）：留一个影子在原处淡出，新画布同时淡入，两边交叉过去。
 * 影子放进视图根（`data-workflow-lite-view`），不放在父节点里——实例视图的外壳跟着一起卸掉，放里面就看不到了。
 */
export function useViewGhost(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    const root = el?.closest('[data-workflow-lite-view]') ?? null
    return () => {
      // 视图还藏着（第一次加载、没人看见）时从模板换成实例：不留影子，否则淡入时模板的残影会叠在实例上。
      const hidden = root instanceof HTMLElement && root.dataset.booting === 'true'
      if (el !== null && !hidden) ghostFade(el, root)
    }
  }, [ref])
}

/** 折叠区展开 / 收起的时长（和 ui.module.css 的 `.presence` 过渡一致；也是 transitionend 没来时的兜底）。 */
const PRESENCE_MS = 260

/**
 * 可以出现、也可以消失的一块（折叠区、行内的提示条 / 错误条）：
 * - 出现：高度从 0 长开、同时淡入，下面的内容被顺势推下去；
 * - 消失：高度收回 0、同时淡出，下面的内容顺势滑上来，再把它卸掉——不是「啪」地一下没了、下面的跳上来。
 * 走的是 CSS 过渡，不是关键帧：收到一半又要展开，从当前高度接着往回长，不是从 0 重来（iOS / macOS 的动画随时能反向）。
 * 第一次挂上时就是开着的不放动画（刷新页面不该看到所有折叠区重新展开一遍）。
 *
 * `show` 为假时，内容保留最后一次的样子放完退场动画，所以调用方照常写 `{cond && <X value={v} />}` 也行：
 * 把条件放进 `show`，把内容放进 children（`show` 为假时 children 可以是假值）。
 * 高度走 `grid-template-rows: 0fr ↔ 1fr`（布局属性，是「只动 transform / opacity」的例外）：折叠区不知道自己多高，
 * 这是不量高度就能从 0 长到内容那么高的办法；只在动的这段时间里动，内容区同时 `overflow: hidden`，平时不裁（阴影、焦点环照常画出来）。
 */
export function Presence(props: {
  show: boolean
  children: ReactNode
  className?: string
}): React.JSX.Element | null {
  const { show } = props
  const still = REDUCED?.matches === true
  const ref = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(show)
  const [open, setOpen] = useState(show)
  const [moving, setMoving] = useState(false)
  const last = useRef<ReactNode>(props.children)
  if (show) last.current = props.children
  if (still) {
    if (show !== mounted) setMounted(show)
    if (show !== open) setOpen(show)
  } else if (show && !mounted) {
    setMounted(true)
  }
  useLayoutEffect(() => {
    if (still || !mounted || show === open) return
    // 新挂上的先以「关着」的样子渲染一帧，量一下版面把这个起点定住，再翻成开着，过渡才有地方起步。
    void ref.current?.offsetHeight
    setOpen(show)
    setMoving(true)
  }, [still, mounted, show, open])
  useEffect(() => {
    if (!moving) return
    const id = window.setTimeout(() => settle(), PRESENCE_MS + 80)
    return () => window.clearTimeout(id)
    // open 翻面（收到一半又展开）时重新计时
  }, [moving, open])
  const showRef = useRef(show)
  showRef.current = show
  function settle(): void {
    setMoving(false)
    if (!showRef.current) setMounted(false)
  }
  if (!mounted) return null
  return (
    <div
      ref={ref}
      className={cx(css.presence, props.className)}
      data-open={open}
      data-moving={moving ? true : undefined}
      aria-hidden={show ? undefined : true}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'grid-template-rows') {
          settle()
        }
      }}
    >
      <div className={css.presenceInner}>{show ? props.children : last.current}</div>
    </div>
  )
}

/** CSS 时间（`240ms` 或压缩后的 `.24s`）转毫秒；读不出来用 `fallback`。 */
function cssMs(value: string, fallback: number): number {
  const number = Number.parseFloat(value)
  if (Number.isNaN(number)) return fallback
  return value.trim().endsWith('ms') ? number : number * 1000
}

/**
 * 底线输入框（`ui.module.css` 的 `.lineField`）被卸掉时，线缩回左边：改名这类输入框一提交就整块换回文字，
 * 框里的线没机会走完 CSS 的收回。这里在卸掉的那一刻（DOM 还在）读一下线此刻伸出多长，
 * 在视图根里放一根一样的线（影子），从那个长度缩回左边再删掉；字已经换回去了，线是唯一留着的东西。
 * 线本来就没伸出来（缩到 0）、开了「减少动态效果」、找不到视图根时什么也不放。
 * 返回要挂到 `.lineField` 外层的 ref。
 */
export function useLineExit(): RefObject<HTMLSpanElement> {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const field = ref.current
    return () => {
      if (field === null || REDUCED?.matches === true || !field.isConnected) return
      const root = field.closest<HTMLElement>('[data-workflow-lite-view]')
      if (root === null) return
      const bar = getComputedStyle(field, '::after')
      const scale = new DOMMatrixReadOnly(bar.transform).a
      if (!(scale > 0.02)) return
      const at = field.getBoundingClientRect()
      const base = root.getBoundingClientRect()
      const height = Number.parseFloat(bar.height)
      const gap = Number.parseFloat(bar.bottom)
      const ghost = document.createElement('div')
      ghost.setAttribute('aria-hidden', 'true')
      Object.assign(ghost.style, {
        position: 'absolute',
        zIndex: '9999',
        left: `${at.left - base.left + Number.parseFloat(bar.left)}px`,
        top: `${at.bottom - base.top + gap * -1 - height}px`,
        width: `${Math.max(0, at.width - Number.parseFloat(bar.left) - Number.parseFloat(bar.right))}px`,
        height: `${height}px`,
        borderRadius: bar.borderRadius,
        background: bar.backgroundColor,
        pointerEvents: 'none',
        transformOrigin: 'left center',
      })
      root.appendChild(ghost)
      const out = ghost.animate([{ transform: `scaleX(${scale})` }, { transform: 'scaleX(0)' }], {
        // 时长、缓动读 `.lineField` 上的同一份变量，和线伸出、缩回的 CSS 不会走样。
        duration: cssMs(getComputedStyle(field).getPropertyValue('--line-ms'), 240),
        easing: getComputedStyle(field).getPropertyValue('--wl-ease-out') || 'ease-out',
        fill: 'forwards',
      })
      const drop = (): void => ghost.remove()
      out.addEventListener('finish', drop)
      out.addEventListener('cancel', drop)
    }
  }, [])
  return ref
}
