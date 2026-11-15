/**
 * dsh-workflow-lite — 图标格的单选：一排小方格，每格一枚图标，名字在悬停提示里。
 *
 * 选中格下面的滑块滑过去（见 motion/thumb.tsx 的 PickThumb），图标是灰、蓝两枚交叉淡过去（FadeMark），新选中的那枚弹一下。
 * 字写得下的用 {@link Segmented}。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/IconSwitch
 */

import { FadeMark } from '../motion/marks.tsx'
import { PickThumb } from '../motion/thumb.tsx'
import { Icon, type IconName } from './Icon.tsx'
import css from './iconSwitch.module.css'

export function IconSwitch<V extends string>(props: {
  /** 整组的名字（读屏用）。 */
  label: string
  value: V
  /** `label` 是这一格的名字：悬停提示、读屏都用它。 */
  options: readonly { value: V; icon: IconName; label: string }[]
  onChange(value: V): void
  /** 整组的 `data-testid`；每格是 `${testId}-${value}`。 */
  testId?: string
  /** 整组会被整个卸掉又挂上时（比如换面），给个名字让滑块接着滑（见 PickThumb 的 `carry`）。 */
  carry?: string
}): React.JSX.Element {
  return (
    <div
      className={css.switch}
      role="radiogroup"
      aria-label={props.label}
      data-testid={props.testId}
    >
      <PickThumb layout={props.value} carry={props.carry} className={css.thumb} />
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          aria-label={option.label}
          data-tip={option.label}
          data-testid={props.testId === undefined ? undefined : `${props.testId}-${option.value}`}
          className={css.item}
          onClick={() => props.onChange(option.value)}
        >
          <FadeMark on={option.value === props.value}>
            <Icon name={option.icon} size={14} />
          </FadeMark>
        </button>
      ))}
    </div>
  )
}
