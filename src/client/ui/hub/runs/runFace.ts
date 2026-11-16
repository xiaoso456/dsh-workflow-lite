/**
 * dsh-workflow-lite — 一个实例在工作流中心里怎么认：状态的图标、颜色档（`data-run-status`，见 chrome/runStatus.module.css）、
 * 状态的字；按状态分组时每一档的名字。左栏的行、分组标题、右栏头部共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/runFace
 */

import type { InstanceSummary, RunStatus } from '../../../../shared/runState.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import type { RunBucket } from '../../../model/runList.ts'
import { RUN_STATUS_TEXT } from '../../chrome/RunStatusBadge.tsx'
import type { IconName } from '../../kit/Icon.tsx'

/** 颜色档：整体状态，另加不记进度（灰）、状态文件读不出来（按失败上色）。 */
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

/** 状态的字：整体状态；不记进度、状态文件不在 / 有误各有一句。 */
export function runStatusText(t: T, item: InstanceSummary): string {
  if (item.statePath === undefined) return t('run.untracked')
  if (item.stateProblem !== undefined) {
    return t(item.stateProblem === 'missing' ? 'run.stateMissing' : 'run.stateInvalid')
  }
  return t(RUN_STATUS_TEXT[item.status ?? 'pending'])
}

/** 进度「2/4」：记了步数才有。 */
export function runProgress(item: InstanceSummary): string | undefined {
  return item.total !== undefined && item.total > 0 ? `${item.done ?? 0}/${item.total}` : undefined
}

/** 按状态分组时各档的名字、图标、颜色档。 */
export const BUCKET_FACE: Record<RunBucket, { label: LocaleKey; icon: IconName; tone: RunTone }> = {
  running: { label: 'hub.runBucket.running', icon: 'play', tone: 'running' },
  waiting: { label: 'run.overall.waiting', icon: 'hourglass', tone: 'waiting' },
  failed: { label: 'run.overall.failed', icon: 'alert', tone: 'failed' },
  done: { label: 'run.overall.done', icon: 'check', tone: 'done' },
  cancelled: { label: 'run.overall.cancelled', icon: 'stop', tone: 'cancelled' },
  untracked: { label: 'run.untracked', icon: 'runs', tone: 'untracked' },
}
