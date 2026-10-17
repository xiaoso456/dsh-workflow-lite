/**
 * dsh-workflow-lite — 工作流下拉里的一行：点名字打开；改名、删除就在这一行上，不用先切过去。
 *
 * - 「改名 / 删除」两个小按钮平时藏着，悬停或键盘移到这一行时浮在右端，和步骤数换着显示
 *   （同一个位置淡入淡出，名字不挪）；触屏没有悬停，一直显示。
 * - 改名在原行换成输入框，高度不变：回车或点开确认，Esc 取消。
 * - 删除的确认卡挂在这一行的删除按钮上（由下拉统一管，见 `WorkflowSwitcher`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/WorkflowRow
 */

import { useEffect, useRef } from 'react'
import type { WorkflowEntry } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { EditActions } from './EditActions.tsx'
import { Highlight } from './Highlight.tsx'
import { Icon } from './Icon.tsx'
import { useLineExit } from './motion.tsx'
import { cx } from './primitives.tsx'
import css from './topbar.module.css'
import ui from './ui.module.css'

export interface WorkflowRowProps {
  t: T
  entry: WorkflowEntry
  /** 正开着的这张。 */
  active: boolean
  editing: boolean
  /** 搜索词（已归一）：名字里命中的字加粗；空 = 不标。 */
  needle?: string
  /** 这一行的确认卡开着：按钮保持显示。 */
  busy: boolean
  /** 删除按钮的 ref：确认卡挂在它上面（只有确认卡指着这一行时才给）。 */
  deleteRef: React.RefObject<HTMLButtonElement> | undefined
  onOpen(event: React.MouseEvent): void
  onEdit(): void
  /** 提交新名字；回 `false` = 名字不行，留在输入框里。 */
  onRename(value: string): Promise<boolean>
  onCancelEdit(): void
  onDelete(): void
}

export function WorkflowRow(props: WorkflowRowProps): React.JSX.Element {
  const { t, entry } = props
  const name = entry.name
  // 根节点在「看」和「改名」之间是同一个元素：列表的「依次浮出」只认新挂上的子项，换成输入框不能算新项（不然名字先淡掉再浮出，像闪了一下）。
  return (
    <div
      className={props.editing ? css.rowEditing : css.row}
      data-busy={props.editing ? undefined : props.busy}
      data-selected={props.active}
    >
      {props.editing ? (
        <RenameFields {...props} />
      ) : (
        <>
          <button
            type="button"
            className={cx(ui.menuItem, css.rowMain)}
            aria-current={props.active ? 'true' : undefined}
            data-testid="wl-wf-item"
            data-value={name}
            onClick={props.onOpen}
          >
            <Icon name={entry.invalid === true ? 'alert' : 'folder'} size={15} />
            <span className={ui.menuLabel}>
              <Highlight text={name} needle={props.needle ?? ''} />
            </span>
            <span className={cx(ui.menuMeta, css.rowMeta)}>
              {entry.invalid === true ? t('wf.broken') : `${entry.nodeCount} ${t('wf.steps')}`}
            </span>
          </button>
          <span className={css.rowActions}>
            <button
              type="button"
              className={css.rowAction}
              data-tip={t('wf.rename')}
              aria-label={`${t('wf.rename')} ${name}`}
              data-testid={`wl-wf-rename-${name}`}
              onClick={props.onEdit}
            >
              <Icon name="pencil" size={14} />
            </button>
            <button
              ref={props.deleteRef}
              type="button"
              className={css.rowAction}
              data-danger="true"
              data-tip={t('common.delete')}
              aria-label={`${t('common.delete')} ${name}`}
              aria-expanded={props.busy}
              data-testid={`wl-wf-delete-${name}`}
              onClick={props.onDelete}
            >
              <Icon name="trash" size={14} />
            </button>
          </span>
        </>
      )}
    </div>
  )
}

/** 删除确认卡上补的那句：正开着的要说编辑页会空出来，有版本的要说版本一起没。 */
export function deleteDesc(t: T, entry: WorkflowEntry, open: boolean): string {
  const versions = entry.versions ?? 0
  const tail =
    versions > 0 ? t('wf.deleteVersions').replace('{n}', String(versions)) : t('wf.deleteConfirm')
  return open ? `${t('wf.deleteOpen')}${tail}` : tail
}

function RenameFields(props: WorkflowRowProps): React.JSX.Element {
  const { t, entry } = props
  const ref = useRef<HTMLInputElement>(null)
  const lineRef = useLineExit()
  /** Esc 之后输入框被卸掉时可能还会补一个 blur：那一下不算提交。 */
  const settled = useRef(false)

  useEffect(() => {
    ref.current?.select()
  }, [])

  const commit = (value: string): void => {
    if (settled.current) return
    settled.current = true
    void props.onRename(value).then((ok) => {
      if (ok) return
      settled.current = false
      ref.current?.focus()
    })
  }

  const cancel = (): void => {
    settled.current = true
    props.onCancelEdit()
  }

  return (
    <>
      <Icon name={entry.invalid === true ? 'alert' : 'folder'} size={15} />
      <span className={cx(ui.editRow, css.rowField)}>
        <span ref={lineRef} className={ui.lineField}>
          <input
            ref={ref}
            className={cx(ui.lineInput, css.rowInput)}
            defaultValue={entry.name}
            aria-label={t('wf.rename')}
            data-testid="wl-wf-rename-input"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing)
                commit(event.currentTarget.value)
              if (event.key === 'Escape') {
                // 只退出改名，下拉留着。
                event.stopPropagation()
                cancel()
              }
            }}
            onBlur={(event) => commit(event.currentTarget.value)}
          />
        </span>
        <EditActions t={t} onConfirm={() => commit(ref.current?.value ?? '')} onCancel={cancel} />
      </span>
    </>
  )
}
