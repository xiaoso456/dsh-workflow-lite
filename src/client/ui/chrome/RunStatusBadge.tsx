/**
 * dsh-workflow-lite — 实例的整体状态：状态名的文案表与状态小标。
 *
 * 实例视图的顶栏与右栏、草稿栏，工作流中心的实例列表与改状态菜单都用它，
 * 放在 chrome/，让工作流中心不必回头 import 实例视图的顶栏。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/chrome/RunStatusBadge
 */

import type { RunStatus } from '../../../shared/runState.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { Icon } from '../kit/Icon.tsx'
import { SwapText } from '../motion/swapText.tsx'
import shared from './runStatus.module.css'

export const RUN_STATUS_TEXT: Record<RunStatus, LocaleKey> = {
  pending: 'run.overall.pending',
  running: 'run.overall.running',
  waiting: 'run.overall.waiting',
  done: 'run.overall.done',
  failed: 'run.overall.failed',
  cancelled: 'run.overall.cancelled',
}

/** 实例的状态小标。 */
export function RunStatusBadge(props: {
  t: T
  status: RunStatus | undefined
  problem?: 'missing' | 'invalid' | undefined
  /** 这个实例不记运行状态（没有状态文件）。 */
  untracked?: boolean
}): React.JSX.Element {
  const { t } = props
  if (props.untracked === true) {
    return (
      <span
        className={shared.status}
        data-glide=""
        data-run-status="untracked"
        data-testid="wl-run-status"
      >
        <span className={shared.dot} />
        {t('run.untracked')}
      </span>
    )
  }
  if (props.problem !== undefined || props.status === undefined) {
    return (
      <span className={shared.status} data-glide="" data-run-status="failed">
        <Icon name="alert" size={11} />
        {t(props.problem === 'missing' ? 'run.stateMissing' : 'run.stateInvalid')}
      </span>
    )
  }
  return (
    <span
      className={shared.status}
      data-glide=""
      data-run-status={props.status}
      data-testid="wl-run-status"
    >
      <span className={shared.dot} />
      <SwapText text={t(RUN_STATUS_TEXT[props.status])} />
    </span>
  )
}
