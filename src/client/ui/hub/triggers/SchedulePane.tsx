/**
 * dsh-workflow-lite — 「触发」页定时的「日程」：接下来 7 天一天一列，每天几点触发（今天已经过去的划掉；
 * 一天里次数太多写「每天 N 次」），下面是错过的怎么办、按哪个时区。
 *
 * 开着时「每隔多久」从宿主排好的下一次往后排（同「触发方式」对话框里的接下来 7 天，`weekOf`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/SchedulePane
 */

import { launchOf } from '../../../../shared/trigger.ts'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { clockTime, shortTime } from '../../../model/time.ts'
import { weekdayText } from '../../../model/triggerText.ts'
import { zoneText } from '../../../model/triggerUpcoming.ts'
import { type WeekDay, weekOf } from '../../../model/triggerWeek.ts'
import css from './live.module.css'

/** 一列里最多列几个钟点；再多写「每天 N 次」。 */
const LISTED = 8

/** 一天里第 `spot`（0–1）那一刻的钟点。 */
function clockOf(day: WeekDay, spot: number, next: WeekDay | undefined): string {
  const end = next?.start ?? day.start + 86_400_000
  return clockTime(day.start + spot * (end - day.start))
}

export function SchedulePane(props: { t: T; entry: TriggerEntry }): React.JSX.Element | null {
  const { t, entry } = props
  const { source } = entry.data
  if (source.kind !== 'schedule') return null
  const now = Date.now()
  const live =
    entry.view.state === 'waiting' || entry.view.state === 'elsewhere' ? entry.view.next : undefined
  const week = weekOf(source.schedule, now, live)
  const zone = zoneText(now)
  const nothing = week.days.every((day) => day.count === 0)
  return (
    <div className={css.stack} data-testid="wl-hub-trg-schedule">
      <section className={css.section}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>{t('trigger.week')}</span>
          <span className={css.aside}>
            {t('hub.trgWeekAside').replace('{zone}', zone).replace('{n}', String(week.upcoming))}
          </span>
        </div>
        {nothing ? (
          <p className={css.muted}>{t('trigger.week.none')}</p>
        ) : (
          <div className={css.week}>
            {week.days.map((day, index) => {
              const next = week.days[index + 1]
              const times = [
                ...day.past.map((spot) => ({ spot, past: true })),
                ...day.fires.map((spot) => ({ spot, past: false })),
              ]
              return (
                <div
                  key={day.start}
                  className={css.wday}
                  data-today={index === 0 || undefined}
                  data-off={day.count === 0 || undefined}
                >
                  <div className={css.wdayHead}>
                    <b>{index === 0 ? t('trigger.fire.today') : weekdayText(t, day.weekday)}</b>
                    <span>{shortTime(day.start).slice(0, 5)}</span>
                  </div>
                  {day.dense || times.length > LISTED ? (
                    <span className={css.wtime}>
                      {t('trigger.week.dense').replace('{n}', String(day.count))}
                    </span>
                  ) : times.length === 0 ? (
                    <span className={css.wnone}>{t('hub.trgDayNone')}</span>
                  ) : (
                    times.map((item) => (
                      <span
                        key={item.spot}
                        className={css.wtime}
                        data-past={item.past || undefined}
                      >
                        {clockOf(day, item.spot, next)}
                      </span>
                    ))
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
      <div className={css.box}>
        <div className={css.field}>
          <span className={css.key}>{t('hub.trgMissed')}</span>
          <span className={css.plain}>
            {t(launchOf(entry.data).catchUp ? 'hub.trgMissedOn' : 'hub.trgMissedOff')}
          </span>
        </div>
        <div className={css.field}>
          <span className={css.key}>{t('hub.trgZone')}</span>
          <span className={css.plain}>{t('hub.trgZoneText').replace('{zone}', zone)}</span>
        </div>
      </div>
    </div>
  )
}
