/**
 * dsh-workflow-lite — 展示设置里能直接改的数字：宽高框里的 {@link RollInput}，缩放、上下文那种「− 数 +」的 {@link Stepper}。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/NumberStep
 */

import { useState } from 'react'
import css from './display.module.css'
import { Icon } from './Icon.tsx'
import { SwapText, useTrend } from './motion.tsx'
import { cx } from './primitives.tsx'

/**
 * 能直接改的数字（宽、高、缩放、上下文）：输入时只是草稿，回车、失焦才交给 `onCommit`（夹进范围、取整由调用方定）；
 * 上下键按 `step` 走一下，当场生效。
 * 没在改的时候，数字画在上面一层的 SwapText 里：点三档、按 − / + 时旧数字让开、新数字滚进来（变大往上、变小往下），
 * 不是一下跳过去；点进去改时那一层藏起来，露出输入框里的字。
 */
export function RollInput(props: {
  label: string
  value: number
  onCommit(value: number): void
  step(up: boolean, big: boolean): number
  testId: string
  className: string
  disabled?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const trend = useTrend(props.value)
  const commit = (): void => {
    if (draft === null) return
    const value = Number.parseInt(draft, 10)
    if (Number.isFinite(value) && value !== props.value) props.onCommit(value)
    setDraft(null)
  }
  return (
    <span className={css.roll}>
      <input
        className={cx(css.rollInput, props.className)}
        inputMode="numeric"
        aria-label={props.label}
        disabled={props.disabled}
        value={draft ?? String(props.value)}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d]/gu, ''))}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const base = draft === null ? props.value : Number.parseInt(draft, 10) || props.value
            setDraft(null)
            props.onCommit(base + props.step(event.key === 'ArrowUp', event.shiftKey))
          }
          if (event.key === 'Escape' && draft !== null) {
            // 只撤掉这次输入，不连带收起浮层。
            event.stopPropagation()
            setDraft(null)
          }
        }}
        data-testid={props.testId}
      />
      <span className={css.rollShow} aria-hidden="true">
        {/* 占宽由输入框定（它比数字宽），这一层只按字宽、居中放：三位数、四位数都在正中。 */}
        <SwapText text={String(props.value)} dir={trend} />
      </span>
    </span>
  )
}

/**
 * 「− 数 +」：两头的按钮按 `next` 走一档，中间的数能直接填（上下键一次 1、按住 Shift 一次 10），后面跟单位。
 * `disabled` 时整块灰着，`tip` 说为什么。
 */
export function Stepper(props: {
  label: string
  value: number
  min: number
  max: number
  unit: string
  /** 按 − / + 走到哪（缩放按常用档位走，别的一次 1）；不给就是 ±1。 */
  next?: (value: number, dir: 1 | -1) => number
  onChange(value: number): void
  testId: string
  lessLabel: string
  moreLabel: string
  disabled?: boolean
  tip?: string | undefined
}): React.JSX.Element {
  const next = props.next ?? ((value: number, dir: 1 | -1) => value + dir)
  const clamp = (value: number): number =>
    Math.min(props.max, Math.max(props.min, Math.round(value)))
  const off = props.disabled === true
  return (
    <span className={css.zoom} aria-disabled={off || undefined} data-tip={props.tip}>
      <button
        type="button"
        className={css.zoomStep}
        aria-label={props.lessLabel}
        data-tip={off ? undefined : props.lessLabel}
        disabled={off || props.value <= props.min}
        data-testid={`${props.testId}-less`}
        onClick={() => props.onChange(clamp(next(props.value, -1)))}
      >
        <Icon name="minus" size={13} />
      </button>
      <span className={css.zoomValue}>
        <RollInput
          label={props.label}
          value={props.value}
          testId={props.testId}
          className={css.zoomInput}
          disabled={off}
          step={(up, big) => (big ? 10 : 1) * (up ? 1 : -1)}
          onCommit={(value) => {
            const fixed = clamp(value)
            if (fixed !== props.value) props.onChange(fixed)
          }}
        />
        {/* 「%」紧贴数字，「行」这种字和数字之间空一点。 */}
        <span className={css.zoomUnit} data-word={props.unit !== '%' || undefined}>
          {props.unit}
        </span>
      </span>
      <button
        type="button"
        className={css.zoomStep}
        aria-label={props.moreLabel}
        data-tip={off ? undefined : props.moreLabel}
        disabled={off || props.value >= props.max}
        data-testid={`${props.testId}-more`}
        onClick={() => props.onChange(clamp(next(props.value, 1)))}
      >
        <Icon name="plus" size={13} />
      </button>
    </span>
  )
}
