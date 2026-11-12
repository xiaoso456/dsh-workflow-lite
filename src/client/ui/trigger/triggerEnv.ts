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

export interface TriggerEnv {
  triggers: Triggers
  /** 这个视图所在的会话与它的工作区（「当前会话」「当前工作区」）。 */
  here: { session?: string | undefined; cwd?: string | undefined }
  /** 已知的工作区目录（侧栏里各会话所在的）。 */
  workspaces: readonly string[]
  /** 可以选作「固定会话」的会话。 */
  sessions: readonly SessionChoice[]
  /**
   * 开、关一张卡片；开不了（还没选工作区…）时选中它并说出原因。
   * 要在本机跑命令、命令还没确认过的：不直接打开，选中它、在面板里请用户确认命令（{@link ask}）。
   */
  toggle(node: string, on: boolean): void
  /** 刚请求确认命令的那张卡片（`seq` 每请求一次加一，面板据此弹出确认卡）。 */
  ask: { node: string; seq: number } | null
  /** 打开一次触发建出来的实例。 */
  openRun(instance: string): void
}

export const TriggerContext = createContext<TriggerEnv | null>(null)

export function useTriggerEnv(): TriggerEnv | null {
  return useContext(TriggerContext)
}
