/**
 * dsh-workflow-lite — 小件：类名拼接、点外面关闭、浮层（分段选择在 Segmented.tsx）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/primitives
 */

import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import overlay from './overlay.module.css'
import ui from './ui.module.css'

/** 拼类名，跳过假值。 */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter((name) => typeof name === 'string' && name !== '').join(' ')
}

/**
 * 在 `ref` 之外按下指针就关掉。
 *
 * 监听挂在 `document` 的**捕获**阶段：React Flow 会在自己的按下处理里拦截冒泡，
 * 冒泡阶段的监听收不到"点在画布上"这一下。
 */
export function useDismiss(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const element = ref.current
      if (element === null || !(event.target instanceof Node)) return
      if (!element.contains(event.target)) close.current()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [open, ref])
}

/**
 * 触发器 + 浮层。浮层不走 portal：留在视图根的子树里，设计令牌照常继承。
 * `Esc` 在这里消化掉（不再冒到视图根去取消画布上的选中）。
 *
 * `hold`：浮层里正有一件事没做完（行内改名、挂在某一行上的确认卡）——点外面先只结束那件事，
 * 浮层留着，再点一下才收。浮层本身可聚焦（不进 Tab 序）：里面的按钮跟着一行被删掉时焦点有处可去，
 * Esc 照样能收起。
 */
export function Popover(props: {
  open: boolean
  onClose: () => void
  trigger: React.ReactNode
  children: React.ReactNode
  align?: 'start' | 'end'
  up?: boolean
  className?: string
  label: string
  hold?: boolean
  /** 鼠标从触发器和浮层上整个移开（离开两者合起来的范围）。 */
  onLeave?: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(props.open && props.hold !== true, ref, props.onClose)
  // 收起后再挂一会儿放退场动画（同 useFloat：在渲染时就判断，不先卸掉再挂一个新的）。
  const [mounted, setMounted] = useState(false)
  const [round, setRound] = useState(0)
  const [wasOpen, setWasOpen] = useState(props.open)
  if (wasOpen !== props.open) {
    setWasOpen(props.open)
    if (props.open) setRound((n) => n + 1)
  }
  if (props.open && !mounted) setMounted(true)
  const leaving = !props.open && mounted
  useEffect(() => {
    if (!leaving) return
    const id = window.setTimeout(() => setMounted(false), FLOAT_EXIT_MS)
    return () => window.clearTimeout(id)
  }, [leaving])
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 只在这一层消化浮层内冒上来的 Esc
    <div
      className={ui.anchor}
      ref={ref}
      onPointerLeave={(event) => {
        if (props.open && event.pointerType === 'mouse') props.onLeave?.()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !props.open) return
        event.stopPropagation()
        props.onClose()
      }}
    >
      {props.trigger}
      {(props.open || leaving) && (
        <div
          key={round}
          className={cx(
            ui.popover,
            props.align === 'end' && ui.popoverEnd,
            props.up === true && ui.popoverUp,
            props.className,
          )}
          role="dialog"
          aria-label={props.label}
          aria-hidden={leaving ? true : undefined}
          data-leaving={leaving ? true : undefined}
          tabIndex={-1}
        >
          {props.children}
        </div>
      )}
    </div>
  )
}

/**
 * 模态框挂到哪里：视图根节点。
 *
 * 面板里打开的模态框不能就地渲染——面板自己带着入场动画（`transform`），会变成里面
 * `position: absolute` 的定位参照，遮罩就只盖住面板那一条。挂回视图根，遮罩盖住整个视图，
 * 设计令牌照常继承，也不会跑出视图去盖宿主页面。
 */
const ModalHost = createContext<HTMLElement | null>(null)
export const ModalHostProvider = ModalHost.Provider

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

/**
 * 模态框：遮罩 + 居中的一张卡。
 *
 * - 键盘事件一律在这里截住：React 的合成事件会顺着组件树（而不是 DOM 树）冒泡，不截的话
 *   在模态框里按 Delete / Esc 会冒到视图根，删掉画布上选中的步骤。
 * - Esc 与点遮罩都走 `onDismiss`；调用方据此决定"有没写完的改动时不关"。
 * - 只有按下与松开都落在遮罩上才算点遮罩：在输入框里拖选文字、松手落在外面，不该把框关掉。
 * - Tab 在框内循环；关掉后焦点还给打开它的那个按钮。
 */
export function Modal(props: {
  label: string
  onDismiss(): void
  children: React.ReactNode
  className?: string
  testId?: string
}): React.JSX.Element {
  const host = useContext(ModalHost)
  const ref = useRef<HTMLDivElement>(null)
  const downOnScrim = useRef(false)
  const scrimRef = useRef<HTMLDivElement>(null)
  useSheetMotion(scrimRef, ref)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    if (dialog !== null && !dialog.contains(document.activeElement)) dialog.focus()
    return () => {
      if (opener?.isConnected === true) opener.focus({ preventScroll: true })
    }
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // Ctrl / ⌘ + S 留给打开它的那块（「我的步骤」在弹窗里改提示词时照样能存）。
    const save = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's'
    if (!save) event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onDismiss()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const first = items[0]
    const last = items[items.length - 1]
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const tree = (
    <div
      ref={scrimRef}
      className={overlay.scrim}
      onPointerDown={(event) => {
        downOnScrim.current = event.target === event.currentTarget
      }}
      onPointerUp={(event) => {
        if (downOnScrim.current && event.target === event.currentTarget) props.onDismiss()
        downOnScrim.current = false
      }}
    >
      <div
        ref={ref}
        className={cx(ui.panel, overlay.sheet, props.className)}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabIndex={-1}
        data-testid={props.testId}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    </div>
  )
  return host === null ? tree : createPortal(tree, host)
}

/** 模态框关掉时淡出的时长。 */
const MODAL_EXIT_MS = 320
const REDUCED_MOTION = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null

/** 触发弹窗的那个控件的位置和大小（视口坐标）。 */
interface Source {
  x: number
  y: number
  w: number
  h: number
}

/** 最近一次按下指针：落在哪个控件上（记下当时的矩形——点完菜单会收起，之后就量不到了）。 */
let lastPress: { box: Source; at: number } | null = null
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target instanceof Element ? event.target : null
      const control =
        target?.closest('button, a, [role="button"], [role="menuitem"], [role="option"]') ?? null
      const rect = control?.getBoundingClientRect()
      lastPress =
        rect !== undefined && rect.width > 0 && rect.height > 0
          ? {
              box: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
              at: performance.now(),
            }
          : {
              box: { x: event.clientX - 16, y: event.clientY - 16, w: 32, h: 32 },
              at: performance.now(),
            }
    },
    true,
  )
}

/**
 * 弹窗从哪个控件长出来：刚按下指针（1.5 秒内）取按下的那个控件；不是点开的（键盘打开）取当前焦点所在的元素；
 * 都没有（焦点在 body 上、过了很久才弹出来）返回 `null`，弹窗从自己的中心浮起。
 */
function openSource(): Source | null {
  if (lastPress !== null && performance.now() - lastPress.at < 1500) return lastPress.box
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused !== document.body) {
    const rect = focused.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
    }
  }
  return null
}

/** 弹窗缩进触发控件时的样子：中心对中心，缩到刚好装进控件里（缩放不小于 0.08、不大于 0.5）。 */
function foldedTransform(source: Source, dialog: HTMLElement, scrim: HTMLElement): string {
  const frame = scrim.getBoundingClientRect()
  // offsetLeft / offsetTop / offsetWidth 不受正在放的变换影响（getBoundingClientRect 受）。
  const centerX = frame.left + dialog.offsetLeft + dialog.offsetWidth / 2
  const centerY = frame.top + dialog.offsetTop + dialog.offsetHeight / 2
  const scale = Math.min(
    0.5,
    Math.max(0.08, Math.min(source.w / dialog.offsetWidth, source.h / dialog.offsetHeight)),
  )
  const dx = source.x + source.w / 2 - centerX
  const dy = source.y + source.h / 2 - centerY
  return `translate(${dx}px, ${dy}px) scale(${scale})`
}

/** 入场的弹簧：读视图根的 `--wl-spring` 令牌（老内核上是贝塞尔）。 */
function springOf(element: Element): string {
  return (
    getComputedStyle(element).getPropertyValue('--wl-spring').trim() ||
    'cubic-bezier(0.34, 1.3, 0.64, 1)'
  )
}

/**
 * 弹窗的进出场（模态框、计划对话框共用）——「从点的那个控件里长出来、缩回那个控件里」（iOS 打开 App、macOS 最小化的路数）：
 * - 打开：量出触发控件的位置，弹窗先缩成控件那么小、叠在控件上，再用弹簧放大到位（淡入只在前三成，先看到一小块从控件里冒出来）；
 * - 关掉：留一个"影子"，缩回同一个控件的位置、淡出（见 ghostOut）；调用方直接卸掉弹窗，不用等动画；
 * - 找不到触发控件（过了很久才弹出来、不是点开的）：用样式里的 `dialogIn`，从中心浮起。
 */
export function useSheetMotion(
  scrimRef: RefObject<HTMLElement | null>,
  dialogRef: RefObject<HTMLElement | null>,
): void {
  const folded = useRef<string | null>(null)
  useLayoutEffect(() => {
    const scrim = scrimRef.current
    const parent = scrim?.parentNode ?? null
    return () => {
      if (scrim !== null) ghostOut(scrim, parent, folded.current)
    }
  }, [scrimRef])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const scrim = scrimRef.current
    const source = openSource()
    if (dialog === null || scrim === null || source === null || REDUCED_MOTION?.matches === true) {
      return
    }
    const from = foldedTransform(source, dialog, scrim)
    folded.current = from
    // 样式里那条 dialogIn 让位：这一条是按触发控件量出来的。
    dialog.style.animation = 'none'
    dialog.animate(
      [
        { transform: from, opacity: 0 },
        { opacity: 1, offset: 0.3 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 560, easing: springOf(dialog), fill: 'backwards' },
    )
  }, [scrimRef, dialogRef])
}

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
function ghostOut(node: HTMLElement, parent: Node | null, folded: string | null): void {
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
 *   量出高度后下面放不下就翻到上方，左右夹在视图里。
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
  const [place, setPlace] = useState<{ left: number; top: number; up: boolean } | null>(null)
  const timer = useRef(0)
  const { openMs, closeMs, width, align = 'start', gap = FLOAT_GAP, exitMs = 0 } = options
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
    const anchor = anchorRef.current
    const root = host ?? document.body
    if (anchor === null) return
    const box = anchor.getBoundingClientRect()
    const area = root.getBoundingClientRect()
    const height = panelRef.current?.offsetHeight ?? 0
    const end =
      align === 'end' || (align === 'auto' && box.left + box.width / 2 - area.left > area.width / 2)
    const wanted = end ? box.right - area.left - width : box.left - area.left - 8
    const left = Math.max(8, Math.min(wanted, area.width - width - 8))
    const below = box.bottom - area.top + gap
    const up = below + height > area.height - 8 && box.top - area.top - gap - height > 8
    setPlace({ left, top: up ? box.top - area.top - gap - height : below, up })
  }, [state, host, width, align, gap])

  useEffect(() => {
    if (state === 'off') return
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (anchorRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)
    const onAway = (event: Event): void => {
      if (!inside(event.target)) setState('off')
    }
    document.addEventListener('pointerdown', onAway, true)
    document.addEventListener('scroll', onAway, true)
    document.addEventListener('wheel', onAway, true)
    return () => {
      document.removeEventListener('pointerdown', onAway, true)
      document.removeEventListener('scroll', onAway, true)
      document.removeEventListener('wheel', onAway, true)
    }
  }, [state])

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
        data-leaving={gone ? true : undefined}
        data-testid={gone ? undefined : props.testId}
        style={{
          left: place?.left ?? 0,
          top: place?.top ?? 0,
          width,
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

/** 「?」说明：悬停多久才出来、离开多久才收（留出把鼠标移进浮层的时间）。 */
const HINT_OPEN_MS = 120
const HINT_CLOSE_MS = 220
const HINT_W = 320

/**
 * 「?」说明：平时只占一个小图标，悬停 / 聚焦 / 点击时浮出一段说明（浮层行为见 {@link useFloat}）。
 * 点「?」钉住（触屏也能用），点别处或按 Esc 收起。
 */
export function HelpTip(props: {
  label: string
  children: React.ReactNode
  testId?: string
}): React.JSX.Element {
  const float = useFloat<HTMLButtonElement>({
    openMs: HINT_OPEN_MS,
    closeMs: HINT_CLOSE_MS,
    width: HINT_W,
    exitMs: FLOAT_EXIT_MS,
  })
  const { state, setState } = float
  return (
    <span className={ui.hint}>
      <button
        ref={float.anchorRef}
        type="button"
        className={ui.hintButton}
        aria-label={props.label}
        aria-expanded={state !== 'off'}
        data-open={state !== 'off'}
        data-testid={props.testId}
        {...float.hoverProps}
        onFocus={() => {
          if (state === 'off') setState('hover')
        }}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (
            state === 'hover' &&
            !(next instanceof Node && float.panelRef.current?.contains(next))
          ) {
            setState('off')
          }
        }}
        onClick={() => {
          float.cancel()
          setState((current) => (current === 'pinned' ? 'off' : 'pinned'))
        }}
        onKeyDown={float.onKeyDown}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={1.8} />
          <path
            d="M9.6 9.4a2.5 2.5 0 014.9.6c0 1.7-2.5 2.1-2.5 3.6M12 16.9v.1"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
          />
        </svg>
      </button>
      {float.render({
        className: ui.hintPanel,
        testId: props.testId === undefined ? undefined : `${props.testId}-panel`,
        children: props.children,
      })}
    </span>
  )
}

/** 把一段文字写进剪贴板；环境不允许就安静地失败。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
