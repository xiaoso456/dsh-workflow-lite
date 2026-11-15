/**
 * dsh-workflow-lite — 「触发」页的「时间线」：从上往下「接下来」→ 今天 → 昨天 …，一天一组，组头（哪天、日期、各种结果几次）
 * 滚动时钉在顶上；在自己的框里滚。
 *
 * 顶上按结果筛选（全部 / 已发出 / 跳过 / 失败，带条数；模型判断不需要的跟着已发出），右边换样子：清单（一行一条）、
 * 时间轴（左边一根连续的线，今天那组里有个「现在」）。样子记在浏览器里；换样子只换外面的 `data-layout`，不重建行。
 *
 * 点一条浮出详情；上下键在记录之间走。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/TimelinePane
 */

import { useState } from 'react'
import type { FireRecord, TriggerEntry } from '../../../../shared/wire/trigger.ts'
import { type TimelineLayout, useTimelineLayout } from '../../../app/timelineLayout.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import {
  countKinds,
  dayHead,
  dayOf,
  FIRE_CHANNEL_TEXT,
  FIRE_KIND_SHORT,
  type FireKind,
  groupByDay,
} from '../../../model/fireView.ts'
import { clockTime } from '../../../model/time.ts'
import {
  durationText,
  matchesOutcome,
  type OutcomeFilter,
  upcomingAt,
} from '../../../model/triggerActivity.ts'
import { statusWhen } from '../../../model/triggerNow.ts'
import { sourceText, stateBadge, stateTone } from '../../../model/triggerText.ts'
import { Icon } from '../../kit/Icon.tsx'
import { IconSwitch } from '../../kit/IconSwitch.tsx'
import { Segmented } from '../../kit/Segmented.tsx'
import { TRIGGER_ICON } from '../../trigger/TriggerMark.tsx'
import { FireRow, NowRow, PlanRow } from './FireRow.tsx'
import css from './timeline.module.css'

/** 「接下来」最多列几次。 */
const AHEAD = 3

const FILTERS: readonly { value: OutcomeFilter; label: LocaleKey }[] = [
  { value: 'all', label: 'trigger.fire.all' },
  { value: 'sent', label: 'trigger.outcome.sent' },
  { value: 'skipped', label: 'trigger.outcome.skipped' },
  { value: 'failed', label: 'trigger.outcome.failed' },
]

/** 组头上各种结果的先后。 */
const KINDS: readonly FireKind[] = ['sent', 'declined', 'skipped', 'failed']

/** 上下键在记录之间走（每条记录的第一个按钮是看详情）。 */
function walk(event: React.KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  const items = [
    ...event.currentTarget.querySelectorAll<HTMLElement>('li[data-pick] > button:first-child'),
  ]
  const at = items.indexOf(document.activeElement as HTMLElement)
  if (at < 0) return
  event.preventDefault()
  items[Math.min(items.length - 1, Math.max(0, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus()
}

export function TimelinePane(props: {
  t: T
  entry: TriggerEntry
  fires: readonly FireRecord[] | null
  /** 全部暂停着（接下来的都不会来）。 */
  paused: boolean
  sessionTitle(id: string): string | undefined
  onPick(record: FireRecord): void
  onOpenRun(instance: string): void
}): React.JSX.Element {
  const { t, entry } = props
  const { view } = entry
  const { source } = entry.data
  const [filter, setFilter] = useState<OutcomeFilter>('all')
  const [layout, setLayout] = useTimelineLayout()
  const now = Date.now()
  const today = dayOf(now)
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
  const todayFires = days[0]?.day === today ? days[0].fires : []
  const past = days.filter((group) => group.day !== today)
  const how = t(FIRE_CHANNEL_TEXT[source.kind])
  const note =
    props.fires === null
      ? null
      : fires.length === 0
        ? t('trigger.historyEmpty')
        : shown.length === 0
          ? t('trigger.fire.noneOfKind')
          : todayFires.length === 0
            ? t('hub.trgTodayNone')
            : null

  const row = (record: FireRecord): React.JSX.Element => (
    <FireRow
      key={record.id}
      t={t}
      record={record}
      when={clockTime(record.at)}
      sessionTitle={props.sessionTitle}
      onPick={props.onPick}
      onOpenRun={props.onOpenRun}
    />
  )

  return (
    <>
      <div className={css.bar}>
        <Segmented<OutcomeFilter>
          label={t('trigger.fire.filter')}
          value={filter}
          options={FILTERS.map((item) => ({
            value: item.value,
            label: t(item.label),
            count:
              props.fires === null
                ? undefined
                : fires.filter((r) => matchesOutcome(r, item.value)).length,
          }))}
          testId="wl-trigger-fire-filter"
          onChange={setFilter}
        />
        <IconSwitch<TimelineLayout>
          label={t('hub.trgLayout')}
          value={layout}
          options={[
            { value: 'list', icon: 'rows', label: t('hub.trgLayout.list') },
            { value: 'rail', icon: 'timeline', label: t('hub.trgLayout.rail') },
          ]}
          testId="wl-hub-trg-layout"
          onChange={setLayout}
        />
      </div>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 只是接住记录按钮冒上来的上下键 */}
      <div
        className={css.scroll}
        data-layout={layout}
        data-testid="wl-hub-trg-history"
        onKeyDown={walk}
      >
        {(ahead.length > 0 || waitingFor !== null) && (
          <section className={css.day} data-testid="wl-hub-trg-upcoming">
            <div className={css.head} data-ahead>
              <span className={css.fade} aria-hidden="true" />
              <span className={css.name}>
                <Icon name={TRIGGER_ICON[source.kind]} size={13} />
                {t('hub.trgUpcoming')}
              </span>
              <span className={css.date}>
                {source.kind === 'schedule'
                  ? t('hub.trgByRule')
                  : source.kind === 'poll'
                    ? t('hub.trgByInterval')
                    : ''}
              </span>
            </div>
            <ul className={css.rows}>
              {[...ahead].reverse().map((at) => {
                const head = dayHead(t, dayOf(at), now)
                return (
                  <PlanRow
                    key={at}
                    t={t}
                    at={at}
                    title={
                      source.kind === 'poll'
                        ? t('hub.trgNextCheckItem')
                        : `${head.name} ${head.date}`
                    }
                    after={t('hub.trgIn').replace('{span}', durationText(t, at - now))}
                    icon={TRIGGER_ICON[source.kind]}
                    how={how}
                  />
                )
              })}
              {waitingFor !== null && (
                <PlanRow t={t} title={waitingFor} icon={TRIGGER_ICON[source.kind]} how={how} />
              )}
            </ul>
          </section>
        )}
        <Day t={t} day={today} now={now} fires={todayFires} note={note !== null}>
          <NowRow
            t={t}
            tone={stateTone(view.state, source.kind)}
            note={`${stateBadge(t, view, source.kind)} · ${statusWhen(t, entry, now).main}`}
          />
          {todayFires.map(row)}
          {note !== null && (
            <li className={css.note} data-testid="wl-hub-trg-note">
              {note}
            </li>
          )}
        </Day>
        {past.map((group) => (
          <Day key={group.day} t={t} day={group.day} now={now} fires={group.fires}>
            {group.fires.map(row)}
          </Day>
        ))}
      </div>
    </>
  )
}

/** 一天：组头（哪天、日期、各种结果几次）+ 这天的行。 */
function Day(props: {
  t: T
  day: number
  now: number
  fires: readonly FireRecord[]
  /** 最后一行是一句话（没有点）：时间轴的线画到它前面那一行的点为止。 */
  note?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = props
  const head = dayHead(t, props.day, props.now)
  const counts = countKinds(props.fires)
  return (
    <section className={css.day}>
      <div className={css.head}>
        <span className={css.fade} aria-hidden="true" />
        <span className={css.name}>{head.name}</span>
        <span className={css.date}>{head.date}</span>
        <span className={css.sum}>
          {KINDS.filter((kind) => counts[kind] > 0).map((kind) => (
            <span key={kind} className={css.count} data-outcome={kind}>
              {t(FIRE_KIND_SHORT[kind])} {counts[kind]}
            </span>
          ))}
        </span>
      </div>
      <ul className={css.rows} data-note={props.note === true || undefined}>
        {props.children}
      </ul>
    </section>
  )
}
