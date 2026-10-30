import { describe, expect, it } from 'vitest'
import type { T } from '../../src/client/i18n.ts'
import type { Display } from '../../src/client/model/display.ts'
import { displaySummary } from '../../src/client/ui/DisplaySettings.tsx'

const t = ((key: string): string => key) as T
const base: Display = {
  item: 0,
  kind: 'html',
  width: 320,
  height: 176,
  zoom: 100,
  fit: 'contain',
  adapt: true,
  hideTitle: false,
  lines: {},
  table: {},
  gallery: {},
}

describe('displaySummary', () => {
  it('预设尺寸带档位名，没选外观写「跟随设置」', () => {
    expect(displaySummary(t, base, true)).toBe('display.size.m 320×176 · 100% · display.look.auto')
  })

  it('自定义尺寸只写宽高；选了外观写它的名字；文件没适配时末尾带一句', () => {
    const out = displaySummary(t, { ...base, width: 400, look: 'glass', adapt: false }, true)
    expect(out).toBe('400×176 · 100% · theme.board.glass · display.adaptOff')
  })

  it('藏了标题写在外观后面', () => {
    expect(displaySummary(t, { ...base, look: 'card', hideTitle: true }, true)).toBe(
      'display.size.m 320×176 · 100% · theme.board.card · display.hideTitle',
    )
  })

  it('不是文件不提适配；图片写摆放，只有原大才写缩放', () => {
    const image: Display = { ...base, kind: 'image', adapt: false }
    expect(displaySummary(t, image, false)).not.toContain('display.adaptOff')
    expect(displaySummary(t, image, false)).toContain('display.fit.contain')
    expect(displaySummary(t, image, false)).not.toContain('%')
    expect(displaySummary(t, { ...image, fit: 'actual' }, false)).toContain('100%')
  })
})
