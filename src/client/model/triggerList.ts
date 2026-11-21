/**
 * dsh-workflow-lite — 工作流中心「触发」页左栏怎么排：按什么分组、组里按什么排、只看哪些（{@link ListSpec}）。
 * 纯计算，不碰界面；选择记在本机浏览器（`app/listView.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerList
 */

import { SOURCE_KINDS } from '../../shared/trigger.ts'
import type { TriggerEntry, TriggerState } from '../../shared/wire/trigger.ts'
import {
  type ArrangedList,
  arrangeList,
  byValue,
  fixedOrder,
  groupId,
  type ListGroup,
  type ListSpec,
  type StoredView,
} from './listView.ts'

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

export const DEFAULT_LIST_VIEW: TriggerListView = { group: 'state', sort: 'name', show: 'all' }

export const TRIGGER_VIEW: StoredView<TriggerListView> = {
  key: 'workflow-lite.hubTriggers',
  defaults: DEFAULT_LIST_VIEW,
  choices: { group: TRIGGER_GROUPS, sort: TRIGGER_SORTS, show: TRIGGER_SHOWS },
}

/** 按状态分的三组：要处理、开着、已关闭。 */
export type StateBucket = 'act' | 'on' | 'off'
const STATE_BUCKETS: readonly StateBucket[] = ['act', 'on', 'off']

/** 停着等人处理的几种状态（全部暂停不算：那是总闸，不是这张卡片的事）。 */
const ACT_STATES: ReadonlySet<TriggerState> = new Set([
  'stopped',
  'error',
  'invalid',
  'restarting',
  'unavailable',
])

/** 这张卡片要人来处理（重新启用、改设置…）。 */
export function needsAction(entry: TriggerEntry): boolean {
  return ACT_STATES.has(entry.view.state)
}

export function stateBucket(entry: TriggerEntry): StateBucket {
  if (needsAction(entry)) return 'act'
  return entry.view.enabled ? 'on' : 'off'
}

/** 左栏的一组；不分组时只有一组，`key` 是空串。按状态分时键是 {@link StateBucket}，按方式分时是触发方式。 */
export type TriggerGroup = ListGroup<TriggerEntry, Exclude<TriggerGroupBy, 'none'>>
export type ArrangedTriggers = ArrangedList<
  TriggerEntry,
  Exclude<TriggerGroupBy, 'none'>,
  TriggerShow
>

const byName = (a: TriggerEntry, b: TriggerEntry): number =>
  a.name.localeCompare(b.name) || a.workflow.localeCompare(b.workflow)

/** 下一次触发的时刻：只有开着、在等的才算（关着、出错的没有下一次）。 */
export function nextOf(entry: TriggerEntry): number | undefined {
  const { state, next } = entry.view
  return state === 'waiting' || state === 'elsewhere' ? next : undefined
}

/** 组的先后：工作流按名称，状态按「待处理、已启用、已停用」，触发方式按五种方式的固定顺序。 */
export const TRIGGER_LIST: ListSpec<
  TriggerEntry,
  Exclude<TriggerGroupBy, 'none'>,
  TriggerSortBy,
  TriggerShow
> = {
  keep: {
    all: () => true,
    on: (entry) => entry.view.enabled,
    act: needsAction,
  },
  sort: {
    name: byName,
    recent: byValue((entry) => entry.view.last?.at, -1, byName),
    next: byValue(nextOf, 1, byName),
  },
  keys: {
    workflow: (entry) => [entry.workflow],
    state: (entry) => [stateBucket(entry)],
    kind: (entry) => [entry.data.source.kind],
  },
  order: {
    state: fixedOrder(STATE_BUCKETS),
    kind: fixedOrder(SOURCE_KINDS),
  },
}

export function arrangeTriggers(
  entries: readonly TriggerEntry[],
  view: TriggerListView,
): ArrangedTriggers {
  return arrangeList(entries, view, TRIGGER_LIST)
}

export { groupId }
