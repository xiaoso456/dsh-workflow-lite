/**
 * dsh-workflow-lite — 右栏标题栏里的名字框：边打边生效，聚焦时末尾出现「确认」「取消」。
 *
 * 和原地改名的几处（`WorkflowRow` 等）是同一套底线 + 两个小按钮，区别是这里改动本来就实时生效：
 * - 确认 / 回车：收起焦点（调用方可以在 `onConfirm` 里顺手做别的，例如保存）；
 * - 取消 / Esc：把名字改回聚焦时的样子，再收起焦点。
 * 两个按钮只在聚焦时才占位（`ui.editRow[data-live]`），平时标题栏里只有一条名字。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/TitleField
 */

import { useRef } from 'react'
import type { T } from '../i18n.ts'
import { EditActions } from './EditActions.tsx'
import css from './inspector.module.css'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

export function TitleField(props: {
  t: T
  value: string
  placeholder: string
  ariaLabel: string
  testId: string
  /** 每敲一下、取消时改回去，都从这里走。 */
  onType(value: string): void
  /** 失焦（调用方用来把这一串改动封成一步撤销）。 */
  onBlur?(): void
  /** 回车或点「确认」；之后焦点照样收起。 */
  onConfirm?(): void
}): React.JSX.Element {
  const { t } = props
  const ref = useRef<HTMLInputElement>(null)
  /** 聚焦时的名字：取消要改回它。 */
  const origin = useRef(props.value)

  const confirm = (): void => {
    props.onConfirm?.()
    ref.current?.blur()
  }
  const cancel = (): void => {
    props.onType(origin.current)
    ref.current?.blur()
  }

  return (
    <span className={cx(ui.editRow, css.titleRow)} data-live="true">
      <span className={ui.lineField}>
        <input
          ref={ref}
          className={cx(ui.lineInput, css.titleInput)}
          value={props.value}
          placeholder={props.placeholder}
          aria-label={props.ariaLabel}
          data-testid={props.testId}
          onFocus={() => {
            origin.current = props.value
          }}
          onChange={(event) => props.onType(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              confirm()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              cancel()
            }
          }}
          onBlur={props.onBlur}
        />
      </span>
      <EditActions t={t} onConfirm={confirm} onCancel={cancel} />
    </span>
  )
}
