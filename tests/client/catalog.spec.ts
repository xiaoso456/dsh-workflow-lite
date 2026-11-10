import { describe, expect, it } from 'vitest'
import { recordSaved } from '../../src/client/model/catalog.ts'
import type { GraphListResponse } from '../../src/shared/wire/graph.ts'

const list = (): GraphListResponse => ({
  workflows: [
    { name: 'a', nodeCount: 3, updatedAt: 300 },
    { name: 'b', nodeCount: 5, updatedAt: 200, versions: 2 },
    { name: 'c', nodeCount: 0, updatedAt: 100, invalid: true, reason: '坏了' },
  ],
  templates: { nodes: [] },
  warnings: [],
  limits: { maxNodes: 400, saveDebounceMs: 800 },
})

describe('recordSaved：存完把列表里这一行记成刚存过', () => {
  it('只换这一行：时间、步骤数更新，其余字段（版本数）保留，别的行原样', () => {
    const before = list()
    const after = recordSaved(before, { name: 'b', nodeCount: 6, savedAt: 1000 })
    expect(after?.workflows[1]).toEqual({ name: 'b', nodeCount: 6, updatedAt: 1000, versions: 2 })
    expect(after?.workflows[0]).toBe(before.workflows[0])
    expect(after?.workflows[2]).toBe(before.workflows[2])
    expect(after?.limits).toBe(before.limits)
    // 不改原列表。
    expect(before.workflows[1]?.updatedAt).toBe(200)
  })

  it('存下来了就不是坏的：去掉「坏了」的标记和原因', () => {
    const after = recordSaved(list(), { name: 'c', nodeCount: 4, savedAt: 1000 })
    expect(after?.workflows[2]).toEqual({ name: 'c', nodeCount: 4, updatedAt: 1000 })
  })

  it('浏览器的钟比文件的慢：时间不往回走', () => {
    const after = recordSaved(list(), { name: 'a', nodeCount: 3, savedAt: 250 })
    expect(after?.workflows[0]?.updatedAt).toBe(300)
  })

  it('列表里没有这张、或者还没列过：原样返回', () => {
    const before = list()
    expect(recordSaved(before, { name: 'zz', nodeCount: 1, savedAt: 1000 })).toBe(before)
    expect(recordSaved(null, { name: 'a', nodeCount: 1, savedAt: 1000 })).toBeNull()
  })
})
