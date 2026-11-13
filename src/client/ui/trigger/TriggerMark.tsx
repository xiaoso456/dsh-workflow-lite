/**
 * dsh-workflow-lite — 触发源的图标块：画布上的触发卡片、工作流中心「触发」页里认一种触发源的那个小色块。
 *
 * 和步骤的图标块（kit/StepMark）同一种样子（`ui.kind`）：每种触发源一个图标、一种颜色。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/TriggerMark
 */

import type { StepColor } from '../../../shared/appearance.ts'
import type { TriggerSourceKind } from '../../../shared/types.ts'
import { cx } from '../kit/cx.ts'
import { Icon, type IconName } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'

/** 每种触发源的图标。 */
export const TRIGGER_ICON: Record<TriggerSourceKind, IconName> = {
  schedule: 'clock',
  poll: 'poll',
  listen: 'terminal',
  http: 'globe',
  after: 'after',
}

const TRIGGER_COLOR: Record<TriggerSourceKind, StepColor> = {
  schedule: 'blue',
  poll: 'teal',
  listen: 'amber',
  http: 'violet',
  after: 'green',
}

/** 这种触发源的颜色（CSS 值）：卡片上速览里的上色部分跟它走。 */
export function triggerTint(kind: TriggerSourceKind): string {
  return `var(--wl-c-${TRIGGER_COLOR[kind]})`
}

export function TriggerMark(props: {
  kind: TriggerSourceKind
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cx(ui.kind, props.className)}
      data-color={TRIGGER_COLOR[props.kind]}
      data-trigger-kind={props.kind}
    >
      <Icon name={TRIGGER_ICON[props.kind]} size={props.size ?? 15} />
    </span>
  )
}
