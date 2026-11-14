/**
 * dsh-workflow-lite — 时刻框：「时 : 分」两段，加一个点开浮层的钟。
 *
 * 改法：
 * - 点一段（或 Tab 进来）后直接打数字：时打「1」「7」就是 17 点并跳到分；第一位已经不可能再接一位（时 3–9、分 6–9）当场跳。
 * - ↑ / ↓ 走一步（时一小时，分一分钟，Shift 十分钟）；← / → 在两段间走。
 * - 滚轮停在哪段改哪段：时一格一小时，分一格 5 分钟（落到整 5 分）；守卫同数字框（`wheelStep.ts`）。走过头绕回。
 * - 钟点开浮层：一排常用时刻 + 「现在」，下面时、分两列像滚轮（不要滚动条，上下两头淡出；打开时选中项在正中）。
 *   分钟每一分都列着；列上滚一格时翻一行、分翻五行。
 *   点时不收（接着点分），点分、点常用就收。
 * 段里的数字换的时候上下滚（{@link SwapText}），不插拔元素。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/TimeField
 */

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { T } from '../../i18n.ts'
import { REDUCED } from '../motion/shared.ts'
import { SwapText } from '../motion/swapText.tsx'
import { type ClockPart, pad2, stepClock, typeClock, wrapClock } from './clockMath.ts'
import { cx } from './cx.ts'
import { Icon } from './Icon.tsx'
import { Popover } from './Popover.tsx'
import { roomAround } from './Select.tsx'
import css from './timeField.module.css'
import { useWheelStep, wheelPixels, wheelStep } from './wheelStep.ts'

/** 浮层里的常用时刻（一天里的第几分钟）。 */
const QUICK = [8 * 60, 9 * 60, 12 * 60, 18 * 60, 22 * 60] as const
/** 浮层大约多高：下面放不下、上面更宽时往上开。 */
const POP_HEIGHT = 300
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute)
/** 浮层两列里滚轮一格翻几行：时一行，分五行（每一分都列着，滚起来五分一跳）。 */
const HOUR_ROWS = 1
const MINUTE_ROWS = 5

const clockText = (minutes: number): string =>
  `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`

export function TimeField(props: {
  t: T
  label: string
  /** 一天里的第几分钟（0–1439）。 */
  value: number
  onChange(minutes: number): void
  /** 离开这个框（焦点出去了）：连着改的几下到这里算一次。 */
  onEnd?(): void
  testId: string
  /** 跟在钟后面的按钮（比如去掉这个时刻的 ✕）。 */
  children?: React.ReactNode
  className?: string
}): React.JSX.Element {
  const { t, value } = props
  const [open, setOpen] = useState(false)
  const [up, setUp] = useState(false)
  const [dir, setDir] = useState<'up' | 'down'>('up')
  /** 正在打字的那一段和打了的几位。 */
  const [typing, setTyping] = useState<{ part: ClockPart; typed: string } | null>(null)
  const field = useRef<HTMLSpanElement>(null)
  const hourRef = useRef<HTMLSpanElement | null>(null)
  const minuteRef = useRef<HTMLSpanElement | null>(null)

  const set = (next: number, toward: 1 | -1): void => {
    const minutes = wrapClock(next)
    if (minutes === value) return
    setDir(toward > 0 ? 'up' : 'down')
    props.onChange(minutes)
  }
  const step = (part: ClockPart, toward: 1 | -1, how: { big?: boolean; wheel?: boolean }): void => {
    setTyping(null)
    set(stepClock(value, part, toward, how), toward)
  }
  const onKey =
    (part: ClockPart) =>
    (event: React.KeyboardEvent<HTMLSpanElement>): void => {
      const { key } = event
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        event.preventDefault()
        step(part, key === 'ArrowUp' ? 1 : -1, { big: event.shiftKey })
      } else if (key === 'ArrowRight' && part === 'hour') {
        event.preventDefault()
        minuteRef.current?.focus()
      } else if (key === 'ArrowLeft' && part === 'minute') {
        event.preventDefault()
        hourRef.current?.focus()
      } else if (/^\d$/u.test(key)) {
        event.preventDefault()
        const typed = (typing?.part === part ? typing.typed : '') + key
        const result = typeClock(value, part, typed)
        set(result.minutes, result.minutes >= value ? 1 : -1)
        if (result.done) {
          setTyping(null)
          if (part === 'hour') minuteRef.current?.focus()
        } else setTyping({ part, typed })
      } else if (key === 'Enter') setTyping(null)
    }
  const pick = (minutes: number, close: boolean): void => {
    set(minutes, minutes >= value ? 1 : -1)
    if (!close) return
    setOpen(false)
    minuteRef.current?.focus()
  }

  const hour = Math.floor(value / 60)
  const minute = value % 60
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t('common.pickTime')}
      up={up}
      className={css.pop}
      trigger={
        <span
          ref={field}
          className={cx(css.field, props.className)}
          role="group"
          aria-label={props.label}
          data-open={open || undefined}
          data-testid={props.testId}
          onPointerDown={(event) => {
            if (
              event.target === event.currentTarget ||
              (event.target as HTMLElement).dataset.colon
            ) {
              event.preventDefault()
              hourRef.current?.focus()
            }
          }}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) props.onEnd?.()
          }}
        >
          <Segment
            part="hour"
            label={`${props.label} · ${t('common.hour')}`}
            text={pad2(hour)}
            now={hour}
            max={23}
            dir={dir}
            typing={typing?.part === 'hour'}
            segRef={hourRef}
            testId={`${props.testId}-hour`}
            onStep={(toward, wheel) => step('hour', toward, { wheel })}
            onKey={onKey('hour')}
            onLeave={() => setTyping(null)}
          />
          <span className={css.colon} data-colon="true" aria-hidden="true">
            :
          </span>
          <Segment
            part="minute"
            label={`${props.label} · ${t('common.minute')}`}
            text={pad2(minute)}
            now={minute}
            max={59}
            dir={dir}
            typing={typing?.part === 'minute'}
            segRef={minuteRef}
            testId={`${props.testId}-minute`}
            onStep={(toward, wheel) => step('minute', toward, { wheel })}
            onKey={onKey('minute')}
            onLeave={() => setTyping(null)}
          />
          <button
            type="button"
            className={css.clock}
            aria-label={t('common.pickTime')}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-tip={t('common.pickTime')}
            data-testid={`${props.testId}-pick`}
            onClick={() => {
              if (!open && field.current !== null) {
                const room = roomAround(field.current)
                setUp(room.below < POP_HEIGHT && room.above > room.below)
              }
              setOpen(!open)
            }}
          >
            <Icon name="clock" size={14} />
          </button>
          {props.children}
        </span>
      }
    >
      <ClockMenu t={t} value={value} testId={props.testId} onPick={pick} />
    </Popover>
  )
}

/** 时或分一段：能聚焦、能打字、能滚。 */
function Segment(props: {
  part: ClockPart
  label: string
  text: string
  now: number
  max: number
  dir: 'up' | 'down'
  typing: boolean
  segRef: React.MutableRefObject<HTMLSpanElement | null>
  testId: string
  onStep(toward: 1 | -1, wheel: boolean): void
  onKey(event: React.KeyboardEvent<HTMLSpanElement>): void
  onLeave(): void
}): React.JSX.Element {
  const { segRef } = props
  const wheel = useWheelStep<HTMLSpanElement>((toward) => props.onStep(toward, true))
  const ref = useCallback(
    (el: HTMLSpanElement | null) => {
      segRef.current = el
      wheel(el)
    },
    [segRef, wheel],
  )
  return (
    <span
      ref={ref}
      className={css.seg}
      role="spinbutton"
      tabIndex={0}
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={props.max}
      aria-valuenow={props.now}
      aria-valuetext={props.text}
      data-typing={props.typing || undefined}
      data-testid={props.testId}
      onKeyDown={props.onKey}
      onBlur={props.onLeave}
    >
      <SwapText text={props.text} dir={props.dir} />
    </span>
  )
}

/**
 * 浮层里的一列：滚轮一格翻 `rows` 行（不按系统的滚动距离，免得一格停在两行中间）；触控板攒满一格再翻。
 * 连着滚时从上一次要去的位置接着算（平滑滚动还没到），翻到头就停。
 */
function useRowWheel(ref: RefObject<HTMLDivElement | null>, rows: number): void {
  useEffect(() => {
    const col = ref.current
    if (col === null) return
    let acc = 0
    let target: number | null = null
    const onWheel = (event: WheelEvent): void => {
      if (event.ctrlKey) return
      event.preventDefault()
      event.stopPropagation()
      const step = wheelStep(acc, wheelPixels(event.deltaY, event.deltaMode))
      acc = step.acc
      if (step.dir === 0) return
      const row = col.querySelector('button')?.offsetHeight ?? 28
      const from = target !== null && Math.abs(col.scrollTop - target) > 1 ? target : col.scrollTop
      const max = col.scrollHeight - col.clientHeight
      // 往上滚（dir = 1）是往列表前面翻。
      target = Math.min(max, Math.max(0, from - step.dir * rows * row))
      col.scrollTo({ top: target, behavior: REDUCED?.matches === true ? 'auto' : 'smooth' })
    }
    col.addEventListener('wheel', onWheel, { passive: false })
    return () => col.removeEventListener('wheel', onWheel)
  }, [ref, rows])
}

/** 浮层：常用时刻一排，时、分两列。每次打开重挂一次（Popover 按打开的次数换键），挂上时把选中项滚到正中。 */
function ClockMenu(props: {
  t: T
  value: number
  testId: string
  onPick(minutes: number, close: boolean): void
}): React.JSX.Element {
  const { t, value } = props
  const hour = Math.floor(value / 60)
  const minute = value % 60
  const hourCol = useRef<HTMLDivElement>(null)
  const minuteCol = useRef<HTMLDivElement>(null)
  useRowWheel(hourCol, HOUR_ROWS)
  useRowWheel(minuteCol, MINUTE_ROWS)
  useLayoutEffect(() => {
    for (const col of [hourCol.current, minuteCol.current]) {
      const selected = col?.querySelector<HTMLElement>('[aria-selected="true"]')
      if (col && selected) {
        col.scrollTop = selected.offsetTop - (col.clientHeight - selected.offsetHeight) / 2
      }
    }
  }, [])
  return (
    <>
      <div className={css.quick}>
        {QUICK.map((at) => (
          <button
            key={at}
            type="button"
            data-testid={`${props.testId}-quick-${clockText(at)}`}
            onClick={() => props.onPick(at, true)}
          >
            {clockText(at)}
          </button>
        ))}
        <button
          type="button"
          data-testid={`${props.testId}-now`}
          onClick={() => {
            const now = new Date()
            props.onPick(now.getHours() * 60 + now.getMinutes(), true)
          }}
        >
          {t('common.now')}
        </button>
      </div>
      <div className={css.cols}>
        <div>
          <div className={css.colHead}>{t('common.hour')}</div>
          <div ref={hourCol} className={css.col} role="listbox" aria-label={t('common.hour')}>
            {HOURS.map((h) => (
              <button
                key={h}
                type="button"
                role="option"
                aria-selected={h === hour}
                data-testid={`${props.testId}-h-${pad2(h)}`}
                onClick={() => props.onPick(h * 60 + minute, false)}
              >
                {pad2(h)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className={css.colHead}>{t('common.minute')}</div>
          <div ref={minuteCol} className={css.col} role="listbox" aria-label={t('common.minute')}>
            {MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                role="option"
                aria-selected={m === minute}
                data-testid={`${props.testId}-m-${pad2(m)}`}
                onClick={() => props.onPick(hour * 60 + m, true)}
              >
                {pad2(m)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
