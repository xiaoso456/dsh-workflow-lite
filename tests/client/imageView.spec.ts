import { describe, expect, it } from 'vitest'
import {
  boxOf,
  clampScale,
  clampView,
  FIT_MAX,
  FIT_PAD,
  fitScale,
  fitView,
  isPannable,
  isTurned,
  panView,
  relayout,
  turnedSize,
  wheelFactor,
  ZOOM_MAX,
  ZOOM_MIN,
  zoomView,
} from '../../src/client/model/imageView.ts'

const frame = { w: 1000, h: 800 }
const wide = { w: 2000, h: 1000 }
const origin = { x: 0, y: 0 }

describe('放大看图的几何', () => {
  it('转过 90 或 270 度（负数也是）宽高对调，转整圈不算', () => {
    expect([0, 90, 180, 270, 360, -90].map((rot) => isTurned(rot))).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
    ])
    expect(turnedSize({ w: 3, h: 2 }, 90)).toEqual({ w: 2, h: 3 })
  })

  it('适应窗口：整张装进舞台、四周留 FIT_PAD，两个方向取更紧的那个', () => {
    // 宽方向紧：(1000 - 64) / 2000
    const flat = fitView(frame, wide, 0)
    expect(flat.scale).toBeCloseTo((frame.w - FIT_PAD * 2) / 2000)
    expect(boxOf(wide, flat).w).toBeCloseTo(frame.w - FIT_PAD * 2)
    // 转 90 度之后图是 1000 × 2000，高方向紧
    const tall = fitView(frame, wide, 90)
    expect(tall.scale).toBeCloseTo((frame.h - FIT_PAD * 2) / 2000)
    expect(boxOf(wide, tall).h).toBeCloseTo(frame.h - FIT_PAD * 2)
    expect(tall).toMatchObject({ x: 0, y: 0, rot: 90 })
  })

  it('小图放大到 FIT_MAX 为止，不会糊成一片', () => {
    expect(fitScale(frame, { w: 300, h: 200 }, 0)).toBe(FIT_MAX)
  })

  it('舞台还没量出来（宽高为 0）时退到最小；图本身是空的也不出错', () => {
    expect(fitScale({ w: 0, h: 0 }, wide, 0)).toBe(ZOOM_MIN)
    expect(fitScale(frame, { w: 0, h: 0 }, 0)).toBe(1)
  })

  it('平移：图比舞台大的方向只能拖到边缘对齐，比舞台小的方向居中', () => {
    const square = { w: 1000, h: 1000 }
    const stage = { w: 800, h: 600 }
    // 宽方向多出 200，一边最多 100；高方向多出 400，一边最多 200
    expect(clampView({ x: 500, y: -500, scale: 1, rot: 0 }, stage, square)).toEqual({
      x: 100,
      y: -200,
      scale: 1,
      rot: 0,
    })
    // 缩到一半之后两个方向都装得下，平移归零
    expect(clampView({ x: 500, y: -500, scale: 0.5, rot: 0 }, stage, square)).toEqual({
      x: 0,
      y: 0,
      scale: 0.5,
      rot: 0,
    })
  })

  it('平移的范围按转过之后的外框算', () => {
    // 1000 × 400 转 90 度成 400 × 1000：宽方向装得下，高方向能拖 (1000 - 600) / 2
    const view = clampView(
      { x: 300, y: 300, scale: 1, rot: 90 },
      { w: 800, h: 600 },
      { w: 1000, h: 400 },
    )
    expect(view).toMatchObject({ x: 0, y: 200 })
  })

  it('只有某个方向上图比舞台大，才能拖', () => {
    const view = { x: 0, y: 0, scale: 1, rot: 0 }
    expect(isPannable(view, { w: 800, h: 600 }, { w: 1000, h: 400 })).toBe(true)
    expect(isPannable(view, { w: 800, h: 600 }, { w: 100, h: 100 })).toBe(false)
  })

  it('以锚点缩放：锚点下面那一点缩放前后在同一处', () => {
    const natural = { w: 5000, h: 5000 }
    const stage = { w: 800, h: 600 }
    const view = { x: 10, y: -20, scale: 1, rot: 0 }
    const anchor = { x: 100, y: 50 }
    const next = zoomView(view, 2, anchor, stage, natural)
    // 缩放前锚点指着图上的哪一点（相对图心、按原倍数）
    const point = { x: (anchor.x - view.x) / view.scale, y: (anchor.y - view.y) / view.scale }
    expect(next.scale).toBe(2)
    expect(next.x + next.scale * point.x).toBeCloseTo(anchor.x)
    expect(next.y + next.scale * point.y).toBeCloseTo(anchor.y)
  })

  it('缩放限在 ZOOM_MIN 到 ZOOM_MAX 之间', () => {
    const natural = { w: 5000, h: 5000 }
    const view = { x: 0, y: 0, scale: 1, rot: 0 }
    expect(zoomView(view, 1000, origin, frame, natural).scale).toBe(ZOOM_MAX)
    expect(zoomView(view, 0, origin, frame, natural).scale).toBe(ZOOM_MIN)
    expect(clampScale(3)).toBe(3)
  })

  it('滚轮：往上（负）放大，往下缩小，来回对称', () => {
    expect(wheelFactor(0)).toBe(1)
    expect(wheelFactor(-100)).toBeGreaterThan(1)
    expect(wheelFactor(100)).toBeLessThan(1)
    expect(wheelFactor(-100) * wheelFactor(100)).toBeCloseTo(1)
    // 一下再猛也封顶在 240 那一下
    expect(wheelFactor(-100000)).toBe(wheelFactor(-240))
  })

  it('舞台变了：适应窗口的重新算，否则保持缩放、只把平移限回范围里', () => {
    const natural = { w: 1000, h: 1000 }
    const fitted = relayout({ x: 0, y: 0, scale: 0.5, rot: 0 }, { w: 400, h: 400 }, natural, true)
    expect(fitted.scale).toBeCloseTo(fitScale({ w: 400, h: 400 }, natural, 0))
    // 放大 1.5 倍：1500 宽，舞台 800，一边最多拖 350
    const kept = relayout({ x: 900, y: 0, scale: 1.5, rot: 0 }, { w: 800, h: 600 }, natural, false)
    expect(kept).toMatchObject({ x: 350, scale: 1.5 })
  })

  it('平移：按量挪，挪过头就停在边上', () => {
    const natural = { w: 1000, h: 1000 }
    const stage = { w: 800, h: 600 }
    const view = { x: 0, y: 0, scale: 1, rot: 0 }
    expect(panView(view, 30, -10, stage, natural)).toMatchObject({ x: 30, y: -10 })
    expect(panView(view, 5000, 0, stage, natural)).toMatchObject({ x: 100 })
  })
})
