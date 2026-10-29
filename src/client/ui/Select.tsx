/**
 * dsh-workflow-lite — 下拉选择（单选）：一个输入框样子的触发块，点开是一张和别处菜单一样的浮层。
 *
 * 不用原生 `<select>`：原生下拉的列表由系统画，颜色、字号、圆角都跟不上主题。
 * 选中项带底色和钩；打开时焦点落在选中项上，上下键在项之间走，Esc / 点外面收起，选了收起并把焦点还给触发块。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Select
 */

import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon.tsx'
import { cx, Popover } from './primitives.tsx'
import css from './select.module.css'
import ui from './ui.module.css'

export function Select<V extends string>(props: {
  label: string
  value: V
  options: readonly { value: V; label: string }[]
  onChange: (value: V) => void
  className?: string
  /** 触发块的 testid；每一项是 `${testId}-${value}`。 */
  testId?: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const current = props.options.find((option) => option.value === props.value)

  useEffect(() => {
    if (!open) return
    const items = list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    const picked = [...(items ?? [])].find((item) => item.getAttribute('aria-checked') === 'true')
    ;(picked ?? items?.[0])?.focus()
  }, [open])

  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []),
    ]
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    items[(at + step + items.length) % items.length]?.focus()
  }

  return (
    <div className={cx(css.wrap, props.className)}>
      <Popover
        open={open}
        onClose={close}
        label={props.label}
        className={css.pop}
        trigger={
          <button
            ref={trigger}
            type="button"
            className={cx(ui.input, css.trigger)}
            aria-label={props.label}
            aria-haspopup="menu"
            aria-expanded={open}
            data-open={open || undefined}
            data-testid={props.testId}
            onClick={() => setOpen(!open)}
          >
            <span className={css.value}>{current?.label ?? ''}</span>
            <span className={css.chevron} aria-hidden="true">
              <Icon name="chevronDown" size={14} />
            </span>
          </button>
        }
      >
        <div ref={list} role="menu" aria-label={props.label} onKeyDown={onKeyDown}>
          {props.options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              aria-checked={option.value === props.value}
              className={ui.menuItem}
              data-active={option.value === props.value}
              data-testid={
                props.testId === undefined ? undefined : `${props.testId}-${option.value}`
              }
              onClick={() => {
                if (option.value !== props.value) props.onChange(option.value)
                close()
              }}
            >
              <span className={ui.menuLabel}>{option.label}</span>
              <span className={css.check} aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  )
}
