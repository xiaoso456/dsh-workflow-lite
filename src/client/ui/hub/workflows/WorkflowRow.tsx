/**
 * dsh-workflow-lite — 工作流中心「工作流」页左边的一行：点它在右栏看这张（标签、版本、改名、删除都在右栏）。
 *
 * 图标块 + 两行字：名字；第二行有标签就只写标签（最多两个和「+N」），没有标签才写步数、版本数
 * （步数、版本数、修改时间都在右栏标题下面，左栏不挤）。画布上正开着的那张名字后面写「当前」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/workflows/WorkflowRow
 */

import type { WorkflowEntry } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import wf from '../../versions/wfList.module.css'
import hub from '../hub.module.css'
import list from '../list/groupedList.module.css'
import type { TagColors } from './TagMark.tsx'
import { RowTags } from './Tags.tsx'
import css from './wfRow.module.css'

export interface WorkflowRowProps {
  t: T
  entry: WorkflowEntry
  colors: TagColors
  /** 列表动画认的键（改过名的行沿用旧键，见 model/rowKeys.ts；同一张在别的组里再出现时加上组的键）。 */
  flipKey: string
  /** 右边正显示这张（选中底块在这一行下面）。 */
  selected: boolean
  /** 右边正显示这张，选中底块在它的另一个组里。 */
  also: boolean
  /** 编辑页正开着这张。 */
  open: boolean
  onPick(): void
}

export function WorkflowRow(props: WorkflowRowProps): React.JSX.Element {
  const { t, entry } = props
  const invalid = entry.invalid === true
  const facts = [
    t('ver.steps').replace('{n}', String(entry.nodeCount)),
    ...((entry.versions ?? 0) > 0 ? [t('ver.count').replace('{n}', String(entry.versions))] : []),
  ].join(' · ')
  return (
    <div
      className={wf.wfRow}
      data-end="none"
      data-flip={props.flipKey}
      data-selected={props.selected}
    >
      <button
        type="button"
        aria-current={props.selected || props.also ? 'true' : undefined}
        className={cx(wf.wfItem, list.item)}
        data-testid="wl-hub-wf"
        data-value={entry.name}
        onClick={props.onPick}
      >
        {/* 读不出来的是珊瑚色的警示。 */}
        <span className={cx(ui.kind, list.mark)} data-color={invalid ? 'coral' : 'blue'}>
          <Icon name={invalid ? 'alert' : 'hub'} size={15} />
        </span>
        <span className={wf.wfText}>
          {/* 画布上正开着的那张：名字后面「当前」（和「运行实例」页本会话当前的实例同一个签）。 */}
          <span className={css.nameLine}>
            <span className={wf.wfName}>{entry.name}</span>
            {props.open && (
              <span className={hub.tag} data-tip={t('hub.wfEditing')}>
                {t('hub.current')}
              </span>
            )}
          </span>
          <span className={cx(wf.wfMeta, css.meta)}>
            {(entry.tags ?? []).length > 0 ? (
              <RowTags tags={entry.tags ?? []} colors={props.colors} />
            ) : (
              <span className={css.metaText}>{facts}</span>
            )}
          </span>
        </span>
      </button>
    </div>
  )
}
