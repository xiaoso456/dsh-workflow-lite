/**
 * dsh-workflow-lite — 触发卡片的现场：每张卡片此刻的状态、开关与本机设置怎么改、能选哪些工作区和会话。
 *
 * 画布上的卡片和右栏的面板都从这里读（同一份状态，两处一起变）。模板视图给出来；
 * 实例视图不给（`null`）——那里的卡片只是执行时的快照，没有开关和状态。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/triggerEnv
 */

import { createContext, useContext } from 'react'
import type { SessionChoice as AgentChoice } from '../../../shared/types.ts'
import type { GraphListResponse } from '../../../shared/wire/graph.ts'
import type { HostAgentsResponse } from '../../../shared/wire/host.ts'
import type { TriggerWaiting } from '../../../shared/wire/trigger.ts'
import type { SessionRow } from '../../app/sessions.ts'
import type { ShellAccess } from '../../app/shells.ts'
import type { Triggers } from '../../app/useTriggers.ts'
import type { RunBrief } from '../../app/workflowRuns.ts'
import type { T } from '../../i18n.ts'
import { type PrevRunText, prevRunText } from '../../model/prevRun.ts'

export type { RunBrief } from '../../app/workflowRuns.ts'

/** 可以选的一个会话。 */
export interface SessionChoice {
  id: string
  title: string
}

/** 接续触发可以等的一个工作流。 */
export interface WorkflowChoice {
  name: string
  /** 开着「记录运行状态」（没开的看不出什么时候跑完）。 */
  runState: boolean
  /** 图里有几张卡片。 */
  nodes: number
}

/** 面板里打开开关前要补的一项。 */
export type LaunchField = 'workspace' | 'session'

/** 请面板接手的一件事：把要补的那一项带到眼前，或者打开「触发方式」对话框（画布上点了卡片的速览）。 */
export type RevealField = LaunchField | 'source'

export interface TriggerEnv {
  triggers: Triggers
  /** 正在编辑的工作流名。 */
  workflow: string
  /** 这个视图所在的会话与它的工作区（「当前会话」「当前工作区」）。 */
  here: { session?: string | undefined; cwd?: string | undefined }
  /** 已知的工作区目录（侧栏里各会话所在的）。 */
  workspaces: readonly string[]
  /** 轮询、监听选 shell 用。 */
  shells: ShellAccess
  /** 可以选作「固定会话」的会话。 */
  sessions: readonly SessionChoice[]
  /** 接续触发能等的工作流（除了这一张之外的全部）。 */
  workflows: readonly WorkflowChoice[]
  /** 读 DSH 里能选的 agent 预设、模型（执行设置里的下拉打开前读，一页里只问一次）。 */
  agents(): Promise<HostAgentsResponse>
  /** 这个工作流设置里写的预设、模型（卡片上「跟随工作流」时用的就是它）。 */
  workflowChoice: AgentChoice
  /** 各工作流最近的几次执行（按工作流名，新的在前，每个最多几个，见 `app/workflowRuns.ts`）；读不到是空的。 */
  recentRuns(): Promise<ReadonlyMap<string, readonly RunBrief[]>>
  /** 在另一个工作流的设置里打开「记录运行状态」（接续触发要靠它）；打不开回一句原因。 */
  enableRunState(workflow: string): Promise<string | null>
  /**
   * 开、关一张卡片。
   * - 要在本机跑命令、命令还没确认过：回 `'confirm'`，由点开关的那一处在开关旁边浮出确认卡（{@link approve}）；
   * - 开不了（还没选工作区、会话…）：说出原因，选中这张卡片，把面板里要补的那一项带到眼前（{@link reveal}）。
   */
  toggle(node: string, on: boolean): 'confirm' | 'done'
  /** 确认要运行的命令并打开开关；开不了时同 {@link toggle}。 */
  approve(node: string, command: string): void
  /** 刚请求面板接手的事；面板用 {@link takeReveal} 接手，接手后就清掉（重新挂上不会再来一次）。 */
  reveal: { node: string; field: RevealField } | null
  /** 面板接手 {@link reveal}：是这张卡片的、又是 `fields` 里的一项就回那一项并清掉，否则 `null`。 */
  takeReveal<F extends RevealField>(node: string, fields: readonly F[]): F | null
  /** 选中这张卡片并打开它的「触发方式」对话框（画布上点卡片的速览）。 */
  editSource(node: string): void
  /** 打开一次触发建出来的实例。 */
  openRun(instance: string): void
  /** 跳到一个会话（和点侧栏一样；排着的在等的那个）。跳不了（会话服务没接上）回 `false`。 */
  openSession(session: string): boolean
  /** 打开工作流中心「触发」页、选中这张卡片（面板的「全部记录」、画布卡片上的工具条和失败小卡）。 */
  openInHub(node: string): void
}

/** 已知的工作区：这个会话的排最前，其余按侧栏里会话的顺序，去重。 */
export function knownWorkspaces(rows: readonly SessionRow[], cwd: string | undefined): string[] {
  const seen = new Set<string>()
  if (cwd !== undefined && cwd !== '') seen.add(cwd)
  for (const row of rows) {
    if (!row.subagent && row.cwd !== undefined && row.cwd !== '') seen.add(row.cwd)
  }
  return [...seen]
}

/** 可以选作「固定会话」的会话（子代理的不算）。 */
export function sessionChoices(rows: readonly SessionRow[]): SessionChoice[] {
  return rows
    .filter((row) => !row.subagent)
    .map((row) => ({ id: row.id, title: row.title === '' ? row.id : row.title }))
}

/** 接续触发能等的工作流：不含 `self`（等自己跑完会一直触发自己），按名称排。 */
export function workflowChoices(
  catalog: GraphListResponse | null,
  self: string | null,
): WorkflowChoice[] {
  return (catalog?.workflows ?? [])
    .filter((entry) => entry.name !== self)
    .map((entry) => ({
      name: entry.name,
      runState: entry.runState === true,
      nodes: entry.nodeCount,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** 上次执行所在的会话：会话列表里找得到就有名字、点了打开；找不到（会话删了）两样都没有。 */
export interface PrevSession {
  title?: string | undefined
  open?: (() => void) | undefined
}

/** 在等的上次执行：什么时候触发的、现在怎样（{@link prevRunText}）、在哪个会话（发进去了才有）。 */
export interface PrevRunView extends PrevRunText {
  at: number
  session?: PrevSession | undefined
}

/** 在等的上次执行（`TriggerView.waiting`）怎么写；没有在等的是 `undefined`。 */
export function prevRunView(
  t: T,
  env: Pick<TriggerEnv, 'openSession' | 'sessions'>,
  waiting: TriggerWaiting | undefined,
  now: number,
): PrevRunView | undefined {
  if (waiting === undefined) return undefined
  const id = waiting.session
  const title = id === undefined ? undefined : env.sessions.find((row) => row.id === id)?.title
  return {
    ...prevRunText(t, waiting, now),
    at: waiting.at,
    ...(id === undefined
      ? {}
      : {
          session:
            title === undefined
              ? {}
              : {
                  title,
                  open: () => {
                    env.openSession(id)
                  },
                },
        }),
  }
}

export const TriggerContext = createContext<TriggerEnv | null>(null)

export function useTriggerEnv(): TriggerEnv | null {
  return useContext(TriggerContext)
}
