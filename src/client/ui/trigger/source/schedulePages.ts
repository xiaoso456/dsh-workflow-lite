/**
 * dsh-workflow-lite — 「触发方式」对话框里定时分两步填：先「触发时间」（规则、判定、接下来 7 天），
 * 判定要跑命令时再「检查命令」（工作区、命令、试运行）。到点就执行只有第一步。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/schedulePages
 */

import type { TriggerSource } from '../../../../shared/types.ts'

export type SchedulePage = 'time' | 'command'

/** 这张草稿有没有第二步：定时、判定要跑命令。 */
export function hasCommandPage(source: TriggerSource): boolean {
  return source.kind === 'schedule' && source.check !== undefined
}

/** 现在该停在哪一步：没有第二步时总是第一步。 */
export function pageOf(source: TriggerSource, wanted: SchedulePage): SchedulePage {
  return hasCommandPage(source) ? wanted : 'time'
}
