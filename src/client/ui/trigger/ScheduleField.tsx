/**
 * dsh-workflow-lite — 定时触发的规则：每隔多久 / 每天几点（可以几个时刻、可限定星期几）/ 五段 cron。
 *
 * 换一种：这一张面板开着时那一种填过的先记着，换回来还在，没填过的给常用值；
 * 写得不对当场说出原因（按界面语言）；cron 写对了在下面说一句相当于什么。
 * 「接下来几次」不在这里：对话框的右栏列（`Upcoming.tsx`）。
 * 放在「触发方式」那一段里（见 `SourceField.tsx`），自己不带分组标题。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/ScheduleField
 */

import { useRef, useState } from 'react'
import {
  DAILY_TIMES_MAX,
  dailyTimes,
  EVERY_MAX,
  formatClock,
  parseClock,
  scheduleIssue,
  withDailyTimes,
} from '../../../shared/schedule.ts'
import type { TriggerSchedule } from '../../../shared/types.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { scheduleIssueText, weekdayChip, weekdayText } from '../../model/triggerText.ts'
import { cronPhrase } from '../../model/triggerUpcoming.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { Segmented } from '../kit/Segmented.tsx'
import { Select } from '../kit/Select.tsx'
import ui from '../kit/ui.module.css'
import ins from '../panel/panel.module.css'
import css from './schedule.module.css'
import row from './trigger.module.css'

type Kind = TriggerSchedule['kind']
type Daily = Extract<TriggerSchedule, { kind: 'daily' }>
type Unit = 'minute' | 'hour' | 'day'

const KINDS: readonly { value: Kind; label: LocaleKey }[] = [
  { value: 'every', label: 'trigger.kind.every' },
  { value: 'daily', label: 'trigger.kind.daily' },
  { value: 'cron', label: 'trigger.kind.cron' },
]

const UNITS: readonly { value: Unit; label: LocaleKey; minutes: number }[] = [
  { value: 'minute', label: 'trigger.unit.minute', minutes: 1 },
  { value: 'hour', label: 'trigger.unit.hour', minutes: 60 },
  { value: 'day', label: 'trigger.unit.day', minutes: 1440 },
]

/** 换一种规则时给的常用值。 */
const SEED: Record<Kind, TriggerSchedule> = {
  every: { kind: 'every', minutes: 60 },
  daily: { kind: 'daily', time: '09:00' },
  cron: { kind: 'cron', expression: '0 9 * * 1-5' },
}

const DAYS = [1, 2, 3, 4, 5, 6, 7] as const

/** 星期的三种常用选法；`days` 空着 = 每天（图里不写 `weekdays`）。 */
const DAY_SETS: readonly { id: string; label: LocaleKey; days: readonly number[] }[] = [
  { id: 'all', label: 'trigger.days.all', days: [] },
  { id: 'work', label: 'trigger.days.work', days: [1, 2, 3, 4, 5] },
  { id: 'weekend', label: 'trigger.days.weekend', days: [6, 7] },
]

/** 分钟数按哪个单位显示最顺：整天按天、整小时按小时，否则按分钟。 */
function unitOf(minutes: number): Unit {
  if (minutes > 0 && minutes % 1440 === 0) return 'day'
  if (minutes > 0 && minutes % 60 === 0) return 'hour'
  return 'minute'
}

const sizeOf = (unit: Unit): number => UNITS.find((item) => item.value === unit)?.minutes ?? 1

export function ScheduleField(props: {
  t: T
  schedule: TriggerSchedule
  /** `typing` = 正在连续输入（在对话框里改的是草稿，用不上）。 */
  onChange(schedule: TriggerSchedule, typing?: boolean): void
  /** 一段连续输入结束（失焦）；草稿里用不上。 */
  onSeal?(): void
}): React.JSX.Element {
  const { t, schedule } = props
  const issue = scheduleIssue(schedule)
  const problem = issue === null ? null : scheduleIssueText(t, issue)
  const phrase =
    schedule.kind === 'cron' && problem === null ? cronPhrase(t, schedule.expression) : null
  /** 这张面板开着时各种规则填过的样子。 */
  const kept = useRef(new Map<Kind, TriggerSchedule>())
  return (
    <>
      <div className={row.row}>
        <span className={row.lead}>{t('trigger.rule')}</span>
        <div className={css.kinds}>
          <Segmented<Kind>
            label={t('trigger.rule')}
            value={schedule.kind}
            testId="wl-trigger-kind"
            onChange={(kind) => {
              if (kind === schedule.kind) return
              kept.current.set(schedule.kind, schedule)
              props.onChange(kept.current.get(kind) ?? SEED[kind])
            }}
            options={KINDS.map((kind) => ({ value: kind.value, label: t(kind.label) }))}
          />
        </div>
      </div>
      {schedule.kind === 'every' && (
        <EveryRow
          t={t}
          minutes={schedule.minutes}
          onChange={props.onChange}
          onSeal={props.onSeal}
        />
      )}
      {schedule.kind === 'daily' && (
        <>
          <TimesRow t={t} schedule={schedule} onChange={props.onChange} onSeal={props.onSeal} />
          <DaysRow t={t} schedule={schedule} onChange={props.onChange} />
        </>
      )}
      {schedule.kind === 'cron' && (
        <>
          <input
            className={cx(ui.input, ui.mono)}
            value={schedule.expression}
            placeholder="0 9 * * 1-5"
            spellCheck={false}
            aria-label={t('trigger.cron')}
            aria-invalid={problem !== null}
            data-testid="wl-trigger-cron"
            onChange={(event) =>
              props.onChange({ kind: 'cron', expression: event.currentTarget.value }, true)
            }
            onBlur={props.onSeal}
          />
          {/* 一直挂着，只换字：写对了又说得成一句话时是「相当于：…」，否则是五段的说明。 */}
          <p className={ins.help} data-testid="wl-trigger-cron-phrase">
            {phrase === null
              ? t('trigger.cronHint')
              : t('trigger.cronMeans').replace('{rule}', phrase)}
          </p>
        </>
      )}
      {/* 一直挂着：写得不对才有字。 */}
      <p className={ins.error} data-testid="wl-trigger-preview" hidden={problem === null}>
        {problem ?? ''}
      </p>
    </>
  )
}

/** 「每天」的时刻：一个时刻一个框，可以加、可以去掉（只剩一个时不能去）。顺序照写着的，保存时才排。 */
function TimesRow(props: {
  t: T
  schedule: Daily
  onChange(schedule: TriggerSchedule, typing?: boolean): void
  onSeal?(): void
}): React.JSX.Element {
  const { t, schedule } = props
  const times = dailyTimes(schedule)
  const set = (next: readonly string[], typing?: boolean): void =>
    props.onChange(withDailyTimes(schedule, next), typing)
  /** 新加的时刻：最后一个往后一小时（过了半夜就绕回来），和已有的重了再往后挪。 */
  const add = (): void => {
    const taken = new Set(times.map((time) => parseClock(time)))
    let clock = ((parseClock(times[times.length - 1] ?? '') ?? 8 * 60) + 60) % 1440
    while (taken.has(clock)) clock = (clock + 60) % 1440
    set([...times, formatClock(clock)])
  }
  return (
    <div className={cx(row.row, css.top)}>
      <span className={cx(row.lead, css.leadTop)}>{t('trigger.time')}</span>
      <div className={css.times}>
        {times.map((time, index) => (
          // 顺序就是身份：改一个时刻时别的框不动。
          // biome-ignore lint/suspicious/noArrayIndexKey: 时刻会被改写，没有别的稳定标识
          <span key={index} className={css.timeBox} data-removable={times.length > 1}>
            <input
              type="time"
              className={cx(ui.input, css.time)}
              value={parseClock(time) === null ? '' : formatClock(parseClock(time) as number)}
              aria-label={t('trigger.time')}
              data-testid={index === 0 ? 'wl-trigger-time' : `wl-trigger-time-${String(index)}`}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value !== '') {
                  set(
                    times.map((old, at) => (at === index ? value : old)),
                    true,
                  )
                }
              }}
              onBlur={props.onSeal}
            />
            {times.length > 1 && (
              <button
                type="button"
                className={css.timeRemove}
                aria-label={t('trigger.timeRemove')}
                data-tip={t('trigger.timeRemove')}
                data-testid={`wl-trigger-time-remove-${String(index)}`}
                onClick={() => set(times.filter((_, at) => at !== index))}
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </span>
        ))}
        <button
          type="button"
          className={cx(ui.btn, ui.small, css.timeAdd)}
          disabled={times.length >= DAILY_TIMES_MAX}
          data-testid="wl-trigger-time-add"
          onClick={add}
        >
          <Icon name="plus" size={13} />
          {t('trigger.timeAdd')}
        </button>
      </div>
    </div>
  )
}

/** 「每天」限定星期几：七个小格（不限定时七个都亮），旁边三种常用选法。 */
function DaysRow(props: {
  t: T
  schedule: Daily
  onChange(schedule: TriggerSchedule): void
}): React.JSX.Element {
  const { t, schedule } = props
  const picked: readonly number[] = schedule.weekdays ?? DAYS
  /** 一天不选、七天全选都是每天：不写。 */
  const set = (days: readonly number[]): void => {
    const weekdays = [...days].sort((a, b) => a - b)
    const { weekdays: _dropped, ...rest } = schedule
    props.onChange(weekdays.length === 0 || weekdays.length === 7 ? rest : { ...rest, weekdays })
  }
  const same = (days: readonly number[]): boolean =>
    days.length === 0
      ? schedule.weekdays === undefined
      : schedule.weekdays?.length === days.length && days.every((day) => picked.includes(day))
  return (
    <div className={cx(row.row, css.wrap)}>
      <span className={row.lead}>{t('trigger.weekdays')}</span>
      <span className={css.days} role="group" aria-label={t('trigger.weekdays')}>
        {DAYS.map((day) => {
          const on = picked.includes(day)
          return (
            <button
              key={day}
              type="button"
              role="checkbox"
              aria-checked={on}
              className={css.day}
              aria-label={weekdayText(t, day)}
              data-testid={`wl-trigger-day-${String(day)}`}
              onClick={() => set(on ? picked.filter((other) => other !== day) : [...picked, day])}
            >
              {weekdayChip(t, day)}
            </button>
          )
        })}
      </span>
      <span className={css.daySets}>
        {DAY_SETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={css.daySet}
            aria-pressed={same(item.days)}
            data-testid={`wl-trigger-days-${item.id}`}
            onClick={() => set(item.days)}
          >
            {t(item.label)}
          </button>
        ))}
      </span>
    </div>
  )
}

/** 「每隔多久」：一个数加一个单位。数字框里是草稿，打得出一个合法的数才写进图。 */
function EveryRow(props: {
  t: T
  minutes: number
  onChange(schedule: TriggerSchedule, typing?: boolean): void
  onSeal?(): void
}): React.JSX.Element {
  const { t, minutes } = props
  const [unit, setUnit] = useState<Unit>(() => unitOf(minutes))
  const [draft, setDraft] = useState<string | null>(null)
  // 图里的数按现在的单位除不尽（别处改过）：退回按分钟显示。
  const shown = minutes % sizeOf(unit) === 0 ? unit : 'minute'
  const amount = minutes / sizeOf(shown)
  const commit = (text: string, size: number): void => {
    const value = Number.parseInt(text, 10)
    if (!Number.isFinite(value) || value < 1) return
    props.onChange({ kind: 'every', minutes: Math.min(EVERY_MAX, value * size) }, true)
  }
  return (
    <>
      <div className={row.row}>
        <span className={row.lead}>{t('trigger.every')}</span>
        <input
          className={cx(ui.input, row.number)}
          inputMode="numeric"
          value={draft ?? String(amount)}
          aria-label={t('trigger.every')}
          data-testid="wl-trigger-every"
          onChange={(event) => {
            const text = event.currentTarget.value.replace(/[^\d]/gu, '')
            setDraft(text)
            commit(text, sizeOf(shown))
          }}
          onBlur={() => {
            setDraft(null)
            props.onSeal?.()
          }}
        />
        <Select<Unit>
          t={t}
          label={t('trigger.every')}
          value={shown}
          className={row.unit}
          testId="wl-trigger-unit"
          onChange={(nextUnit) => {
            setUnit(nextUnit)
            setDraft(null)
            props.onChange({
              kind: 'every',
              minutes: Math.min(EVERY_MAX, amount * sizeOf(nextUnit)),
            })
          }}
          options={UNITS.map((item) => ({ value: item.value, label: t(item.label) }))}
        />
      </div>
      <p className={ins.help}>{t('trigger.everyHint')}</p>
    </>
  )
}
