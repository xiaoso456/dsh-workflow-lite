/**
 * dsh-workflow-lite — 试运行输出里被换行断开的事件：哪一行事件后面跟着没带标记的下一截（判断见
 * `shared/triggerMark.ts` 的 `brokenEvents`，只看标准输出），换算成两路混排的输出里的位置，界面把它们标出来。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/trialLines
 */

import { brokenEvents } from '../../shared/triggerMark.ts'
import type { TryLine } from '../../shared/wire/trigger.ts'

/** 断开了几处、`lines` 里哪几行是没带标记的下一截；没断开是 `null`。 */
export function brokenLines(
  lines: readonly TryLine[],
): { count: number; cut: ReadonlySet<number> } | null {
  const out: number[] = []
  for (const [index, line] of lines.entries()) if (line.stream === 'out') out.push(index)
  const broken = brokenEvents(out.map((index) => lines[index]?.text ?? ''))
  if (broken === null) return null
  return {
    count: broken.count,
    cut: new Set(broken.cut.flatMap((at) => (out[at] === undefined ? [] : [out[at]]))),
  }
}
