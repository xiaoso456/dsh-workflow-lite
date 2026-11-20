import { type CSSProperties, useEffect, useState } from 'react'
import type { T } from '../../../i18n.ts'
import { type FireTally, HOURS } from '../../../model/triggerActivity.ts'
import { weekdayText } from '../../../model/triggerText.ts'
import css from './overview.module.css'
import {
  EMPTY_RHYTHM,
  type RhythmDot,
  type RhythmMark,
  reconcileRhythm,
  rhythmLeaving,
  settleRhythm,
} from './rhythmMotion.ts'

const AXIS_HOURS = [0, 6, 12, 18, 24]
const HOUR_SLOTS = Array.from({ length: HOURS }, (_, hour) => hour)
const EXIT_MS = 200

function dotsOf(tally: FireTally, planned: readonly number[]): RhythmDot[] {
  return tally.days.flatMap((day, row) =>
    (tally.cells[row] ?? []).flatMap<RhythmDot>((cell, hour) => {
      if (cell) return { day, hour, outcome: cell.outcome, many: cell.count > 1 }
      if (row === tally.days.length - 1 && planned.includes(hour)) {
        return { day, hour, outcome: 'plan', many: false }
      }
      return []
    }),
  )
}

export function RhythmGrid(props: {
  t: T
  selection: string
  tally: FireTally
  planned: readonly number[]
  hourNow: number
  loading: boolean
}): React.JSX.Element {
  const { t, selection, tally, planned, hourNow, loading } = props
  const [frame, setFrame] = useState(EMPTY_RHYTHM)
  const next = reconcileRhythm(frame, selection, loading ? null : dotsOf(tally, planned))
  if (next !== frame) setFrame(next)

  useEffect(() => {
    if (!rhythmLeaving(frame)) return
    const timer = window.setTimeout(() => {
      setFrame((current) => (current === frame ? settleRhythm(current) : current))
    }, EXIT_MS + 50)
    return () => window.clearTimeout(timer)
  }, [frame])

  const today = tally.days.length - 1
  const dayName = (row: number, start: number): string => {
    if (row === today) return t('trigger.fire.today')
    if (row === today - 1) return t('trigger.fire.yesterday')
    return t('hub.trgWeekday').replace('{day}', weekdayText(t, new Date(start).getDay() || 7))
  }

  return (
    <div
      className={css.rhythm}
      data-testid="wl-hub-trg-rhythm"
      style={{ '--rhythm-exit': `${EXIT_MS}ms` } as CSSProperties}
    >
      {tally.days.flatMap((start, row) => {
        const day = dayName(row, start)
        return [
          <span key={`day-${start}`} className={css.day}>
            {day}
          </span>,
          ...HOUR_SLOTS.map((hour) => {
            const cell = tally.cells[row]?.[hour]
            return (
              <span
                key={`${start}-${hour}`}
                className={css.cell}
                data-night={hour < 7 || hour > 21 || undefined}
                data-now={(row === today && hour === hourNow) || undefined}
                data-tip={
                  cell
                    ? t('hub.trgCellTip')
                        .replace('{day}', day)
                        .replace('{hour}', String(hour).padStart(2, '0'))
                        .replace('{n}', String(cell.count))
                    : undefined
                }
              />
            )
          }),
        ]
      })}
      {/*
       * 点画在格子上面的几层里（见 rhythmMotion.ts）：不动的一层一直留着；换卡片时上一张独有的点
       * 新起一层从不透明退到透明，退完这一张独有的点再新起一层淡入。
       */}
      <Dots
        key="still"
        days={tally.days}
        marks={next.marks.filter((mark) => mark.layer === 'still')}
        motion="still"
      />
      {next.outgoing.length > 0 && (
        <Dots key={`out-${next.generation}`} days={tally.days} marks={next.outgoing} motion="out" />
      )}
      <Dots
        key={`in-${next.generation}`}
        days={tally.days}
        marks={next.marks.filter((mark) => mark.layer === 'fresh')}
        motion={next.outgoing.length > 0 ? 'after' : 'in'}
      />
      <span className={css.axis}>
        {AXIS_HOURS.map((hour) => (
          <span
            key={hour}
            className={css.tick}
            style={{ left: `${String((hour / HOURS) * 100)}%` }}
            data-edge={hour === 0 ? 'start' : hour === HOURS ? 'end' : undefined}
          >
            {`${String(hour).padStart(2, '0')}:00`}
          </span>
        ))}
      </span>
    </div>
  )
}

/**
 * 一层点：每天一条轨道，点按钟点横着摆。
 * `motion`：`still` 不动；`out` 挂上就从不透明退到透明；`in` 挂上就淡入；`after` 等 `out` 退完再淡入。
 */
function Dots(props: {
  days: readonly number[]
  marks: readonly RhythmMark[]
  motion: 'still' | 'out' | 'in' | 'after'
}): React.JSX.Element {
  return (
    <span
      className={css.dots}
      data-motion={props.motion}
      style={{ '--rhythm-rows': props.days.length } as CSSProperties}
      aria-hidden
    >
      {props.days.map((start) => (
        <span key={start} className={css.track}>
          {props.marks
            .filter((mark) => mark.day === start)
            .map((mark) => (
              <span
                key={mark.id}
                className={css.mark}
                data-hour={mark.hour}
                data-outcome={mark.outcome}
                data-many={mark.many || undefined}
                data-leaving={mark.leaving || undefined}
                data-enter={mark.enter || undefined}
                style={{ '--rhythm-hour': mark.hour } as CSSProperties}
              />
            ))}
        </span>
      ))}
    </span>
  )
}
