import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Markdown } from '../../src/client/ui/Markdown.tsx'

const html = (text: string): string => renderToStaticMarkup(createElement(Markdown, { text }))

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

  it('列表、有序列表、子列表，列表后的普通行另起一段', () => {
    const out = html('- 批次 1\n- 批次 2\n  - 子项\n（备注）\n\n3. 三\n4. 四')
    expect(out).toContain('<ul><li>批次 1</li><li>批次 2<ul><li>子项</li></ul></li></ul>')
    expect(out).toContain('<p>（备注）</p>')
    expect(out).toContain('<ol start="3"><li>三</li><li>四</li></ol>')
  })

  it('一行就是一行：段落里的换行保留成 <br>', () => {
    expect(html('第一行\n第二行')).toContain('<p>第一行<br/>第二行</p>')
  })

  it('代码块原样保留，里面的星号不当粗体', () => {
    const out = html('```\n**不是粗体** <b>\n```')
    expect(out).toContain('<pre')
    expect(out).toContain('**不是粗体** &lt;b&gt;')
  })

  it('用户写的 HTML 一律当文字，链接只认 http(s)', () => {
    const out = html(
      '<img src=x onerror=alert(1)> [好](https://example.com) [坏](javascript:alert(1))',
    )
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
    expect(out).toContain('href="https://example.com"')
    expect(out).not.toContain('href="javascript')
  })

  it('文件名里的下划线不当斜体', () => {
    expect(html('写到 fix_notes_v2.md')).toContain('fix_notes_v2.md')
  })
})
