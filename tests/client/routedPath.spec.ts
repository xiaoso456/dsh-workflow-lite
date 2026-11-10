/**
 * `src/client/ui/canvas/lines/route.ts` 的 `routedPath`：画布挑好的绕行折线，两头换成量出来的连接点坐标。
 */

import { describe, expect, it } from 'vitest'
import { routedPath } from '../../src/client/ui/canvas/lines/route.ts'

/** 路径里所有点（M / L / Q 后面的坐标对）。 */
function coords(path: string): [number, number][] {
  const numbers = path.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
  const out: [number, number][] = []
  for (let index = 0; index < numbers.length; index += 2) {
    out.push([numbers[index] as number, numbers[index + 1] as number])
  }
  return out
}

describe('routedPath', () => {
  // 步骤底边的写点出发，绕到文件卡左边外侧 14 处、再横着进去（卡左边在 x = 300）。
  const planned: [number, number][] = [
    [100, 100],
    [100, 114],
    [286, 114],
    [286, 400],
    [300, 400],
  ]

  it('平时只把伸出去的那段对齐到量出来的点，拐角不动', () => {
    // 线头在命中区外沿：卡边往外 10。
    const points = coords(routedPath(planned, 100, 110, 290, 400)[0])
    expect(points.at(-1)).toEqual([290, 400])
    expect(points.some(([x]) => x === 286)).toBe(true)
  })

  it('量出来的点比算的伸出去的那段还远时，最后一段不被拉反：拐角顺着原方向推出去', () => {
    // 点挪到卡外 6 的虚线框上：线头在 300 - 6 - 10 = 284，比算的拐角 286 还靠左。
    const points = coords(routedPath(planned, 100, 110, 284, 400)[0])
    const last = points.at(-1) as [number, number]
    const before = points.at(-2) as [number, number]
    expect(last).toEqual([284, 400])
    // 进卡前最后一段仍是从左往右。
    expect(before[1]).toBe(400)
    expect(before[0]).toBeLessThan(last[0])
    // 竖段跟着拐角一起挪，还是竖的。
    expect(points.filter(([x]) => x === 280).length).toBeGreaterThanOrEqual(2)
  })

  it('只有一个拐角（另一头就是端点）时照旧对齐', () => {
    const points = coords(
      routedPath(
        [
          [0, 0],
          [0, 50],
          [80, 50],
        ],
        0,
        10,
        78,
        50,
      )[0],
    )
    expect(points[0]).toEqual([0, 10])
    expect(points.at(-1)).toEqual([78, 50])
  })
})
