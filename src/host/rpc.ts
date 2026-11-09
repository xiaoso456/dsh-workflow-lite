/**
 * dsh-workflow-lite — 画布的后端路由。
 *
 * 一个 endpoint 一条精确 Fetch 路由，挂在共享 Connection 的 `/api` 通道上
 * （与生态里其它插件同一条路）。载波负责 Host/Origin + 浏览器会话策略，
 * 我们只解码标准 `client-request` 信封、分派、再按标准 `server-response` 回。
 *
 * 注册走 `ctx.inject(['connection'])` 的子上下文——这样**插件在没有 web 的 profile 里
 * 也能只带工具起来**（RPC 是画布专用，缺它不该让整个插件停摆）。
 *
 * 分派只按 endpoint 的前缀转给 `rpc/` 下各组（graph / plan / run / memory / host / config / pack），
 * 每组各管自己的入参读取。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc
 */

import type { Context } from '@deepseek-ai/cordis'
import { clientRequestSchema, RpcId } from '@deepseek-ai/dsh-client-connection'
import {
  endpointName,
  routePath,
  WORKFLOW_LITE_ENDPOINTS,
  type WorkflowLiteEndpoint,
} from '../shared/wire.ts'
import { dispatchConfig } from './rpc/config.ts'
import { dispatchGraph } from './rpc/graph.ts'
import { dispatchHost } from './rpc/hostAccess.ts'
import { dispatchMemory } from './rpc/memory.ts'
import { dispatchPack } from './rpc/pack.ts'
import { dispatchPlan } from './rpc/plan.ts'
import { dispatchRun } from './rpc/run.ts'
import { fail, type RpcDeps, type RpcResult } from './rpc/shared.ts'

/**
 * 注册全部画布路由。
 * @param ctx - **已绑定 `connection`** 的子上下文。
 * @param deps - 仓储与数据根。
 */
export function registerWorkflowLiteRpc(ctx: Context, deps: RpcDeps): void {
  for (const endpoint of WORKFLOW_LITE_ENDPOINTS) {
    ctx.effect(() => {
      const dispose = ctx.connection.fetch.register({
        path: routePath(endpoint),
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: (request) => serve(deps, endpoint, request),
      })
      return () => {
        void dispose()
      }
    }, `workflow-lite: ${endpoint} Fetch route`)
  }
}

/** 解码信封 → 分派 → 按标准形状作答。畸形流量给裸 HTTP 状态。 */
async function serve(
  deps: RpcDeps,
  endpoint: WorkflowLiteEndpoint,
  request: Request,
): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new Response('body is not JSON', { status: 400 })
  }
  const envelope = clientRequestSchema.safeParse(body)
  if (!envelope.success) return new Response('invalid client-request envelope', { status: 400 })
  const message = envelope.data
  const expected = endpointName(endpoint)
  if (message.method !== expected) {
    return respond(
      message.rpcId,
      fail(
        'bad-request',
        `method ${JSON.stringify(message.method)} does not match endpoint ${JSON.stringify(expected)}`,
      ),
    )
  }
  let result: RpcResult<unknown>
  try {
    result = await dispatch(deps, endpoint, message.payload)
  } catch (error) {
    result = fail('internal', error instanceof Error ? error.message : String(error))
  }
  return respond(message.rpcId, result)
}

function respond(rpcId: string, result: RpcResult<unknown>): Response {
  return Response.json({ type: 'server-response', rpcId: RpcId(rpcId), result })
}

// ─────────────────────────────────────────────────────────────
// 分派
// ─────────────────────────────────────────────────────────────

/** endpoint 是否属于 `<group>/*` 这一组（同时把类型收窄到这一组）。 */
function inGroup<Group extends string>(
  endpoint: WorkflowLiteEndpoint,
  group: Group,
): endpoint is Extract<WorkflowLiteEndpoint, `${Group}/${string}`> {
  return endpoint.startsWith(`${group}/`)
}

async function dispatch(
  deps: RpcDeps,
  endpoint: WorkflowLiteEndpoint,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  if (inGroup(endpoint, 'graph')) return dispatchGraph(deps, endpoint, payload)
  if (inGroup(endpoint, 'plan')) return dispatchPlan(deps, endpoint, payload)
  if (inGroup(endpoint, 'run')) return dispatchRun(deps, endpoint, payload)
  if (inGroup(endpoint, 'memory')) return dispatchMemory(deps, endpoint, payload)
  if (inGroup(endpoint, 'host')) return dispatchHost(deps, endpoint, payload)
  if (inGroup(endpoint, 'config')) return dispatchConfig(deps, endpoint, payload)
  if (inGroup(endpoint, 'pack')) return dispatchPack(deps, endpoint, payload)
  const exhaustive: never = endpoint
  throw new Error(`unknown endpoint ${String(exhaustive)}`)
}
