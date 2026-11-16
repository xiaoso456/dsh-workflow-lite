/**
 * dsh-workflow-lite — 工作流、实例的图标块：工作流是蓝色的（读不出来的是珊瑚色警示），实例按状态上色、换图标
 * （完成 ✓、执行中 ▶、等待 ⌛、失败 △、未开始 ◷、已取消 ■）。
 *
 * 工作流中心的列表、实例右栏的头部、顶栏切换工作流的下拉用的是同一套，换个地方认得出是同一样东西。
 * 大小由用的地方给（`className`）；块本身是 `ui.kind`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/chrome/KindMark
 */

import type { InstanceSummary, RunStatus } from '../../../shared/runState.ts'
import { cx } from '../kit/cx.ts'
import { Icon, type IconName } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import css from './kindMark.module.css'

/** 实例的颜色档：整体状态，另加不记进度（灰）、状态文件读不出来（按失败上色）。 */
export type RunTone = RunStatus | 'untracked'

export function runTone(item: InstanceSummary): RunTone {
  if (item.statePath === undefined) return 'untracked'
  if (item.stateProblem !== undefined) return 'failed'
  return item.status ?? 'pending'
}

const TONE_ICON: Record<RunTone, IconName> = {
  pending: 'clock',
  running: 'play',
  waiting: 'hourglass',
  done: 'check',
  failed: 'alert',
  cancelled: 'stop',
  untracked: 'runs',
}

export function runIcon(item: InstanceSummary): IconName {
  return TONE_ICON[runTone(item)]
}

export function WorkflowKindMark(props: {
  invalid: boolean
  className?: string
}): React.JSX.Element {
  return (
    <span className={cx(ui.kind, props.className)} data-color={props.invalid ? 'coral' : 'blue'}>
      <Icon name={props.invalid ? 'alert' : 'hub'} size={15} />
    </span>
  )
}

export function RunKindMark(props: {
  item: InstanceSummary
  className?: string
  size?: number
}): React.JSX.Element {
  return (
    <span className={cx(ui.kind, css.run, props.className)} data-run-status={runTone(props.item)}>
      <Icon name={runIcon(props.item)} size={props.size ?? 15} />
    </span>
  )
}
