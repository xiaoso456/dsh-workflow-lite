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

/** 往大 / 往小走一档。 */
export function stepZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((step) => step > zoom) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]
  return [...ZOOM_STEPS].reverse().find((step) => step < zoom) ?? ZOOM_STEPS[0]
}
