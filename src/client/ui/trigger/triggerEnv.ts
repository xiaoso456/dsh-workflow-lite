/**
 * dsh-workflow-lite — 触发卡片的现场：每张卡片此刻的状态、开关与本机设置怎么改、能选哪些工作区和会话。
 *
 * 画布上的卡片和右栏的面板都从这里读（同一份状态，两处一起变）。模板视图给出来；
 * 实例视图不给（`null`）——那里的卡片只是执行时的快照，没有开关和状态。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/triggerEnv
 */

import { createContext, useContext } from 'react'
import type { RunStatus } from '../../../shared/runState.ts'
import type { Triggers } from '../../app/useTriggers.ts'

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

/** 每个工作流最多列几次执行。 */
export const RECENT_RUNS = 6

/** 一个工作流的一次执行（一个实例）。 */
export interface RunBrief {
  /** 实例 id。 */
  id: string
  /** 状态文件里写的；读不出来是 `undefined`。 */
  status?: RunStatus
  /** 最后一次更新的时刻。 */
  at: number
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
  /** 可以选作「固定会话」的会话。 */
  sessions: readonly SessionChoice[]
  /** 接续触发能等的工作流（除了这一张之外的全部）。 */
  workflows: readonly WorkflowChoice[]
  /** 各工作流最近的几次执行（按工作流名，新的在前，每个最多 {@link RECENT_RUNS} 个）；读不到是空的。 */
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
  /** 到工作流中心「触发」页看这张卡片的全部触发记录。 */
  openHistory(node: string): void
}

export const TriggerContext = createContext<TriggerEnv | null>(null)

export function useTriggerEnv(): TriggerEnv | null {
  return useContext(TriggerContext)
}
