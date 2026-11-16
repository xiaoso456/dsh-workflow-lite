/**
 * dsh-workflow-lite — 步骤指示：一步一个圆圈 + 名字，中间一段线，走到哪一步那一步亮起来（导出、「触发方式」的定时检查）。
 *
 * - 圆圈里写第几步，给了 `icon` 就换成图标；
 * - 给了 `onPick` 每一步都是按钮，能直接跳过去（不强制按顺序走）；
 * - `alert` 的那一步名字后面一个小黄点（还缺东西）；
 * - 步数会变（导出成 Skill 多一步、定时换成到点就执行少一步）：多出的一步从前一步背后展开、少了的收回去（{@link useTrail}）。
 *
 * 亮、暗两层叠着换透明度（见 steps.module.css），换步时宽度不变。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/Steps
 */

import { useTrail } from '../motion/flip.ts'
import { SwapText } from '../motion/swapText.tsx'
import { cx } from './cx.ts'
import { Icon, type IconName } from './Icon.tsx'
import css from './steps.module.css'

export interface StepItem {
  label: string
  icon?: IconName
  /** 这一步还缺东西。 */
  alert?: boolean
  testId?: string
}

export function Steps(props: {
  steps: readonly StepItem[]
  at: number
  /** 点一步跳过去；不给就只是指示。 */
  onPick?(index: number): void
  className?: string
  label?: string
}): React.JSX.Element {
  const trail = useTrail()
  const { onPick } = props
  return (
    <div
      className={cx(css.steps, props.className)}
      ref={trail}
      role="group"
      aria-label={props.label}
    >
      {props.steps.map((step, index, all) => {
        const inner = (
          <>
            {index > 0 && <span className={css.stepGap} />}
            {/* 暗、亮各一份叠着，换的是透明度。 */}
            <span className={css.stepNum} data-icon={step.icon !== undefined}>
              <span className={css.stepFill} />
              <span className={css.numDim} aria-hidden="true">
                {step.icon === undefined ? index + 1 : <Icon name={step.icon} size={13} />}
              </span>
              <span className={css.numLit} aria-hidden={step.icon !== undefined || undefined}>
                {step.icon === undefined ? index + 1 : <Icon name={step.icon} size={13} />}
              </span>
            </span>
            <span className={css.stepLabel}>
              <span className={css.labelDim} aria-hidden="true">
                <SwapText text={step.label} />
              </span>
              <span className={css.labelLit}>
                <SwapText text={step.label} />
              </span>
            </span>
            {step.alert !== undefined && <span className={css.alert} aria-hidden="true" />}
          </>
        )
        const shared = {
          className: css.step,
          style: { zIndex: all.length - index },
          'data-on': index === props.at,
          'data-reached': index <= props.at,
          'data-alert': step.alert === true,
          'aria-current': index === props.at ? ('step' as const) : undefined,
          'data-testid': step.testId,
        }
        // 步骤按位置认，名字会换（工作流包 / Skill 的第一步）。
        return onPick === undefined ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 步骤按位置认
          <span key={index} {...shared}>
            {inner}
          </span>
        ) : (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: 步骤按位置认
            key={index}
            type="button"
            {...shared}
            onClick={() => onPick(index)}
          >
            {inner}
          </button>
        )
      })}
    </div>
  )
}
