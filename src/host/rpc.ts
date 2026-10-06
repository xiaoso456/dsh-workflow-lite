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
import { normalizeDocument, readNodeData as readDataFields } from '../shared/model.ts'
import type { StateEdit } from '../shared/runState.ts'
import type { NodeData } from '../shared/types.ts'
import {
  endpointName,
  type GraphLoadResponse,
  routePath,
  WORKFLOW_LITE_ENDPOINTS,
  type WorkflowLiteEndpoint,
} from '../shared/wire.ts'
import { listHostDir, listSkills, readSkill, type SkillViewer } from './hostFs.ts'
import { compileWorkflow } from './plan.ts'
import {
  type LiveValues,
  readPluginConfig,
  type SettingsPort,
  writePluginConfig,
} from './pluginConfig.ts'
import type { GraphEdit, RunService } from './runs/service.ts'
import { storageAction } from './runs/storage.ts'
import { type LoadResult, problemsToWarnings, type Repository } from './store/repository.ts'

/** 路由需要的活依赖。 */
export interface RpcDeps {
  repository: Repository
  dataDir: () => string
  /** 画布要用的两个活配置值（`graph/list` 一并回给它，见 `GraphListResponse`）。 */
  limits: () => { maxNodes: number; saveDebounceMs: number }
  /** 工作流实例（`run/*`）。 */
  runs: RunService
  /** 看 DSH 的 skill（选 Skill、预览 SKILL.md 用）；没给就当没装 skill 服务。 */
  skills?: SkillViewer
  /** 「设置」页：DSH 的设置服务（不在时回 `undefined`，页面只读）与活配置的现值。 */
  config: { port: () => SettingsPort | undefined; live: LiveValues }
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

/** 版本号：正整数。 */
function requireVersion(input: Record<string, unknown>): number {
  const value = input.n
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error('n must be a positive integer')
  }
  return value
}

function optionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * 把线上来的 `data` 形状归一成节点的 `data` 本体：只认 `label` / `prompt` / `output`。
 *
 * `prompt` 缺省当**空串**：空 prompt 是编译级问题（由图上的校验面板去说），
 * 不该在这里被拦成"参数不合法"——那会把"内容还没写完的模板"变成"建不出来"。
 */
function readNodeData(value: unknown): NodeData {
  const input = value === undefined || value === null ? {} : asRecord(value)
  const data = readDataFields(input)
  if (data.label === '') delete data.label
  if (data.description === '') delete data.description
  return { ...data, prompt: data.prompt ?? '' }
}

/** 一处状态改动：路径是字符串数组，值只能是文字、数字、文字列表或 `null`（删掉）。 */
function readEdit(raw: unknown): StateEdit {
  const input = asRecord(raw)
  const path = input.path
  if (!Array.isArray(path) || path.some((key) => typeof key !== 'string')) {
    throw new Error('edit.path must be an array of strings')
  }
  return { path: path as string[], from: readEditValue(input.from), to: readEditValue(input.to) }
}

function readEditValue(value: unknown): StateEdit['to'] {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || typeof value === 'number') return value
  if (Array.isArray(value) && value.every((item) => typeof item === 'string'))
    return value as string[]
  throw new Error('edit value must be a string, number, string[] or null')
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
      const outcome = await deps.repository.create(name)
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

    case 'graph/versions': {
      const input = asRecord(payload)
      const outcome = await deps.repository.listVersions(requireString(input, 'name'))
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ versions: outcome.result })
    }

    case 'graph/versionSave': {
      const input = asRecord(payload)
      const note = typeof input.note === 'string' ? input.note : ''
      const outcome = await deps.repository.saveVersion(requireString(input, 'name'), note)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ version: outcome.result })
    }

    case 'graph/versionLoad': {
      const input = asRecord(payload)
      const outcome = await deps.repository.readVersion(
        requireString(input, 'name'),
        requireVersion(input),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ version: outcome.result.entry, document: outcome.result.document })
    }

    case 'graph/versionRestore': {
      const input = asRecord(payload)
      const outcome = await deps.repository.restoreVersion(
        requireString(input, 'name'),
        requireVersion(input),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'graph/versionNote': {
      const input = asRecord(payload)
      const note = typeof input.note === 'string' ? input.note : ''
      const outcome = await deps.repository.noteVersion(
        requireString(input, 'name'),
        requireVersion(input),
        note,
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ version: outcome.result })
    }

    case 'graph/versionDelete': {
      const input = asRecord(payload)
      const outcome = await deps.repository.deleteVersion(
        requireString(input, 'name'),
        requireVersion(input),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'graph/templates': {
      const list = await deps.repository.list()
      return ok(list.templates)
    }

    case 'graph/nodeTemplate': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.readTemplate(name)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ name, data: outcome.result })
    }

    case 'graph/nodeTemplateCreate': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.createNodeTemplate(name, readNodeData(input.data))
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ name, warnings: outcome.result.warnings })
    }

    case 'graph/nodeTemplateDraft': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.readNodeTemplateDraft(name)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ name, data: outcome.result })
    }

    case 'graph/nodeTemplateSave': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const from = optionalString(input, 'from')
      const outcome = await deps.repository.saveNodeTemplate(name, readNodeData(input.data), from)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ name, warnings: outcome.result.warnings })
    }

    case 'graph/nodeTemplateDelete': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.deleteNodeTemplate(name)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ warnings: outcome.result.warnings })
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

    case 'run/list': {
      const input = asRecord(payload)
      const session = optionalString(input, 'session')
      const all = input.all === true || session === undefined
      const instances = await deps.runs.list(session, all)
      const current = session === undefined ? undefined : await deps.runs.currentOf(session)
      return ok({ instances, ...(current === undefined ? {} : { current }) })
    }

    case 'run/load': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      const since = typeof input.since === 'number' ? input.since : undefined
      const outcome = await deps.runs.view(id, optionalString(input, 'session'), since)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/bind': {
      const input = asRecord(payload)
      const outcome = await deps.runs.bind(
        requireString(input, 'id'),
        requireString(input, 'session'),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/save': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      if (!Array.isArray(input.edits)) throw new Error('edits must be an array')
      const edits = input.edits.map(readEdit)
      const note = optionalString(input, 'note')
      let graph: GraphEdit | undefined
      if (input.graph !== undefined) {
        const raw = asRecord(input.graph)
        const parsed = normalizeDocument(raw.document)
        if (parsed.document === null) {
          return fail(
            'invalid_args',
            `提交的图形状不合法：${parsed.problems.map((problem) => problem.message).join('；')}`,
          )
        }
        graph = { base: requireString(raw, 'base'), document: parsed.document }
      }
      if (input.notify !== undefined && typeof input.notify !== 'boolean') {
        throw new Error('notify must be a boolean')
      }
      const outcome = await deps.runs.save(
        id,
        optionalString(input, 'session'),
        edits,
        note,
        graph,
        {
          notify: input.notify !== false,
        },
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/delete': {
      const input = asRecord(payload)
      const outcome = await deps.runs.remove(requireString(input, 'id'), input.withState === true)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/storage': {
      const input = asRecord(payload)
      const action = optionalString(input, 'action') ?? 'stats'
      if (action !== 'stats' && action !== 'clearDispatch' && action !== 'clearFinished') {
        throw new Error(`unknown storage action ${action}`)
      }
      return ok(await storageAction(deps.runs, deps.dataDir(), action))
    }

    case 'run/start': {
      const input = asRecord(payload)
      const workflow = requireString(input, 'workflow')
      const session = requireString(input, 'session')
      const cwd = optionalString(input, 'cwd')
      const load = await deps.repository.load(workflow)
      if (!load.exists) return failFrom({ code: 'not_found', message: `图 ${workflow} 不存在` })
      if (!load.loadable || load.document === null) {
        return failFrom({
          code: 'blocked',
          message: `图 ${workflow} 有保存级问题，无法执行`,
          detail: { problems: load.problems },
        })
      }
      const outcome = await deps.runs.start({
        workflow,
        document: load.document,
        problems: load.problems,
        session: { id: session, ...(cwd === undefined ? {} : { cwd }) },
        answers: input.answers,
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'run/file': {
      const input = asRecord(payload)
      const id = requireString(input, 'id')
      const node = optionalString(input, 'node')
      const path = optionalString(input, 'path')
      const item = typeof input.item === 'number' && Number.isInteger(input.item) ? input.item : 0
      if (node === undefined && path === undefined)
        throw new Error('run/file requires node or path')
      const outcome = await deps.runs.file(
        id,
        node !== undefined ? { node, item } : { path: path ?? '' },
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'host/list': {
      const input = asRecord(payload)
      const path = optionalString(input, 'path')
      const cwd = optionalString(input, 'cwd')
      const outcome = await listHostDir({
        ...(path === undefined ? {} : { path }),
        ...(cwd === undefined ? {} : { cwd }),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'host/skills': {
      const input = asRecord(payload)
      const cwd = optionalString(input, 'cwd')
      const session = optionalString(input, 'session')
      return ok(
        await listSkills(deps.skills, {
          ...(cwd === undefined ? {} : { cwd }),
          ...(session === undefined ? {} : { session }),
        }),
      )
    }

    case 'host/skill': {
      const input = asRecord(payload)
      const cwd = optionalString(input, 'cwd')
      const session = optionalString(input, 'session')
      const outcome = await readSkill(deps.skills, {
        name: requireString(input, 'name'),
        ...(cwd === undefined ? {} : { cwd }),
        ...(session === undefined ? {} : { session }),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'config/get':
      return ok(readPluginConfig(deps.config.port(), deps.config.live))

    case 'config/set': {
      const input = asRecord(payload)
      const revision = input.revision
      if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
        throw new Error('revision must be a non-negative integer')
      }
      const set = input.set === undefined ? {} : asRecord(input.set)
      const reset = input.reset ?? []
      if (!Array.isArray(reset) || !reset.every((key) => typeof key === 'string')) {
        throw new Error('reset must be a list of keys')
      }
      const outcome = await writePluginConfig(deps.config.port(), deps.config.live, {
        revision,
        set,
        reset,
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    default: {
      const exhaustive: never = endpoint
      throw new Error(`unknown endpoint ${String(exhaustive)}`)
    }
  }
}
