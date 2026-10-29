/**
 * dsh-workflow-lite — 资源卡在画布上展示一项内容：哪些能展示、展示哪一项、缺省多大；
 * 编译计划时告诉写它的步骤「卡片里看得到多少」；工具建资源时怎么把 `display` 参数落成 `view`。
 *
 * 能展示的四类：图片、网页（HTML）、Markdown（含自定义文字）、纯文本（日志、代码、数据）。
 * 文件夹、网址、Skill 不展示。展示设置存在资源的 `view` 里（见 `types.ts` 的 `ResourceView`）。
 * 卡片怎么画（标题行、留白、拖动取整）在 `client/model/display.ts`。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/display
 */

import { type BoardCardRoom, boardCardRoom } from './board.ts'
import { extensionOf, fileKindOf } from './fileKind.ts'
import { readView } from './model.ts'
import {
  type ResourceData,
  type ResourceItem,
  type ResourceView,
  VIEW_FITS,
  type ViewFit,
  type ViewLook,
} from './types.ts'

export type DisplayKind = 'image' | 'html' | 'markdown' | 'text'

const HTML_EXTENSIONS = new Set(['html', 'htm'])

/** 一项能怎么展示；不能展示是 `null`。 */
export function displayKindOf(item: ResourceItem): DisplayKind | null {
  if (item.kind === 'text') return 'markdown'
  if (item.kind !== 'file' || item.value.trim() === '') return null
  if (HTML_EXTENSIONS.has(extensionOf(item.value))) return 'html'
  switch (fileKindOf(item.value)) {
    case 'image':
      return 'image'
    case 'markdown':
      return 'markdown'
    case 'text':
    case 'code':
    case 'data':
      return 'text'
    default:
      return null
  }
}

/** 第一个能展示的项；没有就是 `null`。 */
export function firstDisplayable(items: readonly ResourceItem[]): number | null {
  const index = items.findIndex((item) => displayKindOf(item) !== null)
  return index < 0 ? null : index
}

/** 资源里能展示的项（下标）。 */
export function displayableItems(items: readonly ResourceItem[]): number[] {
  return items.flatMap((item, index) => (displayKindOf(item) === null ? [] : [index]))
}

export const VIEW_SIZE_KEYS = ['s', 'm', 'l'] as const
export type ViewSize = (typeof VIEW_SIZE_KEYS)[number]

/**
 * 展示区的三档预设尺寸，按内容种类各一套（宽 × 高，画布像素）。宽度约是步骤卡（216）的一个、一个半、两个；
 * 都是 8 的倍数（拖动按 8 取整）。图片约 3:2；网页的高按看板卡片版（字号和步骤卡片一样）一个问题正好排满来定，
 * 比 16:10 矮一些，高了底下会空一截。
 */
export const VIEW_SIZES: Record<DisplayKind, Record<ViewSize, [number, number]>> = {
  image: { s: [208, 136], m: [320, 216], l: [448, 296] },
  html: { s: [208, 128], m: [320, 176], l: [448, 256] },
  markdown: { s: [208, 160], m: [320, 232], l: [448, 320] },
  text: { s: [208, 128], m: [320, 192], l: [448, 272] },
}

/** 内容缩放的缺省值：都按原大（网页按卡片宽度排版）。缩得小了卡片里的字就看不清。 */
export const DEFAULT_ZOOM: Record<DisplayKind, number> = {
  image: 100,
  html: 100,
  markdown: 100,
  text: 100,
}

/** 刚打开展示时的设置：中档尺寸，其余缺省。 */
export function defaultView(kind: DisplayKind, item?: number): ResourceView {
  const [width, height] = VIEW_SIZES[kind].m
  return item === undefined ? { width, height } : { item, width, height }
}

/** 这张卡此刻展示什么：哪一项、什么种类、设置（缺省已补上）。没开展示或没有能展示的项是 `null`。 */
export interface Display {
  item: number
  kind: DisplayKind
  width: number
  height: number
  zoom: number
  fit: ViewFit
  /** 写它的步骤要不要按展示做适配。 */
  adapt: boolean
  /** 看板贴在画布上的样子：文档里写的（不写 = 跟着外观设置）；画布按设置定下之后也写在这里往下传。 */
  look?: ViewLook
}

export function displayOf(data: ResourceData): Display | null {
  const view = data.view
  if (view === undefined || data.preset !== undefined) return null
  const chosen = view.item === undefined ? undefined : data.items[view.item]
  const item =
    chosen !== undefined && displayKindOf(chosen) !== null
      ? (view.item as number)
      : firstDisplayable(data.items)
  if (item === null) return null
  const kind = displayKindOf(data.items[item] as ResourceItem) as DisplayKind
  return {
    item,
    kind,
    width: view.width,
    height: view.height,
    zoom: view.zoom ?? DEFAULT_ZOOM[kind],
    fit: view.fit ?? 'contain',
    adapt: view.adapt !== false,
    ...(view.look === undefined ? {} : { look: view.look }),
  }
}

// ── 给写它的步骤看的尺寸 ────────────────────────────────────

/**
 * 卡片里的 Markdown / 纯文本一行多高（画布像素，缩放 100% 时）与上下留白：
 * 和 `display.module.css` 的 `.md`（12px × 1.65）、`.pre`（11px × 1.55）、`.flow` 的 padding 一致。
 */
const LINE_HEIGHT = { markdown: 12 * 1.65, text: 11 * 1.55 } as const
const FLOW_PAD_Y = 20

/** 按两倍分辨率出图时，图里的字、线至少多大（图片像素）：缩到卡片里约 10 px 字、1.5 px 线。 */
export const IMAGE_MIN_FONT = 20
export const IMAGE_MIN_STROKE = 3

/** 常见宽高比：图的比例离哪个近（差 5% 以内）就说哪个，否则报小数。 */
const RATIOS: readonly [number, number][] = [
  [1, 1],
  [5, 4],
  [4, 3],
  [3, 2],
  [16, 10],
  [16, 9],
  [2, 1],
  [21, 9],
  [4, 5],
  [3, 4],
  [2, 3],
  [9, 16],
]

/** 宽高比的说法：`3:2`，不靠近常见比例时 `1.55:1`（竖图 `1:1.55`）。 */
export function ratioText(width: number, height: number): string {
  const value = width / height
  for (const [w, h] of RATIOS) {
    if (Math.abs(Math.log(value / (w / h))) < Math.log(1.05)) return `${w}:${h}`
  }
  return value >= 1 ? `${value.toFixed(2)}:1` : `1:${(1 / value).toFixed(2)}`
}

/** 编译计划时写进任务描述的展示事实（按种类）；数字都是页面 / 图片自己的像素。 */
export type DisplayBrief =
  | {
      kind: 'html'
      /** 页面按多宽排版。 */
      layoutWidth: number
      /** 不滚动时露出页面最上面多高。 */
      firstScreen: number
      /** 卡片版放得下多少（按排版尺寸估；缩放只把整张等比缩放，不改排版）。 */
      room: BoardCardRoom
    }
  | {
      kind: 'image'
      /** 展示区的宽高比。 */
      ratio: string
      fit: ViewFit
      /** 展示区（画布像素）。 */
      width: number
      height: number
      /** 原大时看得到图片中间多大一块（图片像素）；其余摆放方式没有。 */
      visible?: { width: number; height: number }
    }
  | {
      kind: 'markdown' | 'text'
      /** 卡片里露出开头大约几行。 */
      lines: number
    }

/**
 * 展示区在画布上占多大。网页按「大小」排版，再按缩放整张等比缩放（像图片一样，排版不变），占「大小 × 缩放」；
 * 其余种类就是「大小」（Markdown、文本的缩放只改字号，图片的缩放只在原大时用）。
 */
export function displayFootprint(display: Pick<Display, 'kind' | 'width' | 'height' | 'zoom'>): {
  width: number
  height: number
} {
  if (display.kind !== 'html') return { width: display.width, height: display.height }
  const scale = display.zoom / 100
  return { width: Math.round(display.width * scale), height: Math.round(display.height * scale) }
}

export function displayBrief(display: Display): DisplayBrief {
  const scale = display.zoom / 100
  switch (display.kind) {
    case 'html':
      return {
        kind: 'html',
        layoutWidth: display.width,
        firstScreen: display.height,
        room: boardCardRoom(display.width, display.height),
      }
    case 'image':
      return {
        kind: 'image',
        ratio: ratioText(display.width, display.height),
        fit: display.fit,
        width: display.width,
        height: display.height,
        ...(display.fit === 'actual'
          ? {
              visible: {
                width: Math.round(display.width / scale),
                height: Math.round(display.height / scale),
              },
            }
          : {}),
      }
    default: {
      const line = LINE_HEIGHT[display.kind] * scale
      return {
        kind: display.kind,
        lines: Math.max(1, Math.floor((display.height - FLOW_PAD_Y) / line)),
      }
    }
  }
}

// ── 工具的 display 参数 ─────────────────────────────────────

/** 工具 `write_resource` 的 `display`（与参数声明同构）：给了的字段才改。 */
export interface DisplaySpec {
  /** `false` = 关掉展示（其余字段不看）。 */
  show?: boolean
  /** 预设尺寸；和 `width` / `height` 同时给时以宽高为准。 */
  size?: ViewSize
  width?: number
  height?: number
  zoom?: number
  fit?: ViewFit
  /** 展示第几项（从 0 数）。 */
  item?: number
  /** 写它的步骤要不要按展示做适配；缺省 = 要。 */
  adapt?: boolean
}

/**
 * 把 `display` 落到资源上：没开过的按展示项的种类从中档起，开过的在原设置上改。
 * 换了种类（比如展示项从图片换成网页）而没给尺寸，尺寸回到新种类的中档。
 * @returns 新的 `view`（`undefined` = 关掉）；参数不对是一句给模型看的错。
 */
export function applyDisplay(
  data: ResourceData,
  spec: DisplaySpec,
): { view: ResourceView | undefined } | { error: string } {
  if (spec.show === false) return { view: undefined }
  if (data.preset !== undefined) return { error: '记忆卡不能在画布上展示' }
  const choices = displayableItems(data.items)
  if (choices.length === 0) {
    return {
      error: '这个资源里没有能在画布上展示的项（图片、HTML、Markdown、文本类文件或自定义文字）',
    }
  }
  if (spec.item !== undefined && !choices.includes(spec.item)) {
    return { error: `display.item 要指向能展示的那几项之一（可选：${choices.join(' / ')}）` }
  }
  if (spec.fit !== undefined && !VIEW_FITS.includes(spec.fit)) {
    return { error: `display.fit 不认识：${String(spec.fit)}（可选：${VIEW_FITS.join(' / ')}）` }
  }
  if (spec.size !== undefined && !VIEW_SIZE_KEYS.includes(spec.size)) {
    return {
      error: `display.size 不认识：${String(spec.size)}（可选：${VIEW_SIZE_KEYS.join(' / ')}）`,
    }
  }
  const before = displayOf(data)
  const item = spec.item ?? before?.item ?? (choices[0] as number)
  const kind = displayKindOf(data.items[item] as ResourceItem) as DisplayKind
  const sameKind = before !== null && before.kind === kind
  const preset = VIEW_SIZES[kind][spec.size ?? 'm']
  const keep = sameKind && spec.size === undefined
  const raw: Record<string, unknown> = {
    ...(sameKind ? data.view : {}),
    item,
    width: spec.width ?? (keep ? before.width : preset[0]),
    height: spec.height ?? (keep ? before.height : preset[1]),
  }
  if (spec.zoom !== undefined) raw.zoom = spec.zoom
  if (spec.fit !== undefined) raw.fit = spec.fit
  if (spec.adapt !== undefined) raw.adapt = spec.adapt
  // 只有一项能展示时不记 item：以后加了项，展示的还是「第一个能展示的」。
  if (choices.length === 1) delete raw.item
  return { view: readView(raw) }
}
