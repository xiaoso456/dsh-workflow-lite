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
import { settledFires } from '../../../model/fireView.ts'
import { pastTime } from '../../../model/time.ts'
import { plannedHours, tallyActivity } from '../../../model/triggerActivity.ts'
import { Icon } from '../../kit/Icon.tsx'
import { RollingNumber } from '../../motion/RollingNumber.tsx'
import type { DetailTab } from './DetailTabs.tsx'
import { FireRow } from './FireRow.tsx'
import css from './overview.module.css'
import { RhythmGrid } from './RhythmGrid.tsx'

/** 「最近」列几条。 */
const RECENT = 3
export function OverviewPane(props: {
  t: T
  entry: TriggerEntry
  selection: string
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
}): React.JSX.Element {
  const { t, entry } = props
  const { view } = entry
  const { activity } = props
  // 「最近」只列有了结果的；排着的在头部状态条和时间线里看。
  const fires = settledFires(props.fires ?? [])
  const now = Date.now()
  const tally = tallyActivity(activity ?? [], now)
  const live = view.state === 'waiting' && !props.paused
  const planned = live ? plannedHours(entry.data.source, now, view.next) : []

  return (
    <div
      className={css.overview}
      data-testid="wl-hub-trg-overview"
      aria-busy={activity === null || props.fires === null || undefined}
    >
      <section className={css.stats}>
        <Stat label={t('hub.trgStatTotal')} value={activity === null ? null : tally.total} />
        <Stat
          label={t('trigger.outcome.sent')}
          value={activity === null ? null : tally.counts.sent}
          tone="sent"
        />
        <Stat
          label={t('trigger.outcome.skipped')}
          value={activity === null ? null : tally.counts.skipped}
          tone="skipped"
        />
        <Stat
          label={t('trigger.outcome.failed')}
          value={activity === null ? null : tally.counts.failed}
          tone="failed"
        />
      </section>

      <section className={css.section}>
        <div className={css.sectionHead}>
          <span className={css.sectionTitle}>{t('hub.trgRhythm')}</span>
          <span className={css.sectionHint}>{t('hub.trgRhythmHint')}</span>
          <span className={css.legend}>
            <span data-outcome="sent">{t('trigger.outcome.sent')}</span>
            <span data-outcome="skipped">{t('trigger.outcome.skipped')}</span>
            <span data-outcome="failed">{t('trigger.outcome.failed')}</span>
            {planned.length > 0 && <span data-outcome="plan">{t('hub.trgPlanned')}</span>}
          </span>
        </div>
        <RhythmGrid
          t={t}
          selection={props.selection}
          tally={tally}
          planned={planned}
          hourNow={new Date(now).getHours()}
          loading={activity === null}
        />
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
          {fires.length === 0 && (
            <li className={css.none}>
              {t(props.fires === null ? 'hub.loading' : 'trigger.historyEmpty')}
            </li>
          )}
          {fires.slice(0, RECENT).map((record) => (
            <FireRow
              key={record.id}
              t={t}
              record={record}
              when={pastTime(t, record.at, now)}
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
  value: number | null
  tone?: 'sent' | 'skipped' | 'failed'
}): React.JSX.Element {
  return (
    <div className={css.stat} data-outcome={props.tone}>
      <span className={css.statLabel}>
        <span className={css.statLabelText}>{props.label}</span>
      </span>
      <RollingNumber value={props.value} className={css.statValue} />
    </div>
  )
}
