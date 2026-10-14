/**
 * dsh-workflow-lite — 放大看图的几何（{@link ImageZoom} 用）：适应窗口、缩放、平移、旋转。纯函数，不碰 DOM，好单测。
 *
 * 坐标以**舞台中心**为原点：`x`、`y` 是图心偏了多少（屏幕像素）；`scale` 是相对原图像素的倍数；
 * `rot` 是顺时针的角度，只取 90 的倍数。`rot` 不折回 0–360，转的圈数照实累计，CSS 过渡才会沿着按钮的方向转。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/imageView
 */

export interface Size {
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export interface ImageView extends Point {
  scale: number
  rot: number
}

/** 缩放的上下界：再小就看不见了，再大就只是一片色块。 */
export const ZOOM_MIN = 0.02
export const ZOOM_MAX = 8
/** 按钮与 + / - 键每次乘或除的倍数。 */
export const ZOOM_STEP = 1.25
/** 适应窗口最多放到原图的两倍：小图（聊天里的截图之类）放大看，但不糊成一片。 */
export const FIT_MAX = 2
/** 适应窗口时四周留的边（像素）。 */
export const FIT_PAD = 32

/** 滚轮一下的 deltaY 封顶（触控板一扫可能很大），以及每个像素对应的指数系数。 */
const WHEEL_REACH = 240
const WHEEL_RATE = 0.0015

export const ORIGIN: Point = { x: 0, y: 0 }

/** 把 `value` 夹进 `[-reach, reach]`。`-0` 也归成 `0`，不然 CSS 里会写出 `-0px`。 */
function within(value: number, reach: number): number {
  const clamped = Math.min(reach, Math.max(-reach, value))
  return clamped === 0 ? 0 : clamped
}

/** 转过 90 或 270 度：宽高对调。 */
export function isTurned(rot: number): boolean {
  return Math.abs(rot % 180) === 90
}

/** 原图转过之后的宽高（还没乘缩放）。 */
export function turnedSize(natural: Size, rot: number): Size {
  return isTurned(rot) ? { w: natural.h, h: natural.w } : natural
}

/** 画在屏幕上的外框（旋转之后的包围盒）。 */
export function boxOf(natural: Size, view: Pick<ImageView, 'scale' | 'rot'>): Size {
  const turned = turnedSize(natural, view.rot)
  return { w: turned.w * view.scale, h: turned.h * view.scale }
}

export function clampScale(scale: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale))
}

/**
 * 整张装进舞台（四周留 `FIT_PAD`），小图放大到 `FIT_MAX` 为止。
 * 舞台还没量出来时宽高是 0，算出来的是 `ZOOM_MIN`；等 ResizeObserver 量好了由 {@link relayout} 重算。
 */
export function fitScale(frame: Size, natural: Size, rot: number): number {
  const box = turnedSize(natural, rot)
  if (box.w <= 0 || box.h <= 0) return 1
  const room = Math.min((frame.w - FIT_PAD * 2) / box.w, (frame.h - FIT_PAD * 2) / box.h)
  return clampScale(Math.min(FIT_MAX, room))
}

/** 适应窗口：居中，缩放取 {@link fitScale}，转的角度保留。 */
export function fitView(frame: Size, natural: Size, rot: number): ImageView {
  return { x: 0, y: 0, scale: fitScale(frame, natural, rot), rot }
}

/**
 * 平移限在范围里：图比舞台大的方向，只能拖到图的边缘与舞台边缘对齐；比舞台小的方向居中。
 * 缩放、旋转、拖动之后都过一遍这里。
 */
export function clampView(view: ImageView, frame: Size, natural: Size): ImageView {
  const box = boxOf(natural, view)
  const reachX = Math.max(0, (box.w - frame.w) / 2)
  const reachY = Math.max(0, (box.h - frame.h) / 2)
  return { ...view, x: within(view.x, reachX), y: within(view.y, reachY) }
}

/** 某个方向上图比舞台大，就能拖。 */
export function isPannable(view: ImageView, frame: Size, natural: Size): boolean {
  const box = boxOf(natural, view)
  return box.w > frame.w || box.h > frame.h
}

/**
 * 以 `anchor` 为中心缩放到 `next`：锚点下面那一点缩放前后在同一处。
 * 图心相对锚点的向量按倍数伸缩，所以新图心是 `anchor - k·(anchor - 图心)`，k 是倍数之比。旋转不影响这个式子。
 */
export function zoomView(
  view: ImageView,
  next: number,
  anchor: Point,
  frame: Size,
  natural: Size,
): ImageView {
  const scale = clampScale(next)
  const k = scale / view.scale
  const zoomed = {
    ...view,
    scale,
    x: anchor.x - k * (anchor.x - view.x),
    y: anchor.y - k * (anchor.y - view.y),
  }
  return clampView(zoomed, frame, natural)
}

/** 平移 `dx`、`dy` 个像素，再限在范围里。 */
export function panView(
  view: ImageView,
  dx: number,
  dy: number,
  frame: Size,
  natural: Size,
): ImageView {
  return clampView({ ...view, x: view.x + dx, y: view.y + dy }, frame, natural)
}

/**
 * 舞台变了，或刚读到图：适应窗口的重新算；否则保持缩放，只把平移限回范围里。
 */
export function relayout(view: ImageView, frame: Size, natural: Size, fitting: boolean): ImageView {
  return fitting ? fitView(frame, natural, view.rot) : clampView(view, frame, natural)
}

/**
 * 滚轮一下的缩放倍数：`deltaY` 为负（往上）放大，为正缩小。两个方向对称，来回滚不跑偏。
 */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-within(deltaY, WHEEL_REACH) * WHEEL_RATE)
}
