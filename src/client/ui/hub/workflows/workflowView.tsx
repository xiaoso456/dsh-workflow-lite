/**
 * dsh-workflow-lite — 工作流列表的视图选项怎么摆：分好组（{@link arrangeWorkflows}）、视图菜单的几段（{@link workflowSections}）、
 * 搜索框里筛选小片那句（{@link filterLabel}）、分组标题写什么（{@link workflowGroupFace}）。
 *
 * 工作流中心「工作流」页的左栏和顶栏切换工作流的下拉共用（两边的分组、排序、筛选是同一份选择，见 app/listView.ts）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/workflows/workflowView
 */

import { sameTag, tagColorOf } from '../../../../shared/tags.ts'
import type { WorkflowEntry } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { type ArrangedList, arrangeList, type ListGroup } from '../../../model/listView.ts'
import {
  effectiveGroup,
  NO_TAG,
  type TagUse,
  tagCatalog,
  WORKFLOW_GROUPS,
  WORKFLOW_SHOWS,
  WORKFLOW_SORTS,
  type WorkflowGroupBy,
  type WorkflowListView,
  type WorkflowShow,
  type WorkflowSortBy,
  withTags,
  workflowListSpec,
} from '../../../model/workflowList.ts'
import type { IconName } from '../../kit/Icon.tsx'
import { type GroupFace, groupDot } from '../list/GroupedList.tsx'
import type { MenuSection } from '../list/ViewMenu.tsx'
import type { TagColors } from './TagMark.tsx'

export type WorkflowGroupKey = Exclude<WorkflowGroupBy, 'none'>

const GROUP: Record<WorkflowGroupBy, { label: LocaleKey; icon: IconName }> = {
  tag: { label: 'hub.wfGroup.tag', icon: 'tag' },
  trigger: { label: 'hub.wfGroup.trigger', icon: 'bolt' },
  updated: { label: 'hub.wfGroup.updated', icon: 'clock' },
  none: { label: 'hub.group.none', icon: 'overview' },
}

const SORT: Record<WorkflowSortBy, { label: LocaleKey; icon: IconName }> = {
  recent: { label: 'hub.wfSort.recent', icon: 'history' },
  name: { label: 'hub.sort.name', icon: 'font' },
}

const SHOW: Record<WorkflowShow, { label: LocaleKey; icon: IconName }> = {
  all: { label: 'hub.wfShow.all', icon: 'overview' },
  triggers: { label: 'hub.wfShow.triggers', icon: 'bolt' },
  versions: { label: 'hub.wfShow.versions', icon: 'history' },
  invalid: { label: 'hub.wfShow.invalid', icon: 'alert' },
}

const UPDATED_TEXT: Record<string, LocaleKey> = {
  today: 'hub.wfBucket.today',
  week: 'hub.wfBucket.week',
  older: 'hub.wfBucket.older',
}

/**
 * 分好组：`all` 是全部工作流（算标签目录、决定能不能按标签分），`matched` 是搜过之后剩下的。
 * 挑过的标签被删掉、改名了就不再拿它筛（`tags` 是还在的那些）。
 */
export function arrangeWorkflows(
  all: readonly WorkflowEntry[],
  matched: readonly WorkflowEntry[],
  view: WorkflowListView,
  tagFilter: readonly string[],
): {
  catalog: TagUse[]
  tags: string[]
  arranged: ArrangedList<WorkflowEntry, WorkflowGroupKey, WorkflowShow>
} {
  const catalog = tagCatalog(all)
  const tags = tagFilter.filter((tag) => catalog.some((use) => sameTag(use.tag, tag)))
  const arranged = arrangeList(
    withTags([...matched], tags),
    { ...view, group: effectiveGroup(view.group, all) },
    workflowListSpec(Date.now()),
  )
  return { catalog, tags, arranged }
}

/** 搜索框里筛选小片上那句：筛法和挑的标签。 */
export function filterLabel(t: T, show: WorkflowShow, tags: readonly string[]): string {
  const parts = [
    ...(show === 'all' ? [] : [t(SHOW[show].label)]),
    ...(tags.length === 0 ? [] : [t('hub.tagFilterShowing').replace('{tags}', tags.join('、'))]),
  ]
  return parts.join(' · ')
}

/** 视图菜单的几段：分组、排序、筛选，有标签时再加「按标签筛」（多选）。 */
export function workflowSections(
  t: T,
  view: WorkflowListView,
  counts: Record<WorkflowShow, number>,
  catalog: readonly TagUse[],
  colors: TagColors,
  tagFilter: readonly string[],
  on: { onView(change: Partial<WorkflowListView>): void; onTag(tag: string): void },
): MenuSection[] {
  const sections: MenuSection[] = [
    {
      id: 'group',
      title: t('hub.groupBy'),
      choices: WORKFLOW_GROUPS.map((value) => ({
        value,
        label: t(GROUP[value].label),
        icon: GROUP[value].icon,
      })),
      checked: (value) => view.group === value,
      onPick: (value) => on.onView({ group: value as WorkflowGroupBy }),
    },
    {
      id: 'sort',
      title: t('hub.sortBy'),
      choices: WORKFLOW_SORTS.map((value) => ({
        value,
        label: t(SORT[value].label),
        icon: SORT[value].icon,
      })),
      checked: (value) => view.sort === value,
      onPick: (value) => on.onView({ sort: value as WorkflowSortBy }),
    },
    {
      id: 'show',
      title: t('hub.showBy'),
      choices: WORKFLOW_SHOWS.map((value) => ({
        value,
        label: t(SHOW[value].label),
        icon: SHOW[value].icon,
        count: counts[value],
      })),
      checked: (value) => view.show === value,
      onPick: (value) => on.onView({ show: value as WorkflowShow }),
    },
  ]
  if (catalog.length > 0) {
    sections.push({
      id: 'tag',
      title: t('hub.tagFilter'),
      multi: true,
      choices: catalog.map((use) => ({
        value: use.tag,
        label: use.tag,
        icon: 'tag',
        tint: tagColorOf(colors, use.tag),
        count: use.count,
      })),
      checked: (value) => tagFilter.some((tag) => sameTag(tag, value)),
      onPick: on.onTag,
    })
  }
  return sections
}

/** 挑过的标签里加上 / 去掉一个。 */
export function toggleTag(list: readonly string[], tag: string): string[] {
  return list.some((known) => sameTag(known, tag))
    ? list.filter((known) => !sameTag(known, tag))
    : [...list, tag]
}

/**
 * 分组标题写什么：按标签是标签名（前面标签色的小圆点；无标签一组排在最后），按触发是有 / 没有触发器，
 * 按修改时间是今天 / 近 7 天 / 更早。标签的改名、删除按钮由「工作流」页自己加（见 WorkflowList）。
 */
export function workflowGroupFace(
  t: T,
  group: ListGroup<WorkflowEntry, WorkflowGroupKey>,
  colors: TagColors,
): GroupFace {
  if (group.by === 'trigger') {
    return {
      label: t(group.key === 'with' ? 'hub.wfBucket.withTrigger' : 'hub.wfBucket.noTrigger'),
    }
  }
  if (group.by === 'updated') return { label: t(UPDATED_TEXT[group.key] ?? 'hub.wfBucket.older') }
  if (group.by !== 'tag') return { label: '' }
  if (group.key === NO_TAG) return { label: t('hub.noTag') }
  return {
    label: group.key,
    mark: (
      <span
        className={groupDot}
        style={
          { '--group-dot': `var(--wl-c-${tagColorOf(colors, group.key)})` } as React.CSSProperties
        }
      />
    ),
  }
}
