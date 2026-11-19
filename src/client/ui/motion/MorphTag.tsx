import { type ReactNode, useCallback, useRef } from 'react'
import { tipWhenCut } from '../kit/cutTip.ts'
import { cx } from '../kit/cx.ts'
import css from './morphTag.module.css'
import { EASE, REDUCED } from './shared.ts'
import {
  EASE_GLIDE,
  SWITCH,
  type SwapSwitch,
  swapDelay,
  switching,
  useSwapSwitch,
} from './swapScope.tsx'
import { revealText, SwapText } from './swapText.tsx'

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
  const swap = useRef<SwapSwitch | null>(null)
  swap.current = useSwapSwitch()
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
      // 列表换了一项（SwapScope）：等字先换、按切换的节奏伸缩；变宽时新字跟着底色露出来。
      const onSwitch = switching(swap.current)
      const grow = next > before
      const timing: KeyframeAnimationOptions = onSwitch
        ? {
            duration: SWITCH.glide,
            delay: swapDelay(tag) + (grow ? SWITCH.enterAt : SWITCH.out),
            easing: EASE_GLIDE,
            fill: 'backwards',
          }
        : { duration: TAG_MOTION_MS, easing: EASE }
      animation = surface.animate([{ clipPath: clip(before) }, { clipPath: clip(next) }], timing)
      const text = label.current?.firstElementChild
      if (onSwitch && grow && text instanceof HTMLElement) revealText(text, next - before, timing)
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
      onPointerOverCapture={(event) =>
        tipWhenCut(
          event.currentTarget,
          label.current?.querySelector<HTMLElement>('[data-swap-now]') ?? label.current,
          props.text,
        )
      }
    >
      <span ref={face} className={css.face} data-tag-face="" aria-hidden="true" />
      <span className={css.content}>
        {props.icon}
        <span ref={label} className={css.label} data-tag-label="">
          <SwapText text={props.text} />
        </span>
      </span>
    </span>
  )
}
