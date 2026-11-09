/**
 * dsh-workflow-lite — 概览的右栏标题栏与图标块。
 *
 * 实例右栏的「概览」和顶栏「在看什么」共用图标块（{@link OverviewMark}）；
 * 其余几种标题栏在 `panel/NodeHeads.tsx`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/OverviewHead
 */

import { Icon } from '../kit/Icon.tsx'
import type { HeadProps } from '../panel/NodeHeads.tsx'
import { PanelHead } from '../panel/PanelHead.tsx'
import panel from '../panel/panel.module.css'
import run from './run.module.css'

/** 概览的图标块（右栏标题栏与顶栏「在看什么」共用）。 */
export function OverviewMark(): React.JSX.Element {
  return (
    <span className={run.navOverview}>
      <Icon name="overview" size={15} />
    </span>
  )
}

export function OverviewHead(props: HeadProps): React.JSX.Element {
  const { t } = props
  return (
    <PanelHead
      t={t}
      lead={<OverviewMark />}
      title={<span className={panel.headTitle}>{t('run.overview')}</span>}
      extra={props.extra}
      onClose={props.onClose}
      closeTestId={props.closeTestId}
    />
  )
}
