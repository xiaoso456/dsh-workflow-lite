/**
 * dsh-workflow-lite — 画布的 typed RPC 调用器。
 *
 * 走共享 Connection 的 `/api` 通道（与 host 侧 one-route-per-endpoint 对齐）。
 *
 * 这里定义自己的载体接口而不直接用 `ConnectionHandle`：`dsh-client-connection` 的宿主半与
 * 客户端半各自给 cordis 的 `Context` 声明了 `connection`，两半同进一个 TS 工程时类型冲突。
 * 所以只按**形状**收窄出要用的那一小块（一个 `rpc.call`），运行时校验、不对就响亮报错。
 *
 * @module @xiaoso/dsh-workflow-lite/client/rpc
 */

import type { ConnectionRpcResult } from '@deepseek-ai/dsh-client-connection'
import { rpcTarget, type WorkflowLiteEndpoint, type WorkflowLiteRpcMap } from '../shared/wire.ts'

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

/** 画布需要的调用面。 */
export interface WorkflowLiteRpc {
  call<K extends WorkflowLiteEndpoint>(
    endpoint: K,
    args: WorkflowLiteRpcMap[K]['args'],
  ): Promise<WorkflowLiteRpcMap[K]['result']>
}

/**
 * 按形状收窄出一个 RPC 载体。
 * @param service - `ctx.get('connection')` 拿到的值。
 * @throws 服务缺失或形状不对——宁可注册时就炸，也不要第一次保存时才炸。
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
  return {
    rpc: {
      call: (channel, endpoint, payload, signal) =>
        invoke.call(rpc, channel, endpoint, payload, signal),
    },
  }
}

/** 端点失败——带 host 给的 `code` 与结构化 `details`（`conflict` 的冲突清单就在里面）。 */
export class WorkflowLiteRpcError extends Error {
  /** host 的失败码（`not_found` / `invalid_args` / `blocked` / `conflict` / `io_error`）。 */
  readonly code: string
  readonly details: ReadonlyMap<string, unknown>

  constructor(code: string, message: string, details: unknown) {
    super(message)
    this.name = 'WorkflowLiteRpcError'
    this.code = code
    this.details = new Map(
      details !== null && typeof details === 'object' ? Object.entries(details) : [],
    )
  }
}

/** 错误的失败码；不是端点失败就给 `undefined`。 */
export function errorCode(error: unknown): string | undefined {
  return error instanceof WorkflowLiteRpcError ? error.code : undefined
}

/** 错误的人话说明。 */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 建一个调用器。 */
export function createWorkflowLiteRpc(carrier: RpcCarrier): WorkflowLiteRpc {
  return {
    async call<K extends WorkflowLiteEndpoint>(
      endpoint: K,
      args: WorkflowLiteRpcMap[K]['args'],
    ): Promise<WorkflowLiteRpcMap[K]['result']> {
      const { channel, endpoint: method } = rpcTarget(endpoint)
      const result = await carrier.rpc.call(channel, method, args)
      if (!result.ok) {
        throw new WorkflowLiteRpcError(
          result.error.code,
          result.error.message,
          result.error.details,
        )
      }
      // 形状由 host 保证；这里只挡"不是对象"这一种坏信封，不重复做逐字段校验。
      if (result.value === null || typeof result.value !== 'object') {
        throw new Error('workflow_lite rpc: malformed payload')
      }
      return result.value as WorkflowLiteRpcMap[K]['result']
    },
  }
}
