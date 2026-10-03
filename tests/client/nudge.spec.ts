/**
 * `src/client/model/nudge.ts`：不同颜色的直角线不叠在同一条道上；走廊上的牌子错开摆。
 */

import { describe, expect, it } from 'vitest'
import { nudge, placeChips, type Track } from '../../src/client/model/nudge.ts'
import type { Rect } from '../../src/client/model/route.ts'

/** 一条走廊线：从 (sx, sy) 出去，经过 y = lane 的走廊，回到 (tx, ty)。 */
function corridor(id: string, group: string, lane: number): Track {
  return {
    id,
    group,
    points: [
      [600, 50],
      [640, 50],
      [640, lane],
      [40, lane],
      [40, 50],
      [80, 50],
    ],
  }
}

describe('nudge', () => {
  it('两种颜色挑中同一条走廊：分到相邻两条道上，接在连接点上的头尾不动', () => {
    const moved = nudge([corridor('fail', 'red', 200), corridor('pass', 'green', 200)], [])
    const fail = moved.get('fail') ?? corridor('fail', 'red', 200).points
    const pass = moved.get('pass') ?? corridor('pass', 'green', 200).points
    expect(Math.abs((fail[2] as number[])[1] - (pass[2] as number[])[1])).toBeGreaterThanOrEqual(6)
    // 竖段也分开了（同一个入口进来的两条竖线不再叠在一起）。
    expect((fail[3] as number[])[0]).not.toBe((pass[3] as number[])[0])
    for (const line of [fail, pass]) {
      expect(line[0]).toEqual([600, 50])
      expect(line.at(-1)).toEqual([80, 50])
      // 仍是直角线：相邻两点要么同 x 要么同 y。
      for (let i = 1; i < line.length; i += 1) {
        const [ax, ay] = line[i - 1] as [number, number]
        const [bx, by] = line[i] as [number, number]
        expect(ax === bx || ay === by).toBe(true)
      }
    }
  })

  it('同一种颜色的线照旧合在一条道上', () => {
    const moved = nudge([corridor('a', 'red', 200), corridor('b', 'red', 200)], [])
    expect(moved.size).toBe(0)
  })

  it('挨得不到一个道距的两种颜色也分开，不会把一条挪到另一条身上', () => {
    const moved = nudge(
      [corridor('a', 'pink', 200), corridor('b', 'cyan', 203), corridor('c', 'cyan', 200)],
      [],
    )
    const lane = (id: string, fallback: number): number =>
      ((moved.get(id)?.[2] as number[] | undefined) ?? [0, fallback])[1] as number
    const pink = lane('a', 200)
    const cyan = [lane('b', 203), lane('c', 200)]
    // 同色的两条合到一条道上，和粉色那条隔开一个道距。
    expect(cyan[0]).toBe(cyan[1])
    expect(Math.abs(pink - (cyan[0] as number))).toBeGreaterThanOrEqual(6)
  })

  it('空当窄就把道距压小，道不伸进卡片里', () => {
    // 走廊上下各压着一张卡，中间只有 16px 的缝。
    const boxes: Rect[] = [
      { x: 100, y: 180, w: 300, h: 12 },
      { x: 100, y: 208, w: 300, h: 40 },
    ]
    const tracks = [
      corridor('a', 'pink', 200),
      corridor('b', 'cyan', 200),
      corridor('c', 'blue', 200),
    ]
    const moved = nudge(tracks, boxes)
    const lanes = tracks.map(
      (track) => ((moved.get(track.id) ?? track.points)[2] as [number, number])[1],
    )
    expect(new Set(lanes).size).toBe(3)
    for (const lane of lanes) {
      expect(lane).toBeGreaterThan(192)
      expect(lane).toBeLessThan(208)
    }
  })

  it('一种颜色的段挪不动（接在连接点上）：它待在原处，别的颜色让开', () => {
    // 写线的树干（两段都接在连接点上）和一条读线的中间段叠在同一条竖线上。
    const trunk: Track = {
      id: 'write',
      group: 'yellow',
      points: [
        [100, 0],
        [100, 80],
        [140, 80],
      ],
    }
    const read: Track = {
      id: 'read',
      group: 'cyan',
      points: [
        [300, 10],
        [320, 10],
        [320, -20],
        [100, -20],
        [100, 60],
        [60, 60],
      ],
    }
    const moved = nudge([trunk, read], [])
    expect(moved.has('write')).toBe(false)
    const line = moved.get('read') ?? []
    expect((line[3] as number[])[0]).not.toBe(100)
    expect((line[4] as number[])[0]).toBe((line[3] as number[])[0])
  })
})

describe('placeChips', () => {
  it('并排走同一段走廊的两块牌子：一块原地，另一块沿走廊挪开、不压住它', () => {
    const placed = placeChips([
      { id: 'a', y: 200, from: 40, to: 640, prefer: 220, width: 70 },
      { id: 'b', y: 207, from: 40, to: 640, prefer: 220, width: 70 },
    ])
    expect(placed.get('a')).toBe(220)
    expect(Math.abs((placed.get('b') ?? 0) - 220)).toBeGreaterThanOrEqual(70)
  })

  it('离得远（不同的走廊）就都放在原本的位置', () => {
    const placed = placeChips([
      { id: 'a', y: 200, from: 40, to: 640, prefer: 220, width: 70 },
      { id: 'b', y: 400, from: 40, to: 640, prefer: 220, width: 70 },
    ])
    expect(placed.get('b')).toBe(220)
  })
})
