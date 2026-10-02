/**
 * dsh-workflow-lite — 步骤的图标块：卡片、面板、步骤库、连接清单里认一个步骤的那个小色块。
 *
 * 样子取自步骤自己的 `data.icon` / `data.color`，没存的按 id 猜（`shared/appearance.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/StepMark
 */

import { type Appearance, appearanceOf } from '../../shared/appearance.ts'
import type { NodeData } from '../../shared/types.ts'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

/** 一个步骤的样子。 */
export function lookOf(id: string, data: Pick<NodeData, 'icon' | 'color'> | undefined): Appearance {
  return appearanceOf(id, data ?? {})
}

export function StepMark(props: {
  look: Appearance
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cx(ui.kind, props.className)}
      data-color={props.look.color}
      data-icon={props.look.icon}
    >
      <Icon name={props.look.icon} size={props.size ?? 15} />
    </span>
  )
}
