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
 * @module @xiaoso/dsh-workflow-lite/client/model/htmlPreview
 */

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
const SCRIPT = `<script data-wl-preview>(()=>{const fit=()=>{const seen=[document.body,document.documentElement].map((el)=>el&&getComputedStyle(el).backgroundColor).find((value)=>value&&!/^(transparent|rgba\\(0, 0, 0, 0\\))$/.test(value));const rgb=seen?seen.match(/[\\d.]+/g).map(Number):[255,255,255];const dark=(0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2])/255<0.5;const root=document.documentElement.style;root.setProperty('--wl-preview-thumb',dark?'${THUMB.onDark}':'${THUMB.onLight}');root.setProperty('--wl-preview-track',seen??'#fff')};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fit);else fit()})()</script>`

/** 补进页面的那一段。 */
export const PREVIEW_STYLE = `${STYLE}${SCRIPT}`

const ANCHORS: readonly RegExp[] = [
  /<head(?:\s[^>]*)?>/iu,
  /<html(?:\s[^>]*)?>/iu,
  /<!doctype[^>]*>/iu,
]

/** 把 {@link PREVIEW_STYLE} 插进页面。 */
export function withPreviewStyle(html: string): string {
  for (const anchor of ANCHORS) {
    const match = anchor.exec(html)
    if (match === null) continue
    const at = match.index + match[0].length
    return `${html.slice(0, at)}${PREVIEW_STYLE}${html.slice(at)}`
  }
  return `${PREVIEW_STYLE}${html}`
}
