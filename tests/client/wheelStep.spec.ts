/**
 * 滚轮改值的换算：一格走一步，触控板的小位移攒满一格才走。
 *
 * @module tests/client/wheelStep.spec
 */

import { describe, expect, it } from 'vitest'
import { WHEEL_NOTCH, wheelPixels, wheelStep } from '../../src/client/ui/kit/wheelStep.ts'

describe('滚轮一步', () => {
  it('按行、按页的位移换成像素', () => {
    expect(wheelPixels(3, 1)).toBe(120)
    expect(wheelPixels(1, 2)).toBe(400)
    expect(wheelPixels(-100, 0)).toBe(-100)
  })

  it('鼠标一格当场走一步：往上滚是 +1，攒的清掉', () => {
    expect(wheelStep(0, -100)).toEqual({ dir: 1, acc: 0 })
    expect(wheelStep(20, 120)).toEqual({ dir: -1, acc: 0 })
  })

  it('触控板的小位移攒满一格才走一步', () => {
    let acc = 0
    const dirs: number[] = []
    for (let i = 0; i < 12; i++) {
      const step = wheelStep(acc, 10)
      acc = step.acc
      dirs.push(step.dir)
    }
    // 120 像素：攒满两格，走两步。
    expect(dirs.filter((dir) => dir !== 0)).toEqual([-1, -1])
    expect(Math.abs(acc)).toBeLessThan(WHEEL_NOTCH)
  })

  it('方向反过来时攒的先抵掉', () => {
    const half = wheelStep(0, 30)
    expect(half.dir).toBe(0)
    expect(wheelStep(half.acc, -30)).toEqual({ dir: 0, acc: 0 })
  })
})
