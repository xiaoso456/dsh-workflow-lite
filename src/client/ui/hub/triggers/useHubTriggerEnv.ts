/**
 * dsh-workflow-lite — 工作流中心「触发」页里一个工作流的触发现场：右栏「设置」打开的对话框（触发方式、保护…）
 * 和画布面板里的是同一批组件，要的也是同一份现场（`TriggerEnv`）。
 *
 * 卡片现在的样子、开关、记录都从这一页已经在轮询的 {@link TriggerHub} 读，不再另起一路；
 * 工作区、会话、能等的工作流和画布上的算法一样（`triggerEnv.ts` 里的几个函数）。
 * 「带到面板眼前」这类只在画布上有的事这里不做。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/useHubTriggerEnv
 */

import { useCallback, useMemo } from 'react'
import { idKey } from '../../../../shared/model.ts'
import type { TriggerData } from '../../../../shared/types.ts'
import type { GraphListResponse } from '../../../../shared/wire/graph.ts'
import { agentCatalog } from '../../../app/agents.ts'
import type { SessionRow } from '../../../app/sessions.ts'
import { createShellAccess } from '../../../app/shells.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { Triggers } from '../../../app/useTriggers.ts'
import { enableRunState, recentRuns } from '../../../app/workflowRuns.ts'
import type { T } from '../../../i18n.ts'
import { switchPatch } from '../../../model/triggerSwitch.ts'
import type { WorkflowLiteRpc } from '../../../rpc.ts'
import {
  knownWorkspaces,
  sessionChoices,
  type TriggerEnv,
  workflowChoices,
} from '../../trigger/triggerEnv.ts'

export interface HubEnvInput {
  t: T
  rpc: WorkflowLiteRpc
  hub: TriggerHub
  /** 选中的卡片所在的工作流。 */
  workflow: string
  /** 工作流中心所在的会话与它的工作区。 */
  session: string | undefined
  cwd: string | undefined
  sessionRows: readonly SessionRow[]
  /** 全部工作流（接续触发选上游用）；还没读到是 `null`。 */
  catalog: GraphListResponse | null
  /** 改了另一个工作流的设置（打开「记录运行状态」）之后重读工作流列表。 */
  onCatalogChanged(): void
  onNotice(text: string, tone?: 'info' | 'error'): void
  /** 改一张卡片写在图里的几项（磁盘上的图）；改不成回一句原因。 */
  patch(workflow: string, node: string, patch: Partial<TriggerData>): Promise<string | null>
  openRun(id: string): void
  openSession(id: string): boolean
}

const NO_REVEAL = (): null => null
const NO_CHOICE = {}
const NOTHING = (): void => {}

export function useHubTriggerEnv(input: HubEnvInput): TriggerEnv {
  const { t, rpc, hub, workflow, session, cwd, sessionRows, catalog, onNotice } = input
  const entries = hub.list?.triggers
  const views = useMemo(
    () =>
      new Map(
        (entries ?? [])
          .filter((entry) => entry.workflow === workflow)
          .map((entry) => [idKey(entry.view.node), entry]),
      ),
    [entries, workflow],
  )

  const triggers = useMemo<Triggers>(
    () => ({
      view: (node) => views.get(idKey(node))?.view,
      owner: hub.list?.owner,
      hookOrigin: hub.list?.hookOrigin ?? '',
      reopen: (node) => hub.reopen(workflow, node),
      endpoint: (node) => hub.endpoint(workflow, node),
      fire: (node, info) => hub.fire(workflow, node, info ?? ''),
      history: (node, limit) => hub.history(workflow, node, limit),
      detail: hub.detail,
      cancel: hub.cancel,
      waive: (node) => hub.waive(workflow, node),
      output: hub.output(workflow),
      tryCommand: (request) => hub.tryCommand({ workflow, ...request }),
      ping: (node) => hub.ping(workflow, node),
    }),
    [views, hub, workflow],
  )

  const shells = useMemo(() => createShellAccess(rpc), [rpc])
  const workspaces = useMemo(() => knownWorkspaces(sessionRows, cwd), [sessionRows, cwd])
  const sessions = useMemo(() => sessionChoices(sessionRows), [sessionRows])
  const workflows = useMemo(() => workflowChoices(catalog, workflow), [catalog, workflow])

  const readRuns = useCallback(() => recentRuns(rpc), [rpc])
  const agents = useCallback(() => agentCatalog(rpc, session), [rpc, session])
  // 同一个工作流里的卡片带的工作流设置是同一份，取哪张的都一样。
  const workflowChoice = useMemo(
    () => [...views.values()][0]?.view.workflowChoice ?? NO_CHOICE,
    [views],
  )
  const onCatalogChanged = input.onCatalogChanged
  const turnOnRunState = useCallback(
    async (name: string): Promise<string | null> => {
      const problem = await enableRunState(rpc, name)
      if (problem === null) onCatalogChanged()
      return problem
    },
    [rpc, onCatalogChanged],
  )

  const patchCard = input.patch
  const patch = useCallback(
    (node: string, change: Partial<TriggerData>): Promise<string | null> =>
      patchCard(workflow, node, change),
    [patchCard, workflow],
  )

  const toggle = useCallback(
    (node: string, on: boolean): void => {
      const entry = views.get(idKey(node))
      if (entry === undefined) return
      void switchPatch(t, entry.data, on, () => hub.endpoint(workflow, node))
        .then((change) => (typeof change === 'string' ? change : patch(node, change)))
        .then((problem) => {
          if (problem !== null) onNotice(problem, 'error')
        })
    },
    [t, views, hub.endpoint, workflow, patch, onNotice],
  )

  return useMemo(
    () => ({
      triggers,
      workflow,
      here: { session, cwd },
      workspaces,
      shells,
      sessions,
      workflows,
      recentRuns: readRuns,
      agents,
      workflowChoice,
      enableRunState: turnOnRunState,
      patch,
      toggle,
      reveal: null,
      takeReveal: NO_REVEAL,
      editSource: NOTHING,
      openRun: input.openRun,
      openSession: input.openSession,
      openInHub: NOTHING,
      openSettings: null,
    }),
    [
      triggers,
      workflow,
      session,
      cwd,
      workspaces,
      shells,
      sessions,
      workflows,
      readRuns,
      agents,
      workflowChoice,
      turnOnRunState,
      patch,
      toggle,
      input.openRun,
    ],
  )
}
