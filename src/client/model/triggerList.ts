/**
 * dsh-workflow-lite — 工作流中心「触发」页左栏怎么排：按什么分组、组里按什么排、只看哪些。
 * 纯计算，不碰界面；选择记在本机（`app/triggerListView.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerList
 */

import { SOURCE_KINDS } from '../../shared/trigger.ts'
import type { TriggerSourceKind } from '../../shared/types.ts'
import type { TriggerEntry, TriggerState } from '../../shared/wire/trigger.ts'

/** 分组：按工作流 / 按状态 / 按触发方式 / 不分组。 */
export type TriggerGroupBy = 'workflow' | 'state' | 'kind' | 'none'
/** 组里怎么排：按名称 / 最近触发的在前 / 下一次触发早的在前。 */
export type TriggerSortBy = 'name' | 'recent' | 'next'
/** 只看哪些：全部 / 开着的 / 要处理的。 */
export type TriggerShow = 'all' | 'on' | 'act'

export const TRIGGER_GROUPS: readonly TriggerGroupBy[] = ['workflow', 'state', 'kind', 'none']
export const TRIGGER_SORTS: readonly TriggerSortBy[] = ['name', 'recent', 'next']
export const TRIGGER_SHOWS: readonly TriggerShow[] = ['all', 'on', 'act']

export interface TriggerListView {
  group: TriggerGroupBy
  sort: TriggerSortBy
  show: TriggerShow
}

export const DEFAULT_LIST_VIEW: TriggerListView = { group: 'workflow', sort: 'name', show: 'all' }

/** 按状态分的三组：要处理、开着、已关闭。 */
export type StateBucket = 'act' | 'on' | 'off'
const STATE_BUCKETS: readonly StateBucket[] = ['act', 'on', 'off']

/** 停着等人处理的几种状态（全部暂停不算：那是总闸，不是这张卡片的事）。 */
const ACT_STATES: ReadonlySet<TriggerState> = new Set([
  'confirm',
  'stopped',
  'error',
  'invalid',
  'restarting',
  'unavailable',
])

/** 这张卡片要人来处理（重新确认命令、重新打开、改设置…）。 */
export function needsAction(entry: TriggerEntry): boolean {
  return ACT_STATES.has(entry.view.state)
}

export function stateBucket(entry: TriggerEntry): StateBucket {
  if (needsAction(entry)) return 'act'
  return entry.view.enabled ? 'on' : 'off'
}

/** 左栏的一组；不分组时只有一组，`key` 是空串。 */
export type TriggerGroup =
  | { by: 'workflow'; key: string; entries: TriggerEntry[] }
  | { by: 'state'; key: StateBucket; entries: TriggerEntry[] }
  | { by: 'kind'; key: TriggerSourceKind; entries: TriggerEntry[] }
  | { by: 'none'; key: ''; entries: TriggerEntry[] }

export interface ArrangedTriggers {
  groups: TriggerGroup[]
  /** 三种「只看」各有几张（菜单里写在每项后面）。 */
  counts: Record<TriggerShow, number>
  /** 筛完还剩几张。 */
  shown: number
}

function keep(entry: TriggerEntry, show: TriggerShow): boolean {
  if (show === 'on') return entry.view.enabled
  if (show === 'act') return needsAction(entry)
  return true
}

const byName = (a: TriggerEntry, b: TriggerEntry): number =>
  a.name.localeCompare(b.name) || a.workflow.localeCompare(b.workflow)

/** 下一次触发的时刻：只有开着、在等的才算（关着、出错的没有下一次）。 */
function nextOf(entry: TriggerEntry): number | undefined {
  const { state, next } = entry.view
  return state === 'waiting' || state === 'elsewhere' ? next : undefined
}

/** 没有值的排在最后，同值按名称。 */
function byValue(
  of: (entry: TriggerEntry) => number | undefined,
  direction: 1 | -1,
): (a: TriggerEntry, b: TriggerEntry) => number {
  return (a, b) => {
    const x = of(a)
    const y = of(b)
    if (x === undefined || y === undefined) {
      return x === y ? byName(a, b) : x === undefined ? 1 : -1
    }
    return (x - y) * direction || byName(a, b)
  }
}

const SORTERS: Record<TriggerSortBy, (a: TriggerEntry, b: TriggerEntry) => number> = {
  name: byName,
  recent: byValue((entry) => entry.view.last?.at, -1),
  next: byValue(nextOf, 1),
}

/** 筛、排、分组。组的先后：工作流按名称，状态按「要处理、开着、已关闭」，触发方式按五种方式的固定顺序。 */
export function arrangeTriggers(
  entries: readonly TriggerEntry[],
  view: TriggerListView,
): ArrangedTriggers {
  const counts: Record<TriggerShow, number> = {
    all: entries.length,
    on: entries.filter((entry) => keep(entry, 'on')).length,
    act: entries.filter((entry) => keep(entry, 'act')).length,
  }
  const sorted = entries.filter((entry) => keep(entry, view.show)).sort(SORTERS[view.sort])
  return { groups: groupOf(sorted, view.group), counts, shown: sorted.length }
}

function groupOf(sorted: readonly TriggerEntry[], by: TriggerGroupBy): TriggerGroup[] {
  if (by === 'none') return sorted.length === 0 ? [] : [{ by, key: '', entries: [...sorted] }]
  if (by === 'state') {
    return STATE_BUCKETS.map((key) => ({
      by,
      key,
      entries: sorted.filter((entry) => stateBucket(entry) === key),
    })).filter((group) => group.entries.length > 0)
  }
  if (by === 'kind') {
    return SOURCE_KINDS.map((key) => ({
      by,
      key,
      entries: sorted.filter((entry) => entry.data.source.kind === key),
    })).filter((group) => group.entries.length > 0)
  }
  const names = [...new Set(sorted.map((entry) => entry.workflow))].sort((a, b) =>
    a.localeCompare(b),
  )
  return names.map((key) => ({
    by,
    key,
    entries: sorted.filter((entry) => entry.workflow === key),
  }))
}

/** 一组折叠记号：分组方式 + 组的键（不同分法下同名的组各记各的）。 */
export function groupId(group: TriggerGroup): string {
  return `${group.by}:${group.key}`
}
