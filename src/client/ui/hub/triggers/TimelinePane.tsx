/**
 * dsh-workflow-lite — 「触发」页的「时间线」：一条竖线从上往下是「接下来」（虚线圈）→「现在」（状态、立即触发）→ 之前，
 * 之前的按天分段（日子的小标题滚动时钉在顶上），每条一行、行高固定，在自己的框里滚。
 *
 * 顶上按结果筛选（全部 / 已发出 / 跳过 / 失败；模型判断不需要的跟着已发出）。点一条浮出详情。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/TimelinePane
 */

import { useState } from 'react'
import type { FireRecord, TriggerEntry } from '../../../../shared/wire/trigger.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { dayText, groupByDay } from '../../../model/fireView.ts'
import { clockTime } from '../../../model/time.ts'
import { matchesOutcome, type OutcomeFilter, upcomingAt } from '../../../model/triggerActivity.ts'
import { statusWhen } from '../../../model/triggerNow.ts'
import { momentText, sourceText, stateBadge, stateTone } from '../../../model/triggerText.ts'
import { cx } from '../../kit/cx.ts'
import { Segmented } from '../../kit/Segmented.tsx'
import { FireNow } from '../../trigger/FireNow.tsx'
import tone from '../../trigger/stateTone.module.css'
import { FireRow } from './FireRow.tsx'
import css from './timeline.module.css'

/** 「接下来」最多列几次。 */
const AHEAD = 3

const FILTERS: readonly { value: OutcomeFilter; label: LocaleKey }[] = [
  { value: 'all', label: 'trigger.fire.all' },
  { value: 'sent', label: 'trigger.outcome.sent' },
  { value: 'skipped', label: 'trigger.outcome.skipped' },
  { value: 'failed', label: 'trigger.outcome.failed' },
]

export function TimelinePane(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  fires: readonly FireRecord[] | null
  /** 全部暂停着（接下来的都不会来）。 */
  paused: boolean
  onPick(record: FireRecord): void
  onOpenRun(instance: string): void
}): React.JSX.Element {
  const { t, entry } = props
  const { view } = entry
  const { source } = entry.data
  const [filter, setFilter] = useState<OutcomeFilter>('all')
  const now = Date.now()
  const live = !props.paused && (view.state === 'waiting' || view.state === 'listening')
  const ahead = props.paused ? [] : upcomingAt(source, view, now, AHEAD)
  // 被动的（等外面来事、等别的工作流）没有排好的时刻：开着时说一句在等什么。
  const waitingFor =
    ahead.length === 0 && live
      ? source.kind === 'after'
        ? sourceText(t, source)
        : t('hub.trgWaitOutside')
      : null
  const fires = props.fires ?? []
  const shown = fires.filter((record) => matchesOutcome(record, filter))
  const days = groupByDay(shown)

  return (
    <>
      <div className={css.bar}>
        <Segmented<OutcomeFilter>
          label={t('trigger.fire.filter')}
          value={filter}
          options={FILTERS.map((item) => ({ value: item.value, label: t(item.label) }))}
          testId="wl-trigger-fire-filter"
          onChange={setFilter}
        />
        <span className={css.aside}>{t('hub.trgFireTip')}</span>
      </div>
      <div className={css.scroll} data-testid="wl-hub-trg-history">
        <div className={css.line}>
          {(ahead.length > 0 || waitingFor !== null) && (
            <>
              <p className={css.label}>{t('hub.trgUpcoming')}</p>
              {[...ahead].reverse().map((at) => (
                <div key={at} className={css.future}>
                  <time className={css.futureTime}>{momentText(t, at, now)}</time>
                  <span className={css.futureWhat}>
                    {source.kind === 'poll' ? t('hub.trgNextCheckItem') : ''}
                  </span>
                </div>
              ))}
              {waitingFor !== null && (
                <div className={css.future}>
                  <span className={css.futureWhat}>{waitingFor}</span>
                </div>
              )}
            </>
          )}
          <p className={css.label}>{t('hub.trgNow')}</p>
          <div
            className={cx(css.now, tone.tone)}
            data-tone={stateTone(view.state, source.kind)}
            data-testid="wl-hub-trg-now"
          >
            <span className={css.nowState}>
              <span className={tone.dot} aria-hidden="true" />
              {stateBadge(t, view, source.kind)}
            </span>
            <span className={css.nowWhen}>{statusWhen(t, entry, now).main}</span>
            <FireNow
              t={t}
              testId="wl-hub-trg-tl"
              fire={(info) => props.hub.fire(entry.workflow, view.node, info)}
            />
          </div>
          {props.fires !== null && fires.length === 0 && (
            <>
              <p className={css.label}>{t('hub.trgEarlier')}</p>
              <p className={css.none}>{t('trigger.historyEmpty')}</p>
            </>
          )}
          {fires.length > 0 && shown.length === 0 && (
            <p className={css.none}>{t('trigger.fire.noneOfKind')}</p>
          )}
          {days.map((group) => (
            <section key={group.day} className={css.day}>
              <p className={css.label}>{dayText(t, group.day, now)}</p>
              <ul className={css.items}>
                {group.fires.map((record) => (
                  <FireRow
                    key={record.id}
                    t={t}
                    record={record}
                    when={clockTime(record.at)}
                    onPick={props.onPick}
                    onOpenRun={props.onOpenRun}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
