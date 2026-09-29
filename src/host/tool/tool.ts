/**
 * dsh-workflow-lite — 唯一的模型可见工具 `workflow_lite`。
 *
 * **一个工具 + 一个 action 枚举**：枚举本身就是能力清单，模型看枚举就知道这张图能干什么，
 * 不必先记住一长串工具名再挑；也避开 DSH 内置的 `workflow` 工具（跑 JS 编排脚本）。
 *
 * 返回通道只有三条（§8.2）：
 * - **被规则拒绝** → 一律 `{ error: { code, message, detail? } }`（`code ∈ {not_found, invalid_args,
 *   blocked, conflict, io_error}`）——它是**返回**而不是抛，好让模型读到结构化失败。
 * - **`problems` 只在 `compile` 里出现**，装编译级错误。
 * - **`warnings` 装警告与提示**，每条带 `level`，任何 action 都能带。
 *
 * 定位一律用 `id`；`label` 只用于显示。
 * @module @xiaoso/dsh-workflow-lite/host/tool/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { analyzeGraph, compareByCodepoint } from '../../shared/graph.ts'
import { idKey } from '../../shared/model.ts'
import { checkName } from '../../shared/naming.ts'
import type {
  ChangedEntry,
  NodeIndexEntry,
  ReadIndexResult,
  ReadNodeResult,
  ToolWarning,
  ValidationProblem,
  WorkflowDocument,
  WorkflowNode,
} from '../../shared/types.ts'
import { ACTIONS, type Action, TOOL_NAME } from '../../shared/types.ts'
import { compileWorkflow } from '../plan.ts'
import { writeFileAtomic } from '../store/atomic.ts'
import { templateFile, templateOccupant } from '../store/paths.ts'
import {
  MAX_SEQUENTIAL,
  type NodeUpsert,
  type Outcome,
  problemsToWarnings,
  type Repository,
} from '../store/repository.ts'

/** 工具需要的三个活依赖（`dataDir` / `maxResultBytes` 是活配置，所以取函数而不是值）。 */
export interface ToolDeps {
  repository: Repository
  dataDir: () => string
  maxResultBytes: () => number
}

const DESCRIPTION = [
  '管理轻量工作流的图文件：一张图 = 一个 JSON（React Flow 原生 nodes/edges/viewport），',
  '每个节点的提示词内联在 node.data.prompt 里。用 action 选动作：',
  'list 列出图与模板 / read 读图（不给 node 只回索引、绝不含正文；给 node 才回那一个节点的正文）/ ',
  'compile 编译成派发计划并把载荷物化进 .dispatch（模型据此自己组织执行）/ ',
  'create 新建图（可从工作流模板）/ write_node 新建或覆盖一个节点 / set_label 改显示名（id 不可改）/ ',
  'delete_node 删节点（连带删边）/ connect、disconnect 增删边 / rename_workflow、delete_workflow 改名删图 / ',
  'save_as_template 存成模板（给了 node 就存成节点模板）。',
  '节点定位一律用 id。',
].join('')

/** 参数与返回值里的 `{ error }` 形状（工具返回它，不抛）。 */
type ToolErrorValue = { error: { code: string; message: string; detail?: Record<string, unknown> } }

function errorValue(outcome: { error: ToolErrorValue['error'] }): JsonValue {
  return toJsonValue({ error: outcome.error })
}

/**
 * 把一个内部值**结构化地**转成无损 JSON——工具的规范返回值必须是 `JsonValue`，
 * 而我们内部用的是带具名接口的对象（它们没有索引签名，不能直接赋给 `JsonValue`）。
 * 这里逐层重建：`undefined` 丢弃（JSON 本来也没有它），非有限数字归 `null`，
 * 其余标量原样。**不做类型断言**。
 */
function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      return Number.isFinite(value) ? value : null
    case 'object': {
      if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry))
      const out: Record<string, JsonValue> = {}
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue
        out[key] = toJsonValue(entry)
      }
      return out
    }
    default:
      return String(value)
  }
}

/** 从 `exec` 取执行者的工作区根（进 ⑤ 的 cwd）。`exec` 缺失时返回 undefined（纯函数自足）。 */
function cwdOf(exec: ToolExecView | undefined): string | undefined {
  return exec?.agent?.session?.header?.cwd
}

/** 节点的索引条目（不含正文）。 */
function indexEntry(document: WorkflowDocument, node: WorkflowNode): NodeIndexEntry {
  const analysis = analyzeGraph(document)
  const predecessors = (analysis.predecessors.get(node.id) ?? []).slice().sort(compareByCodepoint)
  return {
    id: node.id,
    ...(node.data.label === undefined ? {} : { label: node.data.label }),
    predecessors,
    ...(node.data.output === undefined ? {} : { output: node.data.output }),
  }
}

/** 按 `id` 码位序排节点。 */
function sortedNodes(document: WorkflowDocument): WorkflowNode[] {
  return [...document.nodes].sort((a, b) => compareByCodepoint(a.id, b.id))
}

/** 把一份 `LoadResult` 的问题分成 warnings 与 problems（只装编译级）。 */
function splitProblems(problems: readonly ValidationProblem[]): {
  warnings: ToolWarning[]
  compile: ValidationProblem[]
} {
  return {
    warnings: problemsToWarnings(problems),
    compile: problems.filter((problem) => problem.level === 'compile'),
  }
}

/** 把节点存成节点模板（`templates/nodes/<名>.json`）——撞名加序号，绝不静默覆盖。 */
async function saveNodeAsTemplate(
  deps: ToolDeps,
  repository: Repository,
  workflow: string,
  nodeId: string,
  to: string | undefined,
): Promise<Outcome<ChangedEntry[]>> {
  const load = await repository.load(workflow)
  if (!load.exists || load.document === null) {
    return { ok: false, error: { code: 'not_found', message: `图 ${workflow} 不存在` } }
  }
  const node = load.document.nodes.find((candidate) => idKey(candidate.id) === idKey(nodeId))
  if (node === undefined) {
    return {
      ok: false,
      error: { code: 'not_found', message: `图 ${workflow} 里没有节点 ${nodeId}` },
    }
  }
  const base = to ?? node.id
  const nameProblem = checkName(base)
  if (nameProblem !== null) {
    return { ok: false, error: { code: 'invalid_args', message: nameProblem.message } }
  }
  const dataDir = deps.dataDir()
  let name = base
  for (let n = 1; n <= MAX_SEQUENTIAL; n += 1) {
    const occupant = await templateOccupant(dataDir, 'nodes', name)
    if (occupant === null) break
    if (n === MAX_SEQUENTIAL) {
      return { ok: false, error: { code: 'invalid_args', message: `模板名 ${base} 太挤了` } }
    }
    name = `${base}-${n + 1}`
  }
  // 节点模板 = 节点的 `data` 本体（**不带 id / position**）。
  await writeFileAtomic(
    templateFile(dataDir, 'nodes', name),
    `${JSON.stringify(node.data, null, 2)}\n`,
  )
  return {
    ok: true,
    result: [
      { kind: 'workflow', op: 'add', id: `templates/nodes/${name}`, detail: { from: nodeId } },
    ],
  }
}

/**
 * 注册那唯一的工具。
 * @param ctx - 插件上下文（`tools` 已就绪）。
 * @param deps - 仓储与两个活配置。
 * @returns 注销器。
 */
/** 工具的参数面（与下方注册处的 `parameters` 同构；抽成具名接口好让单测直接构造）。 */
export interface WorkflowLiteArgs {
  action: Action
  workflow?: string
  node?: string
  content?: string
  label?: string
  output?: string
  no_output?: boolean
  from_template?: string
  from?: string
  to?: string
  source?: string
  target?: string
  when?: string
  goal?: string
  full?: boolean
}

/** `execute` 真正用到的那一小块执行上下文（完整 `ToolRunContext` 结构上兼容它）。 */
export interface ToolExecView {
  agent?: { session?: { header?: { cwd?: string } } }
}

/**
 * 工具的处理体。**抽出来是为了可单测**：单测直接调它，不必造一个 Cordis Context。
 * @param deps - 仓储与两个活配置。
 * @returns 处理一个调用并回规范 JSON 值（失败也是返回值，不抛）。
 */
export function createWorkflowLiteHandler(
  deps: ToolDeps,
): (args: WorkflowLiteArgs, exec?: ToolExecView) => Promise<JsonValue> {
  return async (args, exec) => {
    const action = args.action as Action
    const repository = deps.repository
    const cap = deps.maxResultBytes()

    const finish = (value: unknown, warnings?: ToolWarning[]): JsonValue => {
      const withWarnings =
        warnings === undefined || warnings.length === 0
          ? value
          : { ...(value as Record<string, unknown>), warnings }
      const serialized = JSON.stringify(withWarnings)
      if (serialized !== undefined && serialized.length > cap) {
        return toJsonValue({
          error: {
            code: 'invalid_args',
            message: `返回内容 ${serialized.length} 字节，超过上限 ${cap}；请改用 read + node=<id> 逐个读`,
          },
        })
      }
      return toJsonValue(withWarnings)
    }

    switch (action) {
      case 'list':
        return finish(await repository.list())

      case 'read': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        const load = await repository.load(name)
        if (!load.exists) {
          return errorValue({ error: { code: 'not_found', message: `图 ${name} 不存在` } })
        }
        if (!load.loadable || load.document === null) {
          return errorValue({
            error: {
              code: 'blocked',
              message: `图 ${name} 有保存级问题，无法读取：${load.problems.map((p) => p.message).join('；')}`,
              detail: {
                problems: load.problems,
                ...(load.text === null ? {} : { raw: truncate(load.text, cap) }),
              },
            },
          })
        }
        const { warnings } = splitProblems(load.problems)
        const nodeId = args.node
        if (nodeId === undefined || nodeId === '') {
          const result: ReadIndexResult = {
            workflow: name,
            viewport: load.document.viewport,
            nodes: sortedNodes(load.document).map((node) =>
              indexEntry(load.document ?? document0(), node),
            ),
            warnings,
          }
          return finish(result)
        }
        const node = load.document.nodes.find((candidate) => idKey(candidate.id) === idKey(nodeId))
        if (node === undefined) {
          return errorValue({
            error: { code: 'not_found', message: `图 ${name} 里没有节点 ${nodeId}` },
          })
        }
        const result: ReadNodeResult = {
          workflow: name,
          node,
          edges: load.document.edges
            .filter((edge) => idKey(edge.source) === idKey(nodeId))
            .sort((a, b) => compareByCodepoint(a.id, b.id)),
          warnings,
        }
        return finish(result)
      }

      case 'compile': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        const outcome = await compileWorkflow(
          repository,
          deps.dataDir(),
          name,
          {
            ...(args.full === true ? { full: true } : {}),
            ...(args.goal === undefined ? {} : { goal: args.goal }),
          },
          cwdOf(exec),
        )
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'create': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        const outcome = await repository.create(
          name,
          args.from === undefined ? {} : { from: args.from },
        )
        if (!outcome.ok) return errorValue(outcome)
        return finish({ ...outcome.result, workflow: name })
      }

      case 'write_node': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        if (args.node === undefined || args.node === '') {
          return errorValue({
            error: { code: 'invalid_args', message: 'write_node 需要 node（节点 id）' },
          })
        }
        const upsert: NodeUpsert = { id: args.node }
        if (args.content !== undefined) upsert.content = args.content
        if (args.label !== undefined) upsert.label = args.label
        if (args.output !== undefined) upsert.output = args.output
        if (args.no_output === true) upsert.noOutput = true
        if (args.from_template !== undefined) upsert.fromTemplate = args.from_template
        const outcome = await repository.writeNode(name, upsert)
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'set_label': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        if (args.node === undefined || args.node === '') {
          return errorValue({
            error: { code: 'invalid_args', message: 'set_label 需要 node（节点 id）' },
          })
        }
        if (args.label === undefined) {
          return errorValue({
            error: {
              code: 'invalid_args',
              message: 'set_label 需要 label（空串 = 清除显示名）',
            },
          })
        }
        const outcome = await repository.setLabel(name, args.node, args.label)
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'delete_node': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        if (args.node === undefined || args.node === '') {
          return errorValue({
            error: { code: 'invalid_args', message: 'delete_node 需要 node（节点 id）' },
          })
        }
        const outcome = await repository.deleteNode(name, args.node)
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'connect':
      case 'disconnect': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        if (args.source === undefined || args.target === undefined) {
          return errorValue({
            error: {
              code: 'invalid_args',
              message: `${action} 需要 source 与 target（节点 id）`,
            },
          })
        }
        const outcome =
          action === 'connect'
            ? await repository.connect(name, args.source, args.target, args.when)
            : await repository.disconnect(name, args.source, args.target, args.when)
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'rename_workflow': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        if (args.to === undefined || args.to === '') {
          return errorValue({
            error: { code: 'invalid_args', message: 'rename_workflow 需要 to' },
          })
        }
        const outcome = await repository.rename(name, args.to)
        if (!outcome.ok) return errorValue(outcome)
        return finish({ ...outcome.result, workflow: args.to })
      }

      case 'delete_workflow': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        const outcome = await repository.remove(name)
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'save_as_template': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        if (args.node !== undefined && args.node !== '') {
          const outcome = await saveNodeAsTemplate(deps, repository, name, args.node, args.to)
          if (!outcome.ok) return errorValue(outcome)
          return finish({ changed: outcome.result, warnings: [] })
        }
        const outcome = await repository.saveAsTemplate(
          name,
          args.to === undefined ? {} : { to: args.to },
        )
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      default: {
        // switch 必须穷尽：走到这里说明 `ACTIONS` 与分派不同步。
        const exhaustive: never = action
        return errorValue({
          error: { code: 'invalid_args', message: `未知 action：${String(exhaustive)}` },
        })
      }
    }
  }
}

/** 工具的参数声明（隐式开放对象根；`required` 内联写）。导出供测试直接编译成 JSON Schema 校验。 */
export const PARAMETERS = {
  action: {
    type: 'string',
    enum: [...ACTIONS],
    required: true,
    description: '要做的动作。',
  },
  workflow: { type: 'string', description: '图名（不带 .json）。除 list 外都需要。' },
  node: {
    type: 'string',
    description: '节点 id（read / write_node / set_label / delete_node / save_as_template）。',
  },
  content: {
    type: 'string',
    description: 'write_node：节点提示词正文（允许空串，但空正文是编译级）。',
  },
  label: {
    type: 'string',
    description: 'write_node / set_label：显示名。不要求唯一；空串 = 清除（回落显示 id）。',
  },
  output: { type: 'string', description: 'write_node：产出契约（相对工作区根的路径）。' },
  no_output: {
    type: 'boolean',
    description: 'write_node：true ⇒ 显式声明本节点不产出文件（写 output: false）。',
  },
  from_template: {
    type: 'string',
    description:
      'write_node：从 templates/nodes/<名>.json 取 data 本体（不复制它的 id 与 position）。',
  },
  from: {
    type: 'string',
    description: 'create：从 templates/workflows/<名>.json 单文件复制。',
  },
  to: { type: 'string', description: 'rename_workflow / save_as_template：目标名。' },
  source: { type: 'string', description: 'connect / disconnect：源节点 id。' },
  target: { type: 'string', description: 'connect / disconnect：目标节点 id。' },
  when: {
    type: 'string',
    description: 'connect / disconnect：条件值（缺省 = 无条件边）。同一条边只在一处出现。',
  },
  goal: { type: 'string', description: 'compile：本次目标（进派发计划的动态尾）。' },
  full: { type: 'boolean', description: 'compile：true = 整卷版（内联正文，给人读）。' },
} as const

/**
 * 注册那唯一的工具。
 * @param ctx - 插件上下文（`tools` 已就绪）。
 * @param deps - 仓储与两个活配置。
 * @returns 注销器。
 */
export function registerWorkflowLiteTool(ctx: Context, deps: ToolDeps): () => void {
  return ctx.tools.register(
    defineTool({
      name: TOOL_NAME,
      description: DESCRIPTION,
      parameters: PARAMETERS,
      output: {
        schema: { type: 'json' },
        render: (_args, value) => {
          const text =
            typeof value === 'object' && value !== null && 'error' in value
              ? renderError(value as ToolErrorValue)
              : renderSuccess(value)
          return [text]
        },
      },
      execute: createWorkflowLiteHandler(deps),
    }),
  )
}

function document0(): WorkflowDocument {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

function requireWorkflow(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value
}

function missingWorkflow(): JsonValue {
  return errorValue({
    error: { code: 'invalid_args', message: '这个 action 需要 workflow（图名）' },
  })
}

function truncate(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\n…（截断）` : text
}

/** 成功结果的可读渲染：一行摘要 + 结构化 JSON。 */
function renderSuccess(value: unknown): ContentBlock {
  const record = (value ?? {}) as Record<string, unknown>
  const parts: string[] = []
  if (Array.isArray(record.changed)) {
    parts.push(`变更 ${record.changed.length} 项`)
  }
  if (Array.isArray(record.workflows)) {
    parts.push(`图 ${record.workflows.length} 张`)
  }
  if (typeof record.plan === 'string') {
    parts.push(record.plan === '' ? '编译被编译级问题挡住' : `计划 ${record.plan.length} 字符`)
    if (typeof record.planId === 'string') parts.push(`planId ${record.planId}`)
  }
  if (typeof record.workflow === 'string') parts.push(`图 ${record.workflow}`)
  const header = parts.length > 0 ? `${parts.join('｜')}\n` : ''
  return { type: 'text', text: `${header}${JSON.stringify(value, null, 2)}` }
}

/** 失败结果的可读渲染：把 code 与人话放在第一行。 */
function renderError(value: ToolErrorValue): ContentBlock {
  const { code, message, detail } = value.error
  const extra = detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`
  return { type: 'text', text: `[${code}] ${message}${extra}` }
}
