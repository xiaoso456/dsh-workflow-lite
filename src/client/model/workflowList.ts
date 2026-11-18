/**
 * dsh-workflow-lite — 工作流中心「工作流」页左栏怎么排：按标签 / 按触发 / 按修改时间分组，最近修改 / 名称排序，
 * 全部 / 有触发器 / 有版本 / 有问题筛选（{@link ListSpec}），另可按标签筛（多选，命中任一个就留下）。纯计算，不碰界面。
 *
 * - 按标签分组时一个工作流打了几个标签就在几组里各出现一次；没打标签的归在键为空串的「无标签」一组，排在最后。
 *   一个标签都还没有时按标签分组就是不分组（只有一组「无标签」没有意义）。
 * - 按修改时间分成今天、近 7 天、更早（按本机的日历日）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/workflowList
 */

import { sameTag } from '../../shared/tags.ts'
import type { WorkflowEntry } from '../../shared/types.ts'
import { fixedOrder, type ListSpec, type StoredView } from './listView.ts'

export type WorkflowGroupBy = 'tag' | 'trigger' | 'updated' | 'none'
export type WorkflowSortBy = 'recent' | 'name'
export type WorkflowShow = 'all' | 'triggers' | 'versions' | 'invalid'

export const WORKFLOW_GROUPS: readonly WorkflowGroupBy[] = ['tag', 'trigger', 'updated', 'none']
export const WORKFLOW_SORTS: readonly WorkflowSortBy[] = ['recent', 'name']
export const WORKFLOW_SHOWS: readonly WorkflowShow[] = ['all', 'triggers', 'versions', 'invalid']

export interface WorkflowListView {
  group: WorkflowGroupBy
  sort: WorkflowSortBy
  show: WorkflowShow
}

export const WORKFLOW_VIEW: StoredView<WorkflowListView> = {
  key: 'workflow-lite.hubWorkflows',
  defaults: { group: 'tag', sort: 'recent', show: 'all' },
  choices: { group: WORKFLOW_GROUPS, sort: WORKFLOW_SORTS, show: WORKFLOW_SHOWS },
}

export const WORKFLOW_SWITCHER_VIEW: StoredView<WorkflowListView> = {
  key: 'workflow-lite.workflowSwitcher',
  defaults: { group: 'none', sort: 'recent', show: 'all' },
  choices: WORKFLOW_VIEW.choices,
}

/** 按标签分组时「无标签」那一组的键。 */
export const NO_TAG = ''

/** 按修改时间分的三组。 */
export type UpdatedBucket = 'today' | 'week' | 'older'
export const UPDATED_BUCKETS: readonly UpdatedBucket[] = ['today', 'week', 'older']

/** 按触发分的两组。 */
export type TriggerBucket = 'with' | 'without'

const tagsOf = (entry: WorkflowEntry): readonly string[] => entry.tags ?? []
const byName = (a: WorkflowEntry, b: WorkflowEntry): number => a.name.localeCompare(b.name)
const byRecent = (a: WorkflowEntry, b: WorkflowEntry): number =>
  b.updatedAt - a.updatedAt || byName(a, b)

/** 修改时间落在哪一组：今天（本机的日历日）、近 7 天（含今天往前 6 天）、更早。 */
export function updatedBucket(updatedAt: number, now: number): UpdatedBucket {
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (updatedAt >= today.getTime()) return 'today'
  const weekStart = new Date(today)
  weekStart.setDate(weekStart.getDate() - 6)
  return updatedAt >= weekStart.getTime() ? 'week' : 'older'
}

/** 这一页的排法；按修改时间分组要知道「现在」。 */
export function workflowListSpec(
  now: number,
): ListSpec<WorkflowEntry, Exclude<WorkflowGroupBy, 'none'>, WorkflowSortBy, WorkflowShow> {
  return {
    keep: {
      all: () => true,
      triggers: (entry) => (entry.triggers ?? 0) > 0,
      versions: (entry) => (entry.versions ?? 0) > 0,
      invalid: (entry) => entry.invalid === true,
    },
    sort: { recent: byRecent, name: byName },
    keys: {
      tag: (entry) => (tagsOf(entry).length === 0 ? [NO_TAG] : tagsOf(entry)),
      trigger: (entry) => [(entry.triggers ?? 0) > 0 ? 'with' : 'without'],
      updated: (entry) => [updatedBucket(entry.updatedAt, now)],
    },
    order: {
      tag: (keys) =>
        [...keys].sort((a, b) => Number(a === NO_TAG) - Number(b === NO_TAG) || a.localeCompare(b)),
      trigger: fixedOrder(['with', 'without']),
      updated: fixedOrder(UPDATED_BUCKETS),
    },
  }
}

/** 一个标签和用着它的工作流数。 */
export interface TagUse {
  tag: string
  count: number
}

/** 全部工作流上打过的标签（不分大小写算同一个，写法取先遇到的），按名称排。 */
export function tagCatalog(workflows: readonly WorkflowEntry[]): TagUse[] {
  const uses: TagUse[] = []
  for (const entry of workflows) {
    for (const tag of tagsOf(entry)) {
      const known = uses.find((use) => sameTag(use.tag, tag))
      if (known === undefined) uses.push({ tag, count: 1 })
      else known.count += 1
    }
  }
  return uses.sort((a, b) => a.tag.localeCompare(b.tag))
}

/** 按标签筛：没挑就全留；挑了留下打了其中任一个的。 */
export function withTags(
  workflows: readonly WorkflowEntry[],
  picked: readonly string[],
): WorkflowEntry[] {
  if (picked.length === 0) return [...workflows]
  return workflows.filter((entry) =>
    tagsOf(entry).some((tag) => picked.some((want) => sameTag(want, tag))),
  )
}

/** 实际按什么分组：一个标签都还没有时，按标签就是不分组。 */
export function effectiveGroup(
  group: WorkflowGroupBy,
  workflows: readonly WorkflowEntry[],
): WorkflowGroupBy {
  return group === 'tag' && !workflows.some((entry) => tagsOf(entry).length > 0) ? 'none' : group
}
