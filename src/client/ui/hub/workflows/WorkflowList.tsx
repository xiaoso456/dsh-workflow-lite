/**
 * dsh-workflow-lite — 工作流中心「工作流」页左边的列表：按视图选项分好组（{@link GroupedList}），点一张在右栏看它；
 * 按标签分组时，组标题前面是标签的颜色，标签的改名、删除在组标题上（悬停露出）。
 *
 * 一张打了几个标签就在几组里各出现一次（按行的动画键认，见 {@link RowAt}）。
 * 改过名的工作流沿用旧键（`rowKeys`，改名在右栏，由 `HubWorkflows` 记）：改完名字不闪、行顺着新排位滑过去。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/workflows/WorkflowList
 */

import { useState } from 'react'
import type { WorkflowEntry } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { groupId, type ListGroup } from '../../../model/listView.ts'
import { type RowKeys, rowKey } from '../../../model/rowKeys.ts'
import { pastTime } from '../../../model/time.ts'
import { NO_TAG, type TagUse, type WorkflowSortBy } from '../../../model/workflowList.ts'
import { useConfirm } from '../../kit/Confirm.tsx'
import { Icon } from '../../kit/Icon.tsx'
import hub from '../hub.module.css'
import { GroupedList, type GroupFace } from '../list/GroupedList.tsx'
import type { TagColors } from './TagMark.tsx'
import { TagRename } from './TagRename.tsx'
import { WorkflowRow } from './WorkflowRow.tsx'
import { type WorkflowGroupKey, workflowGroupFace } from './workflowView.tsx'

export function WorkflowList(props: {
  t: T
  groups: readonly ListGroup<WorkflowEntry, WorkflowGroupKey>[]
  /** 怎么排的：按修改时间排时紧凑的行尾写修改时间。 */
  sort: WorkflowSortBy
  /** 列表里全部工作流的名字（按左栏从上到下）：改过名的行沿用旧键要看它。 */
  names: readonly string[]
  /** 新名字 → 这一行一直在用的键（见 model/rowKeys.ts）。 */
  rowKeys: RowKeys
  selected: string
  /** 选中的那张在几组里都有时，底块落在哪一组。 */
  selectedGroup: string | undefined
  /** 编辑页正开着的那张。 */
  current: string | null
  catalog: readonly TagUse[]
  colors: TagColors
  onPick(name: string, group: string): void
  /** 回 `false` = 没改成（已经提示过）。 */
  renameTag(from: string, to: string): Promise<boolean>
  deleteTag(tag: string): void
}): React.JSX.Element {
  const { t } = props
  const now = Date.now()
  /** 正在改名的标签。 */
  const [renamingTag, setRenamingTag] = useState<string | null>(null)
  /** 删除确认卡指着哪个标签。 */
  const [doomedTag, setDoomedTag] = useState<string | null>(null)
  const tagConfirm = useConfirm<HTMLButtonElement>()
  const keys = new Map(
    props.names.map((name, index) => [name, rowKey(props.rowKeys, props.names, index)]),
  )
  const keyOf = (entry: WorkflowEntry): string => keys.get(entry.name) ?? entry.name
  const doomedUse = props.catalog.find((use) => use.tag === doomedTag)

  return (
    <>
      <GroupedList
        label={t('hub.wfPage')}
        groups={props.groups}
        keyOf={keyOf}
        selected={keys.get(props.selected) ?? props.selected}
        selectedGroup={props.selectedGroup}
        face={(group) =>
          groupFace(t, group, props.colors, {
            renaming: renamingTag,
            doomed: doomedTag,
            confirming: tagConfirm.open,
            anchor: tagConfirm.anchorRef,
            onRename: (tag) => {
              if (tagConfirm.open) tagConfirm.hide()
              setRenamingTag(tag)
            },
            onCommit: async (from, to) => {
              const ok = await props.renameTag(from, to)
              if (ok) setRenamingTag(null)
              return ok
            },
            onCancel: () => setRenamingTag(null),
            onDelete: (tag) => {
              if (tagConfirm.open && doomedTag === tag) {
                tagConfirm.hide()
                return
              }
              setDoomedTag(tag)
              tagConfirm.show()
            },
          })
        }
        empty={t('hub.wfNoMatch')}
        testId="wl-hub-wf-group"
        layout={renamingTag ?? ''}
        row={(entry, at) => (
          <WorkflowRow
            flipKey={at.flip}
            t={t}
            entry={entry}
            colors={props.colors}
            selected={at.selected}
            also={at.also}
            open={entry.name === props.current}
            when={props.sort === 'recent' ? pastTime(t, entry.updatedAt, now) : undefined}
            onPick={() => props.onPick(entry.name, groupId(at.group))}
          />
        )}
      />
      {doomedUse !== undefined &&
        tagConfirm.render({
          t,
          title: t('hub.tagDeleteTitle').replace('{tag}', doomedUse.tag),
          desc: t('hub.tagDeleteDesc').replace('{n}', String(doomedUse.count)),
          confirmText: t('common.delete'),
          testId: 'wl-hub-tag-delete-confirm',
          onConfirm: () => props.deleteTag(doomedUse.tag),
        })}
    </>
  )
}

/** 组标题上标签的改名、删除。 */
interface TagActions {
  renaming: string | null
  /** 删除确认卡指着的那个标签（确认卡挂在它的删除按钮上）。 */
  doomed: string | null
  /** 确认卡开着。 */
  confirming: boolean
  anchor: React.RefObject<HTMLButtonElement>
  onRename(tag: string): void
  onCommit(from: string, to: string): Promise<boolean>
  onCancel(): void
  onDelete(tag: string): void
}

/**
 * 分组标题：写什么见 {@link workflowGroupFace}（顶栏下拉也用它）；这里给标签的组加上改名、删除（悬停露出），
 * 无标签一组没有按钮。
 */
function groupFace(
  t: T,
  group: ListGroup<WorkflowEntry, WorkflowGroupKey>,
  colors: TagColors,
  actions: TagActions,
): GroupFace {
  const base = workflowGroupFace(t, group, colors)
  if (group.by !== 'tag' || group.key === NO_TAG) return base
  const tag = group.key
  if (actions.renaming === tag) {
    return {
      ...base,
      edit: (
        <TagRename
          t={t}
          value={tag}
          onCommit={(to) => actions.onCommit(tag, to)}
          onCancel={actions.onCancel}
        />
      ),
    }
  }
  const doomed = actions.doomed === tag
  return {
    ...base,
    busy: doomed && actions.confirming,
    actions: (
      <>
        <button
          type="button"
          className={hub.wfAction}
          aria-label={`${t('hub.tagRename')} ${tag}`}
          data-tip={t('hub.tagRename')}
          data-testid={`wl-hub-tag-rename-${tag}`}
          onClick={() => actions.onRename(tag)}
        >
          <Icon name="pencil" size={13} />
        </button>
        <button
          ref={doomed ? actions.anchor : undefined}
          type="button"
          className={hub.wfAction}
          data-danger="true"
          aria-label={`${t('hub.tagDelete')} ${tag}`}
          aria-expanded={doomed && actions.confirming}
          data-tip={t('hub.tagDelete')}
          data-testid={`wl-hub-tag-delete-${tag}`}
          onClick={() => actions.onDelete(tag)}
        >
          <Icon name="trash" size={13} />
        </button>
      </>
    ),
  }
}
