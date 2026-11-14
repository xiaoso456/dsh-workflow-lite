/**
 * dsh-workflow-lite — 定时触发的规则：每隔多久 / 每天几点（可以几个时刻、可限定星期几）/ 五段 cron。
 *
 * 先选规则，下面一行是这种规则的常用值（`source/SchedulePresets.tsx`），再下面是这种规则自己的几行。
 * 换一种：这一张面板开着时那一种填过的先记着，换回来还在，没填过的给常用值。
 * 规则的一句人话、写得不对的原因、接下来 7 天都不在这里：对话框顶上的一句话和时间轴（见 `source/ScheduleStage.tsx`）。
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
  withDailyTimes,
} from '../../../shared/schedule.ts'
import type { TriggerSchedule } from '../../../shared/types.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { weekdayChip, weekdayText } from '../../model/triggerText.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { Segmented } from '../kit/Segmented.tsx'
import { Select } from '../kit/Select.tsx'
import ui from '../kit/ui.module.css'
import { Presence } from '../motion/exits.tsx'
import { useResizeFlip } from '../motion/flip.ts'
import { useRowKeys } from '../motion/stage.tsx'
import { CronEditor } from './CronEditor.tsx'
import css from './schedule.module.css'
import { SchedulePresets } from './source/SchedulePresets.tsx'
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
      <div className={row.row}>
        <span className={row.lead}>{t('trigger.presets')}</span>
        <SchedulePresets t={t} schedule={schedule} onChange={props.onChange} />
      </div>
      {/* 三种各一块：换一种时旧的收起、新的长开（高度连续变），下面的东西顺势挪，不是一下跳开。 */}
      <div className={css.kindRows}>
        <Presence show={schedule.kind === 'every'}>
          {schedule.kind === 'every' && (
            <div className={css.kindBlock}>
              <EveryRow
                t={t}
                minutes={schedule.minutes}
                onChange={props.onChange}
                onSeal={props.onSeal}
              />
            </div>
          )}
        </Presence>
        <Presence show={schedule.kind === 'daily'}>
          {schedule.kind === 'daily' && (
            <div className={css.kindBlock}>
              <TimesRow t={t} schedule={schedule} onChange={props.onChange} onSeal={props.onSeal} />
              <DaysRow t={t} schedule={schedule} onChange={props.onChange} />
            </div>
          )}
        </Presence>
        <Presence show={schedule.kind === 'cron'}>
          {schedule.kind === 'cron' && (
            <div className={css.kindBlock}>
              <div className={cx(row.row, css.top)}>
                <span className={cx(row.lead, css.leadCron)}>{t('trigger.cronLead')}</span>
                <div className={css.cron}>
                  <CronEditor
                    t={t}
                    expression={schedule.expression}
                    onChange={(expression, typing) =>
                      props.onChange({ kind: 'cron', expression }, typing)
                    }
                    onSeal={props.onSeal}
                  />
                </div>
              </div>
            </div>
          )}
        </Presence>
      </div>
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
  // 时刻按位置认，配一串稳定的键：去掉中间一个时，没的是那一个框（留个影子淡掉），后面的滑过来。
  const rowKeys = useRowKeys(times.length)
  const flip = useResizeFlip({ exit: true, enter: true })
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
      <div ref={flip} className={css.times}>
        {times.map((time, index) => (
          <span key={rowKeys.keys[index]} className={css.timeBox} data-removable={times.length > 1}>
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
                onClick={() => {
                  rowKeys.drop(index)
                  set(times.filter((_, at) => at !== index))
                }}
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
  )
}
