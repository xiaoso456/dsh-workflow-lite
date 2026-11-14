/**
 * dsh-workflow-lite — 「触发方式」对话框右边上半的设置行：左边一列短标签（和「定时」的规则 / 时间 / 星期同一列宽），
 * 右边是要选的东西，下面可以带一行小字（说明，或写得不对时的原因）。标签后面可以跟一个「?」（`help`）。
 *
 * 标签和右边第一行的字按基线对齐：右边多高、说明出不出来，标签都不动。
 * 说明出现、收起时高度连续变（{@link Presence}），下面的行顺势挪，不是一下跳开。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/StageRow
 */

import { cx } from '../../kit/cx.ts'
import { Presence } from '../../motion/exits.tsx'
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
  /** 下面一行小字（空串、不给 = 没有）；`problem` 时标红。几段轮流换的用 FadeStack 传进来。 */
  note?: React.ReactNode
  problem?: boolean
  testId?: string
  noteTestId?: string
  children: React.ReactNode
}): React.JSX.Element {
  const shown = props.note !== undefined && props.note !== null && props.note !== ''
  return (
    <div className={cx(row.row, css.row)} data-testid={props.testId}>
      <span className={cx(row.lead, props.help !== undefined && css.leadHelp)}>
        {props.label}
        {props.help}
      </span>
      <div className={css.value}>
        {props.children}
        <Presence show={shown} className={css.noteSlot}>
          <p
            className={css.rowNote}
            data-problem={props.problem === true}
            role={props.problem === true ? 'alert' : undefined}
            data-testid={props.noteTestId}
          >
            {props.note}
          </p>
        </Presence>
      </div>
    </div>
  )
}
