/**
 * dsh-workflow-lite — 定时触发的规则：每隔多久 / 每天几点（可限定星期几）/ 五段 cron。
 *
 * 换一种就给那一种的常用值；写得不对当场说出原因，写对了预告下一次是什么时候。
 * 放在「何时触发」那一段里（见 `SourceField.tsx`），自己不带分组标题。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/ScheduleField
 */

import { useState } from 'react'
import { EVERY_MAX, nextFire, parseClock, scheduleProblem } from '../../../shared/schedule.ts'
import type { TriggerSchedule } from '../../../shared/types.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { momentText, weekdayText } from '../../model/triggerText.ts'
import { cx } from '../kit/cx.ts'
import { Segmented } from '../kit/Segmented.tsx'
import { Select } from '../kit/Select.tsx'
import ui from '../kit/ui.module.css'
import ins from '../panel/panel.module.css'
import css from './trigger.module.css'

type Kind = TriggerSchedule['kind']
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
  /** `typing` = 正在连续输入（并成一条撤销步）。 */
  onChange(schedule: TriggerSchedule, typing?: boolean): void
  onSeal(): void
}): React.JSX.Element {
  const { t, schedule } = props
  const problem = scheduleProblem(schedule)
  const next = problem === null ? nextFire(schedule, new Date()) : null
  return (
    <>
      <Segmented<Kind>
        label={t('trigger.when')}
        value={schedule.kind}
        testId="wl-trigger-kind"
        onChange={(kind) => {
          if (kind !== schedule.kind) props.onChange(SEED[kind])
        }}
        options={KINDS.map((kind) => ({ value: kind.value, label: t(kind.label) }))}
      />
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
          <label className={css.row}>
            <span className={css.rowLabel}>{t('trigger.time')}</span>
            <input
              type="time"
              className={cx(ui.input, css.time)}
              value={parseClock(schedule.time) === null ? '' : schedule.time.padStart(5, '0')}
              aria-label={t('trigger.time')}
              data-testid="wl-trigger-time"
              onChange={(event) => {
                const time = event.currentTarget.value
                if (time !== '') props.onChange({ ...schedule, time }, true)
              }}
              onBlur={props.onSeal}
            />
          </label>
          <div className={css.row}>
            <span className={css.rowLabel}>{t('trigger.weekdays')}</span>
            <span className={css.days} role="group" aria-label={t('trigger.weekdays')}>
              {DAYS.map((day) => {
                const on = schedule.weekdays?.includes(day) === true
                return (
                  <button
                    key={day}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    className={css.day}
                    data-testid={`wl-trigger-day-${String(day)}`}
                    onClick={() => {
                      const picked = new Set(schedule.weekdays ?? [])
                      if (on) picked.delete(day)
                      else picked.add(day)
                      const weekdays = [...picked].sort((a, b) => a - b)
                      // 一天不选、七天全选都是每天：不写。
                      props.onChange(
                        weekdays.length === 0 || weekdays.length === 7
                          ? { kind: 'daily', time: schedule.time }
                          : { kind: 'daily', time: schedule.time, weekdays },
                      )
                    }}
                  >
                    {weekdayText(t, day)}
                  </button>
                )
              })}
            </span>
          </div>
          <p className={ins.help}>{t('trigger.weekdaysHint')}</p>
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
          <p className={ins.help}>{t('trigger.cronHint')}</p>
        </>
      )}
      {/* 预告与报错占同一行：换的只是字和属性。 */}
      <p
        className={problem === null ? ins.help : ins.error}
        data-testid="wl-trigger-preview"
        data-problem={problem !== null || undefined}
      >
        {problem ??
          (next === null
            ? ''
            : t('trigger.preview').replace('{time}', momentText(t, next.getTime())))}
      </p>
    </>
  )
}

/** 「每隔多久」：一个数加一个单位。数字框里是草稿，打得出一个合法的数才写进图。 */
function EveryRow(props: {
  t: T
  minutes: number
  onChange(schedule: TriggerSchedule, typing?: boolean): void
  onSeal(): void
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
      <div className={css.row}>
        <span className={css.rowLabel}>{t('trigger.every')}</span>
        <input
          className={cx(ui.input, css.number)}
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
            props.onSeal()
          }}
        />
        <Select<Unit>
          label={t('trigger.every')}
          value={shown}
          className={css.unit}
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
