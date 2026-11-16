/**
 * dsh-workflow-lite — 工作流中心「记忆」页左栏怎么排：按类型 / 按使用 / 按工作流分组，最近修改 / 名称 / 使用数排序，
 * 全部 / 在用 / 未使用筛选（{@link ListSpec}）。纯计算，不碰界面。
 *
 * 按工作流分组时一条记忆被几个工作流用，就在几组里各出现一次；没被用的归在键为空串的一组，排在最后。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/memoryList
 */

import { type MemoryEntry, memoryTitle } from '../../shared/memoryLib.ts'
import { fixedOrder, type ListSpec, type StoredView } from './listView.ts'

export type MemoryGroupBy = 'type' | 'use' | 'workflow' | 'none'
export type MemorySortBy = 'recent' | 'name' | 'used'
export type MemoryShow = 'all' | 'used' | 'unused'

export const MEMORY_GROUPS: readonly MemoryGroupBy[] = ['type', 'use', 'workflow', 'none']
export const MEMORY_SORTS: readonly MemorySortBy[] = ['recent', 'name', 'used']
export const MEMORY_SHOWS: readonly MemoryShow[] = ['all', 'used', 'unused']

export interface MemoryListView {
  group: MemoryGroupBy
  sort: MemorySortBy
  show: MemoryShow
}

export const MEMORY_VIEW: StoredView<MemoryListView> = {
  key: 'workflow-lite.hubMemories',
  defaults: { group: 'none', sort: 'recent', show: 'all' },
  choices: { group: MEMORY_GROUPS, sort: MEMORY_SORTS, show: MEMORY_SHOWS },
}

/** 按使用分的两组。 */
export type UseBucket = 'used' | 'unused'

const used = (entry: MemoryEntry): boolean => entry.usedBy.length > 0
const byName = (a: MemoryEntry, b: MemoryEntry): number =>
  memoryTitle(a).localeCompare(memoryTitle(b)) || a.id.localeCompare(b.id)
const byRecent = (a: MemoryEntry, b: MemoryEntry): number =>
  b.updatedAt - a.updatedAt || byName(a, b)

/** 按工作流分组时「没有工作流在用」那一组的键。 */
export const NO_WORKFLOW = ''

export const MEMORY_LIST: ListSpec<
  MemoryEntry,
  Exclude<MemoryGroupBy, 'none'>,
  MemorySortBy,
  MemoryShow
> = {
  keep: {
    all: () => true,
    used,
    unused: (entry) => !used(entry),
  },
  sort: {
    recent: byRecent,
    name: byName,
    used: (a, b) => b.usedBy.length - a.usedBy.length || byRecent(a, b),
  },
  keys: {
    type: (entry) => [entry.type],
    use: (entry) => [used(entry) ? 'used' : 'unused'],
    workflow: (entry) => (used(entry) ? entry.usedBy : [NO_WORKFLOW]),
  },
  order: {
    type: fixedOrder(['workflow', 'step']),
    use: fixedOrder(['used', 'unused']),
    workflow: (keys) =>
      [...keys].sort(
        (a, b) => Number(a === NO_WORKFLOW) - Number(b === NO_WORKFLOW) || a.localeCompare(b),
      ),
  },
}
