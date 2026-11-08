/**
 * dsh-workflow-lite — 卡片共用的小零件：卡种、运行状态文案、染色。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/cards/cardParts
 */

import type { StepColor } from '../../../../shared/appearance.ts'
import type { NodeStatus } from '../../../../shared/runState.ts'
import type { LocaleKey } from '../../../i18n.ts'
import type { CardKind } from '../../../model/connect.ts'

/** React Flow 节点类型 → 拖线起点的卡种。 */
export function cardKindOf(type: string | undefined): CardKind {
  return type === 'wfResource' ? 'resource' : type === 'wfInput' ? 'input' : 'step'
}

export const RUN_TEXT: Record<NodeStatus, LocaleKey> = {
  pending: 'run.status.pending',
  running: 'run.status.running',
  waiting: 'run.status.waiting',
  done: 'run.status.done',
  failed: 'run.status.failed',
  skipped: 'run.status.skipped',
}

/** 卡片染色：色板里的颜色交给 CSS 变量 `--wl-tint`（色值在主题里）。 */
export function tintStyle(color: StepColor | null): React.CSSProperties | undefined {
  return color === null
    ? undefined
    : ({ '--wl-tint': `var(--wl-c-${color})` } as React.CSSProperties)
}
