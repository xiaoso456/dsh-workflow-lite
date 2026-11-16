/**
 * dsh-workflow-lite — 工作流中心各页左栏的分组列表：可折叠、滚动时钉在顶上的分组标题，组里一行一项。
 *
 * - 一组（标题 + 它的行）包在一块里：钉住的标题只在自己这块里钉着，下一组的标题上来时把它顶走，不叠在一起。
 *   不分组时（`by` 是 `none`）没有标题。
 * - 标题和下面的行同一套格子：前面一格和行里的图标块同宽同列，名字左边对齐，项数靠右挨着折叠箭头。
 *   标题可以带几个按钮（标签的改名、删除）：悬停时浮在项数的位置上；改名时名字那一格换成输入框（`edit`）。
 * - 一项可以出现在几组里（工作流打了几个标签）：选中底块落在点的那一组（`selectedGroup`），别处的同一项
 *   标成「也选着」（`also`），各行的动画键第一次出现用项的键，再出现加上组的键。
 * - 选中底色是一块滑块（ListThumb），换选中、筛选、换分法、折叠时各行滑到新位置（useFlip）。
 *
 * 行长什么样由页自己画（`row`，一般是 `HubRow`），这里只管分组、折叠、动效和行高（标准 / 紧凑，见
 * {@link useListDensity}：尺寸变量挂在列表上，换行高时各行滑到新位置）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/list/GroupedList
 */

import { Fragment, useRef, useState } from 'react'
import { useListDensity } from '../../../app/listDensity.ts'
import { groupId, type ListGroup } from '../../../model/listView.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import ui from '../../kit/ui.module.css'
import { useFlip } from '../../motion/flip.ts'
import { ListThumb } from '../../motion/thumb.tsx'
import wf from '../../versions/wfList.module.css'
import hub from '../hub.module.css'
import css from './groupedList.module.css'

/** 分组标题上画什么。 */
export interface GroupFace {
  /** 前面那一格（和行里的图标块同列）。 */
  lead: React.ReactNode
  label: string
  /** 悬停名字看的（比如工作区的完整路径）。 */
  tip?: string
  /** 名字后面的小标（「本工作区」）。 */
  badge?: React.ReactNode
  /** 悬停时浮出的按钮。 */
  actions?: React.ReactNode
  /** 按钮挂着的事没做完（确认卡开着）：按钮保持显示。 */
  busy?: boolean
  /** 就地改名：给了就把名字那一格换成它（一条输入框），不能折叠。 */
  edit?: React.ReactNode
}

/** 一行在列表里的位置。 */
export interface RowAt<E, G extends string = string> {
  /** 动画键（也当 React 的键）。 */
  flip: string
  /** 选中底块在这一行下面。 */
  selected: boolean
  /** 同一项在别的组里被选中了。 */
  also: boolean
  group: ListGroup<E, G>
}

export function GroupedList<E, G extends string = string>(props: {
  label: string
  groups: readonly ListGroup<E, G>[]
  keyOf(entry: E): string
  selected: string
  /** 选中的那项在几组里都有时，底块落在哪一组（{@link groupId}）；缺省第一组。 */
  selectedGroup?: string
  face(group: ListGroup<E, G>): GroupFace
  row(entry: E, at: RowAt<E, G>): React.ReactNode
  /** 一组都没有时的那句话。 */
  empty: string
  /** 分组标题的测试锚点。 */
  testId: string
  className?: string
  /** 行里别的会让行变高变矮、换位置的东西（同 useFlip 的 layout）。 */
  layout?: string
}): React.JSX.Element {
  const { groups, keyOf } = props
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set())
  const listRef = useRef<HTMLElement>(null)
  const closed = (group: ListGroup<E, G>): boolean =>
    group.by !== 'none' && folded.has(groupId(group))
  const home =
    groups.find(
      (group) =>
        groupId(group) === props.selectedGroup &&
        group.entries.some((entry) => keyOf(entry) === props.selected),
    ) ?? groups.find((group) => group.entries.some((entry) => keyOf(entry) === props.selected))
  const homeId = home === undefined ? '' : groupId(home)
  const shown = groups.flatMap((group) =>
    closed(group) ? [groupId(group)] : group.entries.map((entry) => keyOf(entry)),
  )
  const density = useListDensity()
  const layout = `${props.selected}|${homeId}|${groups[0]?.by ?? ''}|${density}|${shown.join('|')}|${props.layout ?? ''}`
  useFlip(listRef, layout, { enter: true })

  const fold = (id: string): void => {
    setFolded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }

  const seen = new Set<string>()
  return (
    <nav
      ref={listRef}
      className={cx(wf.wfList, wf.sideList, css.list, props.className)}
      data-density={density}
      aria-label={props.label}
    >
      <ListThumb layout={layout} />
      {groups.length === 0 && <p className={cx(hub.sideEmpty, ui.fade)}>{props.empty}</p>}
      {groups.map((group) => {
        const id = groupId(group)
        const shut = closed(group)
        return (
          <div
            key={`box-${id}`}
            className={css.groupBox}
            data-flip-group=""
            data-opened={shut ? undefined : 'true'}
          >
            {group.by !== 'none' && (
              <GroupHead
                id={id}
                face={props.face(group)}
                count={group.entries.length}
                closed={shut}
                testId={props.testId}
                onFold={() => fold(id)}
              />
            )}
            {!shut &&
              group.entries.map((entry) => {
                const key = keyOf(entry)
                const flip = seen.has(key) ? `${id}\n${key}` : key
                seen.add(key)
                const picked = key === props.selected
                return (
                  <Fragment key={flip}>
                    {props.row(entry, {
                      flip,
                      selected: picked && id === homeId,
                      also: picked && id !== homeId,
                      group,
                    })}
                  </Fragment>
                )
              })}
          </div>
        )
      })}
    </nav>
  )
}

function GroupHead(props: {
  id: string
  face: GroupFace
  count: number
  closed: boolean
  testId: string
  onFold(): void
}): React.JSX.Element {
  const { face } = props
  return (
    <div
      className={css.group}
      data-flip={`group-${props.id}`}
      data-acts={face.actions === undefined || face.edit !== undefined ? undefined : 'true'}
      data-busy={face.busy === true ? 'true' : undefined}
    >
      {face.edit !== undefined ? (
        <div className={css.groupEdit}>
          <span className={css.groupLead} aria-hidden="true">
            {face.lead}
          </span>
          {face.edit}
        </div>
      ) : (
        <button
          type="button"
          className={css.groupFold}
          aria-expanded={!props.closed}
          data-testid={props.testId}
          data-value={props.id}
          onClick={props.onFold}
        >
          <span className={css.groupLead} aria-hidden="true">
            {face.lead}
          </span>
          <span className={css.groupName} data-tip={face.tip} data-tip-align="start">
            {face.label}
          </span>
          {face.badge}
          <span className={css.groupCount}>{props.count}</span>
          <span className={css.chevron} aria-hidden="true">
            <Icon name="chevronDown" size={14} />
          </span>
        </button>
      )}
      {face.actions !== undefined && face.edit === undefined && (
        <span className={css.groupActions}>{face.actions}</span>
      )}
    </div>
  )
}

/** 筛选生效时列表顶上的一条：「仅显示待处理 · 2 个 ✕」，点 ✕ 清掉。 */
export function ShowingBar(props: {
  text: string
  clearLabel: string
  testId: string
  onClear(): void
}): React.JSX.Element {
  return (
    <div className={cx(css.showing, ui.fade)} data-testid={props.testId}>
      <span className={css.showingText}>{props.text}</span>
      <button
        type="button"
        className={css.showingClear}
        aria-label={props.clearLabel}
        data-tip={props.clearLabel}
        onClick={props.onClear}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
