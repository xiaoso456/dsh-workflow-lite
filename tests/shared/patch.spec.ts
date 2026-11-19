/**
 * 工具写入的统一合并规则：没给的不动、对象按字段合并、数组和单值整个换、null 恢复缺省、换了 kind 从空的起。
 */

import { describe, expect, it } from 'vitest'
import { mergePatch } from '../../src/shared/patch.ts'

describe('统一合并规则', () => {
  it('没给的不动，对象按字段一层层合并', () => {
    const current = { a: 1, b: { c: 2, d: 3 } }
    expect(mergePatch(current, undefined)).toBe(current)
    expect(mergePatch(current, { b: { d: 4 } })).toEqual({ a: 1, b: { c: 2, d: 4 } })
    // 不改入参。
    expect(current).toEqual({ a: 1, b: { c: 2, d: 3 } })
  })

  it('数组、单值整个换；null 去掉这一项（读入时补回缺省）', () => {
    expect(mergePatch({ list: [1, 2], n: 1 }, { list: [3], n: 2 })).toEqual({ list: [3], n: 2 })
    expect(mergePatch({ a: 1, b: { c: 2 } }, { b: null })).toEqual({ a: 1 })
    expect(mergePatch({ a: 1 }, null)).toBeUndefined()
  })

  it('带 kind 的对象换了 kind 从空的起，同 kind 照常合并', () => {
    const listen = { kind: 'listen', command: 'node tail.mjs' }
    expect(mergePatch(listen, { kind: 'http' })).toEqual({ kind: 'http' })
    expect(mergePatch(listen, { kind: 'listen', command: 'x' })).toEqual({
      kind: 'listen',
      command: 'x',
    })
    expect(mergePatch({ kind: 'daily', time: '08:00', weekdays: [1] }, { time: '09:00' })).toEqual({
      kind: 'daily',
      time: '09:00',
      weekdays: [1],
    })
  })

  it('叠到不是对象的值上：当从空的起，里面的 null 也去掉', () => {
    expect(mergePatch(undefined, { a: 1, b: null })).toEqual({ a: 1 })
    expect(mergePatch('old', { a: 1 })).toEqual({ a: 1 })
  })
})
