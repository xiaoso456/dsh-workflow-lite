/**
 * dsh-workflow-lite — 一组单选卡片：每张一个圆钮、名字，可以带一句说明、一条色线（和画布上的线同色）和一块小图解。
 * 比分段选择（Segmented）多放得下说明，用在「选哪种判定」「什么结果时」这类要解释两句的地方。
 *
 * 选中的那层（淡底 + 同色细边）是一块滑过去的底块（PickThumb），有色的选项各一层、换选时交叉淡；不发光。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/ChoiceCards
 */

import { PickThumb } from '../motion/thumb.tsx'
import css from './choiceCards.module.css'

export interface Choice<V extends string> {
  value: V
  label: string
  desc?: string
  /** 色线和选中时的颜色（CSS 值）；没有就用 `--wl-kind`，再没有用强调色。 */
  color?: string
  /** 名字下面的一块小图解。 */
  extra?: React.ReactNode
}

export function ChoiceCards<V extends string>(props: {
  label: string
  value: V
  options: readonly Choice<V>[]
  onChange(value: V): void
  /** 每张的 `data-testid` 是 `${testId}-${value}`。 */
  testId?: string
  /** 横着排几张（缺省一张一行）。 */
  columns?: number
}): React.JSX.Element {
  const { options } = props
  return (
    <div
      className={css.cards}
      role="radiogroup"
      aria-label={props.label}
      style={{ '--columns': String(props.columns ?? 1) } as React.CSSProperties}
    >
      <PickThumb
        layout={`${props.value}|${options.map((option) => option.value).join(',')}`}
        className={css.thumb}
        tone={{
          list: options.map((option) => option.value),
          on: props.value,
          attr: 'data-choice',
          className: css.tone,
          style: (name) => {
            const color = options.find((option) => option.value === name)?.color
            return color === undefined ? undefined : ({ '--choice': color } as React.CSSProperties)
          },
        }}
      />
      {options.map((option) => {
        const on = option.value === props.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={css.card}
            style={
              option.color === undefined
                ? undefined
                : ({ '--choice': option.color } as React.CSSProperties)
            }
            data-testid={props.testId === undefined ? undefined : `${props.testId}-${option.value}`}
            onClick={() => props.onChange(option.value)}
          >
            <span className={css.top}>
              <span className={css.radio} data-on={on} aria-hidden="true" />
              <span className={css.label}>{option.label}</span>
              {option.color !== undefined && <span className={css.line} aria-hidden="true" />}
            </span>
            {option.desc !== undefined && <span className={css.desc}>{option.desc}</span>}
            {option.extra !== undefined && <span className={css.extra}>{option.extra}</span>}
          </button>
        )
      })}
    </div>
  )
}
