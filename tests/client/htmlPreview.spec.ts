import { describe, expect, it } from 'vitest'

import { boardTheme } from '../../src/client/model/boardTheme.ts'
import {
  BROKEN_IMAGES,
  boardScript,
  brokenImagesOf,
  PREVIEW_STYLE,
  THUMB,
  withPreviewStyle,
} from '../../src/client/model/htmlPreview.ts'
import { BOARD_THEME_EVENT, BOARD_THEME_MESSAGE } from '../../src/shared/board.ts'

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
    new Function('document', 'getComputedStyle', 'addEventListener', script)(
      document,
      getComputedStyle,
      () => {},
    )
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

describe('加载失败的图片：框里报个数，外面只认整数', () => {
  it('补进页面的脚本带着消息类型', () => {
    expect(PREVIEW_STYLE).toContain(`type:'${BROKEN_IMAGES}'`)
  })

  it('认合规的消息；别人的消息、形状不对、负数、小数、非数都不认；超大的数封顶', () => {
    expect(brokenImagesOf({ type: BROKEN_IMAGES, count: 3 })).toBe(3)
    expect(brokenImagesOf({ type: BROKEN_IMAGES, count: 0 })).toBe(0)
    expect(brokenImagesOf({ type: BROKEN_IMAGES, count: 1e9 })).toBe(9999)
    for (const bad of [
      null,
      'x',
      42,
      {},
      { type: 'other', count: 1 },
      { type: BROKEN_IMAGES },
      { type: BROKEN_IMAGES, count: -1 },
      { type: BROKEN_IMAGES, count: 1.5 },
      { type: BROKEN_IMAGES, count: '2' },
    ]) {
      expect(brokenImagesOf(bad)).toBeNull()
    }
  })
})

describe('看板：标模式、写主题变量、换主题就地改', () => {
  /** 在假页面里跑看板那段脚本，返回 <html> 上的属性、内联变量，和发消息的办法。 */
  function runBoard(script: string) {
    const attrs: Record<string, string> = {}
    const vars: Record<string, string> = {}
    const style = {
      colorScheme: '',
      setProperty: (name: string, value: string) => {
        vars[name] = value
      },
    }
    const root = {
      style,
      setAttribute: (name: string, value: string) => (attrs[name] = value),
      toggleAttribute: (name: string, on: boolean) => {
        if (on) attrs[name] = ''
        else delete attrs[name]
      },
    }
    const listeners: ((event: { source: unknown; data: unknown }) => void)[] = []
    const events: string[] = []
    const parent = { kind: 'parent' }
    const body = /<script data-wl-preview>([\s\S]*?)<\/script>/u.exec(script)?.[1] ?? ''
    new Function('document', 'addEventListener', 'dispatchEvent', 'parent', 'Event', body)(
      { documentElement: root },
      (type: string, listener: (event: { source: unknown; data: unknown }) => void) => {
        if (type === 'message') listeners.push(listener)
      },
      (event: { type: string }) => events.push(event.type),
      parent,
      class {
        constructor(readonly type: string) {}
      },
    )
    const post = (data: unknown, source: unknown = parent): void => {
      for (const listener of listeners) listener({ source, data })
    }
    return { attrs, vars, style, events, post }
  }

  it('一上来就标出模式、写上变量和亮暗；没给看板就不插这段', () => {
    const light = boardTheme('light', 'white')
    const page = runBoard(boardScript('card', light))
    expect(page.attrs['data-board']).toBe('card')
    expect(page.vars['--board-bg']).toBe('#fafbfd')
    expect(page.vars['--board-radius']).toBe('10px')
    expect(page.style.colorScheme).toBe('light')
    expect(withPreviewStyle('<head></head>')).not.toContain('data-board')
    expect(withPreviewStyle('<head></head>', { mode: 'full', theme: light })).toBe(
      `<head>${boardScript('full', light)}${PREVIEW_STYLE}</head>`,
    )
  })

  it('换主题：只认父窗口发来的那种消息、只收 --board- 开头的字符串，改完派发事件', () => {
    const page = runBoard(boardScript('card', boardTheme('light', 'white')))
    const dark = boardTheme('dark', 'slate')
    page.post({ type: BOARD_THEME_MESSAGE, ...dark }, { kind: 'someone else' })
    page.post({ type: 'other', ...dark })
    expect(page.vars['--board-bg']).toBe('#fafbfd')
    expect(page.events).toEqual([])
    page.post({
      type: BOARD_THEME_MESSAGE,
      scheme: 'dark',
      vars: { ...dark.vars, color: 'red', '--board-text': 3 },
    })
    expect(page.vars['--board-bg']).toBe('#1b2029')
    expect(page.vars['--board-text']).toBe('#131820')
    expect(page.vars.color).toBeUndefined()
    expect(page.style.colorScheme).toBe('dark')
    expect(page.events).toEqual([BOARD_THEME_EVENT])
  })

  it('镂空：标上属性、页面底透明、--board-bg 换成画布底色；关掉就回到卡面色，不用重载', () => {
    const light = boardTheme('light', 'white')
    expect(light.canvas).toMatch(/^#[0-9a-f]{6}$/u)
    expect(light.canvas).not.toBe(light.vars['--board-bg'])
    const page = runBoard(boardScript('card', { ...light, clear: true }))
    expect(page.attrs['data-board-clear']).toBe('')
    expect(page.vars['--board-bg']).toBe(light.canvas)
    expect(boardScript('card', light)).toContain(
      '[data-board-clear] body{background:transparent!important}',
    )
    page.post({ type: BOARD_THEME_MESSAGE, ...light })
    expect(page.attrs['data-board-clear']).toBeUndefined()
    expect(page.vars['--board-bg']).toBe('#fafbfd')
    // 没带画布底色的消息不镂（不知道该换成什么颜色）。
    page.post({ type: BOARD_THEME_MESSAGE, scheme: 'light', vars: light.vars, clear: true })
    expect(page.attrs['data-board-clear']).toBeUndefined()
  })

  it('瑞士是直角；值里有 </script> 也截不断脚本', () => {
    expect(boardTheme('light', 'swiss', { look: 'swiss' }).vars['--board-radius']).toBe('0px')
    const script = boardScript('card', {
      scheme: 'light',
      vars: { '--board-font': 'x</script><b>' },
    })
    expect(script.match(/<\/script>/gu)).toHaveLength(1)
    expect(runBoard(script).vars['--board-font']).toBe('x</script><b>')
  })
})
