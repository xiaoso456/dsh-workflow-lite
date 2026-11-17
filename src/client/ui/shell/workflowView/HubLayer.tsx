/**
 * dsh-workflow-lite — 工作流中心对话框：把工作流、实例、主机各块接到中心的各页。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/HubLayer
 */

import type { HostAccess } from '../../../app/host.ts'
import type { SessionRow } from '../../../app/sessions.ts'
import type { Runs } from '../../../app/useRuns.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { T } from '../../../i18n.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import { HubDialog, type HubFocus } from '../../hub/HubDialog.tsx'

export function HubLayer({
  t,
  rpc,
  host,
  session,
  sessionRows,
  sessionsReady,
  runs,
  openRun,
  openSession,
  wf,
  sessionCwd,
  hubFocus,
  onClose,
  openTemplate,
  openCard,
}: {
  t: T
  rpc: WorkflowLiteRpc
  host: HostAccess
  session: string | undefined
  sessionRows: readonly SessionRow[]
  sessionsReady: boolean
  runs: Runs
  /** 打开实例；给了 `node` 就选中那一步。 */
  openRun(id: string, node?: string): void
  /** 跳到一个会话；跳不了回 `false`。 */
  openSession(id: string): boolean
  wf: Workflow
  sessionCwd: string | undefined
  /** 打开时停在哪（导出、某张触发卡片）；`null` = 从头。 */
  hubFocus: HubFocus | null
  onClose(): void
  openTemplate(name: string): void
  /** 打开一个工作流、选中里面的一张卡片。 */
  openCard(workflow: string, node: string): void
}): React.JSX.Element {
  const { state } = wf
  return (
    <HubDialog
      t={t}
      rpc={rpc}
      host={host}
      session={session}
      sessionRows={sessionRows}
      sessionsReady={sessionsReady}
      runs={runs}
      onOpenRun={openRun}
      onOpenSession={openSession}
      onOpenCard={openCard}
      onNotice={wf.notify}
      workflows={{
        current: state.name,
        scope: {
          ...(sessionCwd === undefined ? {} : { cwd: sessionCwd }),
          ...(session === undefined ? {} : { session: session }),
        },
        flush: wf.flush,
        onReload: wf.reload,
        onOpen: openTemplate,
        rename: wf.rename,
        remove: wf.remove,
        onChanged: () => void wf.refreshCatalog(),
      }}
      {...(hubFocus === null ? {} : { focus: hubFocus })}
      onClose={onClose}
    />
  )
}
