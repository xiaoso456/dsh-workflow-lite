import { describe, expect, it, vi } from 'vitest'
import { readView } from '../../src/client/app/listView.ts'
import { arrangeList, fixedOrder, groupId, type ListSpec } from '../../src/client/model/listView.ts'
import { MEMORY_LIST, MEMORY_VIEW, NO_WORKFLOW } from '../../src/client/model/memoryList.ts'
import {
  effectiveGroup,
  NO_TAG,
  tagCatalog,
  updatedBucket,
  WORKFLOW_SWITCHER_VIEW,
  WORKFLOW_VIEW,
  withTags,
  workflowListSpec,
} from '../../src/client/model/workflowList.ts'
import type { MemoryEntry } from '../../src/shared/memoryLib.ts'
import type { WorkflowEntry } from '../../src/shared/types.ts'

interface Item {
  name: string
  tags: string[]
  n: number
}

const SPEC: ListSpec<Item, 'tag' | 'size', 'name' | 'n', 'all' | 'big'> = {
  keep: { all: () => true, big: (item) => item.n > 1 },
  sort: { name: (a, b) => a.name.localeCompare(b.name), n: (a, b) => b.n - a.n },
  keys: {
    tag: (item) => (item.tags.length === 0 ? [''] : item.tags),
    size: (item) => [item.n > 1 ? 'big' : 'small'],
  },
  order: { size: fixedOrder(['small', 'big']) },
}

const items: Item[] = [
  { name: 'b', tags: ['x', 'y'], n: 3 },
  { name: 'a', tags: ['y'], n: 1 },
  { name: 'c', tags: [], n: 2 },
]

describe('通用的筛、排、分组', () => {
  it('一项可以落进几组；组按键名排（空串在最前），组里按选的排法', () => {
    const arranged = arrangeList(items, { group: 'tag', sort: 'name', show: 'all' }, SPEC)
    expect(arranged.groups.map((group) => [group.key, group.entries.map((i) => i.name)])).toEqual([
      ['', ['c']],
      ['x', ['b']],
      ['y', ['a', 'b']],
    ])
    // 一项在几组里出现，「筛完还剩几项」只算一次。
    expect(arranged.shown).toBe(3)
    expect(groupId(arranged.groups[1] ?? { by: '', key: '' })).toBe('tag:x')
  })

  it('固定先后；筛选数出每种有几项；不分组只有一组，空了就一组都没有', () => {
    const bySize = arrangeList(items, { group: 'size', sort: 'n', show: 'all' }, SPEC)
    expect(bySize.groups.map((group) => group.key)).toEqual(['small', 'big'])
    expect(bySize.counts).toEqual({ all: 3, big: 2 })
    const big = arrangeList(items, { group: 'none', sort: 'n', show: 'big' }, SPEC)
    expect(big.groups).toEqual([{ by: 'none', key: '', entries: [items[0], items[2]] }])
    expect(arrangeList([], { group: 'none', sort: 'n', show: 'all' }, SPEC).groups).toEqual([])
  })
})

function memory(over: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: 'm',
    type: 'step',
    name: '',
    description: '',
    createdAt: 0,
    usedBy: [],
    files: 0,
    bytes: 0,
    updatedAt: 0,
    versions: 0,
    ...over,
  } as MemoryEntry
}

describe('记忆页', () => {
  const shared = memory({ id: 'shared', name: '共用', usedBy: ['甲', '乙'], updatedAt: 3 })
  const global = memory({ id: 'g', name: '全局', type: 'workflow', usedBy: ['甲'], updatedAt: 2 })
  const idle = memory({ id: 'idle', name: '闲置', updatedAt: 1 })
  const all = [idle, global, shared]
  const view = MEMORY_VIEW.defaults

  it('按工作流：用了几个工作流就在几组里；没人用的一组排在最后', () => {
    const groups = arrangeList(all, { ...view, group: 'workflow' }, MEMORY_LIST).groups
    expect(groups.map((group) => [group.key, group.entries.map((m) => m.id)])).toEqual([
      ['甲', ['shared', 'g']],
      ['乙', ['shared']],
      [NO_WORKFLOW, ['idle']],
    ])
  })

  it('按类型：工作流记忆在前；按使用：在用在前；使用最多排在前', () => {
    const byType = arrangeList(all, { ...view, group: 'type' }, MEMORY_LIST).groups
    expect(byType.map((group) => group.key)).toEqual(['workflow', 'step'])
    const byUse = arrangeList(all, { ...view, group: 'use', sort: 'used' }, MEMORY_LIST)
    expect(byUse.groups.map((group) => [group.key, group.entries.map((m) => m.id)])).toEqual([
      ['used', ['shared', 'g']],
      ['unused', ['idle']],
    ])
    expect(byUse.counts).toEqual({ all: 3, used: 2, unused: 1 })
  })
})

function workflow(over: Partial<WorkflowEntry>): WorkflowEntry {
  return { name: 'w', nodeCount: 1, updatedAt: 0, ...over }
}

describe('工作流页与画布快搜', () => {
  const now = new Date(2026, 10, 15, 15, 0).getTime()
  const day = 24 * 60 * 60 * 1000
  const weekly = workflow({ name: '周报', tags: ['写作', '每周'], updatedAt: now - 60_000 })
  const patrol = workflow({ name: '巡检', tags: ['每周'], triggers: 2, updatedAt: now - 3 * day })
  const loose = workflow({ name: '草稿', updatedAt: now - 30 * day, versions: 2 })
  const all = [loose, patrol, weekly]
  const spec = workflowListSpec(now)

  it('按标签：打了几个就在几组里；无标签排在最后；一个标签都没有时就是不分组', () => {
    const view = {
      ...WORKFLOW_VIEW.defaults,
      group: effectiveGroup(WORKFLOW_VIEW.defaults.group, all),
    }
    const groups = arrangeList(all, view, spec).groups
    expect(groups.map((group) => [group.key, group.entries.map((w) => w.name)])).toEqual([
      ['每周', ['周报', '巡检']],
      ['写作', ['周报']],
      [NO_TAG, ['草稿']],
    ])
    expect(effectiveGroup('tag', [loose])).toBe('none')
    expect(effectiveGroup('trigger', [loose])).toBe('trigger')
  })

  it('画布快搜不继承工作流页的筛选，默认不分组、按最近修改找到所有工作流', () => {
    const savedHubView = { group: 'tag', sort: 'name', show: 'versions' }
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => (key === WORKFLOW_VIEW.key ? JSON.stringify(savedHubView) : null),
      },
    })
    try {
      expect(readView(WORKFLOW_VIEW)).toEqual(savedHubView)
      const arranged = arrangeList(all, readView(WORKFLOW_SWITCHER_VIEW), spec)
      expect(arranged.groups).toEqual([{ by: 'none', key: '', entries: [weekly, patrol, loose] }])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('按修改时间分今天、近 7 天、更早；按触发有的在前', () => {
    const byTime = arrangeList(all, { ...WORKFLOW_VIEW.defaults, group: 'updated' }, spec)
    expect(byTime.groups.map((group) => group.key)).toEqual(['today', 'week', 'older'])
    expect(updatedBucket(now - 6 * day, now)).toBe('week')
    expect(updatedBucket(new Date(2026, 10, 8, 23, 0).getTime(), now)).toBe('older')
    const byTrigger = arrangeList(all, { ...WORKFLOW_VIEW.defaults, group: 'trigger' }, spec)
    expect(byTrigger.groups.map((group) => [group.key, group.entries.length])).toEqual([
      ['with', 1],
      ['without', 2],
    ])
    expect(byTrigger.counts).toEqual({ all: 3, triggers: 1, versions: 1, invalid: 0 })
  })

  it('标签目录数用着的工作流（不分大小写）；按标签筛命中任一个就留下', () => {
    const mixed = [...all, workflow({ name: '日报', tags: ['写作'.toUpperCase(), 'Daily'] })]
    expect(tagCatalog([workflow({ tags: ['Daily'] }), workflow({ tags: ['daily'] })])).toEqual([
      { tag: 'Daily', count: 2 },
    ])
    expect(withTags(mixed, ['daily', '写作']).map((w) => w.name)).toEqual(['周报', '日报'])
    expect(withTags(mixed, [])).toHaveLength(4)
  })
})
