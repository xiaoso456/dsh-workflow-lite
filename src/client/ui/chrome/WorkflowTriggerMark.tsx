/**
 * dsh-workflow-lite — 工作流名字后面的小闪电：有几张触发卡片开着、是不是全部暂停着、有没有没看过的失败
 * （怎么算见 `model/workflowTriggerMarks.ts`）。悬停说一句。
 *
 * 开着几张、红点亮不亮都只换字和属性；记号本身在有了要标的东西时才挂上（下拉打开后读回来那一下，不在热路径上），挂上时淡入。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/chrome/WorkflowTriggerMark
 */

import type { T } from '../../i18n.ts'
import {
  type WorkflowTriggerMark as Mark,
  workflowTriggerTip,
} from '../../model/workflowTriggerMarks.ts'
import { Icon } from '../kit/Icon.tsx'
import css from './workflowTriggerMark.module.css'

export function WorkflowTriggerMark(props: { t: T; mark: Mark }): React.JSX.Element {
  const { t, mark } = props
  return (
    <span
      className={css.mark}
      data-tone={mark.on === 0 || mark.paused ? 'quiet' : 'on'}
      data-tip={workflowTriggerTip(t, mark)}
      data-testid="wl-wf-trigger-mark"
    >
      <Icon name="bolt" size={12} />
      {mark.on > 1 && <span className={css.count}>{mark.on}</span>}
      <i className={css.dot} data-on={mark.unseen} aria-hidden="true" />
    </span>
  )
}
