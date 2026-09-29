/**
 * dsh-workflow-lite — 画布的 typed RPC 调用器。
 *
 * 走共享 Connection 的 `/api` 通道（与 host 侧 one-route-per-endpoint 对齐）。
 *
 * **为什么这里定义自己的载体接口而不是直接用 `ConnectionHandle`**：
 * `@deepseek-ai/dsh-client-connection` 的宿主半与客户端半**各自**给 `@deepseek-ai/cordis`
 * 的 `Context` 声明了 `connection`，同一个 TS 工程里两半都进来时那个字段的类型是冲突的
 * （生态里所有插件都在这里写断言）。我们改用**结构性收窄**：只声明自己真正要用的那一小块
 * （一个 `rpc.call`），运行时按形状校验——形状不对就响亮报错，而不是把坏值往后传。
 *
 * @module @xiaoso/dsh-workflow-lite/client/core/rpc
 */

import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { rpcTarget, type WorkflowLiteEndpoint, type WorkflowLiteRpcMap } from '../../shared/wire.ts'

/** 我们真正需要的那一小块 Connection 面。 */
export interface RpcCarrier {
  rpc: {
    call(
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ): Promise<ConnectionRpcResult<unknown>>
  }
}

/** 画布组件需要的调用面。 */
export interface WorkflowLiteRpc {
  call<K extends WorkflowLiteEndpoint>(
    endpoint: K,
    args: WorkflowLiteRpcMap[K]['args'],
  ): Promise<WorkflowLiteRpcMap[K]['result']>
}

/**
 * 按形状收窄出一个 RPC 载体。服务表的静态类型与运行时的对象不是同一半，
 * 所以这里做一次**运行时**校验：`rpc.call` 必须是函数，否则报错。
 * @param service - `ctx.get('connection')` 拿到的值（`unknown`）。
 * @returns 可用的载体。
 * @throws 当服务缺失或形状不对——宁可在注册时就炸，也不要在第一次保存时才炸。
 */
export function requireRpcCarrier(service: unknown): RpcCarrier {
  if (typeof service !== 'object' || service === null) {
    throw new Error('workflow-lite: connection service is unavailable')
  }
  const rpc = (service as { rpc?: unknown }).rpc
  if (typeof rpc !== 'object' || rpc === null) {
    throw new Error('workflow-lite: connection service has no rpc face')
  }
  const call = (rpc as { call?: unknown }).call
  if (typeof call !== 'function') {
    throw new Error('workflow-lite: connection rpc face has no call()')
  }
  const invoke = call as (
    this: unknown,
    ...args: unknown[]
  ) => Promise<ConnectionRpcResult<unknown>>
  const bound = (
    channel: string,
    endpoint: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<ConnectionRpcResult<unknown>> => invoke.call(rpc, channel, endpoint, payload, signal)
  return { rpc: { call: bound } }
}

/**
 * 端点失败——带 host 给的 `code` 与结构化 `detail`。
 *
 * 为什么不是裸 `Error`：`conflict` 的 `detail.ids` 是**冲突清单**，画布要靠它
 * 告诉用户"哪几个 id 双方都改过"。丢掉 detail 就只能显示一句"冲突了"。
 */
export class WorkflowLiteRpcError extends Error {
  /** host 的失败码（`not_found` / `invalid_args` / `blocked` / `conflict` / `io_error`）。 */
  readonly code: string
  /** 结构化补充（形状由各端点自己定；不认识就当空表）。 */
  readonly details: Record<string, unknown>

  constructor(code: string, message: string, details: unknown) {
    super(message)
    // `name` 同时当 code 用：调用方 `error.name` 就能拿到失败码（旧约定保持有效）。
    this.name = code
    this.code = code
    const record: Record<string, unknown> = {}
    if (details !== null && typeof details === 'object') {
      for (const [key, value] of Object.entries(details)) record[key] = value
    }
    this.details = record
  }
}

/**
 * 边界转换：端点返回的形状由 host 侧保证，客户端只挡"不是对象"这一种坏信封。
 * 不做逐字段深校验——那是 host 的职责，重复一遍只会两处漂移。
 */
function narrow<T extends object>(value: unknown): T {
  if (value === null || typeof value !== 'object') {
    throw new Error('workflow_lite rpc: malformed payload')
  }
  return value as T
}

/** 建一个调用器。 */
export function createWorkflowLiteRpc(carrier: RpcCarrier): WorkflowLiteRpc {
  return {
    async call<K extends WorkflowLiteEndpoint>(
      endpoint: K,
      args: WorkflowLiteRpcMap[K]['args'],
    ): Promise<WorkflowLiteRpcMap[K]['result']> {
      // 通道与端点名走 shared 的唯一出处：通道必须是 `/api`，端点名**不再**重复带通道名。
      const { channel, endpoint: method } = rpcTarget(endpoint)
      const result = await carrier.rpc.call(channel, method, args)
      if (!result.ok) {
        throw new WorkflowLiteRpcError(
          result.error.code,
          result.error.message,
          result.error.details,
        )
      }
      return narrow<WorkflowLiteRpcMap[K]['result']>(result.value)
    },
  }
}
