/**
 * dsh-workflow-lite — 「触发」页里一条触发记录的一行（概览的「最近」和时间线共用）：时刻、结果小签、原因或渠道、建出的实例。
 * 点一行看这次触发的详情；行尾「实例 →」直接打开那次执行。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/FireRow
 */

import type { FireRecord } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { FIRE_CHANNEL_TEXT, fireKind, fireWhy } from '../../../model/fireView.ts'
import { Icon } from '../../kit/Icon.tsx'
import css from './fireRow.module.css'

/** 结果小签上的短名（「模型判断不需要」写「不需要」）。 */
const KIND_TEXT = {
  sent: 'trigger.outcome.sent',
  skipped: 'trigger.outcome.skipped',
  failed: 'trigger.outcome.failed',
  declined: 'trigger.fire.declinedShort',
} as const

export function FireRow(props: {
  t: T
  record: FireRecord
  /** 时刻怎么写（按天分组时只写钟点）。 */
  when: string
  onPick(record: FireRecord): void
  onOpenRun(instance: string): void
}): React.JSX.Element {
  const { t, record } = props
  const kind = fireKind(record)
  const what = fireWhy(record) ?? t(FIRE_CHANNEL_TEXT[record.channel])
  return (
    <li className={css.row} data-outcome={kind}>
      <button
        type="button"
        className={css.main}
        aria-label={`${t('trigger.fireDetail')} ${props.when}`}
        data-testid="wl-trigger-fire"
        onClick={() => props.onPick(record)}
      >
        <time className={css.time}>{props.when}</time>
        <span className={css.chip}>{t(KIND_TEXT[kind])}</span>
        <span className={css.what}>{what}</span>
      </button>
      {record.instance !== undefined && (
        <button
          type="button"
          className={css.run}
          data-tip={t('trigger.openRun')}
          data-testid="wl-trigger-open-run"
          onClick={() => props.onOpenRun(record.instance as string)}
        >
          {t('hub.trgRun')}
          <Icon name="arrowRight" size={11} />
        </button>
      )}
    </li>
  )
}
