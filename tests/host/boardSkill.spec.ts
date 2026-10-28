import { describe, expect, it } from 'vitest'
import { boardTheme } from '../../src/client/model/boardTheme.ts'
import { BOARD_FALLBACK, BOARD_SKILL_CONTENT, BOARD_TEMPLATE } from '../../src/host/boardSkill.ts'
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
})
