/**
 * dsh-workflow-lite — 「运行实例」页「时间线」的行：状态流水和记到这个实例上的触发并在一起，从晚到早、一天一组。纯计算。
 *
 * 流水的时刻是插件改状态时记的；认不出时刻的那条跟着前一条（排序稳定，流水本来就是从早到晚记的）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/runTimeline
 */

import type { RunLogEntry } from '../../shared/runState.ts'
import type { FireRecord } from '../../shared/wire/trigger.ts'
import { dayOf } from './fireView.ts'

export type TimelineItem =
  | { kind: 'log'; at: number; key: string; entry: RunLogEntry }
  | { kind: 'fire'; at: number; key: string; fire: FireRecord }

export interface TimelineDay {
  /** 那天 0 点（{@link dayOf}）。 */
  day: number
  items: TimelineItem[]
}

/** 流水 + 触发，从晚到早、按天分组。 */
export function runTimeline(
  log: readonly RunLogEntry[],
  fires: readonly FireRecord[],
): TimelineDay[] {
  let last = 0
  const items: TimelineItem[] = log.map((entry, index) => {
    const parsed = Date.parse(entry.at)
    last = Number.isNaN(parsed) ? last : parsed
    return { kind: 'log', at: last, key: `log-${String(index)}`, entry }
  })
  for (const fire of fires) items.push({ kind: 'fire', at: fire.at, key: `fire-${fire.id}`, fire })
  // 从早到晚排好（同一刻触发在前：先收到触发、再开始做），再整个倒过来。
  const order = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        a.item.at - b.item.at ||
        (a.item.kind === b.item.kind ? a.index - b.index : a.item.kind === 'fire' ? -1 : 1),
    )
    .map(({ item }) => item)
    .reverse()
  const days: TimelineDay[] = []
  for (const item of order) {
    const day = dayOf(item.at)
    const group = days.at(-1)
    if (group !== undefined && group.day === day) group.items.push(item)
    else days.push({ day, items: [item] })
  }
  return days
}
