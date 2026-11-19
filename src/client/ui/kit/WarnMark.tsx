/**
 * dsh-workflow-lite — 名字旁边的一个告警图标：设了的东西在这台机器上用不了。
 *
 * 和「?」说明同一个浮层（{@link HelpTip}，`tone="warn"`）：悬停 / 聚焦 / 点击浮出，标题是这一项的名字，
 * 下面一条一句写原因和怎么办。只是提醒，不挡操作。
 *
 * 一直挂着：`lines` 没有时藏起来（缩回、淡掉，不能聚焦），有了再弹出来；不插拔，所在那一行不跳。
 * 藏着的那一刻浮层里还是上一回的话，退场时不会变空。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/WarnMark
 */

import { useRef } from 'react'
import { HelpTip } from './HelpTip.tsx'
import shared from './ui.module.css'
import css from './warnMark.module.css'

export function WarnMark(props: {
  title: string
  /** 一条一句；没有 = 没事（图标藏起来）。 */
  lines: readonly string[] | undefined
  testId?: string
}): React.JSX.Element {
  const last = useRef<readonly string[]>([])
  if (props.lines !== undefined) last.current = props.lines
  const lines = last.current
  return (
    <span className={css.mark} data-on={props.lines !== undefined || undefined}>
      <HelpTip
        label={lines.join(' ')}
        tone="warn"
        {...(props.testId === undefined ? {} : { testId: props.testId })}
      >
        <p className={shared.hintTitle}>{props.title}</p>
        <ul className={shared.hintList}>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </HelpTip>
    </span>
  )
}
