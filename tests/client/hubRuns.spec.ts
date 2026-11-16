import { describe, expect, it } from 'vitest'
import {
  matchesQuery,
  workspaceKey,
  workspaceName,
  workspacesOf,
} from '../../src/client/model/hubRuns.ts'
import { arrangeList } from '../../src/client/model/listView.ts'
import {
  isActive,
  RUN_VIEW,
  type RunListView,
  runBucket,
  runListSpec,
  updatedOf,
} from '../../src/client/model/runList.ts'
import type { InstanceSummary } from '../../src/shared/runState.ts'

let seq = 0
function run(over: Partial<InstanceSummary>): InstanceSummary {
  seq += 1
  return {
    id: `20261004-0000${String(seq).padStart(2, '0')}-abcd`,
    workflow: 'wf',
    planId: 'p',
    mode: 'auto',
    createdAt: seq,
    current: false,
    ...over,
  }
}

describe('工作区：路径写法不同也算同一个', () => {
  it('大小写、分隔符、末尾斜杠都不影响；没有工作区是空串', () => {
    expect(workspaceKey('D:\\tmp\\Space-Bunny\\')).toBe(workspaceKey('d:/tmp/space-bunny'))
    expect(workspaceKey(undefined)).toBe('')
  })

  it('名字取路径最后一段', () => {
    expect(workspaceName('D:\\tmp\\ai-battle\\space-bunny')).toBe('space-bunny')
    expect(workspaceName('/home/me/proj/')).toBe('proj')
    expect(workspaceName('D:\\')).toBe('D:')
  })

  it('本会话的工作区在最前，其余按最近建实例的时间，新的在前；计数合并写法不同的同一目录', () => {
    const items = [
      run({ cwd: 'D:\\a', createdAt: 10 }),
      run({ cwd: 'd:/A/', createdAt: 30 }),
      run({ cwd: 'D:\\b', createdAt: 20 }),
      run({ cwd: 'D:\\here', createdAt: 1 }),
      run({ createdAt: 5 }),
    ]
    const list = workspacesOf(items, 'D:\\here\\')
    expect(list.map((item) => [item.name, item.count, item.here])).toEqual([
      ['here', 1, true],
      ['A', 2, false],
      ['b', 1, false],
      ['', 1, false],
    ])
    // 原样的路径取最新那个实例记下的写法
    expect(list[1]?.path).toBe('d:/A/')
    expect(list[3]?.path).toBeUndefined()
  })
})

describe('搜索', () => {
  const item = run({
    workflow: 'qw-loop',
    goal: '把登录页修好',
    cwd: 'D:\\tmp\\space-bunny',
  })

  it('工作流名、会话标题、目标、路径都能搜到，忽略大小写', () => {
    expect(matchesQuery(item, undefined, 'QW')).toBe(true)
    expect(matchesQuery(item, '重构鉴权', '鉴权')).toBe(true)
    expect(matchesQuery(item, undefined, '登录')).toBe(true)
    expect(matchesQuery(item, undefined, 'bunny')).toBe(true)
    expect(matchesQuery(item, undefined, 'nope')).toBe(false)
  })

  it('空白分开的几个词都要命中；空查询都算命中', () => {
    expect(matchesQuery(item, '重构鉴权', 'loop 鉴权')).toBe(true)
    expect(matchesQuery(item, '重构鉴权', 'loop 缓存')).toBe(false)
    expect(matchesQuery(item, undefined, '   ')).toBe(true)
  })
})

describe('左栏的分组、排序、筛选', () => {
  const mine = run({
    workflow: 'a',
    session: 's1',
    cwd: 'D:\\x',
    statePath: 'x/state.yaml',
    status: 'done',
    createdAt: 30,
  })
  const other = run({
    workflow: 'b',
    session: 's2',
    cwd: 'D:\\y',
    statePath: 'y/state.yaml',
    status: 'waiting',
    createdAt: 50,
  })
  const otherSameDir = run({
    workflow: 'c',
    session: 's2',
    cwd: 'd:/X/',
    statePath: 'x/state2.yaml',
    status: 'running',
    createdAt: 40,
    updatedAt: '2026-11-15T10:00:00Z',
  })
  const broken = run({
    workflow: 'a',
    session: 's1',
    cwd: 'D:\\x',
    statePath: 'x/gone.yaml',
    stateProblem: 'missing',
    createdAt: 20,
  })
  const loose = run({ workflow: 'd', createdAt: 10 })
  const items = [mine, other, otherSameDir, broken, loose]
  const spec = runListSpec(items, { cwd: 'D:\\x', session: 's1' })
  const view = (over: Partial<RunListView>): RunListView => ({ ...RUN_VIEW.defaults, ...over })
  const shape = (over: Partial<RunListView>) =>
    arrangeList(items, view(over), spec).groups.map((group) => [
      group.key,
      group.entries.map((item) => item.workflow),
    ])

  it('按工作区：本工作区在最前（写法不同算同一个），其余按最近建实例；组内新的在前', () => {
    expect(shape({})).toEqual([
      [workspaceKey('D:\\x'), ['c', 'a', 'a']],
      [workspaceKey('D:\\y'), ['b']],
      ['', ['d']],
    ])
  })

  it('按状态：进行中、等待用户、失败（含状态文件读不出来）、完成、不记进度', () => {
    expect(shape({ group: 'status' })).toEqual([
      ['running', ['c']],
      ['waiting', ['b']],
      ['failed', ['a']],
      ['done', ['a']],
      ['untracked', ['d']],
    ])
    expect(runBucket(broken)).toBe('failed')
    expect(runBucket(loose)).toBe('untracked')
    expect(runBucket(run({ statePath: 's', status: 'pending' }))).toBe('running')
  })

  it('按会话：本会话在最前；没有会话的一组键是空串', () => {
    expect(shape({ group: 'session' }).map(([key]) => key)).toEqual(['s1', 's2', ''])
  })

  it('排序：最近更新按状态文件的时间，没有就按建立时间；按工作流名', () => {
    expect(updatedOf(otherSameDir)).toBe(Date.parse('2026-11-15T10:00:00Z'))
    expect(updatedOf(mine)).toBe(30)
    expect(shape({ group: 'none', sort: 'name' })).toEqual([['', ['a', 'a', 'b', 'c', 'd']]])
  })

  it('筛选：进行中是执行中 + 等待用户；失败含读不出来的；数出每种有几个', () => {
    const active = arrangeList(items, view({ show: 'active', group: 'none' }), spec)
    expect(active.groups[0]?.entries.map((item) => item.workflow)).toEqual(['b', 'c'])
    expect(active.counts).toEqual({ all: 5, active: 2, failed: 1 })
    expect(isActive(mine)).toBe(false)
  })
})
