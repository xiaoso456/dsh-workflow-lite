/**
 * dsh-workflow-lite — 定时规则「接下来 7 天」：从今天起每天一行，一条 0–24 点的细线，每次执行一个点；
 * 今天已经过去的那一截打斜纹、现在画一条竖线，下一次那个点大一圈。太密的一天（每 5 分钟这类）画成一条，旁边写几次。
 * 底下一行刻度。名字、时区、下一次在外面的工作台上（见 `ScheduleStage.tsx`）。
 *
 * 行数固定、一直挂着：改规则时点的个数会变（规则改了才变，不在打字、拖动的热路径上）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/WeekStrip
 */

import type { T } from '../../../i18n.ts'
import { shortTime } from '../../../model/time.ts'
import { weekdayText } from '../../../model/triggerText.ts'
import type { Week } from '../../../model/triggerWeek.ts'
import css from './week.module.css'

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24] as const

const pct = (spot: number): string => `${(spot * 100).toFixed(3)}%`

export function WeekStrip(props: {
  t: T
  /** 排好的 7 天（`weekOf`）。 */
  week: Week
  /** 规则写对了没有（写错时不画）。 */
  valid: boolean
}): React.JSX.Element {
  const { t, week } = props
  const { next } = week
  return (
    <div className={css.week} data-valid={props.valid} data-testid="wl-trigger-upcoming">
      {week.days.map((day) => {
        const label =
          day.ahead === 0
            ? t('trigger.upcoming.today')
            : day.ahead === 1
              ? t('trigger.upcoming.tomorrow')
              : shortTime(day.start).slice(0, 5)
        return (
          <div
            key={day.start}
            className={css.day}
            data-off={day.count === 0}
            data-ahead={day.ahead}
          >
            <span className={css.label}>
              <b>{label}</b>
              {t('trigger.upcoming.weekday').replace('{day}', weekdayText(t, day.weekday))}
            </span>
            <span className={css.track}>
              {day.ahead === 0 && (
                <>
                  <span className={css.past} style={{ width: pct(week.now) }} />
                  <span className={css.now} style={{ left: pct(week.now) }} />
                </>
              )}
              {day.dense ? (
                <span
                  className={css.band}
                  style={day.ahead === 0 ? { left: pct(week.now) } : undefined}
                />
              ) : (
                <>
                  {day.past.map((spot) => (
                    <span
                      key={`p${spot}`}
                      className={css.fire}
                      data-past="true"
                      style={{ left: pct(spot) }}
                    />
                  ))}
                  {day.fires.map((spot) => (
                    <span
                      key={spot}
                      className={css.fire}
                      data-next={
                        next !== undefined && day.ahead === next.ahead && spot === next.spot
                      }
                      style={{ left: pct(spot) }}
                    />
                  ))}
                </>
              )}
            </span>
            <span className={css.count}>
              {day.dense ? t('trigger.week.dense').replace('{n}', String(day.count)) : ''}
            </span>
          </div>
        )
      })}
      <div className={css.axis} aria-hidden="true">
        <span />
        <span className={css.hours}>
          {HOURS.map((hour) => (
            <span key={hour} className={css.hour}>
              {hour}
            </span>
          ))}
        </span>
        <span />
      </div>
      <p className={css.none} hidden={props.valid}>
        {t('trigger.week.none')}
      </p>
    </div>
  )
}
