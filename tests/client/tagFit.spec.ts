import { describe, expect, it } from 'vitest'
import { fitTags, HOVER_GROW } from '../../src/client/ui/hub/workflows/tagFit.ts'

// 三个标签各 50 宽，「+N」26，「+ 标签」56，间距 6。
const chips = [50, 50, 50]
const tail = [56]
const all = 50 * 3 + 56 + 6 * 3

describe('fitTags', () => {
  it('一行放得下（连悬停变宽那一截）就全放', () => {
    expect(fitTags(chips, tail, 26, 6, all + HOVER_GROW)).toBe(3)
  })

  it('差一点放不下：后面收成「+N」，前面放得下几个放几个', () => {
    // 放两个：50 + 50 + 26 + 56 + 3 个间距
    const two = 50 + 50 + 26 + 56 + 6 * 3
    expect(fitTags(chips, tail, 26, 6, all + HOVER_GROW - 1)).toBe(2)
    expect(fitTags(chips, tail, 26, 6, two + HOVER_GROW)).toBe(2)
    expect(fitTags(chips, tail, 26, 6, two + HOVER_GROW - 1)).toBe(1)
  })

  it('窄到一个都放不下：只剩「+N」「+ 标签」', () => {
    expect(fitTags(chips, tail, 26, 6, 100)).toBe(0)
  })

  it('没有标签', () => {
    expect(fitTags([], tail, 26, 6, 10)).toBe(0)
  })
})
