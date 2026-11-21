/**
 * dsh-workflow-lite — 触发卡片的现场：把状态轮询、已知的工作区与会话、开关怎么改拼成一份，
 * 交给画布上的卡片和右栏的面板（见 `ui/trigger/triggerEnv.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useTriggerScene
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { findNode, isTrigger } from '../../../../shared/model.ts'
import { resolveSessionChoice } from '../../../../shared/sessionChoice.ts'
import { launchMissing } from '../../../../shared/trigger.ts'
import type { TriggerData } from '../../../../shared/types.ts'
import { agentCatalog } from '../../../app/agents.ts'
import type { SessionRow } from '../../../app/sessions.ts'
import { createShellAccess } from '../../../app/shells.ts'
import { useTriggers } from '../../../app/useTriggers.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import {
  recentRuns as readRecentRuns,
  enableRunState as turnOnRunState,
} from '../../../app/workflowRuns.ts'
import type { T } from '../../../i18n.ts'
import type { Selection } from '../../../model/editor.ts'
import { switchPatch } from '../../../model/triggerSwitch.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import {
  knownWorkspaces,
  type RevealField,
  sessionChoices,
  type TriggerEnv,
  workflowChoices,
} from '../../trigger/triggerEnv.ts'

export interface TriggerSceneInput {
  t: T
  rpc: WorkflowLiteRpc
  wf: Workflow
  /** 这个视图所在的会话。 */
  session: string | undefined
  sessionRows: readonly SessionRow[]
  /** 这个会话的工作区。 */
  sessionCwd: string | undefined
  select(selection: Selection): void
  openRun(id: string): void
  /** 跳到一个会话；跳不了回 `false`。 */
  openSession(session: string): boolean
  /** 打开工作流中心「触发」页、选中这个工作流里的这张卡片。 */
  openInHub(node: string): void
  /** 打开工作流中心「设置」页。 */
  openSettings(): void
}

export function useTriggerScene(input: TriggerSceneInput): TriggerEnv {
  const {
    t,
    rpc,
    wf,
    session,
    sessionRows,
    sessionCwd,
    select,
    openRun,
    openSession,
    openInHub,
    openSettings,
  } = input
  const { state } = wf
  // 图里一张触发卡片都没有就不问状态。
  const active = useMemo(() => state.doc?.nodes.some(isTrigger) === true, [state.doc])
  const triggers = useTriggers(rpc, state.name, active, wf.flush, state.baseHash)
  const shells = useMemo(() => createShellAccess(rpc), [rpc])

  const workspaces = useMemo(
    () => knownWorkspaces(sessionRows, sessionCwd),
    [sessionRows, sessionCwd],
  )
  const sessions = useMemo(() => sessionChoices(sessionRows), [sessionRows])
  const catalog = wf.catalog
  const workflows = useMemo(() => workflowChoices(catalog, state.name), [catalog, state.name])

  const recentRuns = useCallback(() => readRecentRuns(rpc), [rpc])
  const agents = useCallback(() => agentCatalog(rpc, session), [rpc, session])

  const refreshCatalog = wf.refreshCatalog
  const { edit, flush } = wf
  const settings = state.doc?.settings
  const current = state.name
  // 卡片上「跟随工作流」写的是画布上这份设置（改了马上跟上，不等存盘后的轮询）。
  const workflowChoice = useMemo(() => resolveSessionChoice(undefined, settings), [settings])
  // 正开着的这个工作流（跳过、排队要它）走编辑器自己的设置、存下去，别的工作流（接续要它）直接改磁盘上的图。
  const enableRunState = useCallback(
    async (workflow: string): Promise<string | null> => {
      if (workflow === current) {
        edit({ type: 'setSettings', settings: { ...settings, runState: true } })
        if (!(await flush())) return t('trigger.runStateSaveFailed')
        await refreshCatalog()
        return null
      }
      const problem = await turnOnRunState(rpc, workflow)
      if (problem === null) await refreshCatalog()
      return problem
    },
    [t, rpc, current, settings, edit, flush, refreshCatalog],
  )

  const [reveal, setReveal] = useState<TriggerEnv['reveal']>(null)
  const doc = useRef(state.doc)
  doc.current = state.doc

  /** 开不了：说出原因，选中这张卡片；缺的是工作区、会话就把面板里那一项带到眼前。 */
  const refuse = useCallback(
    (node: string, problem: string): void => {
      wf.notify(problem, 'error')
      select({ kind: 'node', id: node })
      const card = doc.current === null ? undefined : findNode(doc.current, node)
      if (card === undefined || !isTrigger(card)) return
      const field = launchMissing(card.data)
      if (field !== null) setReveal({ node, field })
    },
    [wf.notify, select],
  )

  // 改编辑器里的图并马上存下去：开关、设置要让宿主当场看到。
  const patch = useCallback(
    async (node: string, change: Partial<TriggerData>): Promise<string | null> => {
      edit({ type: 'patchTrigger', id: node, patch: change })
      return (await flush()) ? null : t('trigger.saveFailed')
    },
    [t, edit, flush],
  )

  const toggle = useCallback(
    (node: string, on: boolean): void => {
      const card = doc.current === null ? undefined : findNode(doc.current, node)
      if (card === undefined || !isTrigger(card)) return
      void switchPatch(t, card.data, on, () => triggers.endpoint(node))
        .then((change) => (typeof change === 'string' ? change : patch(node, change)))
        .then((problem) => {
          if (problem !== null) refuse(node, problem)
        })
    },
    [t, triggers.endpoint, patch, refuse],
  )

  const takeReveal = useCallback(
    <F extends RevealField>(node: string, fields: readonly F[]): F | null => {
      if (reveal === null || reveal.node !== node) return null
      const field = fields.find((item) => item === reveal.field)
      if (field === undefined) return null
      setReveal(null)
      return field
    },
    [reveal],
  )

  const editSource = useCallback(
    (node: string): void => {
      select({ kind: 'node', id: node })
      setReveal({ node, field: 'source' })
    },
    [select],
  )

  return useMemo(
    () => ({
      triggers,
      workflow: state.name ?? '',
      here: { session, cwd: sessionCwd },
      workspaces,
      shells,
      sessions,
      workflows,
      recentRuns,
      agents,
      workflowChoice,
      enableRunState,
      patch,
      toggle,
      reveal,
      takeReveal,
      editSource,
      openRun,
      openSession,
      openInHub,
      openSettings,
    }),
    [
      state.name,
      recentRuns,
      agents,
      workflowChoice,
      enableRunState,
      triggers,
      session,
      sessionCwd,
      workspaces,
      shells,
      sessions,
      workflows,
      patch,
      toggle,
      reveal,
      takeReveal,
      editSource,
      openRun,
      openSession,
      openInHub,
      openSettings,
    ],
  )
}
