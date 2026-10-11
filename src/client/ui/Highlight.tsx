/**
 * dsh-workflow-lite — 搜索命中的那几个字：加粗、换成强调色，不加底色（行的悬停 / 选中底色已经够多了）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Highlight
 */

import { matchRange } from '../model/switcherSearch.ts'
import ui from './ui.module.css'

/** `needle` 是已归一的搜索词（见 `normalizeNeedle`）；空 = 原样输出。 */
export function Highlight(props: { text: string; needle: string }): React.JSX.Element {
  const range = matchRange(props.text, props.needle)
  if (range === null) return <>{props.text}</>
  const [from, to] = range
  return (
    <>
      {props.text.slice(0, from)}
      <mark className={ui.hit}>{props.text.slice(from, to)}</mark>
      {props.text.slice(to)}
    </>
  )
}
