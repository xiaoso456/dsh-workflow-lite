/**
 * dsh-workflow-lite — 在等的上次执行现在怎样（「实例 c967 等待回复」，等回复时用提醒色），下一行是它所在的会话
 * （{@link PrevSessionLink}：「会话：触发器一览 · CI 通知 ↗」）。
 *
 * 跟在「等待上次执行结束 ·」后面：排着的那条的详情（所在的那一行是折行的 flex，会话占满一行另起）。说法见 `model/prevRun.ts`；
 * 「触发」页时间线把上次执行单独排成一行（`hub/triggers/FireRow.tsx` 的 `PrevRow`），会话那一截也用这里的链接。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/PrevRunNote
 */

import type { T } from '../../i18n.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import css from './prevRun.module.css'
import type { PrevRunView, PrevSession } from './triggerEnv.ts'

export function PrevRunNote(props: {
  t: T
  prev: PrevRunView
  /** 那半句的 `data-testid`。 */
  testId: string
  /** 会话链接的 `data-testid`。 */
  sessionTestId: string
}): React.JSX.Element {
  const { prev } = props
  return (
    <>
      <span className={css.text} data-tone={prev.tone} data-testid={props.testId}>
        {prev.text}
      </span>
      {/* 会话另起一行（和时间线上「上次执行」那一行一样）：长短不一时不会在行尾剩个「·」。 */}
      {prev.session !== undefined && (
        <span className={css.sessionLine}>
          <PrevSessionLink t={props.t} session={prev.session} testId={props.sessionTestId} />
        </span>
      )}
    </>
  )
}

/**
 * 上次执行所在的会话：「会话：触发器一览 · CI 通知 ↗」，名字太长截断、悬停看全名，点了打开；
 * 会话已经不在了写「上次执行的会话（已不存在）」，不能点。
 */
export function PrevSessionLink(props: {
  t: T
  session: PrevSession
  testId: string
  className?: string
}): React.JSX.Element {
  const { t, session } = props
  const { title, open } = session
  if (title === undefined || open === undefined) {
    return (
      <span className={cx(css.gone, props.className)} data-testid={props.testId}>
        {t('trigger.prev.sessionGone')}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={cx(css.link, props.className)}
      data-tip={t('trigger.prev.sessionTip').replace('{name}', title)}
      data-testid={props.testId}
      onClick={open}
    >
      <span className={css.linkText}>{t('trigger.prev.session').replace('{name}', title)}</span>
      <Icon name="external" size={12} />
    </button>
  )
}
