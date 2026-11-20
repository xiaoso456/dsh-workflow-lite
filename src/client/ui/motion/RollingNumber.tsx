import { type CSSProperties, useEffect, useState } from 'react'
import { cx } from '../kit/cx.ts'
import css from './rollingNumber.module.css'
import { EMPTY_ROLL, reconcileRoll, settleRoll } from './rollingNumber.ts'
import { switching, useSwapSwitch } from './swapScope.tsx'

export function RollingNumber(props: {
  value: number | null
  className?: string
}): React.JSX.Element {
  const [frame, setFrame] = useState(EMPTY_ROLL)
  // 列表正在换项（外面的 SwapScope）：整个数一起换，方向跟着列表。
  const scope = useSwapSwitch()
  const next = reconcileRoll(frame, props.value, switching(scope) ? scope.dir : null)
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
      data-swap={next.swap === null ? undefined : next.swap.n % 2 === 1 ? 'a' : 'b'}
      data-swap-dir={next.swap?.dir}
      data-was={next.swap?.was}
      style={{ '--roll-places': next.places.length } as CSSProperties}
    >
      <span className={css.readout}>{next.value}</span>
      <span className={css.digits}>
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
    </span>
  )
}
