/**
 * dsh-workflow-lite — 「运行实例」页左栏的一行：状态图标块（颜色跟状态走）、工作流名（本会话当前的实例带「当前」）、
 * 「状态 · 进度 · 建立时间」。会话、工作区写在右栏标题下面，左栏不挤。
 *
 * 点它在右栏看这个实例；查看、移到本会话、删除都在右栏（和「工作流」「记忆」页一样，左栏只是列表）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/RunItem
 */

import type { InstanceSummary } from '../../../../shared/runState.ts'
import type { T } from '../../../i18n.ts'
import { isActive } from '../../../model/runList.ts'
import { tipWhenCut } from '../../kit/cutTip.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import wf from '../../versions/wfList.module.css'
import hub from '../hub.module.css'
import list from '../list/groupedList.module.css'
import { runIcon, runProgress, runStatusText, runTone } from './runFace.ts'
import css from './runs.module.css'

export function RunItem(props: {
  t: T
  item: InstanceSummary
  /** 动画键（见 GroupedList 的 RowAt）。 */
  flip: string
  selected: boolean
  /** 状态后面那半句（建立时间）。 */
  note: string
  onPick(): void
}): React.JSX.Element {
  const { t, item } = props
  const status = runStatusText(t, item)
  // 进度只给还在进行的写：结束了的看状态就够，省下地方给后半句。
  const progress = isActive(item) ? runProgress(item) : undefined
  const full = [item.workflow, status, progress, props.note].filter(Boolean).join(' · ')
  return (
    <div
      className={wf.wfRow}
      data-end="none"
      data-flip={props.flip}
      data-selected={props.selected}
      data-testid="wl-hub-row"
      data-id={item.id}
    >
      <button
        type="button"
        aria-current={props.selected ? 'true' : undefined}
        className={cx(wf.wfItem, list.item)}
        data-testid="wl-hub-run"
        data-value={item.id}
        onPointerOverCapture={(event) =>
          tipWhenCut(
            event.currentTarget,
            [...event.currentTarget.querySelectorAll<HTMLElement>('[data-cut]')],
            full,
            'start',
          )
        }
        onClick={props.onPick}
      >
        <span className={cx(ui.kind, list.mark, css.mark)} data-run-status={runTone(item)}>
          <Icon name={runIcon(item)} size={15} />
        </span>
        <span className={wf.wfText}>
          <span className={css.nameLine}>
            <span className={wf.wfName} data-cut="">
              {item.workflow}
            </span>
            {item.current && (
              <span className={hub.tag} data-tip={t('run.current')}>
                {t('hub.current')}
              </span>
            )}
          </span>
          <span className={css.meta} data-run-status={runTone(item)}>
            <span className={css.dot} aria-hidden="true" />
            <span className={css.stateText}>{status}</span>
            {progress !== undefined && <span className={css.count}>{progress}</span>}
            <span className={css.note} data-cut="">
              {props.note}
            </span>
          </span>
        </span>
      </button>
    </div>
  )
}
