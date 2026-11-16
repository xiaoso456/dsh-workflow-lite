/**
 * dsh-workflow-lite — 定时规则「接下来 7 天」：从今天起每天一行，一条 0–24 点的细线，每次执行一个点；
 * 今天已经过去的那一截打斜纹、现在画一条竖线，下一次那个点大一圈；到点先跑命令检查的点是空心的（`checks`）。太密的一天（每 5 分钟这类）画成一条，旁边写几次。
 * 底下一行刻度。名字、时区、下一次在外面的工作台上（见 `ScheduleStage.tsx`）。
 *
 * 行数固定、一直挂着。改规则时一天里的点按先后认（第几次），时刻变了的点从旧位置滑过去，
 * 多出来的淡入、少了的淡掉再摘（{@link DayDots}）；空心 / 实心、太密的一条是叠层换透明度。
 * 每小时一次时一下挂上一百多个点：点是 8px 的小块、按 `left` 摆（不铺满整条线，不各开一层），
 * 只有时刻变了的那几个放位移动画；空心那层只在今天那行画，淡环只画在下一次上。
 * 点的个数只在规则改了才变，不在打字、拖动的热路径上。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/WeekStrip
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { T } from '../../../i18n.ts'
import { shortTime } from '../../../model/time.ts'
import { weekdayText } from '../../../model/triggerText.ts'
import type { Week, WeekDay } from '../../../model/triggerWeek.ts'
import { slide } from '../../motion/flip.ts'
import { REDUCED } from '../../motion/shared.ts'
import { SwapText } from '../../motion/swapText.tsx'
import css from './week.module.css'

const HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 24] as const

const pct = (spot: number): string => `${(spot * 100).toFixed(3)}%`

/** 少了的点淡掉用多久（和 week.module.css 的 dotOut 一致）。 */
const DOT_OUT_MS = 180

/** 一天里的一个点：在一天中的位置、是不是已经过去、是不是下一次。 */
interface Dot {
  spot: number
  past: boolean
  next: boolean
}

/** 这一天的点，按时刻先后（过去的在前）。太密的一天没有点（画成一条）。 */
function dotsOf(day: WeekDay, next: Week['next']): Dot[] {
  const isNext = (spot: number): boolean =>
    next !== undefined && day.ahead === next.ahead && spot === next.spot
  return [
    ...day.past.map((spot) => ({ spot, past: true, next: false })),
    ...day.fires.map((spot) => ({ spot, past: false, next: isNext(spot) })),
  ]
}

const sameDots = (a: readonly Dot[], b: readonly Dot[]): boolean =>
  a.length === b.length &&
  a.every((dot, i) => {
    const other = b[i] as Dot
    return dot.spot === other.spot && dot.past === other.past && dot.next === other.next
  })

/**
 * 一天里的点：第几次就是第几个元素（键是序号）。规则改了，时刻变了的那几个点从旧位置滑过去
 * （按 `left` 摆在新位置，再用 translateX 从旧位置补回来，见 {@link slide}）；
 * 少了的那几个留一会儿（`data-gone`）淡掉再摘，多出来的挂上时淡入。
 */
function DayDots(props: { dots: readonly Dot[] }): React.JSX.Element {
  const { dots } = props
  const box = useRef<HTMLSpanElement>(null)
  const [shown, setShown] = useState<{
    dots: readonly Dot[]
    gone: readonly Dot[]
    was: readonly Dot[] | null
  }>({ dots, gone: [], was: null })
  if (!sameDots(shown.dots, dots)) {
    setShown({
      dots,
      gone: shown.dots.length > dots.length ? shown.dots.slice(dots.length) : [],
      was: shown.dots,
    })
  }
  // 只在点变了的那一次滑（摘掉淡完的点也会换 `shown`，那次不能再滑一遍）。
  const { was, dots: now } = shown
  useLayoutEffect(() => {
    const el = box.current
    if (was === null || el === null || REDUCED?.matches === true) return
    const width = el.offsetWidth
    const count = Math.min(was.length, now.length)
    for (let index = 0; index < count; index++) {
      const from = (was[index] as Dot).spot
      const to = (now[index] as Dot).spot
      const child = el.children[index]
      if (from !== to && child instanceof HTMLElement) slide(child, 0, (from - to) * width)
    }
  }, [was, now])
  useEffect(() => {
    if (shown.gone.length === 0) return
    const id = setTimeout(
      () => setShown((now) => (now === shown ? { ...now, gone: [] } : now)),
      DOT_OUT_MS,
    )
    return () => clearTimeout(id)
  }, [shown])
  const fire = (dot: Dot, index: number, gone: boolean): React.JSX.Element => (
    <span
      key={index}
      className={css.fire}
      data-past={dot.past}
      data-next={dot.next}
      data-gone={gone || undefined}
      style={{ left: pct(dot.spot) }}
    />
  )
  return (
    <span className={css.dots} ref={box}>
      {dots.map((dot, index) => fire(dot, index, false))}
      {shown.gone.map((dot, index) => fire(dot, dots.length + index, true))}
    </span>
  )
}

export function WeekStrip(props: {
  t: T
  /** 排好的 7 天（`weekOf`）。 */
  week: Week
  /** 规则写对了没有（写错时不画）。 */
  valid: boolean
  /** 到点先跑命令检查：点画成空心。 */
  checks?: boolean
}): React.JSX.Element {
  const { t, week } = props
  const { next } = week
  return (
    <div
      className={css.week}
      data-valid={props.valid}
      data-checks={props.checks === true}
      data-testid="wl-trigger-upcoming"
    >
      {week.days.map((day) => {
        const label =
          day.ahead === 0
            ? t('trigger.upcoming.today')
            : day.ahead === 1
              ? t('trigger.upcoming.tomorrow')
              : shortTime(day.start).slice(0, 5)
        return (
          <div
            key={day.start}
            className={css.day}
            data-off={day.count === 0}
            data-ahead={day.ahead}
          >
            <span className={css.label}>
              <b>{label}</b>
              {t('trigger.upcoming.weekday').replace('{day}', weekdayText(t, day.weekday))}
            </span>
            <span className={css.track}>
              {day.ahead === 0 && (
                <>
                  <span className={css.past} style={{ width: pct(week.now) }} />
                  <span className={css.now} style={{ left: pct(week.now) }} />
                </>
              )}
              <span
                className={css.band}
                data-on={day.dense}
                style={day.ahead === 0 ? { left: pct(week.now) } : undefined}
              />
              <DayDots dots={dotsOf(day, next)} />
            </span>
            <span className={css.count}>
              <SwapText
                text={day.dense ? t('trigger.week.dense').replace('{n}', String(day.count)) : ''}
              />
            </span>
          </div>
        )
      })}
      <div className={css.axis} aria-hidden="true">
        <span />
        <span className={css.hours}>
          {HOURS.map((hour) => (
            <span key={hour} className={css.hour}>
              {hour}
            </span>
          ))}
        </span>
        <span />
      </div>
      <p className={css.none} hidden={props.valid}>
        {t('trigger.week.none')}
      </p>
    </div>
  )
}
