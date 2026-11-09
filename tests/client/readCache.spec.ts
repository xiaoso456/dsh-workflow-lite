/**
 * `src/client/app/readCache.ts`：按「目标 + 信号」留读过的内容，按条数和大小封顶，最近用过的优先留。
 */

import { describe, expect, it } from 'vitest'
import { readCache } from '../../src/client/app/readCache.ts'

describe('readCache', () => {
  it('目标和信号都对得上才算命中', () => {
    const cache = readCache<string>({ entries: 4 })
    cache.put('a', 1, 'one')
    expect(cache.get('a', 1)).toBe('one')
    expect(cache.get('a', 2)).toBeUndefined()
    expect(cache.get('a', '1')).toBeUndefined()
    expect(cache.get('b', 1)).toBeUndefined()
    cache.put('a', 2, 'two')
    expect(cache.get('a', 1)).toBeUndefined()
    expect(cache.get('a', 2)).toBe('two')
  })

  it('超了条数挤掉最久没用的', () => {
    const cache = readCache<string>({ entries: 2 })
    cache.put('a', 0, 'A')
    cache.put('b', 0, 'B')
    expect(cache.get('a', 0)).toBe('A')
    cache.put('c', 0, 'C')
    expect(cache.get('b', 0)).toBeUndefined()
    expect(cache.get('a', 0)).toBe('A')
    expect(cache.get('c', 0)).toBe('C')
  })

  it('超了总量挤掉旧的；一份就超了总量的不留', () => {
    const cache = readCache<string>({ entries: 10, budget: 10, weigh: (v) => v.length })
    cache.put('a', 0, '1234')
    cache.put('b', 0, '1234')
    cache.put('c', 0, '1234')
    expect(cache.get('a', 0)).toBeUndefined()
    expect(cache.get('b', 0)).toBe('1234')
    cache.put('huge', 0, '12345678901')
    expect(cache.get('huge', 0)).toBeUndefined()
    expect(cache.get('b', 0)).toBe('1234')
    expect(cache.get('c', 0)).toBe('1234')
  })
})
