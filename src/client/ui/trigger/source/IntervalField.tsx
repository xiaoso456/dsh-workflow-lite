/**
 * dsh-workflow-lite — 轮询的间隔：一条带刻度的滑条（10 秒 … 1 天几档常用的），旁边一个数加一个单位，两边连着。
 *
 * 数字框里是草稿：打得出一个范围内的数才写进去；超出范围的在下面说一句、不写，失焦时夹进范围（框里的数跟着变）。
 * 滑条只停在刻度上；数字框里写了刻度之间的值，滑块停在最近的那一档下面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/IntervalField
 */

import { useState } from 'react'
import { POLL_MAX_SECONDS, POLL_MIN_SECONDS } from '../../../../shared/trigger.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { spanText } from '../../../model/triggerSay.ts'
import { cx } from '../../kit/cx.ts'
import { Select } from '../../kit/Select.tsx'
import ui from '../../kit/ui.module.css'
import css from './interval.module.css'
import stage from './sourceStage.module.css'

type Unit = 'second' | 'minute' | 'hour'

const UNITS: readonly { value: Unit; label: LocaleKey; seconds: number }[] = [
  { value: 'second', label: 'trigger.unit.second', seconds: 1 },
  { value: 'minute', label: 'trigger.unit.minute', seconds: 60 },
  { value: 'hour', label: 'trigger.unit.hour', seconds: 3600 },
]

/** 滑条上的几档。 */
export const INTERVAL_STOPS = [10, 30, 60, 300, 900, 1800, 3600, 6 * 3600, 86_400] as const

const sizeOf = (unit: Unit): number => UNITS.find((item) => item.value === unit)?.seconds ?? 1

function unitOf(seconds: number): Unit {
  if (seconds > 0 && seconds % 3600 === 0) return 'hour'
  if (seconds > 0 && seconds % 60 === 0) return 'minute'
  return 'second'
}

/** 滑块停在哪一档：不超过它的最大一档。 */
export function stopOf(seconds: number): number {
  let index = 0
  INTERVAL_STOPS.forEach((stop, at) => {
    if (stop <= seconds) index = at
  })
  return index
}

/** 刻度下的短写法：「10秒」「5分」「6时」「1天」。 */
function tickText(t: T, seconds: number): string {
  const [key, size]: [LocaleKey, number] =
    seconds % 86_400 === 0
      ? ['trigger.tick.d', 86_400]
      : seconds % 3600 === 0
        ? ['trigger.tick.h', 3600]
        : seconds % 60 === 0
          ? ['trigger.tick.m', 60]
          : ['trigger.tick.s', 1]
  return t(key).replace('{n}', String(seconds / size))
}

const clamp = (value: number): number =>
  Math.min(POLL_MAX_SECONDS, Math.max(POLL_MIN_SECONDS, value))

export function IntervalField(props: {
  t: T
  seconds: number
  onChange(seconds: number): void
}): React.JSX.Element {
  const { t, seconds } = props
  const [unit, setUnit] = useState<Unit>(() => unitOf(seconds))
  const [draft, setDraft] = useState<string | null>(null)
  const shown = seconds % sizeOf(unit) === 0 ? unit : 'second'
  const amount = seconds / sizeOf(shown)
  const typed = draft === null ? Number.NaN : Number.parseInt(draft, 10) * sizeOf(shown)
  const outOfRange = Number.isFinite(typed) && clamp(typed) !== typed
  const stop = stopOf(seconds)
  const exact = INTERVAL_STOPS[stop] === seconds
  return (
    <section className={stage.section}>
      <p className={stage.head}>
        {t('trigger.every')}
        <span className={stage.headAside}>
          <input
            className={cx(ui.input, css.number)}
            inputMode="numeric"
            value={draft ?? String(amount)}
            aria-label={t('trigger.every')}
            aria-invalid={outOfRange}
            data-testid="wl-trigger-poll-every"
            onChange={(event) => {
              const text = event.currentTarget.value.replace(/[^\d]/gu, '')
              setDraft(text)
              const value = Number.parseInt(text, 10) * sizeOf(shown)
              if (Number.isFinite(value) && clamp(value) === value) props.onChange(value)
            }}
            onBlur={() => {
              if (outOfRange) props.onChange(clamp(typed))
              setDraft(null)
            }}
          />
          <Select<Unit>
            t={t}
            label={t('trigger.every')}
            value={shown}
            className={css.unit}
            testId="wl-trigger-poll-unit"
            onChange={(next) => {
              setUnit(next)
              setDraft(null)
              props.onChange(clamp(amount * sizeOf(next)))
            }}
            options={UNITS.map((item) => ({ value: item.value, label: t(item.label) }))}
          />
        </span>
      </p>
      <div
        className={css.slider}
        style={{ '--at': String(stop / (INTERVAL_STOPS.length - 1)) } as React.CSSProperties}
      >
        <input
          type="range"
          className={css.range}
          min={0}
          max={INTERVAL_STOPS.length - 1}
          step={1}
          value={stop}
          aria-label={t('trigger.every')}
          aria-valuetext={spanText(t, seconds)}
          data-testid="wl-trigger-poll-slider"
          onChange={(event) => {
            const next = INTERVAL_STOPS[Number(event.currentTarget.value)]
            if (next === undefined) return
            setDraft(null)
            setUnit(unitOf(next))
            props.onChange(next)
          }}
        />
        <span className={css.ticks} aria-hidden="true">
          {INTERVAL_STOPS.map((value, index) => (
            <span key={value} className={css.tick} data-on={exact && index === stop}>
              {tickText(t, value)}
            </span>
          ))}
        </span>
      </div>
      <p
        className={stage.error}
        role={outOfRange ? 'alert' : undefined}
        data-testid="wl-trigger-poll-range"
      >
        {outOfRange ? t('trigger.issue.interval').replace('{min}', String(POLL_MIN_SECONDS)) : ''}
      </p>
    </section>
  )
}
