/**
 * dsh-workflow-lite — 触发卡片的现场：把状态轮询、已知的工作区与会话、开关怎么改拼成一份，
 * 交给画布上的卡片和右栏的面板（见 `ui/trigger/triggerEnv.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useTriggerScene
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { findNode, isTrigger } from '../../../../shared/model.ts'
import { commandOf, launchMissing } from '../../../../shared/trigger.ts'
import type { SessionRow } from '../../../app/sessions.ts'
import { useTriggers } from '../../../app/useTriggers.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { T } from '../../../i18n.ts'
import type { Selection } from '../../../model/editor.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import type { TriggerEnv } from '../../trigger/triggerEnv.ts'

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
}

export function useTriggerScene(input: TriggerSceneInput): TriggerEnv {
  const { t, rpc, wf, session, sessionRows, sessionCwd, select, openRun } = input
  const { state } = wf
  // 图里一张触发卡片都没有就不问状态。
  const active = useMemo(() => state.doc?.nodes.some(isTrigger) === true, [state.doc])
  const triggers = useTriggers(rpc, state.name, active, wf.flush, state.baseHash)

  // 工作区：当前会话的排最前，其余按侧栏里会话的顺序，去重。
  const workspaces = useMemo(() => {
    const seen = new Set<string>()
    if (sessionCwd !== undefined && sessionCwd !== '') seen.add(sessionCwd)
    for (const row of sessionRows) {
      if (!row.subagent && row.cwd !== undefined && row.cwd !== '') seen.add(row.cwd)
    }
    return [...seen]
  }, [sessionRows, sessionCwd])

  const sessions = useMemo(
    () =>
      sessionRows
        .filter((row) => !row.subagent)
        .map((row) => ({ id: row.id, title: row.title === '' ? row.id : row.title })),
    [sessionRows],
  )

  // 接续触发能等的工作流：不含正在编辑的这一张（等自己跑完会一直触发自己）。
  const catalog = wf.catalog
  const workflows = useMemo(
    () =>
      (catalog?.workflows ?? [])
        .filter((entry) => entry.name !== state.name)
        .map((entry) => ({ name: entry.name, runState: entry.runState === true }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [catalog, state.name],
  )

  const [reveal, setReveal] = useState<TriggerEnv['reveal']>(null)
  const doc = useRef(state.doc)
  doc.current = state.doc

  /** 开不了：说出原因，选中这张卡片；缺的是本机设置（工作区、会话）就把面板里那一项带到眼前。 */
  const refuse = useCallback(
    (node: string, problem: string): void => {
      wf.notify(problem, 'error')
      select({ kind: 'node', id: node })
      const card = doc.current === null ? undefined : findNode(doc.current, node)
      if (card === undefined || !isTrigger(card)) return
      const field = launchMissing(card.data, triggers.view(node) ?? {})
      if (field !== null) setReveal({ node, field })
    },
    [wf.notify, select, triggers.view],
  )

  const toggle = useCallback(
    (node: string, on: boolean): 'confirm' | 'done' => {
      const card = doc.current === null ? undefined : findNode(doc.current, node)
      const command =
        card !== undefined && isTrigger(card) ? commandOf(card.data.source) : undefined
      const view = triggers.view(node)
      // 要跑命令、还没确认过：有工作区就请点开关的那一处问一句；没有就先去选工作区。
      if (on && command !== undefined && view?.approved !== true) {
        if (view?.workspace !== undefined) return 'confirm'
        refuse(node, t('trigger.needWorkspace'))
        return 'done'
      }
      void triggers.set(node, { enabled: on }).then((problem) => {
        if (problem !== null) refuse(node, problem)
      })
      return 'done'
    },
    [t, triggers.set, triggers.view, refuse],
  )

  const approve = useCallback(
    (node: string, command: string): void => {
      void triggers.set(node, { approve: command, enabled: true }).then((problem) => {
        if (problem !== null) refuse(node, problem)
      })
    },
    [triggers.set, refuse],
  )

  const takeReveal = useCallback(
    (node: string) => {
      if (reveal === null || reveal.node !== node) return null
      setReveal(null)
      return reveal.field
    },
    [reveal],
  )

  return useMemo(
    () => ({
      triggers,
      here: { session, cwd: sessionCwd },
      workspaces,
      sessions,
      workflows,
      toggle,
      approve,
      reveal,
      takeReveal,
      openRun,
    }),
    [
      triggers,
      session,
      sessionCwd,
      workspaces,
      sessions,
      workflows,
      toggle,
      approve,
      reveal,
      takeReveal,
      openRun,
    ],
  )
}
