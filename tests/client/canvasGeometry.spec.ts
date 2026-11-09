/**
 * `src/client/model/canvasGeometry.ts`：卡片矩形（量出来的优先、没量过按标称）、整图外框。
 */

import { describe, expect, it } from 'vitest'
import { boundsOf, cardRect } from '../../src/client/model/canvasGeometry.ts'
import { cardSize, NODE_H, NODE_W } from '../../src/client/model/layout.ts'
import type { WorkflowNode } from '../../src/shared/types.ts'

const step = (id: string, x: number, y: number): WorkflowNode => ({
  id,
  type: 'wfNode',
  position: { x, y },
  data: { prompt: 'p' },
})

describe('canvasGeometry', () => {
  it('量过的按量出来的尺寸，没量过按标称；拖动中按临时坐标', () => {
    const node = step('a', 10, 20)
    expect(cardRect(node, new Map())).toEqual({ x: 10, y: 20, w: NODE_W, h: NODE_H })
    expect(cardRect(node, new Map([['a', { width: 300, height: 90 }]]))).toEqual({
      x: 10,
      y: 20,
      w: 300,
      h: 90,
    })
    expect(cardRect(node, new Map(), { x: -5, y: 7 })).toMatchObject({ x: -5, y: 7 })
    expect(cardSize(node)).toEqual({ w: NODE_W, h: NODE_H })
  })

  it('整图外框包住每张卡；没有卡是 null', () => {
    const sizes = new Map([['b', { width: 100, height: 400 }]])
    expect(boundsOf([step('a', 0, 0), step('b', 500, -100)], sizes)).toEqual({
      x: 0,
      y: -100,
      w: 600,
      h: Math.max(NODE_H + 100, 400),
    })
    expect(boundsOf([], sizes)).toBeNull()
  })
})
