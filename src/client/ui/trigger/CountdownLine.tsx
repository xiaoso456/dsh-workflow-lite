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
import { EASE_OUT, easeOutAt, REDUCED } from '../motion/shared.ts'
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

/** 正在放的这一段：从 `from` 缓出到 `settled`（前 `settleAt` 那一截），再匀速走到 `end`。 */
interface Leg {
  from: number
  settled: number | null
  settleAt: number
  end: number
}

/**
 * 条此刻画到哪（0…1）：按正在放的那一段自己算，不读计算样式——换一项时右栏整块换了内容，
 * 一读 `getComputedStyle` 就是当场把整页样式算一遍。没在放时是行内写的那个（只在减弱动效时写），再不然是 0。
 */
function shownNow(fill: HTMLElement, animation: Animation | null, leg: Leg | null): number {
  const time = animation?.currentTime
  const duration = animation?.effect?.getTiming().duration
  if (
    animation === null ||
    leg === null ||
    typeof time !== 'number' ||
    typeof duration !== 'number'
  ) {
    const inline = /scaleX\(([^)]+)\)/.exec(fill.style.transform)?.[1]
    return inline === undefined ? 0 : Number(inline) || 0
  }
  const p = Math.min(1, Math.max(0, time / duration))
  if (leg.settled === null) return leg.from + (leg.end - leg.from) * easeOutAt(p)
  if (p < leg.settleAt) return leg.from + (leg.settled - leg.from) * easeOutAt(p / leg.settleAt)
  return leg.settled + (leg.end - leg.settled) * ((p - leg.settleAt) / (1 - leg.settleAt))
}

function useRetargetedFill(smooth: boolean, next: number | undefined, seconds: number) {
  const ref = useRef<HTMLSpanElement>(null)
  const running = useRef<Animation | null>(null)
  const leg = useRef<Leg | null>(null)

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
          leg.current = null
          fill.style.transform = scale(progress?.from ?? 0)
          return
        }
        if (progress === null && running.current === null && fill.style.transform === '') return
        const from = shownNow(fill, running.current, leg.current)
        running.current?.cancel()
        const end = progress === null ? 0 : 1
        const duration = Math.max(SETTLE_MS, progress?.left ?? 0)
        const frames: Keyframe[] = [{ transform: scale(from), easing: EASE_OUT }]
        let settled: number | null = null
        if (duration > SETTLE_MS) {
          settled = checkProgress(next, seconds, now + SETTLE_MS)?.from ?? end
          frames.push({ transform: scale(settled), offset: SETTLE_MS / duration })
        }
        frames.push({ transform: scale(end) })
        running.current = fill.animate(frames, { duration, fill: 'both' })
        leg.current = { from, settled, settleAt: SETTLE_MS / duration, end }
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
