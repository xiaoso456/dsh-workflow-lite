/**
 * dsh-workflow-lite — 输出里的一行字：标准输出里 `::trigger::` 开头的是事件（见 `shared/triggerMark.ts`），
 * 标记画成一枚强调色的小签、悬停说「这一行会触发」，后面是它带的背景信息；别的行原样，是日志。
 *
 * 两个 span 一直挂着、只换 `hidden` 和文字：「最近的输出」里行按位置挂着，新行进来只换字，不插拔元素
 * （宿主页面的 `:has` 规则让任何插拔都是整页重算样式，见 `client/PERFORMANCE.md`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/output/EventText
 */

import { markParts } from '../../../../shared/triggerMark.ts'
import type { T } from '../../../i18n.ts'
import css from './eventText.module.css'

/** 这一行是不是事件（只看标准输出）。 */
export function isEventLine(stream: 'out' | 'err' | undefined, text: string): boolean {
  return stream === 'out' && markParts(text) !== null
}

export function EventText(props: {
  t: T
  stream: 'out' | 'err' | undefined
  text: string
  className?: string | undefined
}): React.JSX.Element {
  const parts = props.stream === 'out' ? markParts(props.text) : null
  return (
    <span className={props.className} data-s={props.stream}>
      <span
        className={css.mark}
        hidden={parts === null}
        data-tip={parts === null ? undefined : props.t('out.eventTip')}
      >
        {parts?.mark ?? ''}
      </span>
      {parts === null ? props.text : parts.rest}
    </span>
  )
}
