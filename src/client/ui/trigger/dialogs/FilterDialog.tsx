/**
 * dsh-workflow-lite — 「过滤」对话框：合并、去重、关键字（草稿，「保存」才写进图）。只有轮询、监听、HTTP 有。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/dialogs/FilterDialog
 */

import { useState } from 'react'
import { readTriggerData } from '../../../../shared/trigger.ts'
import type { TriggerData, TriggerFilter } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import ins from '../../panel/panel.module.css'
import { FilterForm } from '../FilterField.tsx'
import { TriggerMark } from '../TriggerMark.tsx'
import { AsideBlock, TriggerSheet } from './TriggerSheet.tsx'

export function FilterDialog(props: {
  t: T
  name: string
  data: TriggerData
  onSave(filter: TriggerFilter | undefined): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const [filter, setFilter] = useState<TriggerFilter | undefined>(props.data.filter)
  // 比规范化之后的：打了又删回缺省值不算改过。
  const normal = (value: TriggerFilter | undefined): string =>
    JSON.stringify(readTriggerData({ ...props.data, filter: value }).filter ?? null)
  const dirty = normal(filter) !== normal(props.data.filter)
  return (
    <TriggerSheet
      t={t}
      title={t('trigger.filter')}
      sub={props.name}
      mark={<TriggerMark kind={props.data.source.kind} size={16} />}
      testId="wl-trigger-filter-dialog"
      wide
      dirty={dirty}
      canSave
      onSave={() => {
        if (dirty) props.onSave(readTriggerData({ ...props.data, filter }).filter)
        props.onClose()
      }}
      onClose={props.onClose}
      aside={
        <AsideBlock title={t('trigger.about')}>
          <p className={ins.help}>{t('trigger.filterHint')}</p>
        </AsideBlock>
      }
    >
      <FilterForm t={t} data={{ ...props.data, filter }} onFilter={setFilter} />
    </TriggerSheet>
  )
}
