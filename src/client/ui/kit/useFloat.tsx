/**
 * dsh-workflow-lite — 悬停浮层的状态与摆位（「?」说明、画布连线上的交接卡片共用）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/useFloat
 */

import { type RefObject, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ModalHost } from './Modal.tsx'

/** 浮层与触发器之间的间距。 */
const FLOAT_GAP = 6
/** 浮层退场动画的时长（和 ui.module.css 的 floatOut 一致）。 */
export const FLOAT_EXIT_MS = 120

export type FloatState = 'off' | 'hover' | 'pinned'

/**
 * 悬停浮层的状态与摆位（「?」说明、画布连线上的交接卡片共用）。
 *
 * - 浮层挂到视图根（和模态框同一个挂载点）：不被滚动区裁掉，也不会把滚动区撑出滚动条；
 *   画布缩放时字号也不跟着变小。
 * - 鼠标可以从触发器移进浮层：离开触发器后稍等一下再收，进了浮层就不收；浮层接住指针，
 *   里面的文字能选中复制，点击不会穿透到后面。
 * - 在触发器与浮层之外按下指针、滚动、滚轮缩放画布都收起；Esc 只收浮层。
 * - 先按"触发器正下方、左边对齐"放（`align: 'end'` 右边对齐；`'auto'` 触发器在视图右半边就右对齐），
 *   量出高度后下面放不下就翻到上方，左右夹在视图里；上下都放不下就往回挪进视图，比视图还高才限高、里面滚。
 * - 里面的内容变高变矮时跟着重量一次：不换边，只在要越出视图时往回挪。
 */
export function useFloat<A extends HTMLElement>(options: {
  openMs: number
  closeMs: number
  width: number
  align?: 'start' | 'end' | 'auto'
  /** 与触发器的间距，缺省 6。 */
  gap?: number
  /**
   * 收起时留多久放退场动画（浮层带 `data-leaving="true"`、不接指针、不带 testId，样式自己写淡出）。
   * 缺省 0：立刻拿掉。
   */
  exitMs?: number
  /**
   * 摆在这个元素旁边，而不是触发器下面：优先左边、放不下放右边，上沿和它对齐（夹在视图里）。
   * 画布上的卡片用：浮层不盖住卡片，卡片往右下长大也碰不到它。
   */
  beside?: RefObject<HTMLElement | null>
  /**
   * 摆在旁边时上沿和谁对齐：缺省和那个元素（画布卡片）；`'anchor'` 和触发器——
   * 右栏里的设置摆在整条栏的左边，但和「调整」那一行齐平。
   */
  besideTop?: 'beside' | 'anchor'
}): {
  state: FloatState
  setState: (next: FloatState | ((current: FloatState) => FloatState)) => void
  anchorRef: RefObject<A>
  panelRef: RefObject<HTMLDivElement>
  /** 取消还没生效的悬停开 / 关。 */
  cancel: () => void
  /** 悬停触发：挂到触发器上。 */
  hoverProps: { onPointerEnter: () => void; onPointerLeave: () => void }
  onKeyDown: (event: React.KeyboardEvent) => void
  /** 把浮层内容包一层定位壳，挂到视图根。 */
  render: (props: {
    className: string
    testId?: string | undefined
    label?: string
    /** 默认 `tooltip`；二次确认这类要操作的浮层用 `alertdialog`，挑一项的用 `menu`。 */
    role?: 'tooltip' | 'alertdialog' | 'dialog' | 'menu'
    children: React.ReactNode
  }) => React.ReactNode
} {
  const host = useContext(ModalHost)
  const anchorRef = useRef<A>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<FloatState>('off')
  const [place, setPlace] = useState<{
    left: number
    top: number
    up: boolean
    /** 摆在旁边（`beside`）时在哪一边：入场从那张卡的方向出来。 */
    side?: 'left' | 'right'
    /** 比整个视图还高时才有：限高、里面滚。 */
    maxHeight?: number
  } | null>(null)
  const timer = useRef(0)
  const {
    openMs,
    closeMs,
    width,
    align = 'start',
    gap = FLOAT_GAP,
    exitMs = 0,
    beside,
    besideTop = 'beside',
  } = options
  /**
   * 浮层还挂着吗：打开时挂上；收起后再挂 `exitMs` 放退场动画。
   * 「上一次的 state」在渲染时就比（不等 effect）：收起的那一次渲染里浮层就带着 `data-leaving` 留在原处，
   * 不会先卸掉、下一刻再挂一个新的——新挂的浮层里各项的入场动画会重放一遍，收起时就闪一下。
   * 每打开一次换一个键：收到一半又打开时，浮层重新入场。
   */
  const [mounted, setMounted] = useState(false)
  const [round, setRound] = useState(0)
  const [prevState, setPrevState] = useState<FloatState>(state)
  if (prevState !== state) {
    setPrevState(state)
    if (prevState === 'off') setRound((n) => n + 1)
  }
  if (state !== 'off' && !mounted) setMounted(true)
  if (state === 'off' && mounted && exitMs === 0) setMounted(false)
  const leaving = state === 'off' && mounted

  const cancel = (): void => window.clearTimeout(timer.current)
  const later = (next: 'off' | 'hover', ms: number): void => {
    cancel()
    timer.current = window.setTimeout(() => setState(next), ms)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  useEffect(() => {
    if (!leaving) return
    const id = window.setTimeout(() => {
      setMounted(false)
      setPlace(null)
    }, exitMs)
    return () => window.clearTimeout(id)
  }, [leaving, exitMs])

  useLayoutEffect(() => {
    if (state === 'off') {
      // 放退场动画的那一会儿还停在原处。
      if (exitMs === 0) setPlace(null)
      return
    }
    const root = host ?? document.body
    /**
     * `again`：已经摆好、只是里面的内容变高变矮了（换了一种展示，选项多了几行）。
     * 左右、上下哪一边都不换，只在要越出视图时往回挪——指针下的那一项尽量不动。
     */
    const measure = (again: boolean): void => {
      const anchor = anchorRef.current
      if (anchor === null) return
      const panel = panelRef.current
      const box = anchor.getBoundingClientRect()
      const area = root.getBoundingClientRect()
      // 限了高也按内容的高算（滚动高度加上下边框）。
      const height =
        panel === null ? 0 : panel.scrollHeight + panel.offsetHeight - panel.clientHeight
      const tall = height > area.height - 16
      const inView = (top: number): number =>
        tall ? 8 : Math.max(8, Math.min(top, area.height - height - 8))
      const maxHeight = tall ? area.height - 16 : undefined
      const aboveTop = box.top - area.top - gap - height
      if (again) {
        setPlace((current) =>
          current === null
            ? current
            : { ...current, top: inView(current.up ? aboveTop : current.top), maxHeight },
        )
        return
      }
      const next = beside?.current
      if (next !== undefined && next !== null) {
        const card = next.getBoundingClientRect()
        const room = card.left - area.left - gap * 2
        const left =
          room >= width ? card.left - area.left - gap * 2 - width : card.right - area.left + gap * 2
        setPlace({
          left: Math.max(8, Math.min(left, area.width - width - 8)),
          top: inView((besideTop === 'anchor' ? box.top : card.top) - area.top),
          up: false,
          side: room >= width ? 'left' : 'right',
          maxHeight,
        })
        return
      }
      const end =
        align === 'end' ||
        (align === 'auto' && box.left + box.width / 2 - area.left > area.width / 2)
      const wanted = end ? box.right - area.left - width : box.left - area.left - 8
      const left = Math.max(8, Math.min(wanted, area.width - width - 8))
      const below = box.bottom - area.top + gap
      const up = below + height > area.height - 8 && aboveTop > 8
      // 上下都放不下：贴着视图下沿往上挪（盖住触发器也比被裁掉强）。
      setPlace({ left, top: up ? aboveTop : inView(below), up, maxHeight })
    }
    measure(false)
    const content = panelRef.current?.firstElementChild
    const observer =
      content == null || typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => measure(true))
    if (content != null) observer?.observe(content)
    const onResize = (): void => measure(false)
    window.addEventListener('resize', onResize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', onResize)
    }
  }, [state, host, width, align, gap, beside, besideTop])

  useEffect(() => {
    if (state === 'off') return
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (anchorRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)
    const onAway = (event: Event): void => {
      if (!inside(event.target)) setState('off')
    }
    // 滚动只在挪动了触发器（或它旁边那张卡）时才收：别处自己滚（日志卡停在末尾、跟着新内容往下拉）不算。
    const onScroll = (event: Event): void => {
      const target = event.target
      const moved = (element: HTMLElement | null | undefined): boolean =>
        element != null && target instanceof Node && target.contains(element)
      if (inside(target)) return
      if (moved(anchorRef.current) || moved(beside?.current)) setState('off')
    }
    document.addEventListener('pointerdown', onAway, true)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('wheel', onAway, true)
    return () => {
      document.removeEventListener('pointerdown', onAway, true)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('wheel', onAway, true)
    }
  }, [state, beside])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || state === 'off') return
    // 只收浮层，不连带关掉外面的对话框、也不取消画布上的选中。
    event.stopPropagation()
    setState('off')
    anchorRef.current?.focus()
  }

  const hoverProps = {
    onPointerEnter: () => {
      if (state === 'off') later('hover', openMs)
      else cancel()
    },
    onPointerLeave: () => {
      if (state === 'hover') later('off', closeMs)
      else if (state === 'off') cancel()
    },
  }

  const render: ReturnType<typeof useFloat>['render'] = (props) => {
    const gone = state === 'off'
    if (gone && !leaving) return null
    const panel = (
      // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role 由调用方给（tooltip / alertdialog / menu），几种都支持 aria-label
      <div
        key={round}
        ref={gone ? undefined : panelRef}
        className={props.className}
        role={props.role ?? 'tooltip'}
        aria-label={props.label}
        aria-hidden={gone ? true : undefined}
        // 可聚焦（不进 Tab 序）：在浮层里点一下选文字时，焦点移进来而不是丢掉。
        tabIndex={-1}
        data-up={place?.up === true}
        data-side={place?.side}
        data-leaving={gone ? true : undefined}
        data-testid={gone ? undefined : props.testId}
        style={{
          left: place?.left ?? 0,
          top: place?.top ?? 0,
          width,
          ...(place?.maxHeight === undefined
            ? {}
            : { maxHeight: place.maxHeight, overflowY: 'auto' as const }),
          // 第一帧还没量好位置：先藏着量高度，摆好了再出现（避免闪一下）。
          visibility: place === null ? 'hidden' : 'visible',
        }}
        onPointerEnter={cancel}
        onPointerLeave={() => {
          if (state === 'hover') later('off', closeMs)
        }}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    )
    return host === null ? panel : createPortal(panel, host)
  }

  return { state, setState, anchorRef, panelRef, cancel, hoverProps, onKeyDown, render }
}
