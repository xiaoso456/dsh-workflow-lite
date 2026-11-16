/**
 * dsh-workflow-lite — 沿底边一条走到下一次的倒计时：画布卡片上轮询的速览、工作流中心「触发」页的状态条共用。
 *
 * 一直挂着，按属性显隐（宿主的 `:has` 样式让任何插拔都整页重算）；只在换了一段（下一次变了）时重算起点和时长，
 * 中途别的字段变了也不打断。换一段时动画名在 a / b 间切，从头再放。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/CountdownLine
 */

import { useMemo } from 'react'
import { checkProgress } from '../../model/triggerGlance.ts'
import { cx } from '../kit/cx.ts'
import { useLast } from '../motion/swapText.tsx'
import css from './countdown.module.css'

export function CountdownLine(props: {
  /** 下一次的时刻；没有（关着、出错）时不走、淡掉。 */
  next: number | undefined
  /** 一段有多长（秒）。 */
  seconds: number
  className?: string
}): React.JSX.Element {
  const { next, seconds } = props
  const progress = useMemo(() => checkProgress(next, seconds, Date.now()), [next, seconds])
  const { n } = useLast(next, 0)
  return (
    <span
      className={cx(css.track, props.className)}
      data-run={progress !== null}
      aria-hidden="true"
    >
      <span
        className={css.fill}
        data-cycle={n % 2 === 0 ? 'a' : 'b'}
        style={
          {
            '--from': progress?.from ?? 0,
            '--left': `${String(progress?.left ?? 0)}ms`,
          } as React.CSSProperties
        }
      />
    </span>
  )
}
