/**
 * dsh-workflow-lite — 排队的记号：沙漏 + 数字（或「排队 3 个」），强调色的字，不加底色块；悬停写「3 个在排队，等上一次跑完」。
 *
 * 画布卡片的底行、面板的状态行、工作流中心「触发」页的左栏和状态条共用。一直挂着、没有排着的时候藏起来（`hidden`）：
 * 个数跟着轮询变，只换字和属性，不插拔元素。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/QueueMark
 */

import type { T } from '../../i18n.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import css from './queueMark.module.css'

export function QueueMark(props: {
  t: T
  /** 排着几个；0 时藏起来。 */
  count: number
  /** 写成「排队 3 个」（缺省只写数字）。 */
  label?: boolean
  className?: string
  testId?: string
}): React.JSX.Element {
  const { t, count } = props
  const n = String(count)
  return (
    <span
      className={cx(css.queue, props.className)}
      hidden={count === 0}
      data-tip={count === 0 ? undefined : t('trigger.queuedTip').replace('{n}', n)}
      data-testid={props.testId}
    >
      <Icon name="hourglass" size={11} />
      {/* 藏着时不留字：读整张卡片文字的地方（悬停提示、测试）不会读到「排队 0 个」。 */}
      {count === 0 ? '' : props.label === true ? t('trigger.queued').replace('{n}', n) : n}
    </span>
  )
}
