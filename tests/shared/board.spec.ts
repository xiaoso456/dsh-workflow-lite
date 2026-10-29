import { describe, expect, it } from 'vitest'
import { BOARD_STYLE } from '../../src/host/boardSkill.ts'
import { BOARD_CARD, boardCardRoom, usesBoardTheme } from '../../src/shared/board.ts'
import { VIEW_SIZES } from '../../src/shared/display.ts'

describe('看板卡片版放得下多少', () => {
  it('网页的三档预设：小卡只有主栏，中、大左右两栏；中档一栏放得下四行指标行', () => {
    const [s, m, l] = (['s', 'm', 'l'] as const).map((size) => {
      const [w, h] = VIEW_SIZES.html[size]
      return boardCardRoom(w, h)
    })
    expect(s).toMatchObject({ small: true, columns: 1 })
    expect(m).toMatchObject({ small: false, columns: 2, stats: 4 })
    expect(l).toMatchObject({ small: false, columns: 2 })
    expect(l.stats).toBeGreaterThan(m.stats)
  })

  it('行数 = 主体高能排下几行（最后一行不带行距）', () => {
    const room = boardCardRoom(320, 176)
    const { stats, list } = BOARD_CARD
    expect(room.height).toBe(176 - 10 - 12 - 20 - 10)
    expect(room.stats * stats.row + (room.stats - 1) * stats.gap).toBeLessThanOrEqual(room.height)
    expect((room.stats + 1) * stats.row + room.stats * stats.gap).toBeGreaterThan(room.height)
    expect(room.list * list.row + (room.list - 1) * list.gap).toBeLessThanOrEqual(room.height)
  })

  it('竖长：单栏上下排', () => {
    expect(boardCardRoom(224, 320)).toMatchObject({ small: false, columns: 1, width: 200 })
  })
})

describe('页面跟不跟画布主题', () => {
  it('看板模板用了 --board-* 变量；自己写死颜色的页面、只是提到变量名的文字不算', () => {
    expect(usesBoardTheme(BOARD_STYLE)).toBe(true)
    expect(usesBoardTheme('<style>body{color:var( --board-text, #222)}</style>')).toBe(true)
    expect(usesBoardTheme('<style>body{background:#fff;color:#222}</style>')).toBe(false)
    expect(usesBoardTheme('<p>主题变量叫 --board-bg</p>')).toBe(false)
  })
})
