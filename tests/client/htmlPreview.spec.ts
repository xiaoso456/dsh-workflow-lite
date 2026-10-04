import { describe, expect, it } from 'vitest'

import { PREVIEW_STYLE, THUMB, withPreviewStyle } from '../../src/client/model/htmlPreview.ts'

describe('withPreviewStyle —— HTML 预览补细滚动条', () => {
  it('有 <head> 就插在它后面', () => {
    expect(withPreviewStyle('<!DOCTYPE html><html lang="zh"><head><title>x</title></head>')).toBe(
      `<!DOCTYPE html><html lang="zh"><head>${PREVIEW_STYLE}<title>x</title></head>`,
    )
  })

  it('没有 <head>：插在 <html> 后；只有 doctype：插在 doctype 后（不能挤到它前面）', () => {
    expect(withPreviewStyle('<html><body>a</body></html>')).toBe(
      `<html>${PREVIEW_STYLE}<body>a</body></html>`,
    )
    expect(withPreviewStyle('<!doctype html>\n<h1>a</h1>')).toBe(
      `<!doctype html>${PREVIEW_STYLE}\n<h1>a</h1>`,
    )
  })

  it('什么都没有就放最前；<header> 不当成 <head>', () => {
    expect(withPreviewStyle('<header>a</header>')).toBe(`${PREVIEW_STYLE}<header>a</header>`)
  })

  it('样式优先级是零（页面自己写的滚动条样式照样生效）；脚本跑之前用中灰', () => {
    expect(PREVIEW_STYLE).toContain(':where(*)')
    expect(PREVIEW_STYLE).toContain(`var(--wl-preview-thumb,${THUMB.unknown})`)
  })
})

describe('滑块颜色跟页面的底色走', () => {
  /** 在一个假页面里跑补进去的脚本，返回它定下的滑块颜色与整页轨道颜色。 */
  function colorsFor(backgrounds: { body?: string; html?: string }): {
    thumb: string | undefined
    track: string | undefined
  } {
    const script = /<script data-wl-preview>([\s\S]*?)<\/script>/u.exec(PREVIEW_STYLE)?.[1] ?? ''
    const set: Record<string, string> = {}
    const body = { kind: 'body' }
    const html = {
      kind: 'html',
      style: { setProperty: (name: string, value: string) => (set[name] = value) },
    }
    const document = { readyState: 'complete', body, documentElement: html }
    const getComputedStyle = (element: { kind: string }) => ({
      backgroundColor:
        (element.kind === 'body' ? backgrounds.body : backgrounds.html) ?? 'rgba(0, 0, 0, 0)',
    })
    new Function('document', 'getComputedStyle', script)(document, getComputedStyle)
    return { thumb: set['--wl-preview-thumb'], track: set['--wl-preview-track'] }
  }

  it('暗底（写在 body 上）→ 浅色滑块，整页轨道是页面底色（不露出框的白底）', () => {
    expect(colorsFor({ body: 'rgb(15, 17, 21)' })).toEqual({
      thumb: THUMB.onDark,
      track: 'rgb(15, 17, 21)',
    })
  })

  it('body 透明、html 上写了暗底 → 也认得出', () => {
    expect(colorsFor({ html: 'rgb(24, 28, 35)' })).toEqual({
      thumb: THUMB.onDark,
      track: 'rgb(24, 28, 35)',
    })
  })

  it('浅底 → 深色滑块；什么背景都没写（框里是白底）→ 深色滑块、白轨道', () => {
    expect(colorsFor({ body: 'rgb(250, 250, 250)' }).thumb).toBe(THUMB.onLight)
    expect(colorsFor({})).toEqual({ thumb: THUMB.onLight, track: '#fff' })
  })
})
