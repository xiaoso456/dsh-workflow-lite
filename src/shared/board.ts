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
}

export const boardVar = (token: BoardToken): string => `--board-${token}`
