/**
 * dsh-workflow-lite — 资源卡在画布上展示一项内容：哪些能展示、展示哪一项、缺省多大；
 * 编译计划时告诉写它的步骤「卡片里看得到多少」；工具建资源时怎么把 `display` 参数落成 `view`。
 *
 * 能展示的五类：图片、网页（HTML）、Markdown（含自定义文字）、纯文本（日志、代码、数据）、
 * 文件夹（图墙：里面的图按新旧排开，没有图时列出文件）。网址、Skill 不展示。展示设置存在资源的 `view` 里（见 `types.ts` 的 `ResourceView`）。
 * 卡片怎么画（标题行、留白、拖动取整）在 `client/model/display.ts`。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/display
 */

import { type BoardCardRoom, boardCardRoom } from './board.ts'
import { extensionOf, fileKindOf, tableFormat } from './fileKind.ts'
import { readView } from './model.ts'
import {
  FOLDER_ORDERS,
  type FolderShow,
  type GalleryLayoutKind,
  type GalleryView,
  type LineView,
  type ResourceData,
  type ResourceItem,
  type ResourceView,
  type TableView,
  VIEW_FITS,
  type ViewFit,
  type ViewFrom,
  type ViewLook,
} from './types.ts'

export type DisplayKind = 'image' | 'html' | 'markdown' | 'text' | 'gallery'

const HTML_EXTENSIONS = new Set(['html', 'htm'])

/** 一项能怎么展示；不能展示是 `null`。 */
export function displayKindOf(item: ResourceItem): DisplayKind | null {
  if (item.kind === 'text') return 'markdown'
  if (item.kind === 'folder') return item.value.trim() === '' ? null : 'gallery'
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

/**
 * 纯文本在卡片里折不折行：一行一条记录的（`.txt`、`.log`、`.jsonl`）折行——要看的多半在行尾（日志的消息、记录的后几个字段），
 * 截掉就看不到了；代码、配置、表格不折——缩进、列就是结构，折了反而看不清。
 */
export function textWraps(path: string): boolean {
  return fileKindOf(path) === 'text' || extensionOf(path) === 'jsonl'
}

/**
 * 这一项在「内容」一组里能调什么：日志、纯文本按行（`lines`），CSV / TSV 排成表（`table`），文件夹（`gallery`）；
 * 代码、配置、Markdown、图片、网页没有这一组。
 */
export function contentKindOf(
  kind: DisplayKind,
  path: string,
): 'lines' | 'table' | 'gallery' | null {
  if (kind === 'gallery') return 'gallery'
  if (kind !== 'text') return null
  if (tableFormat(path) !== null) return 'table'
  return textWraps(path) ? 'lines' : null
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
  gallery: { s: [208, 136], m: [320, 216], l: [448, 296] },
}

/** 内容缩放的缺省值：都按原大（网页按卡片宽度排版）。缩得小了卡片里的字就看不清。 */
export const DEFAULT_ZOOM: Record<DisplayKind, number> = {
  image: 100,
  html: 100,
  markdown: 100,
  text: 100,
  gallery: 100,
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
  /** 不选中、不悬停时藏起标题行。 */
  hideTitle: boolean
  /** 日志、纯文本、表格、图墙各自的设置（没写是空的）。 */
  lines: LineView
  table: TableView
  gallery: GalleryView
}

/** 没写的那组设置（共用一个空对象，比较时不算变了）。 */
const NO_SETTINGS = Object.freeze({})

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
    // 图墙缺省铺满小格（一格一张、不留边）；单张图缺省整张放进框里。
    fit: view.fit ?? (kind === 'gallery' ? 'cover' : 'contain'),
    adapt: view.adapt !== false,
    hideTitle: view.hideTitle === true,
    lines: view.lines ?? NO_SETTINGS,
    table: view.table ?? NO_SETTINGS,
    gallery: view.gallery ?? NO_SETTINGS,
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
  | {
      /** 日志、一行一条的纯文本（卡片里折行）。 */
      kind: 'log'
      /** 卡片里露出大约几行。 */
      lines: number
      /** 卡片看哪一段：`auto` = 写它的步骤在跑、`.log`、文件很大时停在末尾，别的从头。 */
      from: ViewFrom | 'auto'
      /** 卡片只显示匹配的行（要找的字）。 */
      filter?: string
    }
  | {
      kind: 'table'
      /** 展示区宽（画布像素）。 */
      width: number
      from: ViewFrom | 'auto'
    }
  | {
      kind: 'gallery'
      /** 卡片里一次露出几张（最新的在前）。 */
      tiles: number
      /** 最新那张占的大格（画布像素）；格子少时没有大格。 */
      hero?: { width: number; height: number }
      fit: ViewFit
      /** 只显示名字对得上的。 */
      match?: string
    }
  | {
      /** 文件夹列出文件（不排图墙）。 */
      kind: 'files'
      match?: string
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

/** `path` 是展示的那一项（日志、表格按它认）。 */
export function displayBrief(display: Display, path = ''): DisplayBrief {
  const scale = display.zoom / 100
  const content = contentKindOf(display.kind, path)
  const match = display.gallery.match === undefined ? {} : { match: display.gallery.match }
  if (content === 'table') {
    return { kind: 'table', width: display.width, from: display.table.from ?? 'auto' }
  }
  if (content === 'gallery' && display.gallery.show === 'files') return { kind: 'files', ...match }
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
    case 'gallery': {
      const grid = galleryGrid(display.width, display.height, display.gallery)
      const hero = grid.hero ? galleryHero(grid, display.width, display.height) : undefined
      return {
        kind: 'gallery',
        tiles: grid.slots,
        ...(hero ? { hero } : {}),
        fit: display.fit,
        ...match,
      }
    }
    default: {
      const line = LINE_HEIGHT[display.kind] * scale
      const lines = Math.max(1, Math.floor((display.height - FLOW_PAD_Y) / line))
      if (content !== 'lines') return { kind: display.kind, lines }
      const filter = display.lines.filter?.pattern
      return {
        kind: 'log',
        lines,
        from: display.lines.from ?? 'auto',
        ...(filter === undefined ? {} : { filter }),
      }
    }
  }
}

// ── 图墙的格子 ──────────────────────────────────────────────

/** 图墙的格子：小格大约这么宽（画布像素），格子之间留这么宽的缝。 */
const GALLERY_TILE = 88
export const GALLERY_GAP = 3

/**
 * 图墙怎么排：几列几行；`hero` 时第一张（最新的）占一个大格（`heroSpan` 列 × 行）。`slots` 是一次露出几张（大格算一张）。
 * 「大图 + 胶片」是两行：上面一整行大图，下面一排 `strip` 高的小格。
 */
export interface GalleryGrid {
  columns: number
  rows: number
  hero: boolean
  heroSpan: { columns: number; rows: number }
  slots: number
  /** 胶片那排多高（画布像素）；只有「大图 + 胶片」有。 */
  strip?: number
}

/**
 * 按设置排：
 * - 图墙（缺省）：写了 `grid` 就是那几列几行（卡片拖大格子跟着大、张数不变），没写按卡片大小大约 88 宽一格；
 *   至少三列两行时最新的占左上角两列两行（`hero: false` 不放大）。
 * - 大图 + 胶片：最新一张占上面一整行，下面一排小格（高是展示区的两成多，36–72）。
 * - 最新一张：整块就一张。
 */
export function galleryGrid(width: number, height: number, view: GalleryView = {}): GalleryGrid {
  if (view.layout === 'single') {
    return { columns: 1, rows: 1, hero: true, heroSpan: { columns: 1, rows: 1 }, slots: 1 }
  }
  if (view.layout === 'strip') {
    const strip = Math.min(72, Math.max(36, Math.round(height * 0.22)))
    const columns = Math.max(
      2,
      Math.round((width + GALLERY_GAP) / (strip * TILE_ASPECT + GALLERY_GAP)),
    )
    return {
      columns,
      rows: 2,
      hero: true,
      heroSpan: { columns, rows: 1 },
      slots: columns + 1,
      strip,
    }
  }
  const columns = view.grid?.columns ?? Math.max(2, Math.round(width / GALLERY_TILE))
  const tile = (width - GALLERY_GAP * (columns - 1)) / columns
  const rows =
    view.grid?.rows ?? Math.max(1, Math.round((height + GALLERY_GAP) / (tile + GALLERY_GAP)))
  const hero = view.hero !== false && columns >= 3 && rows >= 2
  return {
    columns,
    rows,
    hero,
    heroSpan: { columns: 2, rows: 2 },
    slots: columns * rows - (hero ? 3 : 0),
  }
}

/** 排成 CSS 网格的两条轨道。 */
export function galleryTracks(grid: GalleryGrid): { columns: string; rows: string } {
  return {
    columns: `repeat(${grid.columns}, minmax(0, 1fr))`,
    rows:
      grid.strip === undefined
        ? `repeat(${grid.rows}, minmax(0, 1fr))`
        : `minmax(0, 1fr) ${grid.strip}px`,
  }
}

/** 小格最好接近这个宽高比（截图、图表多是横的）。 */
const TILE_ASPECT = 4 / 3
/** 排法打分：最后一行每少一张扣多少、摊开的那几张变扁了扣多少；最新那张能占大格加多少。 */
const EMPTY_COST = 0.15
const STRETCH_COST = 0.5
const HERO_BONUS = 0.3

/**
 * 这一回真要排几格：图够多就是 {@link galleryGrid}（最新的占大格，最后一格写「+N」）；
 * 图少了按张数重排——小格尽量接近 4:3，五张起尽量让最新的占大格；最后一行不满时那几张摊开占满
 * （`spans`：最后几张各占几列，没有就是都占一列）。固定了几列几行的不重排（空着的格子就空着）；
 * 胶片不够一排时小格少几个，只有一张时就是一张。
 */
export function galleryLayout(
  width: number,
  height: number,
  count: number,
  view: GalleryView = {},
): GalleryGrid & { spans: number[] } {
  const grid = galleryGrid(width, height, view)
  // 固定格子只对图墙有用（换到别的排法时还记着，换回来接着用）。
  const fixed = view.grid !== undefined && (view.layout ?? 'wall') === 'wall'
  if (count >= grid.slots || count <= 0 || fixed) return { ...grid, spans: [] }
  if (view.layout === 'strip') {
    if (count === 1) return { ...galleryGrid(width, height, { layout: 'single' }), spans: [] }
    const columns = count - 1
    return { ...grid, columns, heroSpan: { columns, rows: 1 }, slots: count, spans: [] }
  }
  const heroOk = view.hero !== false
  let best = { columns: 1, rows: count, hero: false, score: Number.POSITIVE_INFINITY }
  const consider = (columns: number, rows: number, hero: boolean): void => {
    const empty = columns * rows - (hero ? 3 : 0) - count
    if (empty < 0 || empty >= lastRowOf(columns, rows, hero)) return
    const aspect = width / columns / (height / rows)
    // 最后一行摊开的那几张也别太扁。
    const lastRow = lastRowOf(columns, rows, hero)
    const stretched =
      empty === 0 ? 0 : Math.log((aspect * lastRow) / (lastRow - empty) / TILE_ASPECT)
    const score =
      Math.abs(Math.log(aspect / TILE_ASPECT)) +
      Math.abs(stretched) * STRETCH_COST +
      empty * EMPTY_COST -
      (hero ? HERO_BONUS : 0)
    if (score < best.score) best = { columns, rows, hero, score }
  }
  for (let columns = 1; columns <= count; columns += 1) {
    for (let rows = 1; rows <= count; rows += 1) {
      consider(columns, rows, false)
      if (heroOk && count >= 5 && columns >= 3 && rows >= 2) consider(columns, rows, true)
    }
  }
  const { columns, rows, hero } = best
  const lastRow = lastRowOf(columns, rows, hero)
  const empty = columns * rows - (hero ? 3 : 0) - count
  const tiles = lastRow - empty
  const spans =
    empty === 0
      ? []
      : Array.from(
          { length: tiles },
          (_, index) => Math.floor(lastRow / tiles) + (index < lastRow % tiles ? 1 : 0),
        )
  return { columns, rows, hero, heroSpan: { columns: 2, rows: 2 }, slots: count, spans }
}

/** 最后一行有几格：有大格且只有两行时，最后一行只有大格右边那几格。 */
function lastRowOf(columns: number, rows: number, hero: boolean): number {
  return hero && rows === 2 ? columns - 2 : columns
}

/** 大格多大（画布像素）。 */
function galleryHero(
  grid: GalleryGrid,
  width: number,
  height: number,
): { width: number; height: number } {
  const cell = (size: number, count: number): number => (size - GALLERY_GAP * (count - 1)) / count
  const span = (size: number, count: number, spans: number): number =>
    cell(size, count) * spans + GALLERY_GAP * (spans - 1)
  return {
    width: Math.round(span(width, grid.columns, grid.heroSpan.columns)),
    height: Math.round(
      grid.strip === undefined
        ? span(height, grid.rows, grid.heroSpan.rows)
        : height - grid.strip - GALLERY_GAP,
    ),
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
  /** 日志、纯文本：看哪一段、只看哪些行。 */
  lines?: DisplayLinesSpec
  /** CSV / TSV：看哪一段、藏哪几列、按哪列排、数字列画浅条。 */
  table?: DisplayTableSpec
  /** 文件夹：展示什么、怎么排、按什么排、只看哪些名字。 */
  folder?: DisplayFolderSpec
}

export interface DisplayLinesSpec {
  from?: ViewFrom
  /** 只看含这段字的行；空串 = 不筛。 */
  filter?: string
  regex?: boolean
  /** 每处匹配前后各带几行。 */
  context?: number
}

export interface DisplayTableSpec {
  from?: ViewFrom
  /** 卡片里不显示的列（表头的字）；空数组 = 都显示。 */
  hide?: string[]
  /** 按哪一列排（表头的字）；空串 = 不排。 */
  sort?: string
  desc?: boolean
  bars?: boolean
}

/** 文件夹的顺序：`newest` 最新在前（缺省）。 */
export const FOLDER_ORDER_CHOICES = ['newest', ...FOLDER_ORDERS] as const

export interface DisplayFolderSpec {
  show?: FolderShow
  layout?: GalleryLayoutKind
  order?: (typeof FOLDER_ORDER_CHOICES)[number]
  /** 只看名字对得上的（`*.png, report-*`）；空串 = 都看。 */
  match?: string
}

/** 三组设置各自只用于哪种内容（报错时说给模型听）。 */
const CONTENT_GROUPS = {
  lines: { kind: 'lines', label: '日志、纯文本文件（.log、.txt、.jsonl 等）' },
  table: { kind: 'table', label: 'CSV / TSV 文件' },
  folder: { kind: 'gallery', label: '文件夹' },
} as const

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
      error:
        '这个资源里没有能在画布上展示的项（图片、HTML、Markdown、文本类文件、文件夹或自定义文字）',
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
  const content = contentKindOf(kind, (data.items[item] as ResourceItem).value)
  for (const key of ['lines', 'table', 'folder'] as const) {
    const group = CONTENT_GROUPS[key]
    if (spec[key] !== undefined && content !== group.kind) {
      return { error: `display.${key} 只用于${group.label}；展示的这一项用不上` }
    }
  }
  if (spec.lines !== undefined) {
    const lines = mergeLines(raw.lines as LineView | undefined, spec.lines)
    if (typeof lines === 'string') return { error: lines }
    raw.lines = lines
  }
  if (spec.table !== undefined)
    raw.table = mergeTable(raw.table as TableView | undefined, spec.table)
  if (spec.folder !== undefined) {
    raw.gallery = mergeFolder(raw.gallery as GalleryView | undefined, spec.folder)
  }
  // 只有一项能展示时不记 item：以后加了项，展示的还是「第一个能展示的」。
  if (choices.length === 1) delete raw.item
  return { view: readView(raw) }
}

/**
 * 在原来的按行设置上改（`raw` 形状，规范化——夹范围、去空、丢认不出的值——交给 `readView`）；
 * 正则写错了、只给了 regex / context 没有要找的字，是一句错。
 */
function mergeLines(
  before: LineView | undefined,
  spec: DisplayLinesSpec,
): Record<string, unknown> | string {
  const next: Record<string, unknown> = { ...before }
  if (spec.from !== undefined) next.from = spec.from
  if (spec.filter === undefined && spec.regex === undefined && spec.context === undefined) {
    return next
  }
  const pattern = spec.filter ?? before?.filter?.pattern ?? ''
  if (pattern === '') {
    if (spec.filter === undefined) return 'display.lines 的 regex、context 要和 filter 一起给'
    delete next.filter
    return next
  }
  const regex = spec.regex ?? before?.filter?.regex === true
  if (regex) {
    try {
      new RegExp(pattern, 'u')
    } catch {
      return `display.lines.filter 不是合法的正则：${pattern}`
    }
  }
  next.filter = {
    ...before?.filter,
    pattern,
    regex,
    context: spec.context ?? before?.filter?.context,
  }
  return next
}

function mergeTable(
  before: TableView | undefined,
  spec: DisplayTableSpec,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...before }
  if (spec.from !== undefined) next.from = spec.from
  if (spec.hide !== undefined) next.hide = spec.hide
  if (spec.bars !== undefined) next.bars = spec.bars
  const column = spec.sort ?? before?.sort?.column ?? ''
  if (column === '') delete next.sort
  else next.sort = { column, desc: spec.desc ?? before?.sort?.desc === true }
  return next
}

function mergeFolder(
  before: GalleryView | undefined,
  spec: DisplayFolderSpec,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...before }
  if (spec.show !== undefined) next.show = spec.show
  if (spec.layout !== undefined) next.layout = spec.layout
  if (spec.order !== undefined) next.order = spec.order
  if (spec.match !== undefined) next.match = spec.match
  return next
}
