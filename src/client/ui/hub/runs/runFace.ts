/**
 * dsh-workflow-lite — 一个实例在工作流中心里怎么认：状态的字；按状态分组时每一档的名字；来源的图标、一步的状态图标。
 * 左栏的行、分组标题、右栏共用。实例的颜色档和图标块在 chrome/KindMark.tsx（顶栏的下拉也用）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/runFace
 */

import type { InstanceSummary, NodeStatus, OriginChannel } from '../../../../shared/runState.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import type { RunBucket } from '../../../model/runList.ts'
import type { RunTone } from '../../chrome/KindMark.tsx'
import { RUN_STATUS_TEXT } from '../../chrome/RunStatusBadge.tsx'
import type { IconName } from '../../kit/Icon.tsx'
import { TRIGGER_ICON } from '../../trigger/TriggerMark.tsx'

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

/** 按状态分组时各档的名字、颜色档。 */
export const BUCKET_FACE: Record<RunBucket, { label: LocaleKey; tone: RunTone }> = {
  running: { label: 'hub.runBucket.running', tone: 'running' },
  waiting: { label: 'run.overall.waiting', tone: 'waiting' },
  failed: { label: 'run.overall.failed', tone: 'failed' },
  done: { label: 'run.overall.done', tone: 'done' },
  cancelled: { label: 'run.overall.cancelled', tone: 'cancelled' },
  untracked: { label: 'run.untracked', tone: 'untracked' },
}

/** 来源的图标：画布上点的、对话里发起的，触发器发起的跟触发方式走。 */
export const ORIGIN_ICON: Record<OriginChannel, IconName> = {
  manual: 'pointer',
  session: 'chat',
  ...TRIGGER_ICON,
  now: 'bolt',
}

/** 一步的状态图标（和左栏、头部的状态图标同一套）。 */
export const STEP_ICON: Record<NodeStatus, IconName> = {
  pending: 'circle',
  running: 'play',
  waiting: 'hourglass',
  done: 'check',
  failed: 'alert',
  skipped: 'skip',
}
