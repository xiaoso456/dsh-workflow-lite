/**
 * dsh-workflow-lite — 一张触发卡片的触发记录：时刻、渠道、结果，跳过 / 失败 / 不需要的原因，建出了实例的可以点过去看。
 *
 * 画布上的面板（`TriggerStatus.tsx`）和工作流中心的「触发」页共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/FireList
 */

import type { FireRecord } from '../../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { shortTime } from '../../model/time.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import ins from '../panel/panel.module.css'
import css from './trigger.module.css'

const CHANNEL_TEXT: Record<FireRecord['channel'], LocaleKey> = {
  schedule: 'trigger.channel.schedule',
  poll: 'trigger.channel.poll',
  listen: 'trigger.channel.listen',
  http: 'trigger.channel.http',
  after: 'trigger.channel.after',
  now: 'trigger.channel.now',
}

/** 一条记录的结果：发出去了但模型判断不需要的，单独说。 */
function outcomeKey(record: FireRecord): LocaleKey {
  if (record.declined !== undefined) return 'trigger.outcome.declined'
  if (record.outcome === 'sent') return 'trigger.outcome.sent'
  return record.outcome === 'skipped' ? 'trigger.outcome.skipped' : 'trigger.outcome.failed'
}

export function FireList(props: {
  t: T
  /** 还没读到是 `null`：先什么都不说，不把「还没读到」说成「没有记录」。 */
  fires: readonly FireRecord[] | null
  onOpenRun(instance: string): void
}): React.JSX.Element | null {
  const { t, fires } = props
  if (fires === null) return null
  if (fires.length === 0) return <p className={ins.help}>{t('trigger.historyEmpty')}</p>
  return (
    <ul className={css.fires}>
      {fires.map((record) => (
        <li
          key={record.id}
          className={css.fire}
          data-outcome={record.declined === undefined ? record.outcome : 'declined'}
        >
          <span className={css.fireTop}>
            <span className={css.fireTime}>{shortTime(record.at)}</span>
            <span className={css.fireChannel}>{t(CHANNEL_TEXT[record.channel])}</span>
            <span className={css.fireOutcome}>{t(outcomeKey(record))}</span>
            {record.instance !== undefined && (
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.small, css.fireOpen)}
                aria-label={t('trigger.openRun')}
                data-tip={t('trigger.openRun')}
                data-testid="wl-trigger-open-run"
                onClick={() => props.onOpenRun(record.instance as string)}
              >
                <Icon name="arrowRight" size={13} />
              </button>
            )}
          </span>
          {(record.declined ?? record.reason) !== undefined && (
            <span className={css.fireReason}>{record.declined ?? record.reason}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
