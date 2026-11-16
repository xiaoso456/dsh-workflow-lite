/**
 * dsh-workflow-lite — 按标签分组时，组标题上就地给标签改名：名字那一格换成一条细输入框（和左栏一行改名同一个样子），
 * 回车或点开确认，Esc 取消（对话框不跟着关），点到别处也算确认。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/workflows/TagRename
 */

import { useEffect, useRef } from 'react'
import type { T } from '../../../i18n.ts'
import { cx } from '../../kit/cx.ts'
import { EditActions } from '../../kit/EditActions.tsx'
import ui from '../../kit/ui.module.css'
import { useLineExit } from '../../motion/exits.tsx'
import css from './wfRow.module.css'

export function TagRename(props: {
  t: T
  value: string
  /** 回 `false` = 没改成，留在输入框里。 */
  onCommit(to: string): Promise<boolean>
  onCancel(): void
}): React.JSX.Element {
  const { t } = props
  const ref = useRef<HTMLInputElement>(null)
  const lineRef = useLineExit()
  /** Esc 之后输入框被卸掉时可能还会补一个 blur：那一下不算提交。 */
  const settled = useRef(false)

  useEffect(() => {
    ref.current?.select()
  }, [])

  const commit = (value: string): void => {
    if (settled.current) return
    if (value.trim() === '' || value.trim() === props.value) {
      settled.current = true
      props.onCancel()
      return
    }
    settled.current = true
    void props.onCommit(value).then((ok) => {
      if (ok) return
      settled.current = false
      ref.current?.focus()
    })
  }

  const cancel = (): void => {
    settled.current = true
    props.onCancel()
  }

  return (
    <span className={cx(ui.editRow, css.tagField)}>
      <span ref={lineRef} className={ui.lineField}>
        <input
          ref={ref}
          className={cx(ui.lineInput, css.tagInput)}
          defaultValue={props.value}
          aria-label={t('hub.tagRename')}
          data-testid="wl-hub-tag-rename-input"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing)
              commit(event.currentTarget.value)
            if (event.key === 'Escape') {
              event.stopPropagation()
              cancel()
            }
          }}
          onBlur={(event) => commit(event.currentTarget.value)}
        />
      </span>
      <EditActions t={t} onConfirm={() => commit(ref.current?.value ?? '')} onCancel={cancel} />
    </span>
  )
}
