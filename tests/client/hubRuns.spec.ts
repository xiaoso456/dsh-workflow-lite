import { describe, expect, it } from 'vitest'
import {
  groupRuns,
  matchesQuery,
  pickGroup,
  workspaceKey,
  workspaceName,
  workspacesOf,
} from '../../src/client/model/hubRuns.ts'
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

describe('搜索 + 分组', () => {
  const mine = run({ workflow: 'a', session: 's1', cwd: 'D:\\x', status: 'done', goal: '只在 x' })
  const other = run({ workflow: 'b', session: 's2', cwd: 'D:\\y', status: 'waiting' })
  const otherSameDir = run({ workflow: 'c', session: 's2', cwd: 'D:\\x', status: 'running' })
  const items = [otherSameDir, other, mine]
  const base = {
    hereCwd: 'D:\\x',
    titleOf: (id: string | undefined) => (id === 's2' ? '别的会话' : undefined),
  }

  it('按工作区分组，本工作区在最前，组内保持原顺序；数出执行中和等待用户的', () => {
    const groups = groupRuns(items, { ...base, query: '' })
    expect(
      groups.map((group) => [
        group.workspace.name,
        group.items.map((i) => i.workflow),
        group.active,
      ]),
    ).toEqual([
      ['x', ['c', 'a'], 1],
      ['y', ['b'], 1],
    ])
  })

  it('搜索跨工作区：只留有命中的组，组里只留命中的实例，计数跟着变', () => {
    const byTitle = groupRuns(items, { ...base, query: '别的' })
    expect(
      byTitle.map((group) => [
        group.workspace.name,
        group.workspace.count,
        group.items.map((i) => i.workflow),
      ]),
    ).toEqual([
      ['x', 1, ['c']],
      ['y', 1, ['b']],
    ])
    expect(groupRuns(items, { ...base, query: 'zzz' })).toEqual([])
  })

  it('右边显示哪组：点过的还在就是它，否则排在最前的（本工作区）', () => {
    const groups = groupRuns(items, { ...base, query: '' })
    expect(pickGroup(groups, workspaceKey('D:\\y'))?.workspace.name).toBe('y')
    expect(pickGroup(groups, null)?.workspace.name).toBe('x')
    // 搜索把点过的那组筛掉了：回到最前的一组。
    const onlyX = groupRuns(items, { ...base, query: '只在 x' })
    expect(pickGroup(onlyX, workspaceKey('D:\\y'))?.workspace.name).toBe('x')
    expect(pickGroup([], null)).toBeUndefined()
  })
})
