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
  options: readonly { value: V; label: string }[]
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

/** 「?」说明的浮层：悬停多久才出来、离开多久才收（留出把鼠标移进浮层的时间）。 */
const HINT_OPEN_MS = 120
const HINT_CLOSE_MS = 220
const HINT_W = 320
const HINT_GAP = 6

/**
 * 「?」说明：平时只占一个小图标，悬停 / 聚焦 / 点击时浮出一段说明。
 *
 * - 浮层挂到视图根（和模态框同一个挂载点），不在对话框的滚动区里：既不会被裁掉，
 *   也不会因为一块看不见的浮层把滚动区撑出滚动条。
 * - 鼠标可以从「?」移进浮层：离开图标后稍等一下再收，进了浮层就不收；浮层接住指针，
 *   里面的文字能选中复制，点击不会穿透到后面。
 * - 点「?」钉住（触屏也能用），点别处或按 Esc 收起。下面放不下时自动弹到上方。
 */
export function HelpTip(props: {
  label: string
  children: React.ReactNode
  testId?: string
}): React.JSX.Element {
  const host = useContext(ModalHost)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<'off' | 'hover' | 'pinned'>('off')
  const [place, setPlace] = useState<{ left: number; top: number; up: boolean } | null>(null)
  const timer = useRef(0)

  const cancel = (): void => window.clearTimeout(timer.current)
  const later = (next: 'off' | 'hover', ms: number): void => {
    cancel()
    timer.current = window.setTimeout(() => setOpen(next), ms)
  }
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // 摆位置：先按"图标正下方、左边对齐"放，量出浮层高度后，下面放不下就翻到上方。
  useLayoutEffect(() => {
    if (open === 'off') {
      setPlace(null)
      return
    }
    const button = buttonRef.current
    const root = host ?? document.body
    if (button === null) return
    const box = button.getBoundingClientRect()
    const area = root.getBoundingClientRect()
    const height = panelRef.current?.offsetHeight ?? 0
    const left = Math.max(8, Math.min(box.left - area.left - 8, area.width - HINT_W - 8))
    const below = box.bottom - area.top + HINT_GAP
    const up = below + height > area.height - 8 && box.top - area.top - HINT_GAP - height > 8
    setPlace({ left, top: up ? box.top - area.top - HINT_GAP - height : below, up })
  }, [open, host])

  // 打开时：在图标与浮层之外按下指针、滚动、按 Esc 都收起。
  useEffect(() => {
    if (open === 'off') return
    const inside = (target: EventTarget | null): boolean =>
      target instanceof Node &&
      (buttonRef.current?.contains(target) === true || panelRef.current?.contains(target) === true)
    const onDown = (event: PointerEvent): void => {
      if (!inside(event.target)) setOpen('off')
    }
    const onScroll = (event: Event): void => {
      if (!inside(event.target)) setOpen('off')
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'Escape' || open === 'off') return
    // 只收浮层，不连带关掉外面的对话框。
    event.stopPropagation()
    setOpen('off')
    buttonRef.current?.focus()
  }

  const panel =
    open === 'off' ? null : (
      <div
        ref={panelRef}
        className={ui.hintPanel}
        role="tooltip"
        // 可聚焦（不进 Tab 序）：在浮层里点一下选文字时，焦点从「?」移进来而不是丢掉，浮层不会因失焦收起。
        tabIndex={-1}
        data-up={place?.up === true}
        data-testid={props.testId === undefined ? undefined : `${props.testId}-panel`}
        style={{
          left: place?.left ?? 0,
          top: place?.top ?? 0,
          // 第一帧还没量好位置：先藏着量高度，摆好了再出现（避免闪一下）。
          visibility: place === null ? 'hidden' : 'visible',
        }}
        onPointerEnter={cancel}
        onPointerLeave={() => {
          if (open === 'hover') later('off', HINT_CLOSE_MS)
        }}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    )

  return (
    <span className={ui.hint}>
      <button
        ref={buttonRef}
        type="button"
        className={ui.hintButton}
        aria-label={props.label}
        aria-expanded={open !== 'off'}
        data-open={open !== 'off'}
        data-testid={props.testId}
        onPointerEnter={() => {
          if (open === 'off') later('hover', HINT_OPEN_MS)
          else cancel()
        }}
        onPointerLeave={() => {
          if (open === 'hover') later('off', HINT_CLOSE_MS)
          else if (open === 'off') cancel()
        }}
        onFocus={() => {
          if (open === 'off') setOpen('hover')
        }}
        onBlur={(event) => {
          if (open === 'hover' && !panelRef.current?.contains(event.relatedTarget as Node | null)) {
            setOpen('off')
          }
        }}
        onClick={() => {
          cancel()
          setOpen((current) => (current === 'pinned' ? 'off' : 'pinned'))
        }}
        onKeyDown={onKeyDown}
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
      {panel !== null && (host === null ? panel : createPortal(panel, host))}
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
