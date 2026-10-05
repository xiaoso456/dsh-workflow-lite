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
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import css from './topbar.module.css'
import ui from './ui.module.css'

export interface WorkflowRowProps {
  t: T
  entry: WorkflowEntry
  /** 正开着的这张。 */
  active: boolean
  editing: boolean
  /** 这一行的确认卡开着：按钮保持显示。 */
  busy: boolean
  /** 删除按钮的 ref：确认卡挂在它上面（只有确认卡指着这一行时才给）。 */
  deleteRef: React.RefObject<HTMLButtonElement> | undefined
  onOpen(): void
  onEdit(): void
  /** 提交新名字；回 `false` = 名字不行，留在输入框里。 */
  onRename(value: string): Promise<boolean>
  onCancelEdit(): void
  onDelete(): void
}

export function WorkflowRow(props: WorkflowRowProps): React.JSX.Element {
  const { t, entry } = props
  const name = entry.name
  if (props.editing) return <RenameRow {...props} />
  return (
    <div className={css.row} data-busy={props.busy}>
      <button
        type="button"
        className={cx(ui.menuItem, css.rowMain)}
        aria-current={props.active ? 'true' : undefined}
        data-active={props.active}
        data-testid="wl-wf-item"
        data-value={name}
        onClick={props.onOpen}
      >
        <Icon name={entry.invalid === true ? 'alert' : 'folder'} size={15} />
        <span className={ui.menuLabel}>{name}</span>
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

function RenameRow(props: WorkflowRowProps): React.JSX.Element {
  const { t, entry } = props
  const ref = useRef<HTMLInputElement>(null)
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

  return (
    <div className={css.rowEditing}>
      <Icon name={entry.invalid === true ? 'alert' : 'folder'} size={15} />
      <input
        ref={ref}
        className={css.rowInput}
        defaultValue={entry.name}
        aria-label={t('wf.rename')}
        data-tip={t('wf.renameHint')}
        data-testid="wl-wf-rename-input"
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit(event.currentTarget.value)
          if (event.key === 'Escape') {
            // 只退出改名，下拉留着。
            event.stopPropagation()
            settled.current = true
            props.onCancelEdit()
          }
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
      />
    </div>
  )
}
