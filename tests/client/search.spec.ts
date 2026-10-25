import { describe, expect, it } from 'vitest'
import { matchesWords, searchWords } from '../../src/client/model/search.ts'

describe('searchWords', () => {
  it('拆成小写的词，空白不算', () => {
    expect(searchWords('  Change   LOG ')).toEqual(['change', 'log'])
    expect(searchWords('   ')).toEqual([])
  })
})

describe('matchesWords', () => {
  it('没有词就都满足', () => {
    expect(matchesWords([], ['x'])).toBe(true)
  })

  it('每个词都要在某一段文字里出现，不分大小写', () => {
    const parts = ['changelog-html', undefined, '做更新日志网页的做法']
    expect(matchesWords(['html', '日志'], parts)).toBe(true)
    expect(matchesWords(['HTML'.toLowerCase(), 'nope'], parts)).toBe(false)
  })
})
