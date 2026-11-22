import type { ReactNode } from 'react'
import { cx } from '../../kit/cx.ts'
import hub from '../hub.module.css'
import css from './workflowDetail.module.css'

export function WorkflowHead(props: {
  title: ReactNode
  subtitle: ReactNode
  actions: ReactNode
}): React.JSX.Element {
  const { title, subtitle, actions } = props
  return (
    <header className={cx(hub.wfHead, css.head)} data-swap-tier="0">
      <div className={hub.wfHeadText}>
        <div className={hub.nameLine}>{title}</div>
        {subtitle}
      </div>
      <div className={cx(hub.headActions, css.actions)}>{actions}</div>
    </header>
  )
}
