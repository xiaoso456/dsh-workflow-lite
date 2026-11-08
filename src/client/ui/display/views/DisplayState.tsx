/**
 * dsh-workflow-lite — 展示区的占位与读不了的说明：居中一枚图标、一两行字。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/DisplayState
 */

import { Icon, type IconName } from '../../kit/Icon.tsx'
import css from './displayState.module.css'

/** 占位与读不了的说明：居中一枚图标、一两行字。 */
export function DisplayState(props: {
  icon: IconName
  title: string
  sub?: string
  tone?: 'wait' | 'error'
  /** 写它的步骤正在跑：边上有一道光在走。 */
  busy?: boolean
}): React.JSX.Element {
  return (
    <div
      className={css.state}
      data-tone={props.tone ?? 'wait'}
      data-busy={props.busy === true || undefined}
      data-testid="wl-display-state"
    >
      <span className={css.stateIcon}>
        <Icon name={props.icon} size={18} />
      </span>
      <span className={css.stateTitle}>{props.title}</span>
      {props.sub !== undefined && props.sub !== '' && (
        <span className={css.stateSub}>{props.sub}</span>
      )}
    </div>
  )
}
