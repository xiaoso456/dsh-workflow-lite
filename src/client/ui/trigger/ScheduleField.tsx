/**
 * dsh-workflow-lite — 定时触发的规则：间隔（每隔多久）/ 时刻（每天几点，可以几个时刻、可限定星期几）/ 五段 cron。
 *
 * 先选规则，下面是这种规则自己的几行，最后一排不带标题的常用值（`source/SchedulePresets.tsx`），点了直接改上面几行。
 * 换一种：这一张面板开着时那一种填过的先记着，换回来还在，没填过的给常用值。
 * 到点就执行的（`plain`）间隔最短 1 分钟，「秒」选不了；先跑命令判定的最短 {@link EVERY_MIN} 秒。
 * 规则的一句人话、写得不对的原因、接下来 7 天都不在这里：对话框顶上的一句话和时间轴（见 `source/ScheduleStage.tsx`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/ScheduleField
 */

import { useRef, useState } from 'react'
import {
  DAILY_TIMES_MAX,
  dailyTimes,
  EVERY_MAX,
  EVERY_MIN,
  formatClock,
  parseClock,
  withDailyTimes,
} from '../../../shared/schedule.ts'
import { PLAIN_EVERY_MIN } from '../../../shared/trigger.ts'
import type { TriggerSchedule } from '../../../shared/types.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { scheduleIssueText, weekdayChip, weekdayText } from '../../model/triggerText.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { Stepper } from '../kit/NumberStep.tsx'
import { Segmented } from '../kit/Segmented.tsx'
import { TimeField } from '../kit/TimeField.tsx'
import ui from '../kit/ui.module.css'
import { Presence } from '../motion/exits.tsx'
import { useResizeFlip } from '../motion/flip.ts'
import { useRowKeys } from '../motion/stage.tsx'
import { CronEditor } from './CronEditor.tsx'
import css from './schedule.module.css'
import { SchedulePresets } from './source/SchedulePresets.tsx'
import { StageRow } from './source/StageRow.tsx'
import row from './trigger.module.css'

type Kind = TriggerSchedule['kind']
type Daily = Extract<TriggerSchedule, { kind: 'daily' }>
type Unit = 'second' | 'minute' | 'hour'

const KINDS: readonly { value: Kind; label: LocaleKey }[] = [
  { value: 'every', label: 'trigger.kind.every' },
  { value: 'daily', label: 'trigger.kind.daily' },
  { value: 'cron', label: 'trigger.kind.cron' },
]

const UNITS: readonly { value: Unit; label: LocaleKey; seconds: number }[] = [
  { value: 'second', label: 'trigger.unit.second', seconds: 1 },
  { value: 'minute', label: 'trigger.unit.minute', seconds: 60 },
  { value: 'hour', label: 'trigger.unit.hour', seconds: 3600 },
]

/** 换一种规则时给的常用值。 */
const SEED: Record<Kind, TriggerSchedule> = {
  every: { kind: 'every', seconds: 3600 },
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

/** 秒数按哪个单位显示最顺：整小时按小时（一天写 24 小时）、整分钟按分钟，否则按秒。 */
function unitOf(seconds: number): Unit {
  if (seconds > 0 && seconds % 3600 === 0) return 'hour'
  if (seconds > 0 && seconds % 60 === 0) return 'minute'
  return 'second'
}

const sizeOf = (unit: Unit): number => UNITS.find((item) => item.value === unit)?.seconds ?? 1

export function ScheduleField(props: {
  t: T
  schedule: TriggerSchedule
  /** 到点就执行（不跑命令）：间隔最短 1 分钟，「秒」选不了。 */
  plain: boolean
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
      {/* 三种各一块：换一种时旧的收起、新的长开（高度连续变），下面的东西顺势挪，不是一下跳开。 */}
      <div className={css.kindRows}>
        <Presence show={schedule.kind === 'every'}>
          {schedule.kind === 'every' && (
            <div className={css.kindBlock}>
              <EveryRow
                t={t}
                seconds={schedule.seconds}
                plain={props.plain}
                onChange={props.onChange}
                onSeal={props.onSeal}
              />
              <SchedulePresets t={t} schedule={schedule} onChange={props.onChange} />
            </div>
          )}
        </Presence>
        <Presence show={schedule.kind === 'daily'}>
          {schedule.kind === 'daily' && (
            <div className={css.kindBlock}>
              <TimesRow t={t} schedule={schedule} onChange={props.onChange} onSeal={props.onSeal} />
              <DaysRow t={t} schedule={schedule} onChange={props.onChange} />
              <SchedulePresets t={t} schedule={schedule} onChange={props.onChange} />
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
              <SchedulePresets t={t} schedule={schedule} onChange={props.onChange} />
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
          <span key={rowKeys.keys[index]} className={css.timeBox}>
            <TimeField
              t={t}
              label={t('trigger.time')}
              value={parseClock(time) ?? 0}
              testId={index === 0 ? 'wl-trigger-time' : `wl-trigger-time-${String(index)}`}
              onChange={(minutes) =>
                set(
                  times.map((old, at) => (at === index ? formatClock(minutes) : old)),
                  true,
                )
              }
              onEnd={props.onSeal}
            >
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
            </TimeField>
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

/**
 * 「每隔多久」：一个数（「− 数 +」）加一个单位（秒 / 分钟 / 小时）。打出范围内的数当场写进草稿；
 * 超出范围的在下面说一句、不写，失焦时夹进范围（框里的数跟着变）。
 */
function EveryRow(props: {
  t: T
  seconds: number
  plain: boolean
  onChange(schedule: TriggerSchedule, typing?: boolean): void
  onSeal?(): void
}): React.JSX.Element {
  const { t, seconds, plain } = props
  const [unit, setUnit] = useState<Unit>(() => unitOf(seconds))
  /** 正在打的数（还没生效）：超出范围时下面说一句。 */
  const [typed, setTyped] = useState<number | null>(null)
  const min = plain ? PLAIN_EVERY_MIN : EVERY_MIN
  // 图里的数按现在的单位除不尽（点了常用、别处改过），或到点就执行时还停在「秒」：换成最顺的单位。
  const fits = seconds % sizeOf(unit) === 0 && !(plain && unit === 'second')
  const shown = fits ? unit : unitOf(seconds)
  const size = sizeOf(shown)
  const amount = seconds / size
  const clamp = (value: number): number => Math.min(EVERY_MAX, Math.max(min, value))
  const typedSeconds = typed === null ? null : typed * size
  const note =
    typedSeconds === null || clamp(typedSeconds) === typedSeconds
      ? ''
      : plain && typedSeconds < PLAIN_EVERY_MIN && typedSeconds >= EVERY_MIN
        ? t('trigger.issue.tooOften')
        : scheduleIssueText(t, { code: 'every', min, max: EVERY_MAX })
  return (
    <StageRow label={t('trigger.every')} note={note} problem testId="wl-trigger-every-row">
      <div className={css.every}>
        <Stepper
          label={t('trigger.every')}
          value={amount}
          min={Math.ceil(min / size)}
          max={Math.floor(EVERY_MAX / size)}
          lessLabel={t('common.decrease')}
          moreLabel={t('common.increase')}
          testId="wl-trigger-every"
          onChange={(value) => props.onChange({ kind: 'every', seconds: value * size }, true)}
          onTyped={(value) => {
            setTyped(value)
            if (value === null) props.onSeal?.()
          }}
        />
        <Segmented<Unit>
          label={t('trigger.every')}
          value={shown}
          testId="wl-trigger-unit"
          fit
          onChange={(next) => {
            if (next === shown) return
            setUnit(next)
            props.onChange({ kind: 'every', seconds: clamp(amount * sizeOf(next)) })
          }}
          options={UNITS.map((item) => ({
            value: item.value,
            label: t(item.label),
            ...(plain && item.value === 'second' ? { off: t('trigger.everyPlainMin') } : {}),
          }))}
        />
      </div>
    </StageRow>
  )
}
