import { type CSSProperties, useEffect, useState } from 'react'
import { cx } from '../kit/cx.ts'
import css from './rollingNumber.module.css'
import { EMPTY_ROLL, reconcileRoll, settleRoll } from './rollingNumber.ts'

export function RollingNumber(props: {
  value: number | null
  className?: string
}): React.JSX.Element {
  const [frame, setFrame] = useState(EMPTY_ROLL)
  const next = reconcileRoll(frame, props.value)
  if (next !== frame) setFrame(next)

  useEffect(() => {
    if (!frame.places.some((place) => place.digit === null || place.glyphs.length > 1)) return
    const timer = window.setTimeout(() => {
      setFrame((current) => (current === frame ? settleRoll(current) : current))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [frame])

  return (
    <span
      className={cx(props.className, css.number)}
      data-value={next.value ?? undefined}
      data-roll={next.direction || undefined}
      style={{ '--roll-places': next.places.length } as CSSProperties}
    >
      <span className={css.readout}>{next.value}</span>
      {next.places.map((place) => (
        <span
          key={place.power}
          className={css.place}
          data-place={place.power}
          data-retiring={place.digit === null || undefined}
          style={{ '--roll-power': place.power } as CSSProperties}
          aria-hidden
        >
          {place.glyphs.map((glyph) => (
            <span
              key={glyph.digit}
              className={css.glyph}
              data-digit={glyph.digit}
              data-exit={glyph.exit ?? undefined}
            />
          ))}
        </span>
      ))}
    </span>
  )
}
