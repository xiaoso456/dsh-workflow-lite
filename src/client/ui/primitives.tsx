/**
 * dsh-workflow-lite — 小件：类名拼接、点外面关闭、分段选择、浮层。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/primitives
 */

import { type RefObject, useEffect, useRef } from 'react'
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

/** 把一段文字写进剪贴板；环境不允许就安静地失败。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
