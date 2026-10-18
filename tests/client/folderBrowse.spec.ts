import { describe, expect, it } from 'vitest'
import {
  crumbsOf,
  filterEntries,
  joinSub,
  matchRanges,
  parentSub,
  splitByRanges,
  stepCursor,
} from '../../src/client/model/folderBrowse.ts'

describe('文件夹浏览：相对路径', () => {
  it('joinSub / parentSub：根是空串，往下拼、往上削一层', () => {
    expect(joinSub('', 'a')).toBe('a')
    expect(joinSub('a/b', 'c.png')).toBe('a/b/c.png')
    expect(parentSub('a/b/c')).toBe('a/b')
    expect(parentSub('a')).toBe('')
    expect(parentSub('')).toBe('')
  })

  it('面包屑：根在最前，每层带自己的 sub；超过四段折掉中间', () => {
    expect(crumbsOf('out', '')).toEqual([{ label: 'out', sub: '' }])
    expect(crumbsOf('out', 'a/b')).toEqual([
      { label: 'out', sub: '' },
      { label: 'a', sub: 'a' },
      { label: 'b', sub: 'a/b' },
    ])
    expect(crumbsOf('out', 'a/b/c/d')).toEqual([
      { label: 'out', sub: '' },
      { label: '…', sub: null },
      { label: 'c', sub: 'a/b/c' },
      { label: 'd', sub: 'a/b/c/d' },
    ])
  })
})

describe('文件夹浏览：筛选', () => {
  it('空查询命中一切、没有高亮；不分大小写；每个词都要出现', () => {
    expect(matchRanges('Combo-01.png', '')).toEqual([])
    expect(matchRanges('Combo-01.png', '  ')).toEqual([])
    expect(matchRanges('Combo-01.png', 'combo')).toEqual([[0, 5]])
    expect(matchRanges('Combo-01.png', 'png combo')).toEqual([
      [0, 5],
      [9, 12],
    ])
    expect(matchRanges('Combo-01.png', 'combo zip')).toBeNull()
  })

  it('重叠、相邻的命中合成一段', () => {
    expect(matchRanges('screenshot', 'screen shot')).toEqual([[0, 10]])
    expect(matchRanges('abcabc', 'abc bca')).toEqual([[0, 4]])
  })

  it('filterEntries 保持原来的次序', () => {
    const entries = [{ name: 'deep' }, { name: 'a-01.png' }, { name: 'b-01.png' }, { name: 'c.md' }]
    expect(filterEntries(entries, '01').map((item) => item.entry.name)).toEqual([
      'a-01.png',
      'b-01.png',
    ])
    expect(filterEntries(entries, '').length).toBe(4)
    expect(filterEntries(entries, 'zzz')).toEqual([])
  })

  it('splitByRanges 把名字切成命中与没命中的几块，拼回去还是原名', () => {
    const parts = splitByRanges('combo-01.png', [
      [0, 5],
      [9, 12],
    ])
    expect(parts).toEqual([
      { text: 'combo', hit: true },
      { text: '-01.', hit: false },
      { text: 'png', hit: true },
    ])
    expect(splitByRanges('a.png', []).length).toBe(1)
    expect(
      splitByRanges('a.png', [[0, 1]])
        .map((part) => part.text)
        .join(''),
    ).toBe('a.png')
  })
})

describe('文件夹浏览：键盘上下选', () => {
  const names = ['a', 'b', 'c']
  it('没选过：下键第一项、上键最后一项；到头停住不绕回', () => {
    expect(stepCursor(names, null, 'next')).toBe('a')
    expect(stepCursor(names, null, 'prev')).toBe('c')
    expect(stepCursor(names, 'a', 'prev')).toBe('a')
    expect(stepCursor(names, 'c', 'next')).toBe('c')
    expect(stepCursor(names, 'a', 'next')).toBe('b')
  })

  it('当前项被筛掉了（不在列表里）按没选过算；列表是空的就是没有', () => {
    expect(stepCursor(names, 'gone', 'next')).toBe('a')
    expect(stepCursor([], 'a', 'next')).toBeNull()
    expect(stepCursor(names, 'b', 'first')).toBe('a')
    expect(stepCursor(names, 'b', 'last')).toBe('c')
  })
})
