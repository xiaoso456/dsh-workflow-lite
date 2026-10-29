/**
 * dsh-workflow-lite — 在查看框里渲染 HTML 之前，给页面补细滚动条，颜色跟着页面自己的底色走。
 *
 * 框里的页面是独立的源，外面的样式进不去，只能在交给 `srcdoc` 的文字里补。
 *
 * 滚动条画在页面上，该看的是**页面的**底色，不是画布的主题：没写背景的页面在框里是白底（画布暗色时也是），
 * 暗色看板在亮色画布里照样是暗底。所以补一小段脚本，页面加载后读 `<body>` / `<html>` 的背景色，
 * 深底用浅色滑块、浅底用深色滑块；脚本跑起来之前先用一个两种底色上都看得见的中灰。
 *
 * 样式用 `:where()` 把优先级压到零——页面自己写了滚动条样式就用页面的。插在 `<head>` 后
 * （没有就在 `<html>` / doctype 后），不能插到 doctype 前面，否则页面会掉进怪异模式。
 *
 * 看板（画布展示的网页）再多补一段：标出卡片 / 查看框模式、写上画布主题的 `--board-*` 变量，换主题时就地改（约定见 shared/board.ts）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/htmlPreview
 */

import {
  BOARD_ATTR,
  BOARD_CLEAR_ATTR,
  BOARD_THEME_EVENT,
  BOARD_THEME_MESSAGE,
  type BoardMode,
  type BoardTheme,
} from '../../shared/board.ts'

/** 深底上的滑块、浅底上的滑块、还不知道底色时的滑块。 */
export const THUMB = {
  onDark: 'rgba(255,255,255,.28)',
  onLight: 'rgba(0,0,0,.28)',
  unknown: 'rgba(128,128,128,.45)',
} as const

/**
 * 页面里的滚动区轨道透明；整页那条滚动条的轨道要写成页面底色——它画在页面外面，
 * 透明的话露出来的是框的白底（暗色页面右边就是一条白边）。
 */
const STYLE = `<style data-wl-preview>:where(*){scrollbar-width:thin;scrollbar-color:var(--wl-preview-thumb,${THUMB.unknown}) transparent}:where(html){scrollbar-color:var(--wl-preview-thumb,${THUMB.unknown}) var(--wl-preview-track,transparent)}</style>`

/**
 * 读页面底色、定滑块颜色和整页轨道颜色。`<body>` 没写背景就看 `<html>`，都没写就是框的白底。
 * 亮度按 sRGB 粗算（0.2126 / 0.7152 / 0.0722），低于一半算深底。
 */
const SCRIPT = `<script data-wl-preview>(()=>{const fit=()=>{const seen=[document.body,document.documentElement].map((el)=>el&&getComputedStyle(el).backgroundColor).find((value)=>value&&!/^(transparent|rgba\\(0, 0, 0, 0\\))$/.test(value));const rgb=seen?seen.match(/[\\d.]+/g).map(Number):[255,255,255];const dark=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255<0.5;const root=document.documentElement.style;root.setProperty('--wl-preview-thumb',dark?'${THUMB.onDark}':'${THUMB.onLight}');root.setProperty('--wl-preview-track',seen??'#fff')};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fit);else fit();addEventListener('${BOARD_THEME_EVENT}',fit)})()</script>`

/** 框里的页面告诉外面「有几张图没加载出来」时发的消息类型。 */
export const BROKEN_IMAGES = 'wl-preview:broken-images'

/**
 * 数加载失败的 `<img>`，变了就告诉外面。框是独立的源（没有 allow-same-origin），外面看不进去，只能让里面报。
 * 和上面的脚本一起插在 `<head>` 最前，赶在图片开始加载之前挂上捕获阶段的 error / load（它们不冒泡）；页面 load 完再扫一遍，
 * 把挂上之前就已经失败的补进来。只报个数，不带地址：消息来自不受信的页面，外面只认一个整数。
 */
const REPORT = `<script data-wl-preview>(()=>{const bad=new Set();let sent=0;const send=()=>{if(bad.size!==sent){sent=bad.size;parent.postMessage({type:'${BROKEN_IMAGES}',count:bad.size},'*')}};addEventListener('error',(e)=>{if(e.target instanceof HTMLImageElement){bad.add(e.target);send()}},true);addEventListener('load',(e)=>{if(e.target instanceof HTMLImageElement&&bad.delete(e.target))send()},true);addEventListener('load',()=>{document.querySelectorAll('img').forEach((img)=>{if(img.complete&&img.currentSrc!==''&&img.naturalWidth===0)bad.add(img)});send()})})()</script>`

/** 补进页面的那一段。 */
export const PREVIEW_STYLE = `${STYLE}${SCRIPT}${REPORT}`

/** 认框里发来的消息：是「加载失败的图片数」就返回个数，别的（别人的消息、形状不对）返回 `null`。 */
export function brokenImagesOf(data: unknown): number | null {
  if (typeof data !== 'object' || data === null) return null
  const { type, count } = data as { type?: unknown; count?: unknown }
  if (type !== BROKEN_IMAGES) return null
  return typeof count === 'number' && Number.isInteger(count) && count >= 0
    ? Math.min(count, 9999)
    : null
}

const ANCHORS: readonly RegExp[] = [
  /<head(?:\s[^>]*)?>/iu,
  /<html(?:\s[^>]*)?>/iu,
  /<!doctype[^>]*>/iu,
]

/** 插进 `<script>` 的 JSON：`<` 写成转义，值里有 `</script>` 也截不断脚本。 */
const scriptJson = (value: unknown): string => JSON.stringify(value).replace(/</gu, '\\u003c')

/**
 * 镂空：页面和 `<body>` 的底一律透明（压过页面自己写的背景）。框元素的 `color-scheme` 得和页面一致，
 * 不然浏览器在框后面垫一层不透明的底（见 ResourceDisplay）。
 */
const CLEAR_STYLE = `<style data-wl-preview>[${BOARD_CLEAR_ATTR}],[${BOARD_CLEAR_ATTR}] body{background:transparent!important}</style>`

/**
 * 看板那一段：一上来就标模式、写变量（写在 `<html>` 的内联样式上，比页面 `:root` 的后备值优先），
 * 之后只认父窗口发来的主题消息，只收 `--board-` 开头的字符串值，改完派发事件让页面重画图表。
 * 消息里 `clear` 为真时标上镂空、`--board-bg` 换成画布底色；镂空随时能开关，不用重载页面。
 */
export function boardScript(mode: BoardMode, theme: BoardTheme): string {
  return `${CLEAR_STYLE}<script data-wl-preview>(()=>{const root=document.documentElement;root.setAttribute('${BOARD_ATTR}',${scriptJson(mode)});const apply=(t)=>{for(const [k,v] of Object.entries(t.vars)){if(k.startsWith('--board-')&&typeof v==='string')root.style.setProperty(k,v)}const clear=t.clear===true&&typeof t.canvas==='string';root.toggleAttribute('${BOARD_CLEAR_ATTR}',clear);if(clear)root.style.setProperty('--board-bg',t.canvas);root.style.colorScheme=t.scheme==='dark'?'dark':'light'};apply(${scriptJson(theme)});addEventListener('message',(e)=>{const d=e.data;if(e.source!==parent||!d||d.type!=='${BOARD_THEME_MESSAGE}'||typeof d.vars!=='object'||d.vars===null)return;apply(d);dispatchEvent(new Event('${BOARD_THEME_EVENT}'))})})()</script>`
}

/** 把 {@link PREVIEW_STYLE}（看板再加 {@link boardScript}）插进页面。 */
export function withPreviewStyle(
  html: string,
  board?: { mode: BoardMode; theme: BoardTheme },
): string {
  const patch =
    board === undefined ? PREVIEW_STYLE : `${boardScript(board.mode, board.theme)}${PREVIEW_STYLE}`
  for (const anchor of ANCHORS) {
    const match = anchor.exec(html)
    if (match === null) continue
    const at = match.index + match[0].length
    return `${html.slice(0, at)}${patch}${html.slice(at)}`
  }
  return `${patch}${html}`
}
