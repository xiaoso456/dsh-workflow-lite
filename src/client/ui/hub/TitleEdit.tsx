/**
 * dsh-workflow-lite — 工作流中心右栏的标题：名字后面一支铅笔，点名字或铅笔就地改名。
 *
 * 「工作流」「记忆」两页共用。改名要等确认才生效（工作流改名要搬文件，不像画布右栏那样边打边改，
 * 见 `panel/TitleField.tsx`）：
 * - 名字换成一条底线输入框（全选着，跟字一样宽、随打字变长），紧跟着「确认」「取消」；回车、点确认或失焦提交，Esc、点取消放弃
 *   （Esc 只退出改名，对话框留着）。
 * - 提交没成（名字不行、主机拒了，调用方已经提示过）就留在输入框里接着改；没改动直接退出。
 * - 平时和改名时一样高，下面的东西不跳；名字太长截成省略号时悬停看全名。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/TitleEdit
 */

import { useEffect, useRef, useState } from 'react'
import type { T } from '../../i18n.ts'
import { tipWhenCut } from '../kit/cutTip.ts'
import { cx } from '../kit/cx.ts'
import { EditActions } from '../kit/EditActions.tsx'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { useLineExit } from '../motion/exits.tsx'
import css from './titleEdit.module.css'

export function TitleEdit(props: {
  t: T
  /** 输入框里的初值（存着的名字，可以是空的）。 */
  value: string
  /** 平时显示的字（名字是空的时候显示的替代，比如记忆的 id）；缺省就是 `value`。 */
  display?: string
  placeholder?: string
  maxLength?: number
  /** 「重命名」这类说法：铅笔的提示、读屏念的。 */
  label: string
  /** 名字 `${testId}`、铅笔 `${testId}-rename`、输入框 `${testId}-input`。 */
  testId: string
  /** 提交新名字（已去掉首尾空白）；回 `false` = 没成，留在输入框里。 */
  onCommit(value: string): Promise<boolean>
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const nameRef = useRef<HTMLButtonElement>(null)
  /** 改名是用键盘或按钮收的：回到标题上，Esc、Tab 接着能用（点别处失焦收的不抢焦点）。 */
  const refocus = useRef(false)
  useEffect(() => {
    if (editing || !refocus.current) return
    refocus.current = false
    nameRef.current?.focus({ preventScroll: true })
  }, [editing])
  const shown = props.display ?? props.value
  if (editing) {
    return (
      <TitleInput
        {...props}
        onDone={(focus) => {
          refocus.current = focus
          setEditing(false)
        }}
      />
    )
  }
  return (
    <span className={css.title}>
      <button
        ref={nameRef}
        type="button"
        className={css.name}
        aria-label={`${props.label}：${shown}`}
        data-testid={props.testId}
        onPointerOverCapture={(event) =>
          tipWhenCut(event.currentTarget, event.currentTarget, shown)
        }
        onClick={() => setEditing(true)}
      >
        {shown}
      </button>
      <button
        type="button"
        className={css.pen}
        aria-label={props.label}
        data-tip={props.label}
        data-testid={`${props.testId}-rename`}
        onClick={() => setEditing(true)}
      >
        <Icon name="pencil" size={13} />
      </button>
    </span>
  )
}

function TitleInput(props: {
  t: T
  value: string
  placeholder?: string
  maxLength?: number
  label: string
  testId: string
  onCommit(value: string): Promise<boolean>
  /** 收起；`focus` = 焦点还在这儿（回车、Esc、点按钮），回到标题上。 */
  onDone(focus: boolean): void
}): React.JSX.Element {
  const { t } = props
  const ref = useRef<HTMLInputElement>(null)
  const lineRef = useLineExit()
  /** 提交、取消之后输入框被卸掉时可能还会补一个 blur：那一下不再提交。 */
  const settled = useRef(false)

  useEffect(() => {
    ref.current?.select()
  }, [])

  const commit = (raw: string, focus: boolean): void => {
    if (settled.current) return
    const value = raw.trim()
    settled.current = true
    if (value === props.value.trim()) {
      props.onDone(focus)
      return
    }
    void props.onCommit(value).then((ok) => {
      if (ok) {
        props.onDone(focus)
        return
      }
      settled.current = false
      ref.current?.focus()
    })
  }
  const cancel = (): void => {
    settled.current = true
    props.onDone(true)
  }

  return (
    <span className={cx(ui.editRow, css.edit)}>
      <span ref={lineRef} className={cx(ui.lineField, css.field)}>
        <input
          ref={ref}
          className={cx(ui.lineInput, css.input)}
          defaultValue={props.value}
          placeholder={props.placeholder}
          maxLength={props.maxLength}
          aria-label={props.label}
          data-testid={`${props.testId}-input`}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(event.currentTarget.value, true)
            }
            if (event.key === 'Escape') {
              // 只退出改名，对话框留着。
              event.preventDefault()
              event.stopPropagation()
              cancel()
            }
          }}
          onBlur={(event) => commit(event.currentTarget.value, false)}
        />
      </span>
      <EditActions
        t={t}
        onConfirm={() => commit(ref.current?.value ?? '', true)}
        onCancel={cancel}
      />
    </span>
  )
}
