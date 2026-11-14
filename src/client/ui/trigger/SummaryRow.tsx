/**
 * dsh-workflow-lite — 触发卡片面板里的摘要列表：一组一个框（{@link SummaryList}），里面一项一行
 * （{@link SummaryRow}）：左边名字、右边值，整行是按钮，点开那一项的详细设置对话框。
 *
 * 直接在面板上选的（会话方式、工作区）是同一个框里的 {@link SummaryField}：左边名字，右边放一个不带框的下拉。
 *
 * 面板只放摘要，长的设置都在对话框里（`dialogs/`）。没设置的那项用浅字说「未设置」，设置过的自然显出来。
 * 「触发方式」不用它：那一块是一张和画布卡片同样子的卡（WhenCard）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/SummaryRow
 */

import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import css from './summaryRow.module.css'

/** 一组摘要行的外框；里面只放 {@link SummaryRow}。 */
export function SummaryList(props: { children: React.ReactNode }): React.JSX.Element {
  return <div className={css.list}>{props.children}</div>
}

/**
 * 列表里放控件的一行：左边名字，右边占满（放 `Select plain`）。
 * `flash`：开关打不开、缺的就是这一项时闪一下底色（见 LaunchField）。
 */
export function SummaryField(props: {
  title: string
  flash?: boolean
  rowRef?: React.Ref<HTMLDivElement>
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div ref={props.rowRef} className={css.field} data-flash={props.flash === true || undefined}>
      <span className={css.title}>{props.title}</span>
      <div className={css.control}>{props.children}</div>
    </div>
  )
}

export function SummaryRow(props: {
  title: string
  /** 摘要（空串时显示 `empty`，浅字）。 */
  summary: string
  empty?: string
  /** 摘要是短写法时，悬停看的完整说法。 */
  tip?: string
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
      <span className={css.title}>{props.title}</span>
      <span
        className={cx(css.summary, props.lines === 2 && css.two)}
        data-blank={blank || undefined}
        data-tip={props.tip}
        data-testid={`${props.testId}-summary`}
      >
        {blank ? (props.empty ?? '') : props.summary}
      </span>
      <span className={css.edit} aria-hidden="true">
        <Icon name="pencil" size={13} />
      </span>
    </button>
  )
}
