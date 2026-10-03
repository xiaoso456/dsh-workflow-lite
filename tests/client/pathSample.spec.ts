/**
 * `src/client/model/pathSample.ts`：不碰 DOM 地沿路径等距取点（光带每次线变了都要重新取）。
 */

import { describe, expect, it } from 'vitest'
import { flattenPath, measurePath } from '../../src/client/model/pathSample.ts'
import { flowPath } from '../../src/client/model/route.ts'

describe('flattenPath', () => {
  it('直线与 H / V：原样给出折点，去掉重复点', () => {
    expect(flattenPath('M 0 0 L 10 0 L 10 0 V 5 H -2')).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
      [-2, 5],
    ])
  })

  it('认 React Flow 贝塞尔的逗号写法，曲线压成细折线、两头落在端点上', () => {
    const line = flattenPath('M0,0 C50,0 50,100 100,100') ?? []
    expect(line[0]).toEqual([0, 0])
    expect(line.at(-1)).toEqual([100, 100])
    expect(line.length).toBeGreaterThan(10)
  })

  it('Z 回到起点；不认识的命令（相对坐标、圆弧）给 null', () => {
    expect(flattenPath('M 0 0 L 4 0 L 4 3 Z')?.at(-1)).toEqual([0, 0])
    expect(flattenPath('M 0 0 l 10 0')).toBeNull()
    expect(flattenPath('M 0 0 A 5 5 0 0 1 10 0')).toBeNull()
    expect(flattenPath('M 0 0 L 10')).toBeNull()
  })
})

describe('measurePath', () => {
  it('折线：长度精确，等距取点含两头', () => {
    const path = measurePath('M 0 0 L 30 0 L 30 40')
    expect(path?.length).toBe(70)
    const points = path?.sample(8) ?? []
    expect(points).toHaveLength(8)
    expect(points[0]).toEqual({ x: 0, y: 0, at: 0 })
    expect(points.at(-1)).toEqual({ x: 30, y: 40, at: 70 })
    // 第 3 个点在 20px 处（还在横段上），第 5 个点在 40px 处（拐过弯 10px）。
    expect(points[2]?.x).toBeCloseTo(20)
    expect(points[2]?.y).toBeCloseTo(0)
    expect(points[4]?.x).toBeCloseTo(30)
    expect(points[4]?.y).toBeCloseTo(10)
  })

  it('圆角折线（Q）：长度与解析值相差不到半个像素', () => {
    // 两条 100px 的边、12px 的圆角：直段 2×88，拐角这段二次曲线的弧长解析值 ≈ 19.479。
    const path = measurePath('M 0 0 L 88 0 Q 100 0 100 12 L 100 100')
    expect(path?.length).toBeCloseTo(176 + 19.479, 0)
  })

  it('流程线的贝塞尔：取的点都在曲线上，间距相等', () => {
    const [d] = flowPath(0, 0, 300, 120)
    const path = measurePath(d)
    expect(path).not.toBeNull()
    const points = path?.sample(20) ?? []
    const gaps = points.slice(1).map((point, index) => {
      const before = points[index] as { x: number; y: number }
      return Math.hypot(point.x - before.x, point.y - before.y)
    })
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
    for (const gap of gaps) expect(Math.abs(gap - mean)).toBeLessThan(mean * 0.05)
    expect(points.at(-1)).toMatchObject({ x: 300, y: 120 })
  })

  it('空路径、零长度、认不出来的路径都给 null', () => {
    expect(measurePath('')).toBeNull()
    expect(measurePath('M 5 5 L 5 5')).toBeNull()
    expect(measurePath('M 0 0 a 1 1 0 0 1 2 0')).toBeNull()
  })
})
