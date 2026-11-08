/**
 * dsh-workflow-lite — 展示区里的网页：沙箱 iframe，按「大小」排版、按缩放整张等比缩放。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/HtmlView
 */

import { useRef } from 'react'
import { usesBoardTheme } from '../../../../shared/board.ts'
import type { Display } from '../../../model/display.ts'
import { useBoardFrame } from '../boardFrame.ts'
import css from '../display.module.css'

/** 网页：按「大小」排版，再按缩放整张等比缩放（像图片一样，排版不变）。页面是看板的卡片版（`data-board="card"`），带画布主题。 */
export function HtmlView(props: {
  name: string
  text: string
  display: Display
  interactive: boolean
}): React.JSX.Element {
  const scale = props.display.zoom / 100
  const frame = useRef<HTMLIFrameElement>(null)
  // 透明只给看板：用了 `--board-*` 变量的页面跟着画布配色；别的网页多半写死了白底黑字（或者黑底白字），
  // 透出画布来就看不清了，留着自己的底。
  const clear =
    props.display.adapt &&
    props.display.look !== undefined &&
    props.display.look !== 'card' &&
    usesBoardTheme(props.text)
  // 没进交互时不画滚动条：卡片是静止的一张图，滚动条只是噪音；进了交互（能滚了）再显示。
  const board = useBoardFrame(frame, props.text, 'card', clear, !props.interactive)
  return (
    <iframe
      ref={frame}
      className={css.frame}
      title={props.name}
      srcDoc={board.srcDoc}
      onLoad={board.onLoad}
      // 只给脚本：没有 allow-same-origin，页面是个独立的源，读不到画布的存储与登录态，也跳不走顶层。
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      tabIndex={props.interactive ? 0 : -1}
      style={{
        width: props.display.width,
        height: props.display.height,
        transform: `scale(${scale})`,
        colorScheme: board.scheme,
      }}
      data-clear={clear || undefined}
      data-testid="wl-display-frame"
    />
  )
}
