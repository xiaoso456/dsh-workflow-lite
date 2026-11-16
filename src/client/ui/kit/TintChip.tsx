/**
 * dsh-workflow-lite — 带颜色的小块：色板里的一种颜色淡一层做底，字和前面的小图标同色。
 *
 * 工作流的标签（左栏一行里）、记忆的类型（全局 / 步骤）共用。颜色交给 CSS 变量 `--wl-chip`（色值在主题里）。
 * `sm` 是列表第二行里的（16px 高），`md` 是右栏标题下面的（20px 高）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/TintChip
 */

import type { StepColor } from '../../../shared/appearance.ts'
import { cx } from './cx.ts'
import { Icon, type IconName } from './Icon.tsx'
import css from './tintChip.module.css'

export function TintChip(props: {
  color: StepColor
  icon: IconName
  label: string
  size?: 'sm' | 'md'
  tip?: string | undefined
  testId?: string
  className?: string
}): React.JSX.Element {
  const size = props.size ?? 'sm'
  return (
    <span
      className={cx(css.chip, props.className)}
      data-size={size}
      style={{ '--wl-chip': `var(--wl-c-${props.color})` } as React.CSSProperties}
      data-tip={props.tip}
      data-testid={props.testId}
    >
      <Icon name={props.icon} size={size === 'sm' ? 10 : 12} />
      <span className={css.label}>{props.label}</span>
    </span>
  )
}
