import { type ReactNode, useCallback, useRef } from 'react'
import { tipWhenCut } from '../kit/cutTip.ts'
import { cx } from '../kit/cx.ts'
import css from './morphTag.module.css'
import { EASE, REDUCED } from './shared.ts'

export const TAG_MOTION_MS = 220

export function MorphTag(props: {
  text: string
  icon?: ReactNode
  className: string
  testId: string
}): React.JSX.Element {
  const face = useRef<HTMLSpanElement>(null)
  const label = useRef<HTMLSpanElement>(null)
  const stop = useRef<(() => void) | null>(null)
  const attach = useCallback((tag: HTMLSpanElement | null) => {
    stop.current?.()
    stop.current = null
    if (tag === null || typeof ResizeObserver === 'undefined') return
    let width: number | undefined
    let from = 0
    let animation: Animation | undefined
    const observer = new ResizeObserver(([size]) => {
      const surface = face.current
      if (size === undefined || surface === null) return
      const next = size.borderBoxSize[0]?.inlineSize ?? tag.offsetWidth
      if (next === width) return
      const progress = animation?.effect?.getComputedTiming().progress ?? 1
      const before = width === undefined ? next : from + (width - from) * progress
      animation?.cancel()
      animation = undefined
      width = next
      from = before
      const span = Math.max(before, next)
      surface.style.setProperty('--wl-tag-span', `${span}px`)
      const clip = (edge: number): string =>
        `inset(0 ${span - edge}px 0 0 round calc(6px * var(--wl-round, 1)))`
      surface.style.clipPath = clip(next)
      if (Math.abs(before - next) < 0.5 || REDUCED?.matches === true) return
      animation = surface.animate([{ clipPath: clip(before) }, { clipPath: clip(next) }], {
        duration: TAG_MOTION_MS,
        easing: EASE,
      })
    })
    observer.observe(tag, { box: 'border-box' })
    stop.current = () => {
      animation?.cancel()
      observer.disconnect()
    }
  }, [])

  return (
    <span
      ref={attach}
      className={cx(props.className, css.tag)}
      data-testid={props.testId}
      onPointerOverCapture={(event) => tipWhenCut(event.currentTarget, label.current, props.text)}
    >
      <span ref={face} className={css.face} data-tag-face="" aria-hidden="true" />
      <span className={css.content}>
        {props.icon}
        <span ref={label} className={css.label} data-tag-label="">
          {props.text}
        </span>
      </span>
    </span>
  )
}
