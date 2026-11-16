/**
 * dsh-workflow-lite — 工作流中心「工作流」页左边的一行：点它在右栏看这张（标签、版本、改名、删除都在右栏）。
 *
 * 一行是 {@link HubRow}：名字；第二行有标签就只写标签（最多两个和「+N」），没有标签才写步数、版本数
 * （步数、版本数、修改时间都在右栏标题下面，左栏不挤）；紧凑时行尾是标签的色块，没有标签写步数。
 * 画布上正开着的那张名字后面写「当前」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/workflows/WorkflowRow
 */

import type { WorkflowEntry } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import hub from '../hub.module.css'
import { HubRow, rowMark } from '../list/HubRow.tsx'
import type { TagColors } from './TagMark.tsx'
import { RowTagDots, RowTags } from './Tags.tsx'
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
  const tags = entry.tags ?? []
  return (
    <HubRow
      flip={props.flipKey}
      selected={props.selected}
      current={props.selected || props.also}
      testId="wl-hub-wf"
      value={entry.name}
      // 读不出来的是珊瑚色的警示。
      mark={
        <span className={cx(ui.kind, rowMark)} data-color={invalid ? 'coral' : 'blue'}>
          <Icon name={invalid ? 'alert' : 'hub'} size={15} />
        </span>
      }
      name={entry.name}
      // 画布上正开着的那张：名字后面「当前」（和「运行实例」页本会话当前的实例同一个签）。
      badge={
        props.open && (
          <span className={hub.tag} data-tip={t('hub.wfEditing')}>
            {t('hub.current')}
          </span>
        )
      }
      meta={
        tags.length > 0 ? (
          <RowTags tags={tags} colors={props.colors} />
        ) : (
          <span className={css.metaText}>{facts}</span>
        )
      }
      end={
        tags.length > 0 ? (
          <RowTagDots tags={tags} colors={props.colors} />
        ) : (
          t('ver.steps').replace('{n}', String(entry.nodeCount))
        )
      }
      tip={[entry.name, tags.length > 0 ? tags.join('、') : facts].join(' · ')}
      onPick={props.onPick}
    />
  )
}
