/**
 * dsh-workflow-lite — 面板里一块的标题：名字，后面可以跟一个「?」，右边可以再挂东西。
 *
 * 长的说明不常驻在面板里：放进「?」，悬停、聚焦或点它才浮出来（见 {@link HelpTip}）。
 * 短的、随当前选择变化的那一句（「一天都不选 = 每天」）仍写在控件下面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/panel/FieldHead
 */

import { HelpTip } from '../kit/HelpTip.tsx'
import ui from '../kit/ui.module.css'
import css from './panel.module.css'

export function FieldHead(props: {
  title: string
  /** 「?」里的说明（浮层里先重复一遍标题）；不给就没有「?」。 */
  help?: React.ReactNode
  helpTestId?: string
  /** 挂在右边的东西（计数、按钮）。 */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={css.label}>
      <span className={css.labelMain}>
        {props.title}
        {props.help !== undefined && (
          <HelpTip label={props.title} testId={props.helpTestId}>
            <p className={ui.hintTitle}>{props.title}</p>
            {props.help}
          </HelpTip>
        )}
      </span>
      {props.children}
    </div>
  )
}

/** 「?」里的一段说明文字。 */
export function HelpText(props: { children: React.ReactNode }): React.JSX.Element {
  return <p className={ui.hintText}>{props.children}</p>
}
