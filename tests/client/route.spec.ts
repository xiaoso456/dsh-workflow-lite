/**
 * `src/client/model/route.ts`：读写线挂在哪两个连接点上、写线怎么走（「左右走流程，上下走文件」）。
 */

import { describe, expect, it } from 'vitest'
import {
  bezierBlocked,
  FILE_SPOTS,
  fileLinkEnds,
  flowBlocked,
  flowPath,
  freeLane,
  nearestLane,
  orthoRoute,
  pointsBlocked,
  type Rect,
  routeFileLink,
  STEP_SPOTS,
  spotOf,
  WRITE_REACH,
  writePoints,
} from '../../src/client/model/route.ts'

const step: Rect = { x: 0, y: 0, w: 200, h: 90 }

describe('写：步骤 → 文件', () => {
  it('文件在下方：步骤底边 file → 文件左边 in', () => {
    expect(routeFileLink('write', step, { x: 70, y: 120, w: 188, h: 56 })).toEqual({
      step: 'file',
      file: 'in',
    })
  })

  it('文件在上方：步骤上边 fileUp → 文件左边 in', () => {
    expect(routeFileLink('write', step, { x: -300, y: -200, w: 188, h: 56 })).toEqual({
      step: 'fileUp',
      file: 'in',
    })
  })

  it('并排时按文件中心偏上还是偏下决定', () => {
    expect(routeFileLink('write', step, { x: 300, y: 40, w: 188, h: 56 }).step).toBe('file')
    expect(routeFileLink('write', step, { x: 300, y: -10, w: 188, h: 56 }).step).toBe('fileUp')
  })
})

describe('读：文件 → 步骤', () => {
  it('从文件右边出发；步骤在上方落到底边 read，在下方落到上边 readTop', () => {
    expect(routeFileLink('read', step, { x: -260, y: 130, w: 188, h: 56 })).toEqual({
      step: 'read',
      file: 'out',
    })
    expect(routeFileLink('read', step, { x: 400, y: -150, w: 188, h: 56 })).toEqual({
      step: 'readTop',
      file: 'out',
    })
  })
})

describe('坐标', () => {
  it('两头正好落在连接点上：连接点的位置和卡片上摆的一致', () => {
    const file: Rect = { x: 70, y: 120, w: 188, h: 56 }
    expect(fileLinkEnds('write', step, file)).toEqual({
      from: spotOf(step, STEP_SPOTS.file),
      to: spotOf(file, FILE_SPOTS.in),
    })
    expect(spotOf(file, FILE_SPOTS.in)).toEqual({ x: 70, y: 148, side: 'left' })
    expect(spotOf(file, FILE_SPOTS.out)).toEqual({ x: 258, y: 148, side: 'right' })
    const reader: Rect = { x: 300, y: 0, w: 200, h: 90 }
    expect(fileLinkEnds('read', reader, file)).toEqual({
      from: { x: 258, y: 148, side: 'right' },
      to: { x: 315, y: 90, side: 'bottom' },
    })
  })
})

describe('写线的折点', () => {
  it('文件挂在下面、左边在树干右侧：一个直角（竖着下来，横着进去）', () => {
    expect(writePoints({ x: 42, y: 90, side: 'bottom' }, { x: 76, y: 140 }, 56)).toEqual([
      [42, 90],
      [42, 140],
      [76, 140],
    ])
    expect(writePoints({ x: 42, y: 0, side: 'top' }, { x: 76, y: -80 }, 56)).toEqual([
      [42, 0],
      [42, -80],
      [76, -80],
    ])
  })

  it('文件在树干左边：从文件卡外侧绕进左边的入口，横走的那段不穿过文件卡', () => {
    const points = writePoints({ x: 400, y: 90, side: 'bottom' }, { x: 100, y: 100 }, 56)
    expect(points[0]).toEqual([400, 90])
    expect(points.at(-1)).toEqual([100, 100])
    expect(points.at(-2)).toEqual([100 - WRITE_REACH, 100])
    // 走廊落在文件卡（y 72..128）下方。
    const lane = (points[1] as [number, number])[1]
    expect(lane).toBeGreaterThan(128)
  })
})

describe('步骤之间的线', () => {
  it('往右走的流程线先横着走出一截再拐：出口下面那串文件卡（右沿多伸出 48px）擦不到', () => {
    // 步骤 216 宽、文件卡右沿在 x=264，下一列在 x=328；落差再大，过了步骤卡下沿之后曲线都在 264 右边。
    const [path] = flowPath(216, 48, 328, 948)
    const probe = path.match(/-?[\d.]+/gu)?.map(Number) ?? []
    const [sx, sy, c1x, c1y, c2x, c2y, tx, ty] = probe as [number, ...number[]]
    for (let i = 0; i <= 200; i += 1) {
      const t = i / 200
      const u = 1 - t
      const x =
        u ** 3 * sx +
        3 * u * u * t * (c1x as number) +
        3 * u * t * t * (c2x as number) +
        t ** 3 * (tx as number)
      const y =
        u ** 3 * (sy as number) +
        3 * u * u * t * (c1y as number) +
        3 * u * t * t * (c2y as number) +
        t ** 3 * (ty as number)
      if (y > 118) expect(x).toBeGreaterThanOrEqual(264)
    }
  })

  it('往回走的走廊不压到任何卡片：被挡住就挪到它下面', () => {
    const boxes: Rect[] = [
      { x: 0, y: 0, w: 216, h: 96 },
      { x: 76, y: 118, w: 188, h: 56 },
      { x: 600, y: 0, w: 216, h: 96 },
    ]
    expect(freeLane(boxes, -26, 880, 66)).toBe(174 + 18)
    expect(freeLane(boxes, 300, 500, 66)).toBe(66)
  })
})

describe('跨列的流程线', () => {
  it('贝塞尔压到中间的卡片才算挡路；走廊挑离终点那一行最近、又不压卡片的 y', () => {
    const middle: Rect = { x: 404, y: 140, w: 188, h: 56 }
    // 从 (216, 48) 到下两列 (656, 220)：曲线从中间那一列的文件卡上穿过去。
    expect(flowBlocked([middle], 216, 48, 656, 220)).toBe(true)
    expect(flowBlocked([{ x: 404, y: 600, w: 188, h: 56 }], 216, 48, 656, 220)).toBe(false)
    expect(nearestLane([middle], 280, 630, 175)).toBe(196 + 18)
    expect(nearestLane([middle], 280, 630, 160)).toBe(140 - 18)
    expect(nearestLane([middle], 280, 630, 40)).toBe(40)
  })
})

describe('绕开卡片的直角走线', () => {
  // 示例图右半边：审查（下面挂着 review.md）在左一列，修复在右一列偏上（下面挂着 fix-notes.md），
  // 汇总在修复下面。修复要更新 review.md，审查要读 fix-notes.md——两条线都得往回走。
  const review: Rect = { x: 0, y: 200, w: 216, h: 80 }
  const reviewMd: Rect = { x: 84, y: 302, w: 180, h: 56 }
  const fix: Rect = { x: 336, y: 60, w: 216, h: 80 }
  const fixNotes: Rect = { x: 420, y: 162, w: 180, h: 56 }
  const report: Rect = { x: 336, y: 254, w: 216, h: 80 }
  const boxes = [review, reviewMd, fix, fixNotes, report]

  const clearOf = (points: [number, number][], skip: Rect[]): boolean =>
    !pointsBlocked(points, boxes, skip)

  it('往回写：从写点出发，穿过卡片之间的缝，从左边进文件卡，一张卡都不压', () => {
    const start = spotOf(fix, STEP_SPOTS.file)
    const end = spotOf(reviewMd, FILE_SPOTS.in)
    const route = orthoRoute(start, end, boxes, fix, reviewMd)
    expect(route).not.toBeNull()
    const points = route?.points ?? []
    expect(points[0]).toEqual([start.x, start.y])
    expect(points.at(-1)).toEqual([end.x, end.y])
    // 最后一段是横着从左边进去的。
    const before = points.at(-2) as [number, number]
    expect(before[1]).toBe(end.y)
    expect(before[0]).toBeLessThan(end.x)
    expect(clearOf(points.slice(1, -1), [])).toBe(true)
    expect(clearOf(points, [fix, reviewMd])).toBe(true)
  })

  it('往回读：从文件卡右边出发，绕到读的步骤的上边或下边进去', () => {
    const start = spotOf(fixNotes, FILE_SPOTS.out)
    const top = orthoRoute(start, spotOf(review, STEP_SPOTS.readTop), boxes, fixNotes, review)
    const bottom = orthoRoute(start, spotOf(review, STEP_SPOTS.read), boxes, fixNotes, review)
    expect(top).not.toBeNull()
    expect(bottom).not.toBeNull()
    for (const route of [top, bottom]) {
      expect(clearOf(route?.points ?? [], [fixNotes, review])).toBe(true)
    }
    // 第一段先往右伸出去，不会掉头压回文件卡。
    const second = top?.points[1] as [number, number]
    expect(second[0]).toBeGreaterThan(start.x)
  })

  it('读线的贝塞尔压到卡片才算挡路', () => {
    const from = spotOf(fixNotes, FILE_SPOTS.out)
    expect(bezierBlocked(from, spotOf(review, STEP_SPOTS.readTop), boxes, [fixNotes, review])).toBe(
      true,
    )
    const far: Rect = { x: 900, y: 100, w: 216, h: 80 }
    expect(
      bezierBlocked(from, spotOf(far, STEP_SPOTS.read), [...boxes, far], [fixNotes, far]),
    ).toBe(false)
  })
})
