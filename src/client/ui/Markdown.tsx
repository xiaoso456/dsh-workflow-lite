/**
 * dsh-workflow-lite — Markdown 排版（计划预览、文档查看、说明栏共用），交给 markdown-it 渲染。
 *
 * 规则是 CommonMark + GFM 表格 / 删除线，另外几处按我们的内容调过：
 * - **不收原始 HTML**（`html: false`）：提示词、文件都是任意文本，里面的标签一律当文字，
 *   这样渲染结果才能直接放进 `innerHTML`。别为了"支持 HTML"把它打开——那就是一个注入口。
 * - **链接只认 http(s)**，新窗口打开、不带来源；相对路径的链接只留文字（点了会把宿主页面带走）。
 * - **相对路径的图片**按文档所在目录找：调用方给了 `image`（文件查看框按实例去读）就换成读回来的图，
 *   没给（计划、说明这类没有"所在目录"的文字）就只显示替代文字。读到了的图不让拖（宿主会当成拖文件进对话），
 *   点一下（或聚焦后回车）在模态框里放大看（{@link ImageZoom}）。
 * - **一行就是一行**（`breaks: true`，GitHub 评论区那种）：提示词与计划都是按行写的。
 * - **只认带协议的网址**：关掉 linkify 的模糊匹配，`review.md` 这种文件名（`.md` 也是顶级域名）不变成链接。
 * - **中日韩友好的强调**（`markdown-it-cjk-friendly`）：`**结论。**后面` 这种挨着中文标点的
 *   粗体，按 CommonMark 原规则认不出来。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Markdown
 */

import MarkdownIt from 'markdown-it'
import cjkFriendly from 'markdown-it-cjk-friendly'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { T } from '../i18n.ts'
import { ImageZoom } from './ImageZoom.tsx'
import css from './markdown.module.css'

const WEB = /^https?:\/\//iu
/** 带协议（`javascript:`、`file:`、`C:` 盘符……）的地址。 */
const SCHEME = /^[a-z][a-z0-9+.-]*:/iu

const md = MarkdownIt({ html: false, breaks: true, linkify: true }).use(cjkFriendly)
md.linkify.set({ fuzzyLink: false, fuzzyEmail: false })
// 放行 http(s) 与相对路径（图片要用）；相对路径的链接在下面 `link_open` 里摘掉地址。
md.validateLink = (url) => WEB.test(url) || !SCHEME.test(url.trim())

md.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index]
  if (token !== undefined && WEB.test(String(token.attrGet('href') ?? ''))) {
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer')
  } else if (token !== undefined) {
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'href')
  }
  return self.renderToken(tokens, index, options)
}

const renderImage = md.renderer.rules.image
md.renderer.rules.image = (tokens, index, options, env, self) => {
  const token = tokens[index]
  const src = String(token?.attrGet('src') ?? '')
  // 图不让拖：拖起来会被宿主当成"拖文件进对话"，弹出整页的添加提示。点开放大看在 `Markdown` 里接。
  token?.attrSet('draggable', 'false')
  if (token !== undefined && WEB.test(src)) token.attrSet('tabindex', '0')
  if (token !== undefined && !WEB.test(src)) {
    // 本地图片先不给地址：挂上之后由 `Markdown` 按文档所在目录去读，读不到就留着替代文字。
    token.attrs = (token.attrs ?? []).filter(([name]) => name !== 'src')
    token.attrSet('data-wl-src', src)
  }
  return renderImage === undefined
    ? self.renderToken(tokens, index, options)
    : renderImage(tokens, index, options, env, self)
}

// 表格包一层：窄的时候横向滚动，圆角边框画在外层上。
md.renderer.rules.table_open = () => `<div class="${css.tableWrap}"><table>\n`
md.renderer.rules.table_close = () => '</table></div>\n'

/** 把文档里写的相对路径读成能放进 `<img src>` 的地址（data URL）。 */
export type ImageSource = (src: string) => Promise<string>

/** markdown-it 把地址做过百分号编码（中文文件名、空格）；交出去之前还原成文件名。 */
function decodeSrc(src: string): string {
  try {
    return decodeURI(src)
  } catch {
    return src
  }
}

/** 事件落在一张读到了的图上就交出它（还在读、读不到的不算）。 */
function shownImage(target: EventTarget): HTMLImageElement | null {
  if (!(target instanceof HTMLImageElement)) return null
  return target.getAttribute('src') === null ? null : target
}

export function Markdown(props: {
  t: T
  text: string
  className?: string
  /** 相对路径的图片怎么读；不给就只显示替代文字。 */
  image?: ImageSource | undefined
}): React.JSX.Element {
  const html = useMemo(() => md.render(props.text), [props.text])
  const root = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState<{ src: string; alt: string; path: string } | null>(null)
  const { image } = props

  // `html` 一变，innerHTML 整块换掉：图片要重新挂地址。
  useEffect(() => {
    const images = root.current?.querySelectorAll<HTMLImageElement>('img[data-wl-src]') ?? []
    let alive = true
    for (const element of images) {
      const missing = (): void => {
        if (alive) element.dataset.wlMissing = ''
      }
      if (image === undefined) {
        missing()
        continue
      }
      image(decodeSrc(element.dataset.wlSrc ?? '')).then((url) => {
        if (!alive) return
        element.src = url
        element.tabIndex = 0
      }, missing)
    }
    return () => {
      alive = false
    }
  }, [html, image])

  const open = (event: React.SyntheticEvent): void => {
    const shown = shownImage(event.target)
    if (shown === null) return
    // 图包在链接里时也是放大看，不跟着链接走。
    event.preventDefault()
    // 路径给标题下面那一行看：本地图是文档里写的相对路径（还原成文件名），网上的图就是网址。
    const local = shown.dataset.wlSrc
    setZoom({
      src: shown.src,
      alt: shown.alt,
      path: local === undefined ? shown.src : decodeSrc(local),
    })
  }

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: 只是把图上的点击、回车接过来（图本身可聚焦） */}
      <div
        ref={root}
        className={[css.md, props.className].filter(Boolean).join(' ')}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') open(event)
        }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: markdown-it 关了原始 HTML、链接只放 http(s)，产出里没有用户写的标签
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {zoom !== null && (
        <ImageZoom
          t={props.t}
          src={zoom.src}
          alt={zoom.alt}
          path={zoom.path}
          onClose={() => setZoom(null)}
        />
      )}
    </>
  )
}
