/**
 * dsh-workflow-lite — 小件：类名拼接、点外面关闭、分段选择、浮层。
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
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(props.open, ref, props.onClose)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 只在这一层消化浮层内冒上来的 Esc
    <div
      className={ui.anchor}
      ref={ref}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !props.open) return
        event.stopPropagation()
        props.onClose()
      }}
    >
      {props.trigger}
      {props.open && (
        <div
          className={cx(
            ui.popover,
            props.align === 'end' && ui.popoverEnd,
            props.up === true && ui.popoverUp,
            props.className,
          )}
          role="dialog"
          aria-label={props.label}
        >
          {props.children}
        </div>
      )}
    </div>
  )
}

/** 分段选择（单选）。选中格下面那块滑块靠 `transform` 滑过去。 */
export function Segmented<V extends string>(props: {
  label: string
  value: V
  /** `color`：选项前的小色点（比如条件的四种线色），和画布上对应的东西同色。 */
  options: readonly { value: V; label: string; color?: string }[]
  onChange: (value: V) => void
}): React.JSX.Element {
  const index = Math.max(
    0,
    props.options.findIndex((option) => option.value === props.value),
  )
  return (
    <div className={ui.seg} role="radiogroup" aria-label={props.label}>
      <span
        className={ui.segThumb}
        style={{
          width: `calc((100% - 4px) / ${props.options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          className={ui.segItem}
          onClick={() => props.onChange(option.value)}
        >
          {option.color !== undefined && (
            <span className={ui.segDot} style={{ background: option.color }} />
          )}
          {option.label}
        </button>
      ))}
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

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    if (dialog !== null && !dialog.contains(document.activeElement)) dialog.focus()
    return () => {
      if (opener?.isConnected === true) opener.focus({ preventScroll: true })
    }
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    event.stopPropagation()
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
      className={cx(overlay.scrim, ui.fade)}
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

/** 浮层与触发器之间的间距。 */
const FLOAT_GAP = 6

export type FloatState = 'off' | 'hover' | 'pinned'

/**
 * 悬停浮层的状态与摆位（「?」说明、画布连线上的交接卡片共用）。
 *
 * - 浮层挂到视图根（和模态框同一个挂载点）：不被滚动区裁掉，也不会把滚动区撑出滚动条；
 *   画布缩放时字号也不跟着变小。
 * - 鼠标可以从触发器移进浮层：离开触发器后稍等一下再收，进了浮层就不收；浮层接住指针，
 *   里面的文字能选中复制，点击不会穿透到后面。
 * - 在触发器与浮层之外按下指针、滚动、滚轮缩放画布都收起；Esc 只收浮层。
 * - 先按"触发器正下方、左边对齐"放，量出高度后下面放不下就翻到上方，左右夹在视图里。
 */
export function useFloat<A extends HTMLElement>(options: {
  openMs: number
  closeMs: number
  width: number
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
    children: React.ReactNode
  }) => React.ReactNode
} {
  const host = useContext(ModalHost)
  const anchorRef = useRef<A>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<FloatState>('off')
  const [place, setPlace] = useState<{ left: number; top: number; up: boolean } | null>(null)
  const timer = useRef(0)
  const { openMs, closeMs, width } = options

  const cancel = (): void => window.clearTimeout(timer.current)
  const later = (next: 'off' | 'hover', ms: number): void => {
    cancel()
    timer.current = window.setTimeout(() => setState(next), ms)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  useLayoutEffect(() => {
    if (state === 'off') {
      setPlace(null)
      return
    }
    const anchor = anchorRef.current
    const root = host ?? document.body
    if (anchor === null) return
    const box = anchor.getBoundingClientRect()
    const area = root.getBoundingClientRect()
    const height = panelRef.current?.offsetHeight ?? 0
    const left = Math.max(8, Math.min(box.left - area.left - 8, area.width - width - 8))
    const below = box.bottom - area.top + FLOAT_GAP
    const up = below + height > area.height - 8 && box.top - area.top - FLOAT_GAP - height > 8
    setPlace({ left, top: up ? box.top - area.top - FLOAT_GAP - height : below, up })
  }, [state, host, width])

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
    if (state === 'off') return null
    const panel = (
      <div
        ref={panelRef}
        className={props.className}
        role="tooltip"
        aria-label={props.label}
        // 可聚焦（不进 Tab 序）：在浮层里点一下选文字时，焦点移进来而不是丢掉。
        tabIndex={-1}
        data-up={place?.up === true}
        data-testid={props.testId}
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
