import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getThemeChoice,
  readThemeChoice,
  resetThemeCache,
  setThemeChoice,
} from '../../src/client/app/theme.ts'
import {
  DARK_THEME_IDS,
  LIGHT_THEME_IDS,
  THEMES,
  type ThemeId,
  type ThemeTokens,
  themeStyle,
} from '../../src/client/model/themes.ts'

const channels = (hex: string): number[] =>
  [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** OKLab 色差（×100）。 */
function deltaE(a: string, b: string): number {
  const lab = (hex: string): number[] => {
    const [r, g, bl] = channels(hex).map(linear) as [number, number, number]
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
  }
  const [x, y] = [lab(a), lab(b)] as [number[], number[]]
  return Math.hypot(...x.map((v, i) => v - (y[i] as number))) * 100
}

const LINES = ['always', 'pass', 'fail', 'custom', 'produce', 'update', 'read'] as const
const ICONS = [
  'cBlue',
  'cGreen',
  'cAmber',
  'cCoral',
  'cTeal',
  'cPink',
  'cOlive',
  'cViolet',
  'cSlate',
] as const
const ALL: readonly ThemeId[] = [...LIGHT_THEME_IDS, ...DARK_THEME_IDS]

describe('配色主题：每套都看得清', () => {
  it.each(ALL)('%s：文字、强调色、语义色、线色、步骤色在面板上过 4.5:1', (id) => {
    const p = THEMES[id]
    const onPanel: (keyof ThemeTokens)[] = [
      'text',
      'text2',
      'text3',
      'accentText',
      'danger',
      'warn',
      'ok',
      'ask',
      ...LINES,
      ...ICONS,
    ]
    for (const key of onPanel) {
      expect(contrast(p[key] as string, p.panel), `${key} 在面板上`).toBeGreaterThanOrEqual(4.5)
    }
    expect(contrast(p.text3, p.fill), '第三级文字在输入框底上').toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.accentOn, p.accent), '主按钮上的字').toBeGreaterThanOrEqual(4.5)
    expect(contrast(p.file, p.fileSurface), '资源卡上的字').toBeGreaterThanOrEqual(4.5)
    for (const key of LINES) {
      expect(contrast(p[key], p.canvas), `${key} 线在画布上`).toBeGreaterThanOrEqual(3)
    }
  })

  /*
   * 线还有第二重记号（线上的牌子、读取是虚线、更新两头有箭头），所以底线是 8；
   * 默认的米色、石板都在 13 以上，照着参考色板配的主题（Nord、Everforest 这类低饱和色板）会低一些。
   */
  it.each(ALL)('%s：七种线两两分得开（OKLab ΔE ≥ 8）', (id) => {
    const p = THEMES[id]
    for (let i = 0; i < LINES.length; i += 1) {
      for (let j = i + 1; j < LINES.length; j += 1) {
        const [a, b] = [LINES[i], LINES[j]] as [(typeof LINES)[number], (typeof LINES)[number]]
        expect(deltaE(p[a], p[b]), `${a} ↔ ${b}`).toBeGreaterThanOrEqual(8)
      }
    }
  })

  it('亮色档的面亮、暗色档的面暗', () => {
    for (const id of LIGHT_THEME_IDS) expect(luminance(THEMES[id].panel)).toBeGreaterThan(0.7)
    for (const id of DARK_THEME_IDS) expect(luminance(THEMES[id].panel)).toBeLessThan(0.1)
  })
})

describe('主题写成 CSS 变量', () => {
  it('亮色一组 --wl-l-*、暗色一组 --wl-d-*，透明度带百分号', () => {
    const style = themeStyle('white', 'ocean')
    expect(style['--wl-l-canvas']).toBe('#f2f4f7')
    expect(style['--wl-d-canvas']).toBe('#0d1420')
    expect(style['--wl-l-c-blue']).toBe('#2f6fde')
    expect(style['--wl-d-line-strong-alpha']).toBe('19%')
  })

  it('shell.module.css 用到的每个 --wl-l-* / --wl-d-* 都有值', () => {
    const css = ['shell.module.css', 'canvas.module.css']
      .map((file) => readFileSync(new URL(`../../src/client/ui/${file}`, import.meta.url), 'utf8'))
      .join('\n')
    const used = new Set([...css.matchAll(/var\((--wl-[ld]-[a-z0-9-]+)\)/gu)].map((m) => m[1]))
    const style = themeStyle('paper', 'slate')
    expect(used.size).toBeGreaterThan(40)
    for (const name of used) expect(style[name as string], name).toBeDefined()
  })
})

describe('选了哪套主题记在浏览器里', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    })
    resetThemeCache()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('没记过就是米色 + 石板', () => {
    expect(readThemeChoice()).toEqual({ light: 'paper', dark: 'slate' })
  })

  it('只换一半，另一半不动；都换回默认就不留记录', () => {
    setThemeChoice({ dark: 'umber' })
    expect(getThemeChoice()).toEqual({ light: 'paper', dark: 'umber' })
    resetThemeCache()
    expect(readThemeChoice()).toEqual({ light: 'paper', dark: 'umber' })
    setThemeChoice({ dark: 'slate' })
    expect(store.size).toBe(0)
  })

  it('记坏了的那一半按默认', () => {
    store.set('workflow-lite.theme', JSON.stringify({ light: 'mist', dark: 'neon' }))
    expect(readThemeChoice()).toEqual({ light: 'mist', dark: 'slate' })
    store.set('workflow-lite.theme', 'not json')
    expect(readThemeChoice()).toEqual({ light: 'paper', dark: 'slate' })
  })
})
