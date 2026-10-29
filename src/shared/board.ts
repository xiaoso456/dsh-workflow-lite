/**
 * dsh-workflow-lite — 看板（画布上展示的 HTML）和插件之间的约定：主题变量、卡片模式、主题变了的通知。
 *
 * 看板是模型写的一个自包含 HTML，显示在资源卡的沙箱框里，也会在查看框、浏览器里单独打开。插件往框里注入两样东西：
 * - **主题变量**：当前画布主题写成 `--board-*`（{@link BOARD_TOKENS}），设在 `<html>` 的内联样式上，
 *   比页面自己 `:root` 里的后备值优先；换主题时经 `postMessage` 就地改，不重载页面，改完在页面里派发 {@link BOARD_THEME_EVENT}。
 * - **模式**：`<html data-board="card">`（画布卡片）/ `"full"`（插件的查看框）；浏览器里打开没有这个属性。
 *
 * 这里的变量名、属性、事件名是对模型公开的接口（skill `workflow-board` 和编译出的任务描述都照它写），
 * 改名会让已经写好的看板失去主题，只能加、不能改。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/board
 */

/** 教模型写看板的按需 skill。 */
export const BOARD_SKILL = 'workflow-board'

/** `<html>` 上标模式的属性。 */
export const BOARD_ATTR = 'data-board'

export type BoardMode = 'card' | 'full'

/**
 * 卡片镂空时 `<html>` 上多标的属性：页面底透明，直接贴在画布上（`--board-bg` 换成画布底色，
 * 要「挖空」的地方照样写 `--board-bg` 就和后面的画布一个颜色）。
 */
export const BOARD_CLEAR_ATTR = 'data-board-clear'

/** 卡片没进交互时 `<html>` 上多标的属性：不画滚动条（页面照样能排版、能被脚本滚，只是看不到滑块）。 */
export const BOARD_STILL_ATTR = 'data-board-still'

/**
 * 页面跟着画布主题走吗：样式里用了 `var(--board-…)`。镂空只给这样的页面，别的网页写死了自己的底色和字色，
 * 底一透明字就看不清了。
 */
export function usesBoardTheme(html: string): boolean {
  return /var\(\s*--board-/u.test(html)
}

/** 主题变了之后在页面 `window` 上派发的事件（画了图表的页面据此重画）。 */
export const BOARD_THEME_EVENT = 'wl-board:theme'

/** 插件发给框里的消息类型。 */
export const BOARD_THEME_MESSAGE = 'wl-board:theme'

/** 公开的主题变量（不带 `--board-` 前缀）与用途。 */
export const BOARD_TOKENS = [
  ['bg', '页面底色（和卡片的展示区同色）'],
  ['surface', '分区、指标块的底（比页面深一档）'],
  ['line', '分隔线、描边'],
  ['text', '正文、数字'],
  ['muted', '次要文字、标签'],
  ['subtle', '更淡的文字：刻度、注脚'],
  ['accent', '强调色（主要数据、链接、选中）'],
  ['on-accent', '强调色底上的文字'],
  ['ok', '达标、通过、变好'],
  ['warn', '注意、接近阈值'],
  ['bad', '失败、超标、变差'],
  ['c1', '图表系列色 1（蓝）'],
  ['c2', '图表系列色 2（青）'],
  ['c3', '图表系列色 3（紫）'],
  ['c4', '图表系列色 4（粉）'],
  ['c5', '图表系列色 5（橄榄）'],
  ['c6', '图表系列色 6（灰蓝）'],
  ['radius', '圆角（有的主题是直角 0px）'],
  ['font', '正文字体'],
  ['mono', '等宽字体'],
] as const

export type BoardToken = (typeof BOARD_TOKENS)[number][0]

/** 一组主题变量的值（键带 `--board-` 前缀）和亮暗。 */
export interface BoardTheme {
  scheme: 'light' | 'dark'
  vars: Record<string, string>
  /** 画布底色：镂空时 `--board-bg` 换成它。 */
  canvas?: string
  /** 这一框镂空（只有卡片里会是）。 */
  clear?: boolean
  /** 卡片没进交互：不画滚动条。 */
  still?: boolean
}

export const boardVar = (token: BoardToken): string => `--board-${token}`

/**
 * 看板卡片版的版式（画布像素，正文 12px 时）。字号和画布上的步骤卡片一套（标题 = 卡片标题，正文 = 卡片说明，
 * 指标值大一档）；画布的字号是定值、不随主题变，所以写死在模板里，不注入。
 * 模板的样式按这些数生成（host/boardSkill.ts），编译器也按它估一张卡放得下几行（{@link boardCardRoom}），两边一起改。
 */
export const BOARD_CARD = {
  font: { title: 13, body: 12, value: 15 },
  /** 内距：普通 / 小卡（宽 < 200 或高 < 160）。 */
  pad: { top: 10, x: 12, bottom: 12 },
  padSmall: { top: 8, x: 12, bottom: 10 },
  /** 标题行的高，标题行和主体之间的距离（普通 / 小卡）。 */
  head: 20,
  headGap: 10,
  headGapSmall: 6,
  /** 左右两栏之间。 */
  colGap: 18,
  /** 成行的组件：一行多高、行距。 */
  stats: { row: 18, gap: 10 },
  list: { row: 16, gap: 4 },
  bars: { row: 16, gap: 6 },
} as const

/** 一张卡的卡片版放得下多少：主体（标题行下面）的大小，一栏放得下几行指标行、列表、对比条。 */
export interface BoardCardRoom {
  /** 2 = 左右两栏（横着的卡），1 = 单栏（竖长、小卡）。 */
  columns: 1 | 2
  /** 小卡：只显示标题行和主栏（`.side` 隐藏）。 */
  small: boolean
  /** 一栏多宽（两栏时是右栏）、主体多高。 */
  width: number
  height: number
  stats: number
  list: number
  bars: number
}

/** 按展示区的大小（画布像素）估：断点和模板样式里的一致（小卡、横着的卡）。 */
export function boardCardRoom(width: number, height: number): BoardCardRoom {
  const small = width < 200 || height < 160
  const wide = !small && width / height >= 1.25
  const pad = small ? BOARD_CARD.padSmall : BOARD_CARD.pad
  const body =
    height -
    pad.top -
    pad.bottom -
    BOARD_CARD.head -
    (small ? BOARD_CARD.headGapSmall : BOARD_CARD.headGap)
  const inner = width - pad.x * 2
  // 两栏是 1.1fr : 1fr，右栏占 1 / 2.1。
  const column = wide ? (inner - BOARD_CARD.colGap) / 2.1 : inner
  const rows = ({ row, gap }: { row: number; gap: number }): number =>
    Math.max(0, Math.floor((body + gap) / (row + gap)))
  return {
    columns: wide ? 2 : 1,
    small,
    width: Math.round(column),
    height: Math.max(0, Math.round(body)),
    stats: rows(BOARD_CARD.stats),
    list: rows(BOARD_CARD.list),
    bars: rows(BOARD_CARD.bars),
  }
}
