import { describe, expect, it } from 'vitest'
import { bezierAt, easeOutAt } from '../../src/client/ui/motion/shared.ts'

describe('bezierAt', () => {
  it('两端是 0 和 1，直线曲线就是原样', () => {
    const linear = bezierAt(0, 0, 1, 1)
    for (const t of [0, 0.1, 0.37, 0.5, 0.9, 1]) expect(linear(t)).toBeCloseTo(t, 4)
  })

  it('平滑减速：前面走得快、一路不回头', () => {
    expect(easeOutAt(0)).toBe(0)
    expect(easeOutAt(1)).toBe(1)
    expect(easeOutAt(0.2)).toBeGreaterThan(0.5)
    let last = 0
    for (let i = 1; i <= 100; i++) {
      const y = easeOutAt(i / 100)
      expect(y).toBeGreaterThanOrEqual(last - 1e-9)
      last = y
    }
  })

  it('和标准的 ease 曲线对得上（cubic-bezier(0.25, 0.1, 0.25, 1) 在一半时约 0.8024）', () => {
    expect(bezierAt(0.25, 0.1, 0.25, 1)(0.5)).toBeCloseTo(0.8024, 3)
  })
})
