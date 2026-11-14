/**
 * 时刻框的算术：走一步、滚轮落整 5 分、打字认几位。
 *
 * @module tests/client/clockMath.spec
 */

import { describe, expect, it } from 'vitest'
import { stepClock, typeClock } from '../../src/client/ui/kit/clockMath.ts'

const at = (h: number, m: number): number => h * 60 + m

describe('时刻走一步', () => {
  it('时一次一小时，过半夜绕回', () => {
    expect(stepClock(at(9, 30), 'hour', 1)).toBe(at(10, 30))
    expect(stepClock(at(23, 30), 'hour', 1)).toBe(at(0, 30))
    expect(stepClock(at(0, 5), 'hour', -1)).toBe(at(23, 5))
  })

  it('分按键一次 1 分钟、Shift 10 分钟，跨小时进位', () => {
    expect(stepClock(at(9, 59), 'minute', 1)).toBe(at(10, 0))
    expect(stepClock(at(9, 0), 'minute', -1, { big: true })).toBe(at(8, 50))
  })

  it('滚轮在分上一格 5 分钟，不在整格上的先落到整格', () => {
    expect(stepClock(at(9, 0), 'minute', 1, { wheel: true })).toBe(at(9, 5))
    expect(stepClock(at(9, 3), 'minute', 1, { wheel: true })).toBe(at(9, 5))
    expect(stepClock(at(9, 3), 'minute', -1, { wheel: true })).toBe(at(9, 0))
    expect(stepClock(at(23, 55), 'minute', 1, { wheel: true })).toBe(at(0, 0))
  })
})

describe('时刻打字', () => {
  it('时打两位，或第一位是 3–9 就打完', () => {
    expect(typeClock(at(9, 15), 'hour', '1')).toEqual({ minutes: at(1, 15), done: false })
    expect(typeClock(at(9, 15), 'hour', '17')).toEqual({ minutes: at(17, 15), done: true })
    expect(typeClock(at(9, 15), 'hour', '7')).toEqual({ minutes: at(7, 15), done: true })
    expect(typeClock(at(9, 15), 'hour', '29').minutes).toBe(at(23, 15))
  })

  it('分第一位是 6–9 就打完，超过 59 夹住', () => {
    expect(typeClock(at(9, 15), 'minute', '4')).toEqual({ minutes: at(9, 4), done: false })
    expect(typeClock(at(9, 15), 'minute', '7')).toEqual({ minutes: at(9, 7), done: true })
    expect(typeClock(at(9, 15), 'minute', '45')).toEqual({ minutes: at(9, 45), done: true })
  })
})
