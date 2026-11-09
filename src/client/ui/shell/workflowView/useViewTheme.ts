/**
 * dsh-workflow-lite — 视图的配色：主题选择、根节点上的变量、「形」（瑞士等）、画布上网页看板用的主题。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useViewTheme
 */

import { useLayoutEffect, useMemo, useState } from 'react'
import { useColorScheme, useThemeChoice } from '../../../app/theme.ts'
import { boardTheme } from '../../../model/boardTheme.ts'
import { themeLook, themeStyle } from '../../../model/themes.ts'

export interface ViewThemeInput {
  /** 视图根（取它算出来的字体）。 */
  rootRef: React.RefObject<HTMLDivElement>
}

export function useViewTheme({ rootRef }: ViewThemeInput) {
  /** 配色主题（工作流中心「设置」里挑）：亮、暗各一套，写成根节点上的两组变量。 */
  const theme = useThemeChoice()
  const themeVars = useMemo(
    () => themeStyle(theme.light, theme.dark) as React.CSSProperties,
    [theme.light, theme.dark],
  )
  /** 瑞士这类连「形」（直角、无阴影、字体）也带着的主题，要知道此刻是亮还是暗。 */
  const scheme = useColorScheme()
  const look = themeLook(scheme, theme.light)
  /** 看板（画布上的网页）用的主题变量：此刻那一套的实值，字体照视图根上算出来的。 */
  const [font, setFont] = useState<string | undefined>(undefined)
  // 换了「形」（瑞士换字体）要重读。
  useLayoutEffect(() => {
    if (rootRef.current !== null) setFont(getComputedStyle(rootRef.current).fontFamily)
  }, [look])
  const board = useMemo(
    () => boardTheme(scheme, scheme === 'light' ? theme.light : theme.dark, { look, font }),
    [scheme, theme.light, theme.dark, look, font],
  )
  return { theme, themeVars, look, board }
}
