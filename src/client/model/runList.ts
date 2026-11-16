/**
 * dsh-workflow-lite — 工作流中心「运行实例」页左栏怎么排：按工作区 / 工作流 / 状态 / 会话分组，最近创建 / 最近更新 /
 * 名称排序，全部 / 进行中 / 失败筛选（{@link ListSpec}）。纯计算，不碰界面。
 *
 * 组的先后：工作区和会话是「本工作区 / 本会话」在最前，其余按最近一次建实例的时间，新的在前；工作流按名称；
 * 状态按「进行中、等待用户、失败、完成、已取消、不记状态」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/runList
 */

import type { InstanceSummary } from '../../shared/runState.ts'
import { workspaceKey } from './hubRuns.ts'
import { fixedOrder, type ListSpec, type StoredView } from './listView.ts'

export type RunGroupBy = 'workspace' | 'workflow' | 'status' | 'session' | 'none'
export type RunSortBy = 'created' | 'updated' | 'name'
export type RunShow = 'all' | 'active' | 'failed'

export const RUN_GROUPS: readonly RunGroupBy[] = [
  'workspace',
  'workflow',
  'status',
  'session',
  'none',
]
export const RUN_SORTS: readonly RunSortBy[] = ['created', 'updated', 'name']
export const RUN_SHOWS: readonly RunShow[] = ['all', 'active', 'failed']

export interface RunListView {
  group: RunGroupBy
  sort: RunSortBy
  show: RunShow
}

export const RUN_VIEW: StoredView<RunListView> = {
  key: 'workflow-lite.hubRuns',
  defaults: { group: 'workspace', sort: 'created', show: 'all' },
  choices: { group: RUN_GROUPS, sort: RUN_SORTS, show: RUN_SHOWS },
}

/**
 * 实例落在哪一档：进行中（含未开始）、等待用户、失败（含状态文件读不出来）、完成、已取消、不记状态。
 * 状态小标、左栏图标块、按状态分组都按它。
 */
export type RunBucket = 'running' | 'waiting' | 'failed' | 'done' | 'cancelled' | 'untracked'
export const RUN_BUCKETS: readonly RunBucket[] = [
  'running',
  'waiting',
  'failed',
  'done',
  'cancelled',
  'untracked',
]

export function runBucket(item: InstanceSummary): RunBucket {
  if (item.statePath === undefined) return 'untracked'
  if (item.stateProblem !== undefined) return 'failed'
  const status = item.status ?? 'pending'
  return status === 'pending' ? 'running' : status
}

/** 还在进行（进行中、等待用户）。 */
export function isActive(item: InstanceSummary): boolean {
  const bucket = runBucket(item)
  return bucket === 'running' || bucket === 'waiting'
}

/** 最近更新的时刻：状态文件写的 `updatedAt`，没有就按建立时间。 */
export function updatedOf(item: InstanceSummary): number {
  const at = item.updatedAt === undefined ? Number.NaN : Date.parse(item.updatedAt)
  return Number.isNaN(at) ? item.createdAt : at
}

const byCreated = (a: InstanceSummary, b: InstanceSummary): number =>
  b.createdAt - a.createdAt || a.id.localeCompare(b.id)

/** 按「本这个在最前，其余按最近建实例的时间，新的在前」排组。 */
function recentFirst(
  items: readonly InstanceSummary[],
  keyOf: (item: InstanceSummary) => string,
  here: string | undefined,
): (keys: readonly string[]) => string[] {
  const latest = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    latest.set(key, Math.max(latest.get(key) ?? 0, item.createdAt))
  }
  return (keys) =>
    [...keys].sort(
      (a, b) =>
        Number(b === here) - Number(a === here) ||
        (latest.get(b) ?? 0) - (latest.get(a) ?? 0) ||
        a.localeCompare(b),
    )
}

/** 会话分组的键：没有会话的是空串。 */
export const sessionKey = (item: InstanceSummary): string => item.session ?? ''

/**
 * 这一页的排法。组的先后要看全部实例（谁最近建过）和「本工作区 / 本会话」是哪个，所以每次按当下的列表给一份。
 */
export function runListSpec(
  items: readonly InstanceSummary[],
  here: { cwd: string | undefined; session: string | undefined },
): ListSpec<InstanceSummary, Exclude<RunGroupBy, 'none'>, RunSortBy, RunShow> {
  const wsOf = (item: InstanceSummary): string => workspaceKey(item.cwd)
  return {
    keep: {
      all: () => true,
      active: isActive,
      failed: (item) => runBucket(item) === 'failed',
    },
    sort: {
      created: byCreated,
      updated: (a, b) => updatedOf(b) - updatedOf(a) || byCreated(a, b),
      name: (a, b) => a.workflow.localeCompare(b.workflow) || byCreated(a, b),
    },
    keys: {
      workspace: (item) => [wsOf(item)],
      workflow: (item) => [item.workflow],
      status: (item) => [runBucket(item)],
      session: (item) => [sessionKey(item)],
    },
    order: {
      workspace: recentFirst(
        items,
        wsOf,
        here.cwd === undefined ? undefined : workspaceKey(here.cwd),
      ),
      status: fixedOrder(RUN_BUCKETS),
      session: recentFirst(items, sessionKey, here.session),
    },
  }
}
