import { type CSSProperties, useEffect, useState } from 'react'
import type { T } from '../../../i18n.ts'
import { type FireTally, HOURS } from '../../../model/triggerActivity.ts'
import { weekdayText } from '../../../model/triggerText.ts'
import css from './overview.module.css'
import { EMPTY_RHYTHM, type RhythmDot, reconcileRhythm } from './rhythmMotion.ts'

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
    if (!frame.marks.some((mark) => mark.leaving)) return
    const timer = window.setTimeout(() => {
      setFrame((current) =>
        current === frame
          ? { ...current, marks: current.marks.filter((mark) => !mark.leaving) }
          : current,
      )
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
          <span
            key={`track-${start}`}
            className={css.track}
            style={{ gridRow: `${row + 1} / span 1` }}
            aria-hidden
          >
            {next.marks
              .filter((mark) => mark.day === start)
              .map((mark) => (
                <span
                  key={mark.id}
                  className={css.mark}
                  data-hour={mark.hour}
                  data-outcome={mark.outcome}
                  data-many={mark.many || undefined}
                  data-leaving={mark.leaving || undefined}
                  style={{ '--rhythm-hour': mark.hour } as CSSProperties}
                />
              ))}
          </span>,
        ]
      })}
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
