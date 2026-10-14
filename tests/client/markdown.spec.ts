import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../../src/client/ui/Markdown.tsx'

const t = (key: string): string => key
const html = (text: string): string => renderToStaticMarkup(createElement(Markdown, { t, text }))

describe('Markdown', () => {
  it('标题、粗体、行内代码', () => {
    const out = html('## 图的事实\n**图名**：`rv-main`。')
    expect(out).toContain('<h2>图的事实</h2>')
    expect(out).toContain('<strong>图名</strong>')
    expect(out).toContain('<code>rv-main</code>')
  })

  it('紧跟在段落后面的表格也认得出来（计划里就是这么写的）', () => {
    const out = html('**图名**：`g`。\n| a | b |\n|---|:-:|\n| 1 | `x\\|y` |\n\n后面')
    expect(out).toContain('<p><strong>图名</strong>：<code>g</code>。</p>')
    expect(out).toContain('<th style="text-align:center">b</th>')
    expect(out).toContain('<code>x|y</code>')
    expect(out).toContain('<p>后面</p>')
  })

  it('列表、有序列表、子列表；空一行之后的普通行另起一段', () => {
    const out = html('- 批次 1\n- 批次 2\n  - 子项\n\n（备注）\n\n3. 三\n4. 四')
    expect(out.replaceAll('\n', '')).toContain(
      '<ul><li>批次 1</li><li>批次 2<ul><li>子项</li></ul></li></ul><p>（备注）</p>',
    )
    expect(out.replaceAll('\n', '')).toContain('<ol start="3"><li>三</li><li>四</li></ol>')
  })

  it('一行就是一行：段落里的换行保留成 <br>', () => {
    expect(html('第一行\n第二行').replaceAll('\n', '')).toContain('<p>第一行<br>第二行</p>')
  })

  it('挨着中文标点的粗体也认得出来', () => {
    const out = html('**结论。**后面是正文，的**「名字」**也加粗，**`code`**要')
    expect(out).toContain('<strong>结论。</strong>后面')
    expect(out).toContain('<strong>「名字」</strong>')
    expect(out).toContain('<strong><code>code</code></strong>要')
  })

  it('代码块原样保留，里面的星号不当粗体', () => {
    const out = html('```\n**不是粗体** <b>\n```')
    expect(out).toContain('<pre')
    expect(out).toContain('**不是粗体** &lt;b&gt;')
  })

  it('用户写的 HTML 一律当文字，链接只认 http(s)，在新窗口打开', () => {
    const out = html(
      '<img src=x onerror=alert(1)> [好](https://example.com) [坏](javascript:alert(1))',
    )
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
    expect(out).toContain(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">好</a>',
    )
    expect(out).not.toContain('href="javascript')
  })

  it('带协议的网址自动成链接，文件名不会', () => {
    const out = html('看 https://example.com/spec 再改 review.md 和 www.example.com')
    expect(out).toContain('href="https://example.com/spec"')
    expect(out).not.toContain('href="http://review.md"')
    expect(out).not.toContain('href="http://www.example.com"')
  })

  it('相对路径的图片先不给地址，记下原路径等查看框去读；网上的图照常', () => {
    const out = html('![修复前](media/修复前.png) ![x](<media/a b.png>) ![w](https://x.dev/a.png)')
    expect(out).toContain('alt="修复前"')
    expect(out).toContain('data-wl-src="media/%E4%BF%AE%E5%A4%8D')
    expect(out).toContain('data-wl-src="media/a%20b.png"')
    expect(out).toContain('src="https://x.dev/a.png"')
    expect(out).not.toMatch(/ src="media/u)
  })

  it('表格单元格里的本地图片也认得出来', () => {
    const out = html('| 前 | 后 |\n|---|---|\n| ![b](media/b.png) 两行 | ![a](media/a.png) |')
    expect(out).toContain('data-wl-src="media/b.png"')
    expect(out).not.toContain('![b]')
  })

  it('图都不让拖（宿主会当成拖文件进对话）；网上的图能聚焦（回车放大看）', () => {
    const out = html('![本地](media/a.png) ![网](https://x.dev/a.png)')
    expect(out.match(/draggable="false"/gu)).toHaveLength(2)
    expect(out).toMatch(/src="https:\/\/x\.dev\/a\.png"[^>]*tabindex="0"/u)
    expect(out).not.toMatch(/data-wl-src="media\/a\.png"[^>]*tabindex/u)
  })

  it('带协议的图片地址（javascript:、file:、盘符）不认；相对路径的链接只留文字', () => {
    const out = html('![x](javascript:alert(1)) ![y](file:///c/a.png) [下一份](./next.md)')
    expect(out).not.toContain('<img')
    expect(out).toContain('<a>下一份</a>')
  })

  it('文件名里的下划线不当斜体', () => {
    expect(html('写到 fix_notes_v2.md')).toContain('fix_notes_v2.md')
  })

  it('表格外面包一层（窄的时候横向滚动）', () => {
    const out = html('| a |\n|---|\n| 1 |')
    expect(out).toMatch(/<div class="[^"]*"><table>/u)
    expect(out).toContain('</table></div>')
  })
})
