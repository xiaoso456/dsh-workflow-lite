/**
 * dsh-workflow-lite — 实例概览里的「来源」：这个实例是怎么发起的（画布上点的、对话里发起的、
 * 哪张触发卡片触发的），以及触发时带过来的触发说明和背景信息。
 *
 * 是几行 `<dt>/<dd>`，放进概览的那张基本信息表里。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/RunOrigin
 */

import type { OriginDetail } from '../../../shared/runState.ts'
import type { T } from '../../i18n.ts'
import { originText } from '../../model/originText.ts'
import own from './runOverview.module.css'

export function OriginRows(props: {
  t: T
  /** 旧实例没记来源：不显示。 */
  origin: OriginDetail | undefined
}): React.JSX.Element | null {
  const { t, origin } = props
  if (origin === undefined) return null
  return (
    <>
      <dt>{t('origin.title')}</dt>
      <dd data-testid="wl-run-origin" data-channel={origin.channel}>
        {originText(t, origin)}
      </dd>
      {origin.note !== undefined && origin.note !== '' && (
        <>
          <dt>{t('origin.note')}</dt>
          <dd className={own.originText} data-testid="wl-run-origin-note">
            {origin.note}
          </dd>
        </>
      )}
      {origin.info !== undefined && origin.info !== '' && (
        <>
          <dt>{t('origin.info')}</dt>
          <dd className={own.originText} data-testid="wl-run-origin-info">
            {origin.info}
          </dd>
        </>
      )}
    </>
  )
}
