/**
 * dsh-workflow-lite — 触发器的画布 RPC 形状：一张触发卡片现在的样子、触发记录、运行情况。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/wire/trigger
 */

import type { RunStatus } from '../runState.ts'
import type { FireChannel } from '../trigger.ts'
import type { SessionAgent, SessionChoice, TriggerData } from '../types.ts'

export type { ShellChoice, ShellFamily, TriggerShellsResponse } from '../types.ts'

/**
 * 一次触发的结果：消息发进会话了 / 被跳过（没轮到它）/ 没发出去 / 排着队（上一次还没跑完，轮到了再发）。
 * 排着的轮到时原地改成发出去或没发出去；关掉卡片、取消的改成跳过。
 */
export type FireOutcome = 'sent' | 'skipped' | 'failed' | 'queued'

/** 已经有结果的那几种（近况只数这些）。 */
export type FireSettled = Exclude<FireOutcome, 'queued'>

/** 触发记录里的一条。 */
export interface FireRecord {
  /** 触发编号：写在发进会话的消息里，模型开始执行时带回来（实例据此记下来源）。 */
  id: string
  workflow: string
  /** 触发卡片的 id 与当时的名字。 */
  node: string
  name: string
  channel: FireChannel
  /** 触发时刻（epoch 毫秒）；排过队的是收到的时刻。 */
  at: number
  outcome: FireOutcome
  /** 排过队的：轮到、发出去（或没发出去）的时刻。 */
  sentAt?: number
  /** 跳过、没发出去的原因。 */
  reason?: string
  /** 新建了会话时设的预设、模型和没用上、回退了默认的那几项（发进现成的会话、什么都没设时没有）。 */
  agent?: SessionAgent
  /** 发进了哪个会话。 */
  session?: string
  /** 这次触发记到了哪个实例上：模型为它建的，或者（{@link joined}）它发进来时模型接着做的；还没开始就没有。 */
  instance?: string
  /** 没有另建实例，模型在会话里原来的实例 {@link instance} 里接着做了。 */
  joined?: true
  /** 卡片有触发条件、模型判断这次不需要执行时，它给的原因（发出去了，但没开始工作流）。 */
  declined?: string
  /** 排队中的：背景信息开头的一行（列表里看得出排着的是哪一件事）。 */
  preview?: string
}

/**
 * 卡片上的状态：
 * - `off` 开关关着；`waiting` 开着、等下一次（定时到点、轮询的下一次检查）；
 * - `listening` 开着、在等外面来（监听程序在跑、HTTP 地址开着）；
 * - `restarting` 监听程序退出了，等着重启；`error` 起不来（端口被占），`problem` 写原因；
 * - `invalid` 开着但设置有误（触发源写得不对、缺工作区或会话、地址和别的卡片重了…），`problem` 写原因；
 * - `stopped` 连续失败被自动停用（开关还开着，「重新启用」或关了再开才接着跑）；
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
  | 'stopped'
  | 'elsewhere'
  | 'unavailable'
  | 'paused'

/** 负责触发的那个 DSH 进程。 */
export interface TriggerOwner {
  /** 是不是回答这次请求的这个进程。 */
  mine: boolean
  pid: number
  /** 它开始负责的时刻。 */
  since: number
}

/** 一张触发卡片现在的样子（定义和设置在图里，这里是跑起来的情况）。 */
export interface TriggerView {
  node: string
  /** 图里的开关开着（自动停用了的也算开着，看 `state`）。 */
  enabled: boolean
  state: TriggerState
  /** 下一次触发（定时）、下一次检查（轮询）、下一次重启（监听程序）的时刻。 */
  next?: number
  /** `invalid` / `stopped` / `unavailable` / `restarting` / `error` 的原因。 */
  problem?: string
  /** 条件轮询上一次检查：时刻、触发了没有。 */
  checked?: { at: number; met: boolean }
  /** 监听程序这次启动的时刻。 */
  since?: number
  /** 监听程序最近打出的一行与时刻（画布卡片上显示）。 */
  line?: { at: number; text: string }
  /** 监听程序最近一次记下输出（标准输出、错误输出都算）的时刻；最近的输出跟着它重读。 */
  output?: number
  /** 轮询、监听：实际用哪个 shell 跑（卡片上选的，没选是默认的）。 */
  runShell?: { path: string; name: string }
  /** HTTP：别人连的网址（图里写了地址才有；地址里的中文等已转义）。 */
  url?: string
  /** 最近一次触发。 */
  last?: FireRecord
  /** 最近一次失败的时刻（没失败过不给）：界面拿它和本机记的「看到哪儿了」比，有没看过的失败就亮红点。 */
  lastFailure?: number
  /** 排着队的有几个（没有不给）。 */
  queued?: number
  /**
   * 在等哪一次跑完：有排着的、或选了跳过而最近一次因为上一次没结束被跳过了，且上一次还没结束时才给
   * （「视为已结束」就是对它说的）。
   */
  waiting?: TriggerWaiting
  /** 所在工作流开着「记录运行状态」（跳过、排队靠它判断上一次结束没有）。 */
  runState?: true
  /** 所在工作流设置里写的预设、模型（卡片上「跟随工作流」时用的就是它）；都没写不给。 */
  workflowChoice?: SessionChoice
  /** 接续触发：等的那个工作流最新的实例现在怎样（选了工作流、它有实例时才给）。 */
  upstream?: TriggerUpstream
}

/** 接续触发等的那个工作流最新的实例。 */
export interface TriggerUpstream {
  id: string
  /** 整体状态；没记运行状态、读不出来不给。 */
  status?: RunStatus
  /** 最近一次动静的时刻（状态文件最后改动的时刻，没有就是建的时刻）。 */
  at: number
}

/**
 * 排着的在等的那一次：上一次触发发起的执行。按运行状态算结束（见 `host/triggers/runEnd.ts`），
 * 所以还没对上实例（模型还没编译）、或模型还没把状态改成结束，都算没跑完。
 */
export interface TriggerWaiting {
  /** 上一次触发的编号。 */
  fire: string
  /** 上一次触发的时刻（时间线上那一行写的钟点）。 */
  at: number
  /** 发进去的会话。 */
  session?: string
  /** 对上的实例；还没对上不给。 */
  instance?: string
  /** 实例运行状态里的整体状态；还没对上实例、实例没有状态文件时不给。 */
  status?: RunStatus
  /** 从什么时候起没动静：状态文件最后改动的时刻；还没对上实例时是发出去的时刻。 */
  since: number
}

export interface TriggerListResponse {
  triggers: TriggerView[]
  /** 现在由谁负责触发；还没有进程负责时没有。 */
  owner?: TriggerOwner
  /** 「全部暂停」着：从什么时候起。 */
  paused?: number
  /** HTTP 触发别人连的网址开头（`http://地址:端口`），后面接 `hookPath(地址)`。 */
  hookOrigin: string
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
  hookOrigin: string
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

/** 「重新启用」一张自动停用了的卡片。 */
export interface TriggerReopenRequest {
  workflow: string
  node: string
}

/** HTTP 触发：给一个没被别的卡片用的地址和一个随机令牌（对话框里换到 HTTP、换令牌时用）。 */
export interface TriggerEndpointRequest {
  workflow: string
  node: string
}

export interface TriggerEndpointResponse {
  hook: string
  token: string
  /** 别的卡片已经用了的地址（自己写地址时当场说重了）。 */
  taken: string[]
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

/** 一张卡片一段时间里触发了多少次（「触发」页概览的数和节律）。 */
export interface TriggerActivityRequest {
  workflow: string
  node: string
  /** 从什么时候起（epoch 毫秒）；到现在为止。 */
  since: number
}

/** 一格时间（15 分钟）里某种结果的次数。 */
export interface TriggerActivitySlot {
  /** 这一格的开始（epoch 毫秒）。 */
  at: number
  outcome: FireSettled
  count: number
}

export interface TriggerActivityResponse {
  /** 从早到晚；一次都没有的格子不给。 */
  slots: TriggerActivitySlot[]
}

/** 记到一个实例上的触发：建出它的那次（`joined` 没有），接着它做的几次（`joined`）。 */
export interface TriggerOfInstanceRequest {
  instance: string
}

export interface TriggerOfInstanceResponse {
  /** 从早到晚。 */
  fires: FireRecord[]
}

export interface TriggerDetailRequest {
  /** 触发编号（记录的 `id`）。 */
  fire: string
}

/** 取消排着的一次（记成跳过）。 */
export interface TriggerCancelRequest {
  /** 触发编号（记录的 `id`）。 */
  fire: string
}

/** 视为已结束：把上一次发起的那次执行当作已经结束（跳过的下一次照常触发，排着的下一个接着发）。 */
export interface TriggerWaiveRequest {
  workflow: string
  node: string
}

/** 清空一张卡片排着的（都记成跳过）。 */
export interface TriggerClearQueueRequest {
  workflow: string
  node: string
}

export interface TriggerClearQueueResponse {
  /** 清掉了几个。 */
  cleared: number
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

/** 最近的输出里一行的长度上限（字符）；再长的截断，记下原来多大。 */
export const OUTPUT_LINE_MAX_CHARS = 2000

/**
 * 最近的输出里的一条：轮询的一次检查（连着结果和输出都一样的几次合成一条），或监听程序的一次运行（启动到退出）。
 * - `met` / `unmet` / `fail`：检查触发了、条件不满足、命令没跑成；
 * - `running` / `exited` / `stopped`：程序在跑、自己退出了、被停下（关了开关、改了设置、DSH 退出）；
 *   启动不了、找不到命令的那次是 `fail`。
 */
export type OutputVerdict = 'met' | 'unmet' | 'fail' | 'running' | 'exited' | 'stopped'

export interface OutputEntry {
  /** 编号（读这一条的输出用）。 */
  id: number
  kind: 'check' | 'run'
  /** 检查的时刻（合成的是最早那次）、程序启动的时刻。 */
  at: number
  /** 合成的检查：最近那次的时刻（展开看到的是那一次的输出）。 */
  last?: number
  /** 程序退出、被停下的时刻。 */
  end?: number
  verdict: OutputVerdict
  /** 退出码；没退出（超时被结束、被信号结束、还在跑）是 `null`。 */
  code: number | null
  /** 给人看的一句：没跑成的原因、程序退出的说法、「第一次检查，只记下输出」。 */
  note?: string
  /** 检查用了多久（毫秒）。 */
  ms?: number
  /** 存着几行输出。 */
  lines: number
  /** 合成了几次（多于一次才有）。 */
  count?: number
  /** 一眼看的那一行：检查是输出的第一行，运行是最后一行；没有输出是空串。 */
  preview: string
}

/** 「全部 / 触发 / 没跑成」三档。 */
export type OutputFilter = 'all' | 'met' | 'fail'

export interface TriggerOutputRequest {
  workflow: string
  node: string
  /** 缺省 `all`。 */
  filter?: OutputFilter
  /** 最多给几条，缺省、最多见宿主。 */
  limit?: number
}

/** 轮询命令、监听程序最近的输出：一条一条，新的在前（只有摘要，每条的输出另读）。 */
export interface TriggerOutputResponse {
  entries: OutputEntry[]
  /** 各档有几次（合成的按次数算），筛选分段上的数。 */
  counts: Record<OutputFilter, number>
  /** 按筛选还有更多没给。 */
  more: boolean
  /** 更早的输出因为超过保留行数丢掉过（清空之后重新算）。 */
  dropped: boolean
  /** 现在每张卡片保留多少行（插件设置）。 */
  keep: number
}

export interface OutputLine {
  at: number
  stream: 'out' | 'err'
  text: string
  /** 连着一模一样的这一行打了几次（多于一次才有）。 */
  repeat?: number
  /** 截断了：原来这一行多少字节。 */
  size?: number
}

export interface TriggerOutputLinesRequest {
  workflow: string
  node: string
  /** 读哪几条（{@link OutputEntry.id}）。 */
  entries: number[]
  /** 每条只要最后几行；不给是全部。 */
  tail?: number
}

export interface TriggerOutputLinesResponse {
  /** 按请求的顺序；已经被挤掉、清空了的不给。 */
  entries: { id: number; total: number; lines: OutputLine[] }[]
}

export interface TriggerOutputClearRequest {
  workflow: string
  node: string
}

/**
 * `trigger/try`：「触发方式」对话框里的「试运行」——把还没保存的命令在选定的工作区里跑一次给人看。
 * 不看开关、不记触发记录、不发进会话；用户在界面上确认过才发（命令以 DSH 进程的身份运行、不进沙箱）。
 */
export interface TriggerTryRequest {
  workflow: string
  /** 哪张卡片（脚本的数据目录按它给，用试运行那份）。 */
  node: string
  /** 定时的检查命令：跑完为止；监听：跑几秒、收下这几秒打出的行就结束。 */
  kind: 'check' | 'listen'
  command: string
  /** 在哪个目录里跑（卡片上设的工作目录）；不给是卡片目录。 */
  cwd?: string
  /** 卡片上选的会话工作区（经环境变量交给脚本）。 */
  workspace?: string
  /** 用哪个 shell（程序的完整路径）；不给或空串 = 跟着默认。 */
  shell?: string
}

/** 试运行打出的一行。 */
export interface TryLine {
  stream: 'out' | 'err'
  text: string
}

export interface TriggerTryResponse {
  /** 退出码；没跑起来、超时、监视到点被结束时是 `null`。 */
  code: number | null
  /** 两路输出的行（检查是标准输出在前、错误输出在后，监视按打出的先后；只留最后一截）。 */
  lines: TryLine[]
  /**
   * 标准输出里 `::trigger::` 开头的行数（见 `shared/triggerMark.ts`）：监视的每一行启用后触发一次；
   * 定时检查有它们时只有这几行是背景信息。
   */
  events: number
  /** 跑了多久（毫秒）。 */
  ms: number
  /** 监听：到点时程序还在跑，是试运行结束了它。 */
  stopped?: true
  /** 命令没跑成（启动不了、找不到命令、超时）的原因。 */
  failure?: string
}

/**
 * `trigger/ping`：HTTP 触发「发一条测试请求」——带上令牌向这张卡片的地址真的发一条 POST，
 * 和别的程序发来的一样走过滤、发进会话、记进触发记录。
 */
export interface TriggerPingRequest {
  workflow: string
  node: string
}

export interface TriggerPingResponse {
  /** HTTP 状态码（202 = 收下了）。 */
  status: number
  /** 回应的正文（只留开头）。 */
  text: string
}

/** `trigger/shell`：认一个自己选的程序能不能当 shell 用。 */
export interface TriggerShellRequest {
  path: string
}
