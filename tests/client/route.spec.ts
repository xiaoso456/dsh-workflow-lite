/**
 * `src/client/model/route.ts`：读写线挂在哪两个连接点上（「左右走流程，上下走文件」）。
 */

import { describe, expect, it } from 'vitest'
import {
  FILE_SPOTS,
  fileLinkEnds,
  type Rect,
  routeFileLink,
  STEP_SPOTS,
  spotOf,
} from '../../src/client/model/route.ts'

const step: Rect = { x: 0, y: 0, w: 200, h: 90 }

describe('写：步骤 → 文件', () => {
  it('文件在下方：步骤底边 file → 文件上沿 in', () => {
    expect(routeFileLink('write', step, { x: 40, y: 130, w: 188, h: 56 })).toEqual({
      step: 'file',
      file: 'in',
    })
  })

  it('文件在上方：步骤上边 fileUp → 文件下沿 inBottom', () => {
    expect(routeFileLink('write', step, { x: -300, y: -200, w: 188, h: 56 })).toEqual({
      step: 'fileUp',
      file: 'inBottom',
    })
  })

  it('并排时按文件中心偏上还是偏下决定', () => {
    expect(routeFileLink('write', step, { x: 300, y: 40, w: 188, h: 56 }).step).toBe('file')
    expect(routeFileLink('write', step, { x: 300, y: -10, w: 188, h: 56 }).step).toBe('fileUp')
  })
})

describe('读：文件 → 步骤', () => {
  it('从文件朝着步骤那一侧出发；步骤在上方落到底边 read，在下方落到上边 readTop', () => {
    expect(routeFileLink('read', step, { x: -260, y: 130, w: 188, h: 56 })).toEqual({
      step: 'read',
      file: 'out',
    })
    expect(routeFileLink('read', step, { x: 400, y: -150, w: 188, h: 56 })).toEqual({
      step: 'readTop',
      file: 'outLeft',
    })
  })
})

describe('坐标', () => {
  it('两头正好落在连接点上：连接点的位置和卡片上摆的一致', () => {
    const file: Rect = { x: 40, y: 130, w: 188, h: 56 }
    expect(fileLinkEnds('write', step, file)).toEqual({
      from: spotOf(step, STEP_SPOTS.file),
      to: spotOf(file, FILE_SPOTS.in),
    })
    expect(spotOf(step, STEP_SPOTS.file)).toEqual({ x: 124, y: 90, side: 'bottom' })
    expect(spotOf(file, FILE_SPOTS.out)).toEqual({ x: 228, y: 158, side: 'right' })
    const reader: Rect = { x: 300, y: 0, w: 200, h: 90 }
    expect(fileLinkEnds('read', reader, file)).toEqual({
      from: { x: 228, y: 158, side: 'right' },
      to: { x: 344, y: 90, side: 'bottom' },
    })
  })
})
