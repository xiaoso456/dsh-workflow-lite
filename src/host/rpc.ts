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
 * 入参一律**从原始记录里逐字段读**（不做类型断言）；图文档走 `normalizeDocument`
 * 做形状归一，坏形状在这里就被挡成 `invalid_args`，不会渗进仓储。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  type ConnectionRpcResult,
  clientRequestSchema,
  RpcId,
} from '@deepseek-ai/dsh-client-connection'
import { normalizeDocument } from '../shared/model.ts'
import {
  endpointName,
  type GraphLoadResponse,
  routePath,
  WORKFLOW_LITE_ENDPOINTS,
  type WorkflowLiteEndpoint,
} from '../shared/wire.ts'
import { compileWorkflow } from './plan.ts'
import { type LoadResult, problemsToWarnings, type Repository } from './store/repository.ts'

/** 路由需要的活依赖。 */
export interface RpcDeps {
  repository: Repository
  dataDir: () => string
  /** 画布要用的两个活配置值（`graph/list` 一并回给它，见 `GraphListResponse`）。 */
  limits: () => { maxNodes: number; saveDebounceMs: number }
}

type RpcResult<T> = ConnectionRpcResult<T>

/** 仓储 / 校验层回告的错误形状（`detail` 是可选的结构化补充）。 */
interface DomainError {
  code: string
  message: string
  detail?: Record<string, unknown>
}

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

function ok(value: unknown): RpcResult<unknown> {
  return { ok: true, value }
}

/** 失败结果——信封要求 `details` 在场，所以这里补齐。 */
function fail(code: string, message: string, detail?: Record<string, unknown>): RpcResult<unknown> {
  return { ok: false, error: { code, message, details: detail ?? {} } }
}

/** 把仓储 / 校验层的失败转成线信封。 */
function failFrom(error: DomainError): RpcResult<unknown> {
  return fail(error.code, error.message, error.detail)
}

// ─────────────────────────────────────────────────────────────
// 入参读取（不做断言）
// ─────────────────────────────────────────────────────────────

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('payload must be a JSON object')
  }
  return payload as Record<string, unknown>
}

function requireString(input: Record<string, unknown>, field: string): string {
  const value = input[field]
  if (typeof value !== 'string' || value === '') throw new Error(`missing ${field}`)
  return value
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field]
  return typeof value === 'string' && value !== '' ? value : undefined
}

// ─────────────────────────────────────────────────────────────
// 分派
// ─────────────────────────────────────────────────────────────

async function dispatch(
  deps: RpcDeps,
  endpoint: WorkflowLiteEndpoint,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  switch (endpoint) {
    case 'graph/list': {
      const list = await deps.repository.list()
      return ok({ ...list, limits: deps.limits() })
    }

    case 'graph/load': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const load: LoadResult = await deps.repository.load(name)
      if (!load.exists) return fail('not_found', `图 ${name} 不存在`)
      const response: GraphLoadResponse = {
        name: load.name,
        // 保存级破损时给空壳文档——画布据此进只读错误态；原文一并回给模型/用户去修。
        document: load.document ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        hash: load.hash ?? '',
        problems: load.problems,
        warnings: problemsToWarnings(load.problems),
        ...(load.text === null ? {} : { raw: load.text }),
      }
      return ok(response)
    }

    case 'graph/save': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const parsed = normalizeDocument(input.document)
      if (parsed.document === null) {
        return fail(
          'invalid_args',
          `提交的文档形状不合法：${parsed.problems.map((problem) => problem.message).join('；')}`,
        )
      }
      const baseHash = optionalString(input, 'baseHash') ?? null
      // 「保留我的」只在画布（人在场、看过冲突清单）时有意义；工具写路径不传，也就拿不到。
      const force = input.force === true
      const outcome = await deps.repository.save(name, parsed.document, { baseHash, force })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({
        hash: outcome.result.hash,
        warnings: outcome.result.warnings,
        // 成功路径上恒为空：真冲突在非 force 时走 `error.detail.ids` 返回（不写盘），
        // 而 force 时冲突 id 已按本地为准写完，没有"未能合并"的残留。
        conflictIds: [],
      })
    }

    case 'graph/create': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const from = optionalString(input, 'from')
      const outcome = await deps.repository.create(name, from === undefined ? {} : { from })
      if (!outcome.ok) return failFrom(outcome.error)
      // 撞名加序号时，实际生成的名字在 changed 里。
      const created = outcome.result.changed[0]?.id ?? name
      return ok({ name: created, warnings: outcome.result.warnings })
    }

    case 'graph/rename': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const to = requireString(input, 'to')
      const outcome = await deps.repository.rename(name, to)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ name: to, warnings: outcome.result.warnings })
    }

    case 'graph/delete': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.remove(name)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ warnings: outcome.result.warnings })
    }

    case 'graph/templates': {
      const list = await deps.repository.list()
      return ok(list.templates)
    }

    case 'graph/nodeTemplate': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.readTemplate('nodes', name)
      if (!outcome.ok) return failFrom(outcome.error)
      // `readTemplate('nodes')` 给的就是 `data` 本体；这里按形状把
      // 「一张图」那一支排掉——`WorkflowDocument` 必带 `nodes`，`NodeData` 不带。
      const data = outcome.result
      if ('nodes' in data) {
        return fail('internal', `模板 ${name} 不是节点模板（读出来的是整张图）`)
      }
      return ok({ name, data })
    }

    case 'plan/build': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const goal = optionalString(input, 'goal')
      const cwd = optionalString(input, 'cwd')
      const outcome = await compileWorkflow(
        deps.repository,
        deps.dataDir(),
        name,
        {
          ...(input.full === true ? { full: true } : {}),
          ...(goal === undefined ? {} : { goal }),
        },
        cwd,
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    default: {
      const exhaustive: never = endpoint
      throw new Error(`unknown endpoint ${String(exhaustive)}`)
    }
  }
}
