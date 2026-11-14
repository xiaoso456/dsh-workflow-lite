/**
 * dsh-workflow-lite — 触发器的画布 RPC 形状：一张触发卡片现在的样子、触发记录、本机设置。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/trigger
 */

import type { FireChannel } from '../trigger.ts'
import type { TriggerData } from '../types.ts'

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
 * - `unavailable` 这里触发不了（发不了会话），`problem` 写原因；
 * - `paused` 开着，但这台机器上的触发器「全部暂停」了（开关不动，恢复后接着跑）。
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
  | 'paused'

/** HTTP 触发的地址与令牌（本机状态；只给画布看）。 */
export interface TriggerEndpoint {
  /** 别人连的网址（地址里的中文等已转义）。 */
  url: string
  /** `/trigger/` 后面那一段（原样）。 */
  hook: string
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
  /** 监听程序最近打出的一行与时刻（画布卡片上显示）。 */
  line?: { at: number; text: string }
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
  /** 「全部暂停」着：从什么时候起。 */
  paused?: number
}

/** 工作流中心「触发」页里的一张卡片：在哪个工作流、叫什么、怎么触发，以及现在的样子。 */
export interface TriggerEntry {
  workflow: string
  name: string
  data: TriggerData
  view: TriggerView
}

/** 这台机器上所有工作流里的触发卡片（按工作流名、再按图里的先后）。 */
export interface TriggerAllResponse {
  triggers: TriggerEntry[]
  owner?: TriggerOwner
  paused?: number
}

/**
 * HTTP 触发的端口现在的样子（设置页「监听状态」）：按负责触发的那个 DSH 进程写下的说。
 * - `idle`：没有打开的 HTTP 触发卡片，端口没占用；
 * - `open`：正在监听，`url` 是别人连的地址（监听所有网卡时是某块网卡的地址）；
 * - `error`：开不了（端口被占用、地址不在本机），`problem` 是原因；
 * - `away`：没有 DSH 进程在负责触发。
 */
export type TriggerHttpStatus =
  | { state: 'idle' }
  | { state: 'open'; host: string; port: number; url: string }
  | { state: 'error'; problem: string }
  | { state: 'away' }

/** 全部暂停 / 恢复。 */
export interface TriggerPauseRequest {
  paused: boolean
}

export interface TriggerPauseResponse {
  paused?: number
}

/** 改本机设置：开关、工作区、固定会话、确认命令、HTTP 的地址与令牌。给了哪项改哪项。 */
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
  /** HTTP 触发：换一个随机的新令牌（旧的马上作废）。 */
  resetToken?: true
  /** HTTP 触发：自己写的地址（`/trigger/` 后面那一段，不能和别的卡片重）。 */
  hook?: string
  /** HTTP 触发：自己写的令牌（至少 16 个字）。 */
  token?: string
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
  /** 最多要几条（缺省 50，上限是存下的全部）。 */
  limit?: number
}

export interface TriggerHistoryResponse {
  /** 新的在前。 */
  fires: FireRecord[]
}

export interface TriggerDetailRequest {
  /** 触发编号（记录的 `id`）。 */
  fire: string
}

/** 一次触发那一刻带的东西；记录已经被挤掉、或那次什么都没带时各项都没有。 */
export interface TriggerDetailResponse {
  note?: string
  condition?: string
  /** 背景信息；太长时只给开头（{@link infoClipped}）。 */
  info?: string
  infoClipped?: true
  /** 合并窗口里并进来了几次（多于一次才有）。 */
  merged?: number
}

export interface TriggerOutputRequest {
  workflow: string
  node: string
}

/** 轮询命令、监听程序最近的输出（负责触发的进程写下的）；还没有是空串。 */
export interface TriggerOutputResponse {
  text: string
}
