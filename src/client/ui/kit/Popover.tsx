/**
 * dsh-workflow-lite — 触发器 + 浮层，以及"点外面就关"的监听。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/Popover
 */

import { type RefObject, useEffect, useRef, useState } from 'react'
import { cx } from './cx.ts'
import css from './popover.module.css'
import { FLOAT_EXIT_MS } from './useFloat.tsx'

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
      className={css.anchor}
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
            css.popover,
            props.align === 'end' && css.popoverEnd,
            props.up === true && css.popoverUp,
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
