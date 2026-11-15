/**
 * dsh-workflow-lite — 「触发」页的「概览」：近 7 天四格数、「节律」（7 天 × 24 小时，每次触发一个点、按结果着色，
 * 定时今天还没到的钟点画虚线圈）、最近 3 次（点了看详情，末尾到时间线看全部）。
 *
 * 数和节律从宿主数好的同一份近况算（{@link tallyActivity}），对得上，触发得再勤也数得全。一次都没触发过也照样排开：数都是 0，节律只画今天还要触发的，
 * 「最近」里说一句还没有触发过。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/OverviewPane
 */

import type {
  FireRecord,
  TriggerActivitySlot,
  TriggerEntry,
} from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { fireWhen } from '../../../model/fireView.ts'
import { HOURS, plannedHours, tallyActivity } from '../../../model/triggerActivity.ts'
import { weekdayText } from '../../../model/triggerText.ts'
import { Icon } from '../../kit/Icon.tsx'
import type { DetailTab } from './DetailTabs.tsx'
import { FireRow } from './FireRow.tsx'
import css from './overview.module.css'

/** 「最近」列几条。 */
const RECENT = 3

/** 夜里（22 点到早上 7 点）的格子再淡一点，白天一眼看得出来。 */
const isNight = (hour: number): boolean => hour < 7 || hour > 21

export function OverviewPane(props: {
  t: T
  entry: TriggerEntry
  /** 还没读到是 `null`。 */
  fires: readonly FireRecord[] | null
  /** 近 7 天每一小格的次数；还没读到是 `null`。 */
  activity: readonly TriggerActivitySlot[] | null
  /** 全部暂停着（今天还要触发的就不画了）。 */
  paused: boolean
  sessionTitle(id: string): string | undefined
  onPick(record: FireRecord): void
  onTab(tab: DetailTab): void
  onOpenRun(instance: string): void
}): React.JSX.Element | null {
  const { t, entry, fires } = props
  const { view } = entry
  const { activity } = props
  if (fires === null || activity === null) return null
  const now = Date.now()
  const tally = tallyActivity(activity, now)
  const live = view.state === 'waiting' && !props.paused
  const planned = live ? plannedHours(entry.data.source, now, view.next) : []
  const hourNow = new Date(now).getHours()
  const dayName = (row: number, start: number): string =>
    row === 0
      ? t('trigger.fire.today')
      : row === 1
        ? t('trigger.fire.yesterday')
        : weekdayText(t, new Date(start).getDay() === 0 ? 7 : new Date(start).getDay())

  return (
    <div className={css.overview} data-testid="wl-hub-trg-overview">
      <section className={css.stats}>
        <Stat label={t('hub.trgStatTotal')} value={tally.total} />
        <Stat label={t('trigger.outcome.sent')} value={tally.counts.sent} tone="sent" />
        <Stat label={t('trigger.outcome.skipped')} value={tally.counts.skipped} tone="skipped" />
        <Stat label={t('trigger.outcome.failed')} value={tally.counts.failed} tone="failed" />
      </section>

      <section className={css.section}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>{t('hub.trgRhythm')}</span>
          <span className={css.legend}>
            <span data-outcome="sent">{t('trigger.outcome.sent')}</span>
            <span data-outcome="skipped">{t('trigger.outcome.skipped')}</span>
            <span data-outcome="failed">{t('trigger.outcome.failed')}</span>
            {planned.length > 0 && <span data-outcome="plan">{t('hub.trgPlanned')}</span>}
          </span>
        </div>
        <div className={css.rhythm} data-testid="wl-hub-trg-rhythm">
          {tally.cells.map((row, index) => {
            const start = tally.days[index] as number
            const day = dayName(index, start)
            return [
              <span key={`day-${String(start)}`} className={css.day}>
                {day}
              </span>,
              ...row.map((cell, hour) => {
                const plan = index === 0 && cell === null && planned.includes(hour)
                return (
                  <span
                    key={`${String(start)}-${String(hour)}`}
                    className={css.cell}
                    data-night={isNight(hour) || undefined}
                    data-now={(index === 0 && hour === hourNow) || undefined}
                    data-tip={
                      cell === null
                        ? undefined
                        : t('hub.trgCellTip')
                            .replace('{day}', day)
                            .replace('{hour}', String(hour).padStart(2, '0'))
                            .replace('{n}', String(cell.count))
                    }
                  >
                    {cell !== null && (
                      <b
                        className={css.mark}
                        data-outcome={cell.outcome}
                        data-many={cell.count > 1 || undefined}
                      />
                    )}
                    {plan && <b className={css.mark} data-outcome="plan" />}
                  </span>
                )
              }),
            ]
          })}
          <span />
          {Array.from({ length: HOURS }, (_, hour) => (
            <span key={`axis-${String(hour)}`} className={css.axis}>
              {hour % 6 === 0 ? String(hour).padStart(2, '0') : ''}
            </span>
          ))}
        </div>
      </section>

      <section className={css.section}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>{t('hub.trgRecent')}</span>
          {fires.length > 0 && (
            <button
              type="button"
              className={css.link}
              data-testid="wl-hub-trg-see-all"
              onClick={() => props.onTab('timeline')}
            >
              {t('hub.trgSeeAll')}
              <Icon name="arrowRight" size={12} />
            </button>
          )}
        </div>
        <ul className={css.recent}>
          {fires.length === 0 && <li className={css.none}>{t('trigger.historyEmpty')}</li>}
          {fires.slice(0, RECENT).map((record) => (
            <FireRow
              key={record.id}
              t={t}
              record={record}
              when={fireWhen(t, record.at, now)}
              sessionTitle={props.sessionTitle}
              onPick={props.onPick}
              onOpenRun={props.onOpenRun}
            />
          ))}
        </ul>
      </section>
    </div>
  )
}

function Stat(props: {
  label: string
  value: number
  tone?: 'sent' | 'skipped' | 'failed'
}): React.JSX.Element {
  return (
    <div className={css.stat} data-outcome={props.tone} data-zero={props.value === 0 || undefined}>
      <span className={css.statValue}>{props.value}</span>
      <span className={css.statLabel}>{props.label}</span>
    </div>
  )
}
