/**
 * dsh-workflow-lite — 唯一的模型可见工具 `workflow_lite`。
 *
 * **一个工具 + 一个 action 枚举**：枚举本身就是能力清单，模型看枚举就知道这张图能干什么，
 * 不必先记住一长串工具名再挑；也避开 DSH 内置的 `workflow` 工具（跑 JS 编排脚本）。
 *
 * 返回通道只有三条：
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
import type { DisplaySpec } from '../../shared/display.ts'
import { compareByCodepoint } from '../../shared/graph.ts'
import { idKey, isInput, isResource, isStep } from '../../shared/model.ts'
import { memoryOf } from '../../shared/presets.ts'
import type {
  MemoryIndexEntry,
  ReadIndexResult,
  ReadNodeResult,
  StepNode,
  ToolWarning,
  ValidationProblem,
  WorkflowDocument,
} from '../../shared/types.ts'
import { type Action, TOOL_NAME } from '../../shared/types.ts'
import { compileWorkflow } from '../plan.ts'
import type { SessionRef } from '../runs/runCore.ts'
import type { RunService } from '../runs/service.ts'
import { hasMemory, listMemories, type MemoryDeps } from '../store/memories.ts'
import type { NodeUpsert } from '../store/repoNodes.ts'
import { problemsToWarnings } from '../store/repoResult.ts'
import type { Repository } from '../store/repository.ts'
import {
  answersOf,
  handoffOf,
  inputUpsertOf,
  statePatchOf,
  toJsonValue,
  type WorkflowLiteArgs,
} from './args.ts'
import { indexEntry, inputEntries, resourceEntries } from './indexEntries.ts'
import { writeMemoryCard } from './memoryCard.ts'
import { saveNodeAsTemplate } from './nodeTemplate.ts'
import { displaySpecOf, resourceUpsertOf } from './resourceArgs.ts'
import { DESCRIPTION, PARAMETERS } from './schema.ts'

/** 工具需要的三个活依赖（`dataDir` / `maxResultBytes` 是活配置，所以取函数而不是值）。 */
export interface ToolDeps {
  repository: Repository
  dataDir: () => string
  maxResultBytes: () => number
  /** 工作流实例（运行状态）；不给就当没有这块能力（`runs` / `resume` 报错，编译不建实例）。 */
  runs?: RunService
}

/** 参数与返回值里的 `{ error }` 形状（工具返回它，不抛）。 */
type ToolErrorValue = { error: { code: string; message: string; detail?: Record<string, unknown> } }

function errorValue(outcome: { error: ToolErrorValue['error'] }): JsonValue {
  return toJsonValue({ error: outcome.error })
}

/** 从 `exec` 取执行者的工作区根（进 ⑤ 的 cwd）。`exec` 缺失时返回 undefined（纯函数自足）。 */
function cwdOf(exec: ToolExecView | undefined): string | undefined {
  return exec?.agent?.session?.header?.cwd
}

/**
 * 调用方的会话：子代理的会话不产生自己的实例归属，沿 `parentSession` 归到发起它的会话。
 */
function sessionOf(exec: ToolExecView | undefined): SessionRef {
  const header = exec?.agent?.session?.header
  const id =
    header?.origin === 'subagent' && header.parentSession !== undefined
      ? header.parentSession
      : header?.id
  return {
    ...(id === undefined ? {} : { id }),
    ...(header?.cwd === undefined ? {} : { cwd: header.cwd }),
  }
}

/** 图里引用了、记忆库里却没有的记忆（`idKey`）。 */
async function missingMemories(dataDir: string, document: WorkflowDocument): Promise<Set<string>> {
  const missing = new Set<string>()
  for (const node of document.nodes) {
    const memory = isResource(node) ? memoryOf(node.data) : undefined
    if (memory === undefined || memory.memory === '') continue
    if (!(await hasMemory(dataDir, memory.memory))) missing.add(idKey(memory.memory))
  }
  return missing
}

/** `list` 里的记忆库：挑已有的引用时看。 */
async function memoryIndex(deps: MemoryDeps): Promise<MemoryIndexEntry[]> {
  return (await listMemories(deps))
    .filter((entry) => entry.invalid !== true)
    .map((entry) => ({
      id: entry.id,
      type: entry.type,
      name: entry.name,
      ...(entry.description === '' ? {} : { description: entry.description }),
      usedBy: entry.usedBy,
    }))
}

/** 按 `id` 码位序排步骤。 */
function sortedNodes(document: WorkflowDocument): StepNode[] {
  return document.nodes.filter(isStep).sort((a, b) => compareByCodepoint(a.id, b.id))
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

/** `execute` 真正用到的那一小块执行上下文（完整 `ToolRunContext` 结构上兼容它）。 */
export interface ToolExecView {
  agent?: {
    session?: {
      header?: { id?: string; cwd?: string; origin?: string; parentSession?: string }
    }
  }
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

    const session = sessionOf(exec)
    // 用户在画布上改了状态、当时没送到模型的通知：随这次调用的返回值一起交给它。
    const notices = deps.runs === undefined ? [] : await deps.runs.takeNotices(session.id)
    const finish = (value: unknown, warnings?: ToolWarning[]): JsonValue => {
      const withNotices =
        notices.length === 0
          ? value
          : { ...(value as Record<string, unknown>), userNotices: notices }
      const withWarnings =
        warnings === undefined || warnings.length === 0
          ? withNotices
          : { ...(withNotices as Record<string, unknown>), warnings }
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
        return finish({
          ...(await repository.list()),
          memories: await memoryIndex({ dataDir: deps.dataDir(), repository }),
        })

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
        const { warnings, compile } = splitProblems(load.problems)
        const nodeId = args.node
        if (nodeId === undefined || nodeId === '') {
          const result: ReadIndexResult = {
            workflow: name,
            viewport: load.document.viewport,
            ...(load.document.settings === undefined ? {} : { settings: load.document.settings }),
            nodes: sortedNodes(load.document).map((node) =>
              indexEntry(load.document ?? document0(), node),
            ),
            ...(load.document.nodes.some(isResource)
              ? {
                  resources: resourceEntries(
                    load.document,
                    await missingMemories(deps.dataDir(), load.document),
                  ),
                }
              : {}),
            ...(load.document.nodes.some(isInput) ? { inputs: inputEntries(load.document) } : {}),
            // 索引就是自检的入口：阻塞编译的问题也在这里给，不必为了看问题去编译（编译会建实例）。
            ...(compile.length === 0 ? {} : { problems: compile }),
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
          // 资源与输入节点给连着它的全部线（谁写、谁读）；步骤给出边。
          edges: load.document.edges
            .filter((edge) =>
              isResource(node) || isInput(node)
                ? idKey(edge.source) === idKey(nodeId) || idKey(edge.target) === idKey(nodeId)
                : idKey(edge.source) === idKey(nodeId),
            )
            .sort((a, b) => compareByCodepoint(a.id, b.id)),
          warnings,
        }
        return finish(result)
      }

      case 'compile': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        const runs = deps.runs
        const answers = answersOf(args)
        if (typeof answers === 'string') {
          return errorValue({ error: { code: 'invalid_args', message: answers } })
        }
        // 整卷版是给人看的：不建实例，路径里留着 {instance}。
        if (args.full === true || runs === undefined) {
          const outcome = await compileWorkflow(
            repository,
            deps.dataDir(),
            name,
            {
              ...(args.full === true ? { full: true } : {}),
              ...(args.goal === undefined ? {} : { goal: args.goal }),
              ...(answers === undefined ? {} : { answers }),
            },
            cwdOf(exec),
          )
          if (!outcome.ok) return errorValue(outcome)
          return finish(outcome.result)
        }
        const load = await repository.load(name)
        if (!load.exists) {
          return errorValue({ error: { code: 'not_found', message: `图 ${name} 不存在` } })
        }
        if (!load.loadable || load.document === null) {
          return errorValue({
            error: {
              code: 'blocked',
              message: `图 ${name} 有保存级问题，无法加载：${load.problems.map((p) => p.message).join('；')}`,
              detail: { problems: load.problems },
            },
          })
        }
        // 派发版：建一个工作流实例，按它出计划（和画布上点「执行」之后 resume 拿到的一样）。
        const outcome = await runs.compile({
          workflow: name,
          document: load.document,
          problems: load.problems,
          session,
          ...(args.goal === undefined ? {} : { goal: args.goal }),
          answers: answers ?? {},
        })
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'runs': {
        if (deps.runs === undefined) return noRuns()
        const list = await deps.runs.list(session.id, args.all === true || session.id === undefined)
        return finish({ instances: list })
      }

      case 'resume': {
        if (deps.runs === undefined) return noRuns()
        const outcome = await deps.runs.resume(
          args.instance === undefined || args.instance === '' ? undefined : args.instance,
          session,
        )
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'state': {
        if (deps.runs === undefined) return noRuns()
        const patch = statePatchOf(args)
        if (typeof patch === 'string') {
          return errorValue({ error: { code: 'invalid_args', message: patch } })
        }
        const outcome = await deps.runs.state(
          args.instance === undefined || args.instance === '' ? undefined : args.instance,
          session,
          patch,
        )
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'create': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        const outcome = await repository.create(name)
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
        if (args.input !== undefined) {
          const input = inputUpsertOf(args.node, args.input)
          if (typeof input === 'string') {
            return errorValue({ error: { code: 'invalid_args', message: input } })
          }
          const outcome = await repository.writeInput(name, input)
          if (!outcome.ok) return errorValue(outcome)
          return finish(outcome.result)
        }
        const upsert: NodeUpsert = { id: args.node }
        if (args.content !== undefined) upsert.content = args.content
        if (args.label !== undefined) upsert.label = args.label
        if (args.output !== undefined) upsert.output = args.output
        if (args.outputs !== undefined) {
          upsert.outputs = args.outputs.map((spec) =>
            spec.rule === undefined ? { path: spec.path } : { path: spec.path, rule: spec.rule },
          )
          const displays: { path: string; display: DisplaySpec }[] = []
          for (const [index, spec] of args.outputs.entries()) {
            if (spec.display === undefined) continue
            const display = displaySpecOf(spec.display, `outputs[${index}].display`)
            if (typeof display === 'string') {
              return errorValue({ error: { code: 'invalid_args', message: display } })
            }
            displays.push({ path: spec.path, display })
          }
          if (displays.length > 0) upsert.displays = displays
        }
        if (args.description !== undefined) upsert.description = args.description
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
            ? await repository.connect(
                name,
                args.source,
                args.target,
                args.when,
                handoffOf(args),
                args.update,
              )
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
        if (args.node === undefined || args.node === '') {
          return errorValue({
            error: {
              code: 'invalid_args',
              message: 'save_as_template 需要 node（要存成节点模板的步骤 id）',
            },
          })
        }
        const outcome = await saveNodeAsTemplate(deps, repository, name, args.node, args.to)
        if (!outcome.ok) return errorValue(outcome)
        return finish({ changed: outcome.result, warnings: [] })
      }

      case 'configure': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        if (
          args.output_root === undefined &&
          args.mode === undefined &&
          args.reuse === undefined &&
          args.set_goal === undefined &&
          args.run_state === undefined
        ) {
          return errorValue({
            error: {
              code: 'invalid_args',
              message: 'configure 需要 output_root、mode、reuse、set_goal 或 run_state',
            },
          })
        }
        const outcome = await repository.configure(name, {
          ...(args.output_root === undefined ? {} : { outputRoot: args.output_root }),
          ...(args.mode === undefined ? {} : { mode: args.mode }),
          ...(args.reuse === undefined ? {} : { reuse: args.reuse }),
          ...(args.set_goal === undefined ? {} : { setGoal: args.set_goal }),
          ...(args.run_state === undefined ? {} : { runState: args.run_state }),
        })
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'write_resource': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        if (args.memory !== undefined) {
          if ((args.node !== undefined && args.node !== '') || args.resource !== undefined) {
            return errorValue({
              error: {
                code: 'invalid_args',
                message:
                  '加记忆只给 memory，不带 node / resource（卡片 id 和内容由插件定）；建好的记忆卡要换一条就 delete_node 再加',
              },
            })
          }
          if (typeof args.memory !== 'object' || args.memory === null) {
            return errorValue({
              error: { code: 'invalid_args', message: 'memory 要写成 { type, id, step }' },
            })
          }
          const outcome = await writeMemoryCard(deps, name, args.memory)
          if (!outcome.ok) return errorValue(outcome)
          return finish(outcome.result)
        }
        if ((args.node === undefined || args.node === '') && args.resource === undefined) {
          return errorValue({
            error: {
              code: 'invalid_args',
              message: 'write_resource 需要 resource（新建）或 node + resource（修改）',
            },
          })
        }
        const upsert = resourceUpsertOf(args.node, args.resource ?? {})
        if (typeof upsert === 'string') {
          return errorValue({ error: { code: 'invalid_args', message: upsert } })
        }
        const outcome = await repository.writeResource(name, upsert)
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

function noRuns(): JsonValue {
  return errorValue({
    error: { code: 'invalid_args', message: '工作流实例不可用（插件没有装配运行状态这块能力）' },
  })
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
