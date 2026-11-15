/**
 * dsh-workflow-lite — 最近的输出什么时候该重读：卡片状态里跟输出有关的几样
 * （又检查了一次、程序起来了或退出了、打出新的一行——标准输出、错误输出都算）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/output/outputStamp
 */

import type { TriggerView } from '../../../../shared/wire/trigger.ts'

export function outputStamp(view: TriggerView | undefined): string {
  if (view === undefined) return ''
  return [
    view.state,
    view.checked?.at ?? '',
    view.since ?? '',
    view.next ?? '',
    view.line?.at ?? '',
    view.output ?? '',
  ].join('|')
}
