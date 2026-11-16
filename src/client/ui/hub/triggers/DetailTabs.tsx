/**
 * dsh-workflow-lite — 「触发」页右栏的四个页签：概览、时间线、按触发方式换名字的那一页（输出 / 调用 / 日程 / 上游）、设置。
 *
 * 时间线上写着有几条记录，有没看过的失败时旁边一个红点。样子和键盘走法见 {@link PaneTabs}。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/DetailTabs
 */

import type { TriggerSourceKind } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { PaneTabs } from '../pane/PaneTabs.tsx'

export type DetailTab = 'overview' | 'timeline' | 'live' | 'settings'
export const DETAIL_TABS: readonly DetailTab[] = ['overview', 'timeline', 'live', 'settings']

/** 第三页按触发方式叫什么。 */
const LIVE_NAME: Record<TriggerSourceKind, LocaleKey> = {
  schedule: 'hub.trgTab.schedule',
  poll: 'hub.trgTab.output',
  listen: 'hub.trgTab.output',
  http: 'hub.trgTab.call',
  after: 'hub.trgTab.upstream',
}

export function DetailTabs(props: {
  t: T
  kind: TriggerSourceKind
  value: DetailTab
  /** 时间线上的记录条数（还没读到不写）。 */
  count: number | undefined
  /** 有还没看过的失败（时间线页签上亮红点）。 */
  failed: boolean
  onChange(tab: DetailTab): void
}): React.JSX.Element {
  const { t } = props
  return (
    <PaneTabs
      label={t('hub.trgTabs')}
      testId="wl-hub-trg-tab"
      value={props.value}
      onChange={props.onChange}
      tabs={DETAIL_TABS.map((tab) =>
        tab === 'timeline'
          ? {
              id: tab,
              label: t('hub.trgTab.timeline'),
              count: props.count,
              dot: { on: props.failed, label: t('hub.trgFailedDot') },
            }
          : {
              id: tab,
              label:
                tab === 'live' ? t(LIVE_NAME[props.kind]) : t(`hub.trgTab.${tab}` as LocaleKey),
            },
      )}
    />
  )
}
