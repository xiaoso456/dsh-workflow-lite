/**
 * dsh-workflow-lite — 工作流中心「工作流」页左边的一行：点它看这张的版本；改名、删除就在这一行上。
 *
 * - 「改名 / 删除」平时藏着，悬停或键盘移到这一行时浮在右端，和「正在编辑」的小绿点换着显示
 *   （只动透明度，名字不挪）；触屏没有悬停，一直显示。
 * - 改名只把名字那一行换成一条细输入框，下面一行换成按键提示，整行高度不变：
 *   回车或点开确认，Esc 取消（对话框不跟着关）。
 * - 删除的确认卡挂在这一行的删除按钮上（由 `HubWorkflowList` 统一管）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubWorkflowRow
 */

import { useEffect, useRef } from 'react'
import type { WorkflowEntry } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import hub from './hub.module.css'
import { Icon } from './Icon.tsx'

export interface HubWorkflowRowProps {
  t: T
  entry: WorkflowEntry
  /** 右边正显示这张。 */
  selected: boolean
  /** 编辑页正开着这张。 */
  open: boolean
  editing: boolean
  /** 这一行的确认卡开着：按钮保持显示。 */
  busy: boolean
  /** 删除按钮的 ref：确认卡挂在它上面（只有确认卡指着这一行时才给）。 */
  deleteRef: React.RefObject<HTMLButtonElement> | undefined
  onPick(): void
  onEdit(): void
  /** 提交新名字；回 `false` = 名字不行，留在输入框里。 */
  onRename(value: string): Promise<boolean>
  onCancelEdit(): void
  onDelete(): void
}

export function HubWorkflowRow(props: HubWorkflowRowProps): React.JSX.Element {
  const { t, entry } = props
  const name = entry.name
  if (props.editing) return <RenameRow {...props} />
  return (
    <div className={hub.wfRow} data-busy={props.busy}>
      <button
        type="button"
        aria-current={props.selected ? 'true' : undefined}
        className={hub.wfItem}
        data-testid="wl-hub-wf"
        data-value={name}
        onClick={props.onPick}
      >
        <span className={hub.wfIcon}>
          <Icon name={entry.invalid === true ? 'alert' : 'folder'} size={15} />
        </span>
        <span className={hub.wfText}>
          <span className={hub.wfName}>{name}</span>
          <span className={hub.wfMeta}>
            {t('ver.steps').replace('{n}', String(entry.nodeCount))}
            {(entry.versions ?? 0) > 0 &&
              ` · ${t('ver.count').replace('{n}', String(entry.versions))}`}
          </span>
        </span>
        {props.open && <span className={hub.wfDot} data-tip={t('hub.wfEditing')} />}
      </button>
      <span className={hub.wfActions}>
        <button
          type="button"
          className={hub.wfAction}
          data-tip={t('wf.rename')}
          aria-label={`${t('wf.rename')} ${name}`}
          data-testid={`wl-hub-wf-rename-${name}`}
          onClick={props.onEdit}
        >
          <Icon name="pencil" size={14} />
        </button>
        <button
          ref={props.deleteRef}
          type="button"
          className={hub.wfAction}
          data-danger="true"
          data-tip={t('common.delete')}
          aria-label={`${t('common.delete')} ${name}`}
          aria-expanded={props.busy}
          data-testid={`wl-hub-wf-delete-${name}`}
          onClick={props.onDelete}
        >
          <Icon name="trash" size={14} />
        </button>
      </span>
    </div>
  )
}

function RenameRow(props: HubWorkflowRowProps): React.JSX.Element {
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
    <div className={hub.wfEditing}>
      <span className={hub.wfIcon}>
        <Icon name={entry.invalid === true ? 'alert' : 'folder'} size={15} />
      </span>
      <span className={hub.wfText}>
        <input
          ref={ref}
          className={hub.wfInput}
          defaultValue={entry.name}
          aria-label={t('wf.rename')}
          data-testid="wl-hub-wf-rename-input"
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(event.currentTarget.value)
            if (event.key === 'Escape') {
              // 只退出改名，对话框留着。
              event.stopPropagation()
              settled.current = true
              props.onCancelEdit()
            }
          }}
          onBlur={(event) => commit(event.currentTarget.value)}
        />
        <span className={hub.wfMeta}>{t('wf.renameHint')}</span>
      </span>
    </div>
  )
}
