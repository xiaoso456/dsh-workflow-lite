/**
 * dsh-workflow-lite — 分段选择（单选）。
 *
 * 选中格下面那块滑块滑到新的一格（见 motion.tsx 的 PickThumb），字色灰 → 深是两层字交叉淡过去（FadeText），
 * 不是瞬间变色；选项前的小色点（`color`）只在选中、悬停时亮起；`count` 是字后面一个小数字标。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Segmented
 */

import { FadeText, PickThumb } from './motion.tsx'
import ui from './ui.module.css'

export function Segmented<V extends string>(props: {
  label: string
  value: V
  /** `color`：选项前的小色点（比如条件的四种线色），和画布上对应的东西同色。 */
  options: readonly { value: V; label: string; color?: string; count?: number }[]
  onChange: (value: V) => void
  disabled?: boolean
  /** 每格的 `data-testid` 是 `${testId}-${value}`。 */
  testId?: string
}): React.JSX.Element {
  return (
    <div
      className={ui.seg}
      role="radiogroup"
      aria-label={props.label}
      aria-disabled={props.disabled === true ? true : undefined}
    >
      <PickThumb
        layout={`${props.value}|${props.options.map((option) => option.value).join(',')}`}
        className={ui.segThumb}
      />
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          className={ui.segItem}
          disabled={props.disabled}
          data-testid={props.testId === undefined ? undefined : `${props.testId}-${option.value}`}
          onClick={() => props.onChange(option.value)}
        >
          {option.color !== undefined && (
            <span className={ui.segDot} style={{ background: option.color }} />
          )}
          <FadeText text={option.label} on={option.value === props.value} />
          {option.count !== undefined && <span className={ui.segCount}>{option.count}</span>}
        </button>
      ))}
    </div>
  )
}
