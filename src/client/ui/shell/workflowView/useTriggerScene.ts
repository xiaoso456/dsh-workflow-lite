/**
 * dsh-workflow-lite — 触发卡片的现场：把状态轮询、已知的工作区与会话、开关怎么改拼成一份，
 * 交给画布上的卡片和右栏的面板（见 `ui/trigger/triggerEnv.ts`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/shell/workflowView/useTriggerScene
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { findNode, isTrigger } from '../../../../shared/model.ts'
import { commandOf } from '../../../../shared/trigger.ts'
import type { SessionRow } from '../../../app/sessions.ts'
import { useTriggers } from '../../../app/useTriggers.ts'
import type { Workflow } from '../../../app/useWorkflow.ts'
import type { Selection } from '../../../model/editor.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import type { TriggerEnv } from '../../trigger/triggerEnv.ts'

export interface TriggerSceneInput {
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
  const { rpc, wf, session, sessionRows, sessionCwd, select, openRun } = input
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

  const [ask, setAsk] = useState<TriggerEnv['ask']>(null)
  const asked = useRef(0)
  const doc = useRef(state.doc)
  doc.current = state.doc

  const toggle = useCallback(
    (node: string, on: boolean): void => {
      // 要跑命令、还没确认过：先请用户在面板里看一眼命令。
      const card = doc.current === null ? undefined : findNode(doc.current, node)
      const command =
        card !== undefined && isTrigger(card) ? commandOf(card.data.source) : undefined
      if (on && command !== undefined && triggers.view(node)?.approved !== true) {
        select({ kind: 'node', id: node })
        asked.current += 1
        setAsk({ node, seq: asked.current })
        return
      }
      void triggers.set(node, { enabled: on }).then((problem) => {
        if (problem === null) return
        // 开不了：说出原因，并把这张卡片的面板打开（要补的设置就在里面）。
        wf.notify(problem, 'error')
        select({ kind: 'node', id: node })
      })
    },
    [triggers.set, triggers.view, wf.notify, select],
  )

  return useMemo(
    () => ({
      triggers,
      here: { session, cwd: sessionCwd },
      workspaces,
      sessions,
      toggle,
      ask,
      openRun,
    }),
    [triggers, session, sessionCwd, workspaces, sessions, toggle, ask, openRun],
  )
}
