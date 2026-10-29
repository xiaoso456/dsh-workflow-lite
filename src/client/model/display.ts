/**
 * dsh-workflow-lite — 画布上的展示卡：卡片因展示多大、拖出来的尺寸怎么取整、缩放怎么走档。
 *
 * 哪些能展示、展示哪一项、缺省多大在 `shared/display.ts`（编译计划、工具也要用），这里转出去给界面用。
 * 卡片尺寸 = 标题行 + 展示区，布局与连线都按它算。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/display
 */

import { type Display, displayFootprint } from '../../shared/display.ts'
import { VIEW_LIMITS } from '../../shared/types.ts'

export {
  DEFAULT_ZOOM,
  type Display,
  type DisplayKind,
  defaultView,
  displayableItems,
  displayFootprint,
  displayKindOf,
  displayOf,
  firstDisplayable,
  VIEW_SIZES,
} from '../../shared/display.ts'

/** 展示卡的标题行高（CSS 里写死同样的数）；展示区贴着标题行，四周不留白。 */
export const DISPLAY_HEAD = 38

/** 展示卡整张的尺寸：标题行 + 展示区在画布上占的大小（网页要乘缩放）。 */
export function displayCardSize(display: Pick<Display, 'kind' | 'width' | 'height' | 'zoom'>): {
  w: number
  h: number
} {
  const area = displayFootprint(display)
  return { w: area.width, h: DISPLAY_HEAD + area.height }
}

/** 拖出来的展示区尺寸：夹进范围、按 8 像素取整。 */
export function snapView(width: number, height: number): { width: number; height: number } {
  const snap = (value: number, [lo, hi]: readonly [number, number]): number =>
    Math.min(hi, Math.max(lo, Math.round(value / 8) * 8))
  return { width: snap(width, VIEW_LIMITS.width), height: snap(height, VIEW_LIMITS.height) }
}

/** 内容缩放可选的几档（百分比）。 */
export const ZOOM_STEPS = [25, 33, 50, 67, 75, 90, 100, 110, 125, 150, 200] as const

/** 拖着缩放时离哪一档这么近（百分点）就吸上去。 */
const ZOOM_SNAP = 3

/**
 * 按住 Ctrl 拖右下角＝缩放：拖到的那个角投到卡片对角线上，看是原来的几倍，缩放跟着乘上去。
 * 只看对角线方向：横着拖、竖着拖、斜着拖都按「卡片变大了多少」算，不会因为手抖往一边偏就跳。
 * 结果取整、夹进 25–400；离某一档（100%、125%……）不到 3 个百分点就吸到那一档。
 * `from` 是开始拖时卡片在画布上的大小，`to` 是此刻拖到的大小（画布像素）。
 */
export function dragZoom(
  zoom: number,
  from: { width: number; height: number },
  to: { width: number; height: number },
): number {
  const length = from.width * from.width + from.height * from.height
  const ratio = length > 0 ? (to.width * from.width + to.height * from.height) / length : 1
  const [lo, hi] = VIEW_LIMITS.zoom
  const next = Math.min(hi, Math.max(lo, Math.round(zoom * Math.max(0, ratio))))
  const near = ZOOM_STEPS.find((step) => Math.abs(step - next) <= ZOOM_SNAP)
  return near ?? next
}

/** 往大 / 往小走一档。 */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((step) => step > zoom) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom) ?? ZOOM_STEPS[0]
}
