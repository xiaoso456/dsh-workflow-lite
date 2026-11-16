/**
 * dsh-workflow-lite — 分段选择（单选）。
 *
 * 选中格下面那块滑块滑到新的一格（见 motion/thumb.tsx 的 PickThumb），字色灰 → 深是两层字交叉淡过去（FadeText），
 * 不是瞬间变色；选项前的小色点（`color`）只在选中、悬停时亮起；`icon` 是字前面的小图标（灰 → 强调色同样交叉淡过去；
 * 给了 `tint` 就一直是那个颜色：没选中时淡一些、悬停和选中满色）；
 * `count` 是字后面一个小数字标；`tip` 是悬停说明。`fit` 时各格按自己的字宽排，不等分。
 * `off` 是这一格暂时选不了的原因（悬停时说；格子用 `aria-disabled` 而不是 `disabled`，好让悬停提示照常出来）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/Segmented
 */

import { FadeMark, FadeText } from '../motion/marks.tsx'
import { PickThumb } from '../motion/thumb.tsx'
import { Icon, type IconName } from './Icon.tsx'
import css from './segmented.module.css'

export function Segmented<V extends string>(props: {
  label: string
  value: V
  /** `color`：选项前的小色点（比如条件的四种线色），和画布上对应的东西同色。 */
  /** `tip`：悬停说明（字是符号时也当读屏的名字）。 */
  options: readonly {
    value: V
    label: string
    color?: string
    icon?: IconName
    /** 图标的颜色（CSS 颜色）：没选中时淡一些，选中、悬停满色。 */
    tint?: string
    count?: number
    tip?: string
    /** 这一格选不了的原因（给了就选不了）。 */
    off?: string
  }[]
  onChange: (value: V) => void
  disabled?: boolean
  /** 每格的 `data-testid` 是 `${testId}-${value}`。 */
  testId?: string
  /** 不铺底、只描一圈线（放在深色的输出台这类底子上，灰底太跳）。 */
  plain?: boolean
  /** 各格按字宽排（默认等分整条）。 */
  fit?: boolean
}): React.JSX.Element {
  return (
    <div
      className={css.seg}
      data-plain={props.plain === true || undefined}
      data-fit={props.fit === true || undefined}
      role="radiogroup"
      aria-label={props.label}
      aria-disabled={props.disabled === true ? true : undefined}
    >
      <PickThumb
        layout={`${props.value}|${props.options.map((option) => option.value).join(',')}`}
        className={css.segThumb}
      />
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          className={css.segItem}
          disabled={props.disabled}
          aria-disabled={option.off === undefined ? undefined : true}
          data-tip={option.off ?? option.tip}
          aria-label={option.tip}
          data-testid={props.testId === undefined ? undefined : `${props.testId}-${option.value}`}
          onClick={() => {
            if (option.off === undefined) props.onChange(option.value)
          }}
        >
          {option.color !== undefined && (
            <span className={css.segDot} style={{ background: option.color }} />
          )}
          {option.icon !== undefined && (
            <FadeMark
              on={option.value === props.value}
              className={css.segIcon}
              tinted={option.tint !== undefined}
              style={
                option.tint === undefined
                  ? undefined
                  : ({ '--seg-tint': option.tint } as React.CSSProperties)
              }
            >
              <Icon name={option.icon} size={13} />
            </FadeMark>
          )}
          <FadeText text={option.label} on={option.value === props.value} />
          {option.count !== undefined && <span className={css.segCount}>{option.count}</span>}
        </button>
      ))}
    </div>
  )
}
