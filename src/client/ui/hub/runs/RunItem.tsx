/**
 * dsh-workflow-lite — 「运行实例」页左栏的一行（{@link HubRow}）：状态图标块（颜色跟状态走）、工作流名（本会话当前的实例带「当前」）、
 * 「状态 · 进度 · 时间」；紧凑时行尾跟着排序：按时间排写那个时间，按名字排写进度（还在进行的）或时间。会话、工作区写在右栏标题下面，左栏不挤。
 *
 * 点它在右栏看这个实例；查看、移到本会话、删除都在右栏（和「工作流」「记忆」页一样，左栏只是列表）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/RunItem
 */

import type { InstanceSummary } from '../../../../shared/runState.ts'
import type { T } from '../../../i18n.ts'
import { isActive } from '../../../model/runList.ts'
import { RunKindMark, runTone } from '../../chrome/KindMark.tsx'
import hub from '../hub.module.css'
import { HubRow, rowMark } from '../list/HubRow.tsx'
import { runProgress, runStatusText } from './runFace.ts'
import css from './runs.module.css'

export function RunItem(props: {
  t: T
  item: InstanceSummary
  /** 动画键（见 GroupedList 的 RowAt）。 */
  flip: string
  selected: boolean
  /** 状态后面那半句（排序用的那个时间：建立或最近更新）。 */
  note: string
  /** 按时间排着：紧凑时行尾就写那个时间（不写进度）。 */
  sortedByTime: boolean
  onPick(): void
}): React.JSX.Element {
  const { t, item } = props
  const status = runStatusText(t, item)
  // 进度只给还在进行的写：结束了的看状态就够，省下地方给后半句。
  const progress = isActive(item) ? runProgress(item) : undefined
  return (
    <HubRow
      flip={props.flip}
      selected={props.selected}
      current={props.selected}
      testId="wl-hub-run"
      rowTestId="wl-hub-row"
      value={item.id}
      mark={<RunKindMark item={item} className={rowMark} />}
      name={item.workflow}
      badge={
        item.current && (
          <span className={hub.tag} data-tip={t('run.current')}>
            {t('hub.current')}
          </span>
        )
      }
      meta={
        <span className={css.meta} data-run-status={runTone(item)}>
          <span className={css.dot} aria-hidden="true" />
          <span className={css.stateText}>{status}</span>
          {progress !== undefined && <span className={css.count}>{progress}</span>}
          <span className={css.note} data-cut="">
            {props.note}
          </span>
        </span>
      }
      end={
        props.sortedByTime || progress === undefined ? (
          props.note
        ) : (
          <span className={css.count}>{progress}</span>
        )
      }
      tip={[item.workflow, status, progress, props.note].filter(Boolean).join(' · ')}
      onPick={props.onPick}
    />
  )
}
