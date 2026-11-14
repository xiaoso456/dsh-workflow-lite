/**
 * dsh-workflow-lite — 「触发方式」对话框右边上半的设置行：左边一列短标签（和「定时」的规则 / 时间 / 星期同一列宽），
 * 右边是要选的东西，下面可以带一行小字（说明，或写得不对时的原因）。标签后面可以跟一个「?」（`help`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/StageRow
 */

import { cx } from '../../kit/cx.ts'
import row from '../trigger.module.css'
import css from './sourceStage.module.css'

/** 一组设置行（行与行之间的距离）。 */
export function StageRows(props: { children: React.ReactNode }): React.JSX.Element {
  return <div className={css.rows}>{props.children}</div>
}

export function StageRow(props: {
  label: string
  /** 紧跟在标签文字后面的东西（「?」说明）。 */
  help?: React.ReactNode
  /** 内容不止一行高（带说明、会折行）：标签对着第一行。 */
  top?: boolean
  /** 下面一行小字；`problem` 时标红。 */
  note?: string | undefined
  problem?: boolean
  testId?: string
  noteTestId?: string
  children: React.ReactNode
}): React.JSX.Element {
  const top = props.top === true || props.note !== undefined
  return (
    <div className={cx(row.row, top && css.rowTop)} data-testid={props.testId}>
      <span className={cx(row.lead, top && css.leadTop, props.help !== undefined && css.leadHelp)}>
        {props.label}
        {props.help}
      </span>
      <div className={css.value}>
        {props.children}
        {props.note !== undefined && (
          <p
            className={css.rowNote}
            data-problem={props.problem === true}
            role={props.problem === true && props.note !== '' ? 'alert' : undefined}
            data-testid={props.noteTestId}
          >
            {props.note}
          </p>
        )}
      </div>
    </div>
  )
}
