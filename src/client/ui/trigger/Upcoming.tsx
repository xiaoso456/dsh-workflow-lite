/**
 * dsh-workflow-lite — 定时规则「接下来几次」：每次一行（哪天、周几、几点），下面一行写按哪个时区；
 * 规则写得不对时说一句等改对了再列。
 *
 * 放在「触发方式」对话框的右栏。行数固定、一直挂着：改规则时只换字和 `hidden`，不插拔元素。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/Upcoming
 */

import type { TriggerSchedule } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import { UPCOMING_COUNT, upcomingRows, zoneText } from '../../model/triggerUpcoming.ts'
import ins from '../panel/panel.module.css'
import css from './upcoming.module.css'

const SLOTS = Array.from({ length: UPCOMING_COUNT }, (_, index) => index)

export function Upcoming(props: {
  t: T
  schedule: TriggerSchedule
  /** 卡片开着时宿主排好的下一次（见 `upcomingRows`）。 */
  live?: number | undefined
}): React.JSX.Element {
  const { t } = props
  const now = Date.now()
  const rows = upcomingRows(t, props.schedule, now, props.live)
  return (
    <div className={css.upcoming} data-testid="wl-trigger-upcoming">
      <ol className={css.list} hidden={rows.length === 0}>
        {SLOTS.map((slot) => {
          const row = rows[slot]
          return (
            <li key={slot} className={css.row} data-first={slot === 0} hidden={row === undefined}>
              <span className={css.day}>{row?.day ?? ''}</span>
              <span className={css.weekday}>{row?.weekday ?? ''}</span>
              <span className={css.clock}>{row?.clock ?? ''}</span>
            </li>
          )
        })}
      </ol>
      <p className={ins.help} hidden={rows.length > 0}>
        {t('trigger.upcoming.none')}
      </p>
      <p className={ins.help}>{t('trigger.upcoming.zone').replace('{zone}', zoneText(now))}</p>
    </div>
  )
}
