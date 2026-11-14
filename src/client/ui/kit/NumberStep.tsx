/**
 * dsh-workflow-lite — 能改的数字：「− 数 +」（{@link Stepper}，全站的数字框都用它）和不带按钮的读数框（{@link RollInput}，展示设置的宽 × 高）。
 *
 * 改法都一样：
 * - 直接打字：只收数字；打出范围内的数当场生效（对话框里改的是草稿，Ctrl+Enter 保存时不会丢最后几个字），
 *   超出范围的标红、不生效，回车 / 失焦时夹进范围；Esc 撤回这次输入。
 * - ↑ / ↓ 走一步，按着 Shift 走一大步；滚轮停在控件上滚一格走一步（守卫见 `wheelStep.ts`）。
 * - − / + 点一下走一步，按住连着走、越走越快（`useHoldRepeat.ts`）；到头的那一边变灰。
 * - 走不动了（到头）读数轻轻顶一下，不绕回。
 * - 没在打字时数字画在上面一层的 SwapText 里：变大旧数往上让开、新数从下面进来，变小反过来。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/NumberStep
 */

import { useRef, useState } from 'react'
import { SwapText, useTrend } from '../motion/swapText.tsx'
import { cx } from './cx.ts'
import { Icon } from './Icon.tsx'
import css from './numberStep.module.css'
import { useHoldRepeat } from './useHoldRepeat.ts'
import { useWheelStep } from './wheelStep.ts'

/** 「顶一下」：第几次（单双换动画名，换一次放一次）、往哪边。 */
export interface Bump {
  n: number
  dir: 1 | -1
}

const bumpAttr = (bump: Bump | undefined): string | undefined =>
  bump === undefined || bump.n === 0
    ? undefined
    : `${bump.dir > 0 ? 'up' : 'down'}-${bump.n % 2 === 1 ? 'a' : 'b'}`

/** 只留数字。 */
const digitsOf = (text: string): string => text.replace(/[^\d]/gu, '')

/**
 * 一个能直接改的数字（不带按钮）：输入框和一层滚动的读数叠在同一格，聚焦时露出输入框。
 * `value` 为 null 是空着（给了 `placeholder` 时写浅字）。
 * 回车、失焦交给 `onCommit`（夹进范围由调用方定）；`onType` 每打一个字报一次（可以拿来当场生效），`onEnd` 报这次输入结束。
 * Esc 撤回这次输入：回到聚焦时的数（当场生效过的也撤回）。
 * ↑ / ↓：给了 `onStep` 就交给它，否则按 `step` 算好交给 `onCommit`。`wheel`：自己接滚轮（独立用时；在 Stepper 里由外框接）。
 */
export function RollInput(props: {
  label: string
  value: number | null
  onCommit(value: number | null): void
  onType?(value: number | null): void
  onEnd?(): void
  onStep?(dir: 1 | -1, big: boolean): void
  step?(up: boolean, big: boolean): number
  wheel?: boolean
  placeholder?: string
  invalid?: boolean
  bump?: Bump
  testId: string
  className: string
  disabled?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const trend = useTrend(props.value ?? 0)
  /** 聚焦时的数（Esc 撤回到它）。 */
  const start = useRef(props.value)
  const parse = (text: string): number | null => (text === '' ? null : Number.parseInt(text, 10))
  // 打字的时候数被别处改了（按了 − / +）：框里换成新的数，不留着打了一半的字。
  const [seen, setSeen] = useState(props.value)
  if (seen !== props.value) {
    setSeen(props.value)
    if (draft !== null && parse(draft) !== props.value) setDraft(null)
  }
  const commit = (): void => {
    if (draft === null) return
    const value = parse(draft)
    setDraft(null)
    if (value !== props.value) props.onCommit(value)
    props.onEnd?.()
  }
  const step = (dir: 1 | -1, big: boolean): void => {
    if (draft !== null) {
      // 打到一半按了 ↑ / ↓：先把打的交出去，再从它走。
      const typed = parse(draft)
      setDraft(null)
      if (typed !== props.value) {
        props.onCommit(typed)
        return
      }
    }
    if (props.onStep !== undefined) props.onStep(dir, big)
    else if (props.step !== undefined && props.value !== null) {
      props.onCommit(props.value + props.step(dir > 0, big))
    }
  }
  const wheel = useWheelStep<HTMLSpanElement>(step, props.wheel === true && props.disabled !== true)
  return (
    <span className={css.roll} ref={wheel}>
      <input
        className={cx(css.rollInput, props.className)}
        inputMode="numeric"
        aria-label={props.label}
        aria-invalid={props.invalid === true || undefined}
        disabled={props.disabled}
        placeholder={props.placeholder}
        value={draft ?? (props.value === null ? '' : String(props.value))}
        onChange={(event) => {
          const text = digitsOf(event.target.value)
          setDraft(text)
          props.onType?.(parse(text))
        }}
        onFocus={(event) => {
          start.current = props.value
          event.currentTarget.select()
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            step(event.key === 'ArrowUp' ? 1 : -1, event.shiftKey)
          }
          if (event.key === 'Escape' && draft !== null) {
            // 只撤掉这次输入，不连带收起浮层、关掉对话框。
            event.stopPropagation()
            setDraft(null)
            if (props.value !== start.current) props.onCommit(start.current)
            props.onEnd?.()
          }
        }}
        data-testid={props.testId}
      />
      <span
        className={css.rollShow}
        aria-hidden="true"
        data-empty={props.value === null || undefined}
        data-bump={bumpAttr(props.bump)}
      >
        {/* 占宽由输入框定（它比数字宽），这一层只按字宽放。 */}
        <SwapText
          text={props.value === null ? (props.placeholder ?? '') : String(props.value)}
          dir={trend}
        />
      </span>
    </span>
  )
}

interface StepperBase {
  label: string
  min: number
  max: number
  unit?: string
  /** 走一步到哪（缩放按常用档位走）；不给就是 ±1，`big`（Shift）±10。 */
  next?: (value: number, dir: 1 | -1, big: boolean) => number
  /** 中间的数按几位宽（缺省 3 位）。 */
  digits?: number
  /** 正在打的数（还没生效，可能超出范围）；打完（回车、失焦、Esc）报 null。 */
  onTyped?(value: number | null): void
  testId: string
  lessLabel: string
  moreLabel: string
  disabled?: boolean
  tip?: string | undefined
  className?: string
  /** 矮一号（26 高，和胶囊一排）；缺省和输入框一样高（32）。 */
  compact?: boolean
}

/** 不能空着的数，和能空着的数（`empty` 是空着时框里的浅字）。 */
type StepperProps = StepperBase &
  (
    | { empty?: undefined; value: number; onChange(value: number): void }
    | { empty: string; value: number | null; onChange(value: number | null): void }
  )

/**
 * 「− 数 +」：全站的数字框。中间的数能直接打，两头的按钮、↑↓、滚轮按 `next` 走一步（缺省一次 1、Shift 一次 10），
 * 后面可以跟单位。`empty`：可以空着（`value` 为 null，框里写这几个浅字，比如「不限制」）——在最小值再往下减就是空，
 * 空着按 + 从最小值开始。`disabled` 时整块灰着，`tip` 说为什么。
 */
export function Stepper(props: StepperProps): React.JSX.Element {
  const { min, max } = props
  const value: number | null = props.value
  const off = props.disabled === true
  const canEmpty = props.empty !== undefined
  /** 交出一个新数：不能空着的从来不交 null。 */
  const emit = (n: number | null): void => {
    if (props.empty !== undefined) props.onChange(n)
    else if (n !== null) props.onChange(n)
  }
  const [bump, setBump] = useState<Bump>({ n: 0, dir: 1 })
  const [typed, setTyped] = useState<number | null>(null)
  const clamp = (n: number): number => Math.min(max, Math.max(min, Math.round(n)))
  const next = props.next ?? ((n: number, dir: 1 | -1, big: boolean) => n + dir * (big ? 10 : 1))
  const knock = (dir: 1 | -1): false => {
    setBump((was) => ({ n: was.n + 1, dir }))
    return false
  }
  /** 走一步；走不动返回 false（按住连着走的就停了）。 */
  const move = (dir: 1 | -1, big = false): boolean => {
    if (off) return false
    if (value === null) {
      if (dir < 0) return knock(dir)
      emit(min)
      return true
    }
    if (canEmpty && dir < 0 && value <= min) {
      emit(null)
      return true
    }
    const to = clamp(next(value, dir, big))
    if (to === value) return knock(dir)
    emit(to)
    return true
  }
  const inRange = (n: number): boolean => n >= min && n <= max
  const less = useHoldRepeat(() => move(-1))
  const more = useHoldRepeat(() => move(1))
  const wheel = useWheelStep<HTMLSpanElement>((dir, big) => move(dir, big), !off)
  const atMin = value === null || (!canEmpty && value <= min)
  const atMax = value !== null && value >= max
  return (
    <span
      ref={wheel}
      className={cx(css.zoom, props.className)}
      aria-disabled={off || undefined}
      data-compact={props.compact === true || undefined}
      data-tip={props.tip}
    >
      <button
        type="button"
        className={css.zoomStep}
        aria-label={props.lessLabel}
        data-tip={off ? undefined : props.lessLabel}
        disabled={off || atMin}
        data-testid={`${props.testId}-less`}
        {...less}
      >
        <Icon name="minus" size={13} />
      </button>
      <span
        className={css.zoomValue}
        data-unit={props.unit !== undefined || undefined}
        style={{ '--digits': props.digits ?? 3 } as React.CSSProperties}
      >
        <RollInput
          label={props.label}
          value={value}
          placeholder={props.empty}
          invalid={typed !== null && !inRange(typed)}
          bump={bump}
          testId={props.testId}
          className={css.zoomInput}
          disabled={off}
          onType={(n) => {
            setTyped(n)
            props.onTyped?.(n)
            // 范围内的数当场生效；空着只在能空着时生效。
            if (n === null ? canEmpty : inRange(n)) {
              if (n !== value) emit(n)
            }
          }}
          onStep={(dir, big) => {
            move(dir, big)
          }}
          onEnd={() => {
            setTyped(null)
            props.onTyped?.(null)
          }}
          onCommit={(n) => {
            if (n === null) {
              if (canEmpty && value !== null) emit(null)
              return
            }
            const fixed = canEmpty && n < min ? null : clamp(n)
            if (fixed !== value) emit(fixed)
          }}
        />
        {props.unit !== undefined && (
          // 「%」紧贴数字，「行」「毫秒」这种字和数字之间空一点。
          <span className={css.zoomUnit} data-word={props.unit !== '%' || undefined}>
            {props.unit}
          </span>
        )}
      </span>
      <button
        type="button"
        className={css.zoomStep}
        aria-label={props.moreLabel}
        data-tip={off ? undefined : props.moreLabel}
        disabled={off || atMax}
        data-testid={`${props.testId}-more`}
        {...more}
      >
        <Icon name="plus" size={13} />
      </button>
    </span>
  )
}
