import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { boardTheme } from '../../src/client/model/boardTheme.ts'
import {
  BOARD_CARD_FONT,
  BOARD_FALLBACK,
  BOARD_SCRIPT,
  BOARD_SKILL_CONTENT,
  BOARD_TEMPLATE,
} from '../../src/host/boardSkill.ts'
import { BOARD_TOKENS, boardVar } from '../../src/shared/board.ts'

describe('skill workflow-board', () => {
  it('模板的后备值就是默认两套主题（晴白、石板）注进框里的值', () => {
    const prefixed = (values: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(values).map(([token, value]) => [`--board-${token}`, value]),
      )
    expect(prefixed(BOARD_FALLBACK.light)).toEqual(boardTheme('light', 'white').vars)
    expect(prefixed(BOARD_FALLBACK.dark)).toEqual(boardTheme('dark', 'slate').vars)
  })

  it('变量表列全；模板里两版切换、亮暗后备都在', () => {
    for (const [token] of BOARD_TOKENS)
      expect(BOARD_SKILL_CONTENT).toContain(`\`${boardVar(token)}\``)
    expect(BOARD_TEMPLATE).toContain('[data-board="card"] .card-view { display: grid; }')
    expect(BOARD_TEMPLATE).toContain('[data-board="card"] .full-view { display: none; }')
    expect(BOARD_TEMPLATE).toContain('@media (prefers-color-scheme: dark)')
    expect(BOARD_SKILL_CONTENT).toContain(BOARD_TEMPLATE)
  })

  it('模板里除了后备值没有写死的颜色', () => {
    const rest = BOARD_TEMPLATE.replace(/:root \{[^}]*\}/gu, '')
    expect(rest).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/iu)
  })

  it('模板末尾带着脚本，脚本是能解析的 JS', () => {
    expect(BOARD_TEMPLATE).toContain(BOARD_SCRIPT)
    const code = BOARD_SCRIPT.replace(/^<script>/u, '').replace(/<\/script>$/u, '')
    expect(() => new Function(code)).not.toThrow()
  })

  it('卡片版的字号就是画布上步骤卡片的字号（标题 = 卡片标题，正文 = 卡片说明）', () => {
    const shell = readFileSync(
      new URL('../../src/client/ui/shell.module.css', import.meta.url),
      'utf8',
    )
    const canvas = readFileSync(
      new URL('../../src/client/ui/canvas.module.css', import.meta.url),
      'utf8',
    )
    const px = (name: string) =>
      Number(new RegExp(String.raw`--wl-fs-${name}: (\d+)px`, 'u').exec(shell)?.[1])
    const rule = (name: string) =>
      new RegExp(String.raw`\.${name} \{[^}]*font-size: var\(--wl-fs-(\w+)\)`, 'u').exec(
        canvas,
      )?.[1]
    expect(BOARD_CARD_FONT.title).toBe(px(rule('cardTitle') ?? ''))
    expect(BOARD_CARD_FONT.body).toBe(px(rule('cardBody') ?? ''))
    expect(BOARD_TEMPLATE).toContain(`font-size: calc(${BOARD_CARD_FONT.body}px * var(--k, 1))`)
  })
})
