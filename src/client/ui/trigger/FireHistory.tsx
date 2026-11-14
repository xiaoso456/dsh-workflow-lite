/**
 * dsh-workflow-lite — 一张触发卡片的全部触发记录：顶上按结果筛选（各类带条数），下面按天分组的列表。
 *
 * 工作流中心「触发」页的右栏用；画布面板里只列最近几条，不筛选（`TriggerStatus.tsx` 直接用 `FireList`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/FireHistory
 */

import { useState } from 'react'
import type { FireRecord, TriggerDetailResponse } from '../../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { countFires, FIRE_KINDS, type FireKind, fireKind } from '../../model/fireView.ts'
import { Segmented } from '../kit/Segmented.tsx'
import { FireList } from './FireList.tsx'
import css from './fires.module.css'

/** 框里露出几行。 */
const ROWS = 12

type Filter = 'all' | FireKind

/** 筛选格上的短名（「模型判断不需要」在这里写「不需要」）。 */
const FILTER_TEXT: Record<Filter, LocaleKey> = {
  all: 'trigger.fire.all',
  sent: 'trigger.outcome.sent',
  skipped: 'trigger.outcome.skipped',
  failed: 'trigger.outcome.failed',
  declined: 'trigger.fire.declinedShort',
}

/** 和列表里圆点同色（fires.module.css）。 */
const FILTER_COLOR: Record<FireKind, string> = {
  sent: 'var(--wl-ok-dot)',
  skipped: 'var(--wl-text-3)',
  failed: 'var(--wl-danger)',
  declined: 'var(--wl-c-slate)',
}

export function FireHistory(props: {
  t: T
  /** 还没读到是 `null`。 */
  fires: readonly FireRecord[] | null
  detail(fire: string): Promise<TriggerDetailResponse>
  onOpenRun(instance: string): void
}): React.JSX.Element | null {
  const { t, fires } = props
  const [filter, setFilter] = useState<Filter>('all')
  if (fires === null || fires.length === 0) {
    return (
      <FireList t={t} fires={fires} rows={ROWS} detail={props.detail} onOpenRun={props.onOpenRun} />
    )
  }
  const counts = countFires(fires)
  const shown = filter === 'all' ? fires : fires.filter((record) => fireKind(record) === filter)
  return (
    <div className={css.history}>
      <Segmented<Filter>
        label={t('trigger.fire.filter')}
        value={filter}
        options={[
          { value: 'all', label: t(FILTER_TEXT.all), count: fires.length },
          ...FIRE_KINDS.map((kind) => ({
            value: kind,
            label: t(FILTER_TEXT[kind]),
            color: FILTER_COLOR[kind],
            count: counts[kind],
          })),
        ]}
        testId="wl-trigger-fire-filter"
        onChange={setFilter}
      />
      <FireList
        t={t}
        fires={shown}
        empty={t('trigger.fire.noneOfKind')}
        days
        rows={ROWS}
        detail={props.detail}
        onOpenRun={props.onOpenRun}
      />
    </div>
  )
}
