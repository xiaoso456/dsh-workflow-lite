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
}

/**
 * 卡片上的状态：
 * - `off` 开关关着；`waiting` 开着、等下一次；`invalid` 开着但定时规则写得不对；
 * - `stopped` 连续失败被自动停用（开关已被关掉）；
 * - `elsewhere` 开着，但负责触发的是另一个 DSH 进程；
 * - `unavailable` 这个 DSH 里发不了会话（缺服务）。
 */
export type TriggerState = 'off' | 'waiting' | 'invalid' | 'stopped' | 'elsewhere' | 'unavailable'

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
  /** 下一次触发的时刻（`waiting`、`elsewhere` 时有）。 */
  next?: number
  /** `invalid` / `stopped` / `unavailable` 的原因。 */
  problem?: string
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

/** 改本机设置：开关、工作区、固定会话。给了哪项改哪项。 */
export interface TriggerSetRequest {
  workflow: string
  node: string
  enabled?: boolean
  workspace?: string
  /** 空串 = 清掉。 */
  session?: string
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
