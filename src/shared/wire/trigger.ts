/**
 * dsh-workflow-lite — 触发器的画布 RPC 形状：一张触发卡片现在的样子、触发记录、本机设置。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/trigger
 */

import type { FireChannel } from '../trigger.ts'

/** 一次触发的结果：消息发进会话了 / 被跳过（没轮到它）/ 没发出去。 */
export type FireOutcome = 'sent' | 'skipped' | 'failed'

/** 触发记录里的一条。 */
export interface FireRecord {
  /** 触发编号：写在发进会话的消息里，模型开始执行时带回来（实例据此记下来源）。 */
  id: string
  workflow: string
  /** 触发卡片的 id 与当时的名字。 */
  node: string
  name: string
  channel: FireChannel
  /** 触发时刻（epoch 毫秒）。 */
  at: number
  outcome: FireOutcome
  /** 跳过、没发出去的原因。 */
  reason?: string
  /** 发进了哪个会话。 */
  session?: string
  /** 模型开始执行后建出来的实例；还没开始就没有。 */
  instance?: string
  /** 卡片有触发条件、模型判断这次不需要执行时，它给的原因（发出去了，但没开始工作流）。 */
  declined?: string
}

/**
 * 卡片上的状态：
 * - `off` 开关关着；`waiting` 开着、等下一次（定时到点、轮询的下一次检查）；
 * - `listening` 开着、在等外面来（监听程序在跑、HTTP 地址开着）；
 * - `restarting` 监听程序退出了，等着重启；`error` 起不来（端口被占），`problem` 写原因；
 * - `invalid` 开着但触发源写得不对；`confirm` 开着，但要运行的命令（或工作区）改过了，要重新确认才跑；
 * - `stopped` 连续失败被自动停用（开关已被关掉）；
 * - `elsewhere` 开着，但负责触发的是另一个 DSH 进程；
 * - `unavailable` 这里触发不了（发不了会话），`problem` 写原因。
 */
export type TriggerState =
  | 'off'
  | 'waiting'
  | 'listening'
  | 'restarting'
  | 'error'
  | 'invalid'
  | 'confirm'
  | 'stopped'
  | 'elsewhere'
  | 'unavailable'

/** HTTP 触发的地址与令牌（本机状态；只给画布看）。 */
export interface TriggerEndpoint {
  url: string
  token: string
}

/** 负责触发的那个 DSH 进程。 */
export interface TriggerOwner {
  /** 是不是回答这次请求的这个进程。 */
  mine: boolean
  pid: number
  /** 它开始负责的时刻。 */
  since: number
}

/** 一张触发卡片现在的样子（定义在图里，其余是本机状态）。 */
export interface TriggerView {
  node: string
  enabled: boolean
  state: TriggerState
  /** 下一次触发（定时）、下一次检查（轮询）、下一次重启（监听程序）的时刻。 */
  next?: number
  /** `invalid` / `confirm` / `stopped` / `unavailable` / `restarting` / `error` 的原因。 */
  problem?: string
  /** 条件轮询上一次检查：时刻、触发了没有。 */
  checked?: { at: number; met: boolean }
  /** 监听程序这次启动的时刻。 */
  since?: number
  /** 要运行的命令（轮询、监听）已经在本机确认过、而且之后没改过。 */
  approved?: boolean
  /** HTTP 触发：地址与令牌（打开过开关之后才有）。 */
  endpoint?: TriggerEndpoint
  /** 新建会话用的工作区目录。 */
  workspace?: string
  /** 「固定会话」用的那个会话。 */
  session?: string
  /** 最近一次触发。 */
  last?: FireRecord
}

export interface TriggerListResponse {
  triggers: TriggerView[]
  /** 现在由谁负责触发；还没有进程负责时没有。 */
  owner?: TriggerOwner
}

/** 改本机设置：开关、工作区、固定会话、确认命令、换令牌。给了哪项改哪项。 */
export interface TriggerSetRequest {
  workflow: string
  node: string
  enabled?: boolean
  workspace?: string
  /** 空串 = 清掉。 */
  session?: string
  /**
   * 确认要运行的命令（轮询、监听）：原样带上用户看到的那条命令，和图里现在的对得上才算数。
   * 命令以 DSH 进程的身份在工作区里运行、不进沙箱，所以开之前要确认；命令或工作区改了要重新确认。
   */
  approve?: string
  /** HTTP 触发：换一个新令牌（旧的马上作废）。 */
  resetToken?: true
}

export interface TriggerFireRequest {
  workflow: string
  node: string
  /** 手填的背景信息。 */
  info?: string
}

export interface TriggerListRequest {
  workflow: string
}

export interface TriggerHistoryRequest {
  workflow: string
  /** 只看这张卡片的。 */
  node?: string
}

export interface TriggerHistoryResponse {
  /** 新的在前。 */
  fires: FireRecord[]
}

export interface TriggerOutputRequest {
  workflow: string
  node: string
}

/** 轮询命令、监听程序最近的输出（负责触发的进程写下的）；还没有是空串。 */
export interface TriggerOutputResponse {
  text: string
}
