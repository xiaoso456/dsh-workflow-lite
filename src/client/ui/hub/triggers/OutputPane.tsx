/**
 * dsh-workflow-lite — 「触发」页轮询、监听的「输出」：要跑的命令；一条工具条（左边上一次检查或最近一行、共几次，
 * 右边筛选与几枚图标）；下面是最近的输出——一次检查（或程序的一次运行）一行，点开看输出（见 `trigger/output/`）。
 *
 * 卡片状态一变（又检查了一次、程序重启了、打出新的一行）再读一次。只换文字，不插拔元素。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/OutputPane
 */

import { useState } from 'react'
import { commandOf } from '../../../../shared/trigger.ts'
import type { OutputFilter, TriggerEntry } from '../../../../shared/wire/trigger.ts'
import { useOutputView } from '../../../app/outputView.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { T } from '../../../i18n.ts'
import { momentText } from '../../../model/triggerText.ts'
import { OutputList } from '../../trigger/output/OutputList.tsx'
import { OutputTools } from '../../trigger/output/OutputTools.tsx'
import { outputStamp } from '../../trigger/output/outputStamp.ts'
import { useOutputLog } from '../../trigger/output/useOutputLog.ts'
import css from './live.module.css'

export function OutputPane(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  /** 「改保留行数」：到设置页。 */
  onSettings?: () => void
}): React.JSX.Element {
  const { t, hub, entry } = props
  const { view: state } = entry
  const kind = entry.data.source.kind === 'listen' ? 'listen' : 'poll'
  const command = commandOf(entry.data.source) ?? ''
  const [filter, setFilter] = useState<OutputFilter>('all')
  const [view, setView] = useOutputView(kind)
  const model = useOutputLog({
    access: hub.output(entry.workflow),
    node: state.node,
    stamp: outputStamp(state),
    filter: kind === 'poll' ? filter : 'all',
  })

  const now = Date.now()
  const lead =
    kind === 'poll'
      ? state.checked === undefined
        ? ''
        : t(state.checked.met ? 'trigger.checkedMet' : 'trigger.checkedUnmet').replace(
            '{time}',
            momentText(t, state.checked.at, now),
          )
      : state.line === undefined
        ? ''
        : `${t('hub.trgLastLine')} ${momentText(t, state.line.at, now)}`
  const total = model.data?.counts.all ?? 0
  const count =
    total === 0 ? '' : t(kind === 'poll' ? 'out.checks' : 'out.runs').replace('{n}', String(total))

  return (
    <div className={css.console} data-testid="wl-hub-trg-output">
      <div className={css.cmdline}>
        <code className={css.cmd}>{command}</code>
      </div>
      <div className={css.consoleBar}>
        <span className={css.barLead}>{lead}</span>
        <span className={css.barText} hidden={count === ''}>
          {count}
        </span>
        <OutputTools
          t={t}
          kind={kind}
          model={model}
          view={view}
          onView={setView}
          filter={filter}
          onFilter={setFilter}
          testId="wl-hub-trg-output"
        />
      </div>
      <OutputList
        t={t}
        model={model}
        view={view}
        filter={kind === 'poll' ? filter : 'all'}
        {...(props.onSettings === undefined ? {} : { onSettings: props.onSettings })}
        testId="wl-hub-trg-output-list"
      />
    </div>
  )
}
