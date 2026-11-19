/**
 * dsh-workflow-lite — 切换工作流的下拉里，名字后面那个小闪电：这张工作流有几张触发卡片开着。
 *
 * - 开着几张就写几（一张不写数）；有卡片开着才标，关着的、没有触发卡片的不标。
 * - 这台机器「全部暂停」了：记号褪成灰色，不消失（恢复后哪几张会动一眼就看得出）。
 * - 任何一张有还没看过的失败（和画布卡片、工作流中心时间线是同一个红点）：记号上亮红点。
 *   连续失败被自动停用的卡片开关已经关了，这时没有开着的也照样标出来（灰色闪电 + 红点）。
 *
 * 纯计算，不碰界面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/workflowTriggerMarks
 */

import type { TriggerAllResponse } from '../../shared/wire/trigger.ts'
import { type FiresSeen, hasUnseenFailure, seenOf } from '../app/fireSeen.ts'
import type { T } from '../i18n.ts'

export interface WorkflowTriggerMark {
  /** 开着几张。 */
  on: number
  /** 全部暂停着。 */
  paused: boolean
  /** 有还没看过的失败。 */
  unseen: boolean
}

/** 按工作流名：只有要标的才在里面。 */
export function workflowTriggerMarks(
  list: TriggerAllResponse,
  seen: FiresSeen,
): ReadonlyMap<string, WorkflowTriggerMark> {
  const paused = list.paused !== undefined
  const marks = new Map<string, WorkflowTriggerMark>()
  for (const { workflow, view } of list.triggers) {
    const on = view.enabled ? 1 : 0
    const unseen = hasUnseenFailure(view.lastFailure, seenOf(seen, workflow, view.node))
    if (on === 0 && !unseen) continue
    const mark = marks.get(workflow) ?? { on: 0, paused, unseen: false }
    marks.set(workflow, { ...mark, on: mark.on + on, unseen: mark.unseen || unseen })
  }
  return marks
}

/** 悬停记号时那一行说明。 */
export function workflowTriggerTip(t: T, mark: WorkflowTriggerMark): string {
  const parts = [
    mark.on > 0 ? t('trigger.wfMark.on').replace('{n}', String(mark.on)) : t('trigger.wfMark.none'),
  ]
  if (mark.paused && mark.on > 0) parts.push(t('trigger.state.paused'))
  if (mark.unseen) parts.push(t('trigger.wfMark.unseen'))
  return parts.join(' · ')
}
