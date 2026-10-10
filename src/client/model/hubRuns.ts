/**
 * dsh-workflow-lite — 工作流中心「运行实例」页的筛选与分组：按关键字筛，按工作区分组，挑出右边显示哪一组。
 *
 * 工作区就是实例建立时会话的 `cwd`；路径的大小写、分隔符、末尾斜杠不同也算同一个（Windows）。
 * 没记下工作区的实例归在一组（键是空串）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/hubRuns
 */

import type { InstanceSummary } from '../../shared/runState.ts'

/** 一个工作区。 */
export interface HubWorkspace {
  /** 比较用的键（标准化后的路径；没有工作区是空串）。 */
  key: string
  /** 原样的路径（取这一组里最新那个实例记下的写法）。 */
  path: string | undefined
  /** 显示用的名字：路径最后一段。 */
  name: string
  count: number
  /** 是不是本会话所在的工作区。 */
  here: boolean
}

/** 工作区的比较键。 */
export function workspaceKey(cwd: string | undefined): string {
  if (cwd === undefined) return ''
  return cwd
    .replace(/[\\/]+$/u, '')
    .replace(/\\/gu, '/')
    .toLowerCase()
}

/** 路径最后一段（`D:\a\b` → `b`；盘符根 `D:\` → `D:`）。 */
export function workspaceName(path: string): string {
  const parts = path.split(/[\\/]+/u).filter((part) => part !== '')
  return parts[parts.length - 1] ?? path
}

/** 列表里出现过的工作区：本会话的在最前，其余按最近一次建实例的时间，新的在前。 */
export function workspacesOf(
  items: readonly InstanceSummary[],
  hereCwd: string | undefined,
): HubWorkspace[] {
  const here = workspaceKey(hereCwd)
  const byKey = new Map<string, HubWorkspace & { latest: number }>()
  for (const item of items) {
    const key = workspaceKey(item.cwd)
    const seen = byKey.get(key)
    if (seen === undefined) {
      byKey.set(key, {
        key,
        path: item.cwd,
        name: item.cwd === undefined ? '' : workspaceName(item.cwd),
        count: 1,
        here: hereCwd !== undefined && key === here,
        latest: item.createdAt,
      })
      continue
    }
    seen.count += 1
    if (item.createdAt <= seen.latest) continue
    seen.latest = item.createdAt
    if (item.cwd !== undefined) {
      seen.path = item.cwd
      seen.name = workspaceName(item.cwd)
    }
  }
  return [...byKey.values()]
    .sort((a, b) => Number(b.here) - Number(a.here) || b.latest - a.latest)
    .map(({ latest: _latest, ...workspace }) => workspace)
}

/** 关键字命中没有：工作流名、会话标题、目标、工作区路径、实例 id，忽略大小写；空白分开的几个词都要命中。 */
export function matchesQuery(
  item: InstanceSummary,
  sessionTitle: string | undefined,
  query: string,
): boolean {
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== '')
  if (words.length === 0) return true
  const haystack = [item.workflow, sessionTitle, item.goal, item.cwd, item.id]
    .filter((part): part is string => part !== undefined)
    .join('\n')
    .toLowerCase()
  return words.every((word) => haystack.includes(word))
}

/** 一个工作区和它的实例。 */
export interface HubGroup {
  workspace: HubWorkspace
  /** 组内保持原顺序：新的在前。 */
  items: InstanceSummary[]
  /** 还在进行的：执行中 + 等待用户。 */
  active: number
}

/** 按关键字挑出实例，再按工作区分组（组的顺序同 {@link workspacesOf}：本工作区在最前）。 */
export function groupRuns(
  items: readonly InstanceSummary[],
  options: {
    query: string
    hereCwd: string | undefined
    titleOf: (session: string | undefined) => string | undefined
  },
): HubGroup[] {
  const shown = items.filter((item) =>
    matchesQuery(item, options.titleOf(item.session), options.query),
  )
  return workspacesOf(shown, options.hereCwd).map((workspace) => {
    const mine = shown.filter((item) => workspaceKey(item.cwd) === workspace.key)
    return {
      workspace,
      items: mine,
      active: mine.filter((item) => item.status === 'running' || item.status === 'waiting').length,
    }
  })
}

/**
 * 右边显示哪个工作区：点过的那个还在列表里就是它（搜索把它筛掉了就不算）；
 * 否则排在最前的——有本工作区就是本工作区，没有就是最近建过实例的。
 */
export function pickGroup(
  groups: readonly HubGroup[],
  picked: string | null,
): HubGroup | undefined {
  return groups.find((group) => group.workspace.key === picked) ?? groups[0]
}
