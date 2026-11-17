/**
 * dsh-workflow-lite — 「触发」页的「时间线」：从上往下「排队中」→「接下来」→ 今天 → 昨天 …，一天一组，
 * 组头（哪天、日期、各种结果几次）滚动时钉在顶上；在自己的框里滚。
 *
 * 「排队中」一组只在有排着的时候有：组头写几个、在等哪个会话（点了跳过去），右边「清空」（浮出确认卡）；
 * 先收到的在上、第一个底色浅一档（下一个就是它）。它们一定比新来的先跑，所以放在「接下来」上面；
 * 筛选和条数都不算排着的，这一组不管筛哪种都在顶上。
 *
 * 顶上按结果筛选（全部 / 已发出 / 跳过 / 失败，带条数；模型判断不需要的跟着已发出），右边换样子：清单（一行一条）、
 * 时间轴（左边一根连续的线，今天那组里有个「现在」）。样子记在浏览器里；换样子只换外面的 `data-layout`，不重建行，
 * 旧样子先淡出、新样子再淡入（{@link useCrossfade} 的 through）：同样的行在两种样子里位置不同，同时淡会叠出重影；
 * 不是整块先空掉再淡进来，行高也不在眼前一下跳变。
 *
 * 点一条浮出详情；上下键在记录之间走。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/TimelinePane
 */

import { useRef, useState } from 'react'
import type { FireRecord, TriggerEntry } from '../../../../shared/wire/trigger.ts'
import { type TimelineLayout, useTimelineLayout } from '../../../app/timelineLayout.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import {
  countKinds,
  dayHead,
  dayOf,
  FIRE_CHANNEL_TEXT,
  FIRE_KIND_SHORT,
  groupByDay,
  queuedFires,
  type SettledKind,
  settledFires,
} from '../../../model/fireView.ts'
import { clockTime, durationText } from '../../../model/time.ts'
import { matchesOutcome, type OutcomeFilter, upcomingAt } from '../../../model/triggerActivity.ts'
import { statusWhen } from '../../../model/triggerNow.ts'
import { sourceFace, sourceText, stateBadge, stateTone } from '../../../model/triggerText.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { IconSwitch } from '../../kit/IconSwitch.tsx'
import { Segmented } from '../../kit/Segmented.tsx'
import ui from '../../kit/ui.module.css'
import { useCrossfade } from '../../motion/crossfade.ts'
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
const KINDS: readonly SettledKind[] = ['sent', 'declined', 'skipped', 'failed']

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
  /** 排着的在等的那个会话（「排队中」组头写）。 */
  waiting: { title: string; open?: () => void } | undefined
  /** 清空排着的。 */
  onClearQueue(): void
  onPick(record: FireRecord): void
  onOpenRun(instance: string): void
}): React.JSX.Element {
  const { t, entry } = props
  const { view } = entry
  const { source } = entry.data
  const face = sourceFace(source)
  const [filter, setFilter] = useState<OutcomeFilter>('all')
  const [layout, setLayout] = useTimelineLayout()
  // 切换按钮马上换到新的一格；记录那块拍完旧样子再换（两张快照交叉淡）。
  const scrollRef = useRef<HTMLDivElement>(null)
  const shownLayout = useCrossfade(layout, scrollRef, { through: true })
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
  const all = props.fires ?? []
  const queue = queuedFires(all)
  const fires = settledFires(all)
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

  const row = (record: FireRecord, place?: number): React.JSX.Element => (
    <FireRow
      key={record.id}
      t={t}
      record={record}
      when={clockTime(record.at)}
      {...(place === undefined ? {} : { place })}
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
        ref={scrollRef}
        className={css.scroll}
        data-layout={shownLayout}
        data-testid="wl-hub-trg-history"
        onKeyDown={walk}
      >
        {queue.length > 0 && (
          <QueueGroup
            t={t}
            count={queue.length}
            waiting={props.waiting}
            onClear={props.onClearQueue}
          >
            {queue.map((record, index) => row(record, index + 1))}
          </QueueGroup>
        )}
        {(ahead.length > 0 || waitingFor !== null) && (
          <section className={css.day} data-testid="wl-hub-trg-upcoming">
            <div className={css.head} data-ahead>
              <span className={css.fade} aria-hidden="true" />
              <span className={css.name}>
                <Icon name={TRIGGER_ICON[source.kind]} size={13} />
                {t('hub.trgUpcoming')}
              </span>
              <span className={css.date}>
                {source.kind === 'schedule' ? t('hub.trgByRule') : ''}
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
                      face === 'check' ? t('hub.trgNextCheckItem') : `${head.name} ${head.date}`
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
            tone={stateTone(view.state, face)}
            note={`${stateBadge(t, view, face)} · ${statusWhen(t, entry, now).main}`}
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

/** 「排队中」一组：组头写几个、在等哪个会话，右边「清空」（浮出确认卡再清）。 */
function QueueGroup(props: {
  t: T
  count: number
  waiting: { title: string; open?: () => void } | undefined
  onClear(): void
  children: React.ReactNode
}): React.JSX.Element {
  const { t, waiting } = props
  const clear = useConfirm<HTMLButtonElement>()
  return (
    <section className={css.day} data-testid="wl-hub-trg-queue">
      <div className={css.head} data-queue>
        <span className={css.fade} aria-hidden="true" />
        <span className={css.name}>{t('hub.trgQueue')}</span>
        <span className={css.queueNote}>
          <span className={css.queueCount}>
            {t('hub.trgQueueHead').replace('{n}', String(props.count))}
          </span>
          {waiting !== undefined && (
            <>
              <span aria-hidden="true">·</span>
              <span>{t('trigger.fire.running')}</span>
              {waiting.open === undefined ? (
                <span className={css.queueSession}>{waiting.title}</span>
              ) : (
                <button
                  type="button"
                  className={css.queueLink}
                  data-testid="wl-hub-trg-queue-session"
                  onClick={waiting.open}
                >
                  <span className={css.queueSession}>{waiting.title}</span>
                  <Icon name="external" size={12} />
                </button>
              )}
            </>
          )}
        </span>
        <button
          ref={clear.anchorRef}
          type="button"
          className={cx(ui.btn, ui.small, ui.dangerQuiet, css.queueClear)}
          aria-expanded={clear.open}
          data-testid="wl-hub-trg-queue-clear"
          onClick={clear.toggle}
        >
          {t('hub.trgQueueClear')}
        </button>
        {clear.render({
          t,
          title: t('hub.trgQueueClearTitle').replace('{n}', String(props.count)),
          desc: t('hub.trgQueueClearDesc'),
          confirmText: t('hub.trgQueueClear'),
          testId: 'wl-hub-trg-queue-clear-ok',
          onConfirm: props.onClear,
        })}
      </div>
      <ul className={css.rows}>{props.children}</ul>
    </section>
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
