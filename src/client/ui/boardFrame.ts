/**
 * dsh-workflow-lite — 网页框带上看板的主题：卡片里、查看框里的 HTML 都由这里拼 `srcdoc`。
 *
 * `srcdoc` 只跟着页面内容和模式变：换主题时不重载页面（重载会闪一下、丢掉页面里的状态），
 * 而是经 `postMessage` 把新的变量发进去；框加载完再补发一次，接住拼好之后到加载完之间换的主题。
 * 主题由视图根（WorkflowView）放进 {@link BoardThemeContext}；没有时只补滚动条，不标模式。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/boardFrame
 */

import {
  createContext,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'
import { BOARD_THEME_MESSAGE, type BoardMode, type BoardTheme } from '../../shared/board.ts'
import { withPreviewStyle } from '../model/htmlPreview.ts'

export const BoardThemeContext = createContext<BoardTheme | null>(null)

export function useBoardFrame(
  frame: RefObject<HTMLIFrameElement | null>,
  text: string,
  mode: BoardMode,
): { srcDoc: string; onLoad: () => void } {
  const theme = useContext(BoardThemeContext)
  const latest = useRef(theme)
  latest.current = theme
  const srcDoc = useMemo(() => {
    const current = latest.current
    return withPreviewStyle(text, current === null ? undefined : { mode, theme: current })
  }, [text, mode])
  const send = useCallback(() => {
    const current = latest.current
    if (current === null) return
    // 框是独立的源（origin 是 "null"），只能发给 '*'；里面的脚本只认父窗口发来的这一种消息。
    frame.current?.contentWindow?.postMessage({ type: BOARD_THEME_MESSAGE, ...current }, '*')
  }, [frame])
  // 主题变了就发（send 读的是最新的那份）。
  useEffect(() => {
    send()
  }, [theme, send])
  return { srcDoc, onLoad: send }
}
