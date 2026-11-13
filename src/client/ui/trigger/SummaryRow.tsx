/**
 * dsh-workflow-lite — 触发卡片面板里的一行摘要：标题 + 一两行摘要，整行是按钮，点开那一项的详细设置对话框。
 *
 * 面板只放摘要，长的设置都在对话框里（`dialogs/`）。没写过的那项用浅字说「没写」之类，不留空行。
 * 「触发方式」不用它：那一块是一张和画布卡片同样子的卡（WhenCard）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/SummaryRow
 */

import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import css from './summaryRow.module.css'

export function SummaryRow(props: {
  title: string
  /** 摘要（空串时显示 `empty`，浅字）。 */
  summary: string
  empty?: string
  /** 字的摘要最多几行（缺省 1）。 */
  lines?: 1 | 2
  editLabel: string
  testId: string
  onEdit(): void
}): React.JSX.Element {
  const blank = props.summary === ''
  return (
    <button
      type="button"
      className={css.row}
      aria-label={`${props.editLabel} ${props.title}`}
      data-testid={props.testId}
      onClick={props.onEdit}
    >
      <span className={css.text}>
        <span className={css.title}>{props.title}</span>
        <span
          className={cx(css.summary, props.lines === 2 && css.two)}
          data-blank={blank || undefined}
          data-testid={`${props.testId}-summary`}
        >
          {blank ? (props.empty ?? '') : props.summary}
        </span>
      </span>
      <span className={css.edit} aria-hidden="true">
        <Icon name="pencil" size={13} />
      </span>
    </button>
  )
}
