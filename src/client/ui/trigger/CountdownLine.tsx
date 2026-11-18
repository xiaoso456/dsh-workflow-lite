/**
 * dsh-workflow-lite — 沿底边一条走到下一次的倒计时：画布卡片上轮询的速览、工作流中心「触发」页的状态条共用。
 *
 * 一直挂着，按属性显隐（宿主的 `:has` 样式让任何插拔都整页重算）；只在换了一段（下一次变了）时重算起点和时长，
 * 中途别的字段变了也不打断。画布直接走当前一段，工作流中心从上一次画到的位置平滑接上。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/CountdownLine
 */

import { useEffect, useMemo, useRef } from 'react'
import { checkProgress } from '../../model/triggerGlance.ts'
import { cx } from '../kit/cx.ts'
import { EASE_OUT, REDUCED } from '../motion/shared.ts'
import { useLast } from '../motion/swapText.tsx'
import css from './countdown.module.css'

export function CountdownLine(props: {
  /** 下一次的时刻；没有（关着、出错）时不走、淡掉。 */
  next: number | undefined
  /** 一段有多长（秒）。 */
  seconds: number
  className?: string
  smooth?: boolean
}): React.JSX.Element {
  const { next, seconds, smooth = false } = props
  const progress = useMemo(() => checkProgress(next, seconds, Date.now()), [next, seconds])
  const { n } = useLast(smooth ? undefined : next, 0)
  const fill = useRetargetedFill(smooth, next, seconds)
  return (
    <span
      className={cx(css.track, props.className)}
      data-run={progress !== null}
      data-smooth={smooth || undefined}
      aria-hidden="true"
    >
      <span
        className={css.fill}
        ref={smooth ? fill : undefined}
        data-cycle={smooth ? undefined : n % 2 === 0 ? 'a' : 'b'}
        style={
          smooth
            ? undefined
            : ({
                '--from': progress?.from ?? 0,
                '--left': `${String(progress?.left ?? 0)}ms`,
              } as React.CSSProperties)
        }
      />
    </span>
  )
}

const SETTLE_MS = 220
const scale = (fraction: number): string => `scaleX(${String(fraction)})`

function useRetargetedFill(smooth: boolean, next: number | undefined, seconds: number) {
  const ref = useRef<HTMLSpanElement>(null)
  const running = useRef<Animation | null>(null)

  useEffect(() => {
    const fill = ref.current
    if (!smooth || fill === null) return
    let frame = 0
    const play = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const now = Date.now()
        const progress = checkProgress(next, seconds, now)
        if (REDUCED?.matches || typeof fill.animate !== 'function') {
          running.current?.cancel()
          running.current = null
          fill.style.transform = scale(progress?.from ?? 0)
          return
        }
        if (progress === null && running.current === null && fill.style.transform === '') return
        const from = new DOMMatrixReadOnly(getComputedStyle(fill).transform).m11
        running.current?.cancel()
        const end = progress === null ? 0 : 1
        const duration = Math.max(SETTLE_MS, progress?.left ?? 0)
        const frames: Keyframe[] = [{ transform: scale(from), easing: EASE_OUT }]
        if (duration > SETTLE_MS) {
          const settled = checkProgress(next, seconds, now + SETTLE_MS)?.from ?? end
          frames.push({ transform: scale(settled), offset: SETTLE_MS / duration })
        }
        frames.push({ transform: scale(end) })
        running.current = fill.animate(frames, { duration, fill: 'both' })
      })
    }
    play()
    REDUCED?.addEventListener('change', play)
    return () => {
      cancelAnimationFrame(frame)
      REDUCED?.removeEventListener('change', play)
    }
  }, [smooth, next, seconds])

  useEffect(() => () => running.current?.cancel(), [])
  return ref
}
