/**
 * dsh-workflow-lite — 接续触发等的那个工作流最近的一次执行，按现在的设置会不会接着执行这一个：
 * 「触发方式」对话框里接续那一页、工作流中心「触发」页的「上游」共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/afterRuns
 */

import { afterMatches, type FinishedStatus } from '../../shared/trigger.ts'
import type { TriggerSource } from '../../shared/types.ts'
import type { RunBrief } from '../app/workflowRuns.ts'
import type { LocaleKey } from '../i18n.ts'

const FINISHED: readonly string[] = ['done', 'failed', 'cancelled'] satisfies FinishedStatus[]

/** 跑完了的结果；还没结束（或看不出来）是 `null`。 */
export function finishedOf(run: RunBrief): FinishedStatus | null {
  return run.status !== undefined && FINISHED.includes(run.status)
    ? (run.status as FinishedStatus)
    : null
}

/** 这一次会不会接着执行：`fires` 会、`skips` 不会、`open` 还没结束。 */
export type AfterVerdict = 'fires' | 'skips' | 'open'

export function afterVerdict(
  source: Extract<TriggerSource, { kind: 'after' }>,
  run: RunBrief,
): AfterVerdict {
  const finished = finishedOf(run)
  if (finished === null) return 'open'
  return afterMatches(source, finished) ? 'fires' : 'skips'
}

export const AFTER_VERDICT_TEXT: Record<AfterVerdict, LocaleKey> = {
  fires: 'trigger.afterRunFires',
  skips: 'trigger.afterRunSkips',
  open: 'trigger.afterRunOpen',
}
