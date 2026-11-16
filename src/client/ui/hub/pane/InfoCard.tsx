/**
 * dsh-workflow-lite — 工作流中心右栏的信息卡片：小图标 + 标题，右上角一支铅笔或别的按钮，下面两列的名字 / 值。
 *
 * 「触发」页「设置」、「运行实例」页「信息」共用。两张一排时外面套 {@link InfoColumns}：两列各自往下排、底边对齐。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/pane/InfoCard
 */

import type { T } from '../../../i18n.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import css from './infoCard.module.css'

/** 一行：名字和值。 */
export type InfoRow = readonly [label: string, value: React.ReactNode]

export function InfoCard(props: {
  t: T
  icon: IconName
  /** 标题前小图标的颜色（CSS 颜色值）；不给是灰的。 */
  tint?: string
  title: string
  testId: string
  /** 右上角铅笔（打开对话框改这张卡片）；就地能改的卡片不给。 */
  onEdit?(): void
  /** 右上角别的按钮（没有铅笔时才放）。 */
  action?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const style = props.tint === undefined ? undefined : { '--tint': props.tint }
  const edit = props.t('hub.trgEditCard').replace('{name}', props.title)
  return (
    <section className={css.card} style={style as React.CSSProperties} data-testid={props.testId}>
      <div className={css.cardTitle}>
        <Icon name={props.icon} size={12} />
        <span>{props.title}</span>
        {props.onEdit !== undefined ? (
          <button
            type="button"
            className={css.pen}
            aria-label={edit}
            data-tip={edit}
            data-testid={`${props.testId}-edit`}
            onClick={props.onEdit}
          >
            <Icon name="pencil" size={13} />
          </button>
        ) : (
          props.action !== undefined && <span className={css.action}>{props.action}</span>
        )}
      </div>
      {props.children}
    </section>
  )
}

/** 名字 / 值两列；值是 `undefined` 的行不出。 */
export function InfoRows(props: { rows: readonly InfoRow[] }): React.JSX.Element {
  return (
    <dl className={css.kv}>
      {props.rows.map(([label, value]) =>
        value === undefined ? null : (
          <div key={label} className={css.kvRow}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ),
      )}
    </dl>
  )
}

/** 两列卡片：两列各自往下排，每列最后一张撑满，底边对齐。 */
export function InfoColumns(props: {
  left: React.ReactNode
  right: React.ReactNode
  testId: string
  /** 两列下面不分列的东西（对话框）。 */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={css.masonry} data-testid={props.testId}>
      <div className={css.col}>{props.left}</div>
      <div className={css.col}>{props.right}</div>
      {props.children}
    </div>
  )
}

export function Muted(props: { children: React.ReactNode }): React.JSX.Element {
  return <span className={css.muted}>{props.children}</span>
}

export function Mono(props: { children: React.ReactNode }): React.JSX.Element {
  return <code className={css.mono}>{props.children}</code>
}

export function Quote(props: { children: React.ReactNode }): React.JSX.Element {
  return <div className={css.quote}>{props.children}</div>
}
