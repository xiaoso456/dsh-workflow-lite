/**
 * dsh-workflow-lite — 小件：类名拼接、点外面关闭、分段选择、浮层。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/primitives
 */

import { createContext, type RefObject, useContext, useEffect, useRef } from 'react'
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

/** 把一段文字写进剪贴板；环境不允许就安静地失败。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
