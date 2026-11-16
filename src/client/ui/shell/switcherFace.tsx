/**
 * dsh-workflow-lite — 顶栏切换工作流的下拉里，一行工作流除了名字还写什么（和工作流中心「工作流」页的行一个规矩）。
 *
 * - 紧凑：行尾跟着排序走——按最近修改排写修改时间，按名称排写标签色块（没有标签写步数）。
 * - 标准：名字下面一行，有标签写标签片，没有写步数；行尾空着（悬停时那里出改名、删除）。
 *
 * 读不出来的那张只写「无法读取」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/switcherFace
 */

import type { WorkflowEntry } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import { pastTime } from '../../model/time.ts'
import type { WorkflowSortBy } from '../../model/workflowList.ts'
import type { TagColors } from '../hub/workflows/TagMark.tsx'
import { RowTagDots, RowTags } from '../hub/workflows/Tags.tsx'

export interface SwitcherRowFace {
  /** 标准行高的第二行；紧凑时不给。 */
  sub?: React.ReactNode
  /** 行尾那一格（悬停时让给改名、删除两个按钮）。 */
  end: React.ReactNode
}

export function workflowFace(
  t: T,
  entry: WorkflowEntry,
  options: { sort: WorkflowSortBy; standard: boolean; colors: TagColors; now: number },
): SwitcherRowFace {
  if (entry.invalid === true) {
    return options.standard ? { sub: t('wf.broken'), end: null } : { end: t('wf.broken') }
  }
  const tags = entry.tags ?? []
  const steps = `${entry.nodeCount} ${t('wf.steps')}`
  if (options.standard) {
    return {
      sub: tags.length > 0 ? <RowTags tags={tags} colors={options.colors} /> : steps,
      end: null,
    }
  }
  if (options.sort === 'recent') return { end: pastTime(t, entry.updatedAt, options.now) }
  return { end: tags.length > 0 ? <RowTagDots tags={tags} colors={options.colors} /> : steps }
}
