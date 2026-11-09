/**
 * `src/client/model/samePlain.ts`：逐项比内容（口径同 JSON）、读回来的数据结构共享。
 */

import { describe, expect, it } from 'vitest'
import { samePlain, shareSame } from '../../src/client/model/samePlain.ts'

describe('samePlain', () => {
  it('内容相同就相同：不看对象身份、键的顺序', () => {
    expect(samePlain({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true)
    expect(samePlain('a', 'a')).toBe(true)
    expect(samePlain(Number.NaN, Number.NaN)).toBe(true)
    expect(samePlain(null, null)).toBe(true)
  })

  it('任何一处不同就不同：值、长度、种类、多出来的键', () => {
    expect(samePlain({ a: 1 }, { a: 2 })).toBe(false)
    expect(samePlain([1, 2], [1, 2, 3])).toBe(false)
    expect(samePlain([], {})).toBe(false)
    expect(samePlain({}, [])).toBe(false)
    expect(samePlain([], null)).toBe(false)
    expect(samePlain('1', 1)).toBe(false)
    expect(samePlain({ a: 1 }, { a: 1, b: 2 })).toBe(false)
    expect(samePlain({ a: 1, b: 2 }, { a: 1 })).toBe(false)
    expect(samePlain({ a: { b: [1] } }, { a: { b: [2] } })).toBe(false)
  })

  it('值为 undefined 的键等于没有（同 JSON）', () => {
    expect(samePlain({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(samePlain({ a: 1 }, { a: 1, b: undefined })).toBe(true)
    expect(samePlain({ a: undefined }, { a: null })).toBe(false)
  })

  it('跳过的键在任何一层都不比；没跳过的函数只认同一个', () => {
    const skip = new Set(['onPick'])
    expect(
      samePlain({ data: { onPick: () => 1, x: 1 } }, { data: { onPick: () => 2, x: 1 } }, skip),
    ).toBe(true)
    expect(samePlain({ data: { onPick: () => 1, x: 1 } }, { data: { x: 1 } }, skip)).toBe(true)
    const f = (): number => 1
    expect(samePlain({ f }, { f })).toBe(true)
    expect(samePlain({ f }, { f: (): number => 1 })).toBe(false)
  })

  it('和 JSON 比字符串的结论一致（画布连线、卡片指纹换成它之前的口径）', () => {
    const cases: [unknown, unknown][] = [
      [
        { id: 'e', data: { lane: { x: 1, y: [2, 3] }, points: null } },
        { id: 'e', data: { lane: { x: 1, y: [2, 3] }, points: null } },
      ],
      [
        { id: 'e', data: { lane: { x: 1 } } },
        { id: 'e', data: { lane: { x: 1.5 } } },
      ],
      [
        { id: 'e', markerEnd: { color: 'a' } },
        { id: 'e', markerEnd: { color: 'b' } },
      ],
      [
        [true, ['in'], { a: '' }],
        [true, ['in'], { a: '' }],
      ],
      [
        [true, ['in'], { a: '' }],
        [false, ['in'], { a: '' }],
      ],
    ]
    for (const [a, b] of cases)
      expect(samePlain(a, b)).toBe(JSON.stringify(a) === JSON.stringify(b))
  })
})

describe('shareSame', () => {
  it('整份相同：交回上一份本身', () => {
    const prev = { a: [1, { b: 2 }], c: { d: 'x' } }
    expect(shareSame(prev, JSON.parse(JSON.stringify(prev)))).toBe(prev)
  })

  it('只变了一支：其余部分沿用上一份的对象，内容与新的一致', () => {
    const prev = {
      mtime: 1,
      state: { nodes: { a: { status: 'done' }, b: { status: 'running' } } },
      document: { nodes: [{ id: 'a' }, { id: 'b' }] },
    }
    const next = {
      mtime: 2,
      state: { nodes: { a: { status: 'done' }, b: { status: 'done' } } },
      document: { nodes: [{ id: 'a' }, { id: 'b' }] },
    }
    const merged = shareSame(prev, next)
    expect(merged).toEqual(next)
    expect(merged).not.toBe(prev)
    expect(merged.document).toBe(prev.document)
    expect(merged.state.nodes.a).toBe(prev.state.nodes.a)
    expect(merged.state.nodes.b).not.toBe(prev.state.nodes.b)
  })

  it('多了、少了键或数组项都算变了；没有上一份就原样交回', () => {
    const prev = { a: [1, 2], b: 1 }
    expect(shareSame(prev, { a: [1, 2] })).toEqual({ a: [1, 2] })
    expect(shareSame(prev, { a: [1, 2] })).not.toBe(prev)
    expect(shareSame(prev, { a: [1, 2], b: 1, c: 1 })).not.toBe(prev)
    const shorter = shareSame(prev, { a: [1], b: 1 })
    expect(shorter.a).toEqual([1])
    const next = { a: 1 }
    expect(shareSame(null, next)).toBe(next)
    expect(shareSame([1], next)).toBe(next)
  })
})
