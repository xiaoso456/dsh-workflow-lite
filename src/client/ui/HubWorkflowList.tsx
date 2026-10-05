/**
 * dsh-workflow-lite — 工作流中心「工作流」页左边的列表：选一张、就地改名、删除（确认卡挂在那一行上）。
 *
 * 改名、删除走编辑页同一套（`Workflow.rename / remove`）：正开着的那张会先把改动写下去 / 停掉排着的保存，
 * 编辑页跟着换名字或空出来；版本目录由主机跟着搬走或删掉。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HubWorkflowList
 */

import { useState } from 'react'
import type { WorkflowEntry } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { useConfirm } from './Confirm.tsx'
import { HubWorkflowRow } from './HubWorkflowRow.tsx'
import hub from './hub.module.css'
import { deleteDesc } from './WorkflowRow.tsx'

export function HubWorkflowList(props: {
  t: T
  workflows: readonly WorkflowEntry[]
  selected: string
  /** 编辑页正开着的那张。 */
  current: string | null
  onPick(name: string): void
  /** 回 `false` = 没改成（名字不行或主机拒了，已经提示过）。 */
  rename(from: string, to: string): Promise<boolean>
  remove(name: string): Promise<boolean>
}): React.JSX.Element {
  const { t, workflows } = props
  /** 正在改名的那一行。 */
  const [editing, setEditing] = useState<string | null>(null)
  /** 删除确认卡指着哪一行。 */
  const [doomed, setDoomed] = useState<string | null>(null)
  const confirm = useConfirm<HTMLButtonElement>()
  const doomedEntry = workflows.find((entry) => entry.name === doomed)

  return (
    <nav className={hub.wfList} aria-label={t('hub.wfPage')}>
      {workflows.map((entry) => (
        <HubWorkflowRow
          key={entry.name}
          t={t}
          entry={entry}
          selected={entry.name === props.selected}
          open={entry.name === props.current}
          editing={editing === entry.name}
          busy={confirm.open && doomed === entry.name}
          deleteRef={doomed === entry.name ? confirm.anchorRef : undefined}
          onPick={() => props.onPick(entry.name)}
          onEdit={() => {
            if (confirm.open) confirm.hide()
            setEditing(entry.name)
          }}
          onRename={async (value) => {
            const ok = await props.rename(entry.name, value)
            if (ok) setEditing(null)
            return ok
          }}
          onCancelEdit={() => setEditing(null)}
          onDelete={() => {
            if (confirm.open && doomed === entry.name) {
              confirm.hide()
              return
            }
            setDoomed(entry.name)
            confirm.show()
          }}
        />
      ))}
      {doomedEntry !== undefined &&
        confirm.render({
          t,
          title: t('wf.deleteTitle').replace('{name}', doomedEntry.name),
          desc: deleteDesc(t, doomedEntry, doomedEntry.name === props.current),
          confirmText: t('common.delete'),
          testId: 'wl-hub-wf-delete-confirm',
          onConfirm: () => void props.remove(doomedEntry.name),
        })}
    </nav>
  )
}
