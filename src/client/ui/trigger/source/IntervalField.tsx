/**
 * dsh-workflow-lite — 轮询的间隔（「触发方式」对话框的一行设置）：一排常用间隔的胶囊，点一下就定；
 * 「自定义…」展开数字框 + 单位（间隔不是常用的那几档时一直展开）。
 *
 * 数字框里是草稿：打得出一个范围内的数才写进去；超出范围的在下面说一句、不写，失焦时夹进范围（框里的数跟着变）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/IntervalField
 */

import { useState } from 'react'
import { POLL_MAX_SECONDS, POLL_MIN_SECONDS } from '../../../../shared/trigger.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { spanText } from '../../../model/triggerSay.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { Select } from '../../kit/Select.tsx'
import ui from '../../kit/ui.module.css'
import css from './interval.module.css'
import chips from './presets.module.css'
import { StageRow } from './StageRow.tsx'
import stage from './sourceStage.module.css'

type Unit = 'second' | 'minute' | 'hour'

const UNITS: readonly { value: Unit; label: LocaleKey; seconds: number }[] = [
  { value: 'second', label: 'trigger.unit.second', seconds: 1 },
  { value: 'minute', label: 'trigger.unit.minute', seconds: 60 },
  { value: 'hour', label: 'trigger.unit.hour', seconds: 3600 },
]

/** 常用的几档（别的点「自定义…」填）。 */
export const INTERVAL_STOPS = [60, 300, 900, 3600, 86_400] as const

const sizeOf = (unit: Unit): number => UNITS.find((item) => item.value === unit)?.seconds ?? 1

function unitOf(seconds: number): Unit {
  if (seconds > 0 && seconds % 3600 === 0) return 'hour'
  if (seconds > 0 && seconds % 60 === 0) return 'minute'
  return 'second'
}

/** 是不是常用的那几档之一。 */
export function isStop(seconds: number): boolean {
  return (INTERVAL_STOPS as readonly number[]).includes(seconds)
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
  /** 点过「自定义…」。 */
  const [opened, setOpened] = useState(false)
  const custom = opened || !isStop(seconds)
  const shown = seconds % sizeOf(unit) === 0 ? unit : 'second'
  const amount = seconds / sizeOf(shown)
  const typed = draft === null ? Number.NaN : Number.parseInt(draft, 10) * sizeOf(shown)
  const outOfRange = Number.isFinite(typed) && clamp(typed) !== typed
  return (
    <StageRow
      label={t('trigger.every')}
      note={
        outOfRange ? t('trigger.issue.interval').replace('{min}', String(POLL_MIN_SECONDS)) : ''
      }
      problem
      testId="wl-trigger-poll-interval"
    >
      <div className={stage.line} role="group" aria-label={t('trigger.every')}>
        {INTERVAL_STOPS.map((stop) => {
          const on = !custom && stop === seconds
          return (
            <button
              key={stop}
              type="button"
              className={chips.chip}
              aria-pressed={on}
              data-testid={`wl-trigger-poll-every-${String(stop)}`}
              onClick={() => {
                setOpened(false)
                setDraft(null)
                setUnit(unitOf(stop))
                props.onChange(stop)
              }}
            >
              <span className={chips.check} aria-hidden="true">
                <Icon name="check" size={11} />
              </span>
              {spanText(t, stop)}
            </button>
          )
        })}
        <button
          type="button"
          className={chips.chip}
          aria-pressed={custom}
          aria-expanded={custom}
          data-testid="wl-trigger-poll-custom"
          onClick={() => setOpened(true)}
        >
          {t('trigger.everyCustom')}
        </button>
        <span className={css.custom} hidden={!custom}>
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
      </div>
    </StageRow>
  )
}
