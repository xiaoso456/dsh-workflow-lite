import { describe, expect, it } from 'vitest'
import {
  DIAL_GAP,
  DIAL_MINORS,
  DIAL_TAIL,
  dialMarks,
  nearest,
  rubber,
  type Spring,
  springAtRest,
  springStep,
  tickLook,
} from '../../src/client/model/dial.ts'

describe('dialMarks', () => {
  it('一版一道主刻度，两版之间几道小刻度，头尾各延出一截', () => {
    const marks = dialMarks(3)
    expect(marks.filter((mark) => mark.major !== null).map((mark) => mark.major)).toEqual([0, 1, 2])
    expect(marks).toHaveLength(2 * DIAL_MINORS + 3 + 2 * DIAL_TAIL)
    expect(marks[0]?.x).toBeCloseTo(-DIAL_TAIL / (DIAL_MINORS + 1))
    // 从左到右排好。
    expect(marks.every((mark, i) => i === 0 || mark.x > (marks[i - 1]?.x ?? 0))).toBe(true)
  })

  it('没有版就没有刻度', () => {
    expect(dialMarks(0)).toEqual([])
  })
})

describe('tickLook', () => {
  it('正中最高最亮，越远越矮越淡，远处收敛到本来的样子', () => {
    const center = tickLook(0, true)
    const near = tickLook(DIAL_GAP / 2, true)
    const far = tickLook(DIAL_GAP * 6, true)
    expect(center.sy).toBeCloseTo(2)
    expect(center.opacity).toBeCloseTo(1)
    expect(near.sy).toBeLessThan(center.sy)
    expect(near.opacity).toBeLessThan(center.opacity)
    expect(far.sy).toBeCloseTo(1, 3)
    expect(far.opacity).toBeCloseTo(0.3, 2)
  })

  it('小刻度本来短，正中放大得更多', () => {
    expect(tickLook(0, false).sy).toBeGreaterThan(tickLook(0, true).sy)
  })
})

describe('nearest / rubber', () => {
  it('吸附到最近一版，不出头尾', () => {
    expect(nearest(1.49, 4)).toBe(1)
    expect(nearest(1.5, 4)).toBe(2)
    expect(nearest(-0.8, 4)).toBe(0)
    expect(nearest(9, 4)).toBe(3)
  })

  it('拖出头尾只跟三成', () => {
    expect(rubber(-1, 4)).toBeCloseTo(-0.3)
    expect(rubber(4, 4)).toBeCloseTo(3.3)
    expect(rubber(2.2, 4)).toBe(2.2)
  })
})

describe('springStep', () => {
  it('走到目标停稳，途中轻轻过冲一点', () => {
    let spring: Spring = { pos: 0, vel: 0 }
    let peak = 0
    let frames = 0
    while (!springAtRest(spring, 1) && frames < 600) {
      spring = springStep(spring, 1, 1 / 60)
      peak = Math.max(peak, spring.pos)
      frames += 1
    }
    expect(springAtRest(spring, 1)).toBe(true)
    // 半秒左右停稳（太慢拖泥带水，太快看不出滑）。
    expect(frames).toBeGreaterThan(15)
    expect(frames).toBeLessThan(90)
    // 过冲看得出来，但不到一成。
    expect(peak).toBeGreaterThan(1.001)
    expect(peak).toBeLessThan(1.1)
  })
})
