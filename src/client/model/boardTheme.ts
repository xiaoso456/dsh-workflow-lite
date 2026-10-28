/**
 * dsh-workflow-lite — 画布主题 → 看板的 `--board-*` 变量（约定见 shared/board.ts）。
 *
 * 框里的页面是独立的源，`light-dark()` 拼出来的 `--wl-*` 进不去，所以按此刻的亮暗挑出那一套主题，写成实值。
 * 字体从视图根读（宿主的字体、瑞士的 Helvetica 系），读不到用系统字体。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/boardTheme
 */

import { type BoardTheme, type BoardToken, boardVar } from '../../shared/board.ts'
import { THEMES, type ThemeId, type ThemeLook, type ThemeMode } from './themes.ts'

export const BOARD_FONT = `system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`
export const BOARD_MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

export function boardTheme(
  mode: ThemeMode,
  id: ThemeId,
  options: { look?: ThemeLook | undefined; font?: string | undefined } = {},
): BoardTheme {
  const t = THEMES[id]
  const values: Record<BoardToken, string> = {
    bg: t.panel,
    surface: t.fill,
    line: `rgb(${t.ink} / ${t.lineStrongAlpha}%)`,
    text: t.text,
    muted: t.text2,
    subtle: t.text3,
    accent: t.accent,
    'on-accent': t.accentOn,
    ok: t.ok,
    warn: t.warn,
    bad: t.danger,
    c1: t.cBlue,
    c2: t.cGreen,
    c3: t.cAmber,
    c4: t.cCoral,
    c5: t.cTeal,
    c6: t.cViolet,
    radius: options.look === 'swiss' ? '0px' : '10px',
    font: options.font === undefined || options.font.trim() === '' ? BOARD_FONT : options.font,
    mono: BOARD_MONO,
  }
  const vars: Record<string, string> = {}
  for (const [token, value] of Object.entries(values)) vars[boardVar(token as BoardToken)] = value
  return { scheme: mode, vars }
}
