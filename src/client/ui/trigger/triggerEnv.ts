/**
 * dsh-workflow-lite — 触发卡片的现场：每张卡片此刻的状态、开关与本机设置怎么改、能选哪些工作区和会话。
 *
 * 画布上的卡片和右栏的面板都从这里读（同一份状态，两处一起变）。模板视图给出来；
 * 实例视图不给（`null`）——那里的卡片只是执行时的快照，没有开关和状态。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/triggerEnv
 */

import { createContext, useContext } from 'react'
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
}

/** 面板里打开开关前要补的一项。 */
export type LaunchField = 'workspace' | 'session'

export interface TriggerEnv {
  triggers: Triggers
  /** 这个视图所在的会话与它的工作区（「当前会话」「当前工作区」）。 */
  here: { session?: string | undefined; cwd?: string | undefined }
  /** 已知的工作区目录（侧栏里各会话所在的）。 */
  workspaces: readonly string[]
  /** 可以选作「固定会话」的会话。 */
  sessions: readonly SessionChoice[]
  /** 接续触发能等的工作流（除了这一张之外的全部）。 */
  workflows: readonly WorkflowChoice[]
  /**
   * 开、关一张卡片。
   * - 要在本机跑命令、命令还没确认过：回 `'confirm'`，由点开关的那一处在开关旁边浮出确认卡（{@link approve}）；
   * - 开不了（还没选工作区、会话…）：说出原因，选中这张卡片，把面板里要补的那一项带到眼前（{@link reveal}）。
   */
  toggle(node: string, on: boolean): 'confirm' | 'done'
  /** 确认要运行的命令并打开开关；开不了时同 {@link toggle}。 */
  approve(node: string, command: string): void
  /** 刚请求「把要补的那一项带到眼前」的卡片；面板用 {@link takeReveal} 接手，接手后就清掉（重新挂上不会再来一次）。 */
  reveal: { node: string; field: LaunchField } | null
  /** 面板接手 {@link reveal}：是这张卡片的就回要补的那一项并清掉，否则 `null`。 */
  takeReveal(node: string): LaunchField | null
  /** 打开一次触发建出来的实例。 */
  openRun(instance: string): void
}

export const TriggerContext = createContext<TriggerEnv | null>(null)

export function useTriggerEnv(): TriggerEnv | null {
  return useContext(TriggerContext)
}
