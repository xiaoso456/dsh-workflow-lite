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
import { fileGraph, outputsOf, stepFiles } from '../../shared/files.ts'
import { analyzeGraph, compareByCodepoint } from '../../shared/graph.ts'
import { canonicalOutput, idKey, isFile, isStep } from '../../shared/model.ts'
import { checkName } from '../../shared/naming.ts'
import { NODE_STATUSES, RUN_STATUSES } from '../../shared/runState.ts'
import type {
  ChangedEntry,
  ExecutionMode,
  FileIndexEntry,
  Handoff,
  NodeIndexEntry,
  ReadIndexResult,
  ReadNodeResult,
  StepNode,
  ToolWarning,
  ValidationProblem,
  WorkflowDocument,
} from '../../shared/types.ts'
import { ACTIONS, type Action, EXECUTION_MODES, TOOL_NAME } from '../../shared/types.ts'
import { compileWorkflow } from '../plan.ts'
import type { NodePatch, RunService, SessionRef, StatePatch } from '../runs/service.ts'
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
  /** 工作流实例（运行状态）；不给就当没有这块能力（`runs` / `resume` 报错，编译不建实例）。 */
  runs?: RunService
}

const DESCRIPTION = [
  '管理轻量工作流的图文件：一张图 = 一个 JSON（React Flow 原生 nodes/edges/viewport），',
  '每个节点的提示词内联在 node.data.prompt 里。用 action 选动作：',
  'list 列出图与模板 / read 读图（不给 node 只回索引、绝不含正文；给 node 才回那一个节点的正文）/ ',
  'compile 编译成派发计划：建一个工作流实例，各步骤的任务描述写进工作区的 .workflow-lite/runs/<实例>/tasks/（模型据此自己组织执行；full=true 是给人看的整卷版，不建实例）/ ',
  'create 新建图（可从工作流模板）/ write_node 新建或覆盖一个节点 / set_label 改显示名（id 不可改）/ ',
  'delete_node 删节点（连带删边）/ connect、disconnect 增删边 / rename_workflow、delete_workflow 改名删图 / ',
  'save_as_template 存成模板（给了 node 就存成节点模板）/ ',
  'configure 改工作流设置（output_root 产出根目录、mode 执行方式、run_state 记录运行状态）/ write_file 新建或修改文件节点 / ',
  'runs 列工作流实例 / resume 拿一个实例的计划接着跑 / state 看或改实例的运行状态（开了 run_state 的图按计划末尾「运行状态」段用它记进度，不要直接编辑状态文件；插件补时间、轮次、流水并校验）。',
  '用户在画布上点「执行」时会发来一句带实例 id 的话：用 resume 拿那个实例的计划，照着执行。',
  '文件是独立的节点：connect 步骤 → 文件 = 写它（update 选在原文件上更新），文件 → 步骤 = 读它；',
  'write_node 的 output/outputs 也会自动建好文件节点并连上。步骤 → 步骤的线缺省交上游的执行结果（handoff / handoff_note 可改）。',
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

/** 步骤的索引条目（不含正文）：前置步骤，以及它读、写的文件。 */
function indexEntry(document: WorkflowDocument, node: StepNode): NodeIndexEntry {
  const analysis = analyzeGraph(document)
  const predecessors = (analysis.predecessors.get(node.id) ?? []).slice().sort(compareByCodepoint)
  const files = stepFiles(document, node.id)
  return {
    id: node.id,
    ...(node.data.label === undefined ? {} : { label: node.data.label }),
    predecessors,
    ...(files.reads.length === 0 ? {} : { reads: files.reads.map(({ file }) => file.data.path) }),
    ...(files.writes.length === 0
      ? {}
      : {
          writes: files.writes.map(({ file, update }) =>
            update ? { path: file.data.path, update: true as const } : { path: file.data.path },
          ),
        }),
  }
}

/** 文件节点的索引条目：谁写、谁读。 */
function fileEntries(document: WorkflowDocument): FileIndexEntry[] {
  return [...fileGraph(document).values()]
    .sort((a, b) => compareByCodepoint(a.file.id, b.file.id))
    .map(({ file, writers, readers }) => ({
      id: file.id,
      path: file.data.path,
      ...(file.data.rule === undefined ? {} : { rule: file.data.rule }),
      writers: writers.map((writer) =>
        writer.update ? { id: writer.id, update: true as const } : { id: writer.id },
      ),
      readers,
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
  if (isFile(node)) {
    return {
      ok: false,
      error: { code: 'invalid_args', message: `${node.id} 是文件节点，只有步骤能存成节点模板` },
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
  // 节点模板 = 节点的 `data` 本体（**不带 id / position**）+ 它写的文件（作为产出清单）。
  const outputs = outputsOf(load.document, node.id)
  const data = outputs.length === 0 ? node.data : { ...node.data, output: canonicalOutput(outputs) }
  await writeFileAtomic(templateFile(dataDir, 'nodes', name), `${JSON.stringify(data, null, 2)}\n`)
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
  outputs?: { path: string; rule?: string }[]
  description?: string
  no_output?: boolean
  from_template?: string
  from?: string
  to?: string
  source?: string
  target?: string
  when?: string
  goal?: string
  full?: boolean
  output_root?: string
  mode?: ExecutionMode
  handoff?: 'result' | 'none'
  handoff_note?: string
  update?: boolean
  path?: string
  rule?: string
  run_state?: boolean
  instance?: string
  all?: boolean
  status?: string
  note?: string
  nodes?: NodePatchArgs[]
  log?: string
}

/** `state` 动作里一个步骤的改动（与参数声明同构）。 */
export interface NodePatchArgs {
  id: string
  status?: string
  summary?: string
  outputs?: string[]
  verdict?: string
  error?: string
  by?: string
}

/** 把 `state` 的参数整理成服务的入参；状态值不认识就回一句给模型看的错。 */
function statePatchOf(args: WorkflowLiteArgs): StatePatch | string {
  const patch: StatePatch = {}
  if (args.status !== undefined) {
    const status = RUN_STATUSES.find((candidate) => candidate === args.status)
    if (status === undefined)
      return `status 不认识：${args.status}（可选：${RUN_STATUSES.join(' / ')}）`
    patch.status = status
  }
  if (args.note !== undefined) patch.note = args.note
  if (args.log !== undefined) patch.log = args.log
  if (args.nodes !== undefined) {
    if (!Array.isArray(args.nodes)) return 'nodes 要写成 [{ id, status, summary, … }]'
    const nodes: Record<string, NodePatch> = {}
    for (const raw of args.nodes) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return 'nodes 的每一项要写成 { id, status, summary, … }'
      }
      const id = raw.id
      if (typeof id !== 'string' || id === '') return 'nodes 的每一项都要有 id（步骤 id）'
      if (nodes[id] !== undefined) return `nodes 里步骤 ${id} 出现了两次，合成一项`
      const node: NodePatch = {}
      if (raw.status !== undefined) {
        const status = NODE_STATUSES.find((candidate) => candidate === raw.status)
        if (status === undefined) {
          return `nodes.${id}.status 不认识：${raw.status}（可选：${NODE_STATUSES.join(' / ')}）`
        }
        node.status = status
      }
      for (const key of ['summary', 'verdict', 'error', 'by'] as const) {
        const value = raw[key]
        if (value === undefined) continue
        if (typeof value !== 'string') return `nodes.${id}.${key} 必须是文字`
        node[key] = value
      }
      if (raw.outputs !== undefined) {
        if (!Array.isArray(raw.outputs) || raw.outputs.some((item) => typeof item !== 'string')) {
          return `nodes.${id}.outputs 必须是文件路径的列表`
        }
        node.outputs = raw.outputs
      }
      nodes[id] = node
    }
    patch.nodes = nodes
  }
  return patch
}

/**
 * connect 的交接参数 → 仓储的入参：`undefined` = 不动，`null` = 回到缺省（交执行结果、不附说明），
 * `false` = 只管先后，对象 = 交执行结果并附说明。
 */
function handoffOf(args: WorkflowLiteArgs): Handoff | false | null | undefined {
  if (args.handoff === 'none') return false
  if (args.handoff_note !== undefined) return { note: args.handoff_note }
  if (args.handoff === 'result') return null
  return undefined
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
            ...(load.document.settings === undefined ? {} : { settings: load.document.settings }),
            nodes: sortedNodes(load.document).map((node) =>
              indexEntry(load.document ?? document0(), node),
            ),
            ...(load.document.nodes.some(isFile) ? { files: fileEntries(load.document) } : {}),
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
          // 文件节点给连着它的全部线（谁写、谁读）；步骤给出边。
          edges: load.document.edges
            .filter((edge) =>
              isFile(node)
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
        // 整卷版是给人看的：不建实例，路径里留着 {instance}。
        if (args.full === true || runs === undefined) {
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
        if (args.outputs !== undefined) {
          upsert.outputs = args.outputs.map((spec) =>
            spec.rule === undefined ? { path: spec.path } : { path: spec.path, rule: spec.rule },
          )
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

      case 'configure': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        if (
          args.output_root === undefined &&
          args.mode === undefined &&
          args.run_state === undefined
        ) {
          return errorValue({
            error: {
              code: 'invalid_args',
              message: 'configure 需要 output_root、mode 或 run_state',
            },
          })
        }
        const outcome = await repository.configure(name, {
          ...(args.output_root === undefined ? {} : { outputRoot: args.output_root }),
          ...(args.mode === undefined ? {} : { mode: args.mode }),
          ...(args.run_state === undefined ? {} : { runState: args.run_state }),
        })
        if (!outcome.ok) return errorValue(outcome)
        return finish(outcome.result)
      }

      case 'write_file': {
        const name = requireWorkflow(args.workflow)
        if (name === null) return missingWorkflow()
        if (args.node === undefined && args.path === undefined) {
          return errorValue({
            error: { code: 'invalid_args', message: 'write_file 需要 node（文件节点 id）或 path' },
          })
        }
        const outcome = await repository.writeFile(name, {
          ...(args.node === undefined || args.node === '' ? {} : { id: args.node }),
          ...(args.path === undefined ? {} : { path: args.path }),
          ...(args.rule === undefined ? {} : { rule: args.rule }),
        })
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
  outputs: {
    type: 'array',
    description:
      'write_node：一个或多个产出，每个可带生成规则（规则进派发计划的交付契约）。给了它就整份替换 output。',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: { type: 'string', required: true, description: '相对工作区根的产出路径。' },
        rule: { type: 'string', description: '这份产出该怎么写：格式、必须包含什么。' },
      },
    },
  },
  description: {
    type: 'string',
    description: 'write_node：一句话说明这一步做什么（给人看，不进计划）；空串 = 清除。',
  },
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
    description:
      'connect / disconnect：条件（缺省 = 无条件边）。短判定词（pass / fail）走 VERDICT 约定；也可以写一句自然语言条件，由执行者判断。',
  },
  handoff: {
    type: 'string',
    enum: ['result', 'none'],
    description:
      'connect（步骤 → 步骤）：result（缺省）把上游这一次的执行结果交给下游 / none 只管先后。边已存在时只改交接。',
  },
  handoff_note: {
    type: 'string',
    description:
      'connect（步骤 → 步骤）：交接说明——下游拿到执行结果之后怎么用（进派发计划）；空串 = 清除。',
  },
  update: {
    type: 'boolean',
    description:
      'connect（步骤 → 文件）：true = 在原文件上更新（先读再改，如修完在问题清单里打钩）；false = 整份写出。缺省：文件还没人写就是整份写出，已经有人写就是更新。',
  },
  path: {
    type: 'string',
    description: 'write_file：文件路径（相对产出根目录，不能是绝对路径或含 ..）。',
  },
  rule: { type: 'string', description: 'write_file：这份文件该怎么写；空串 = 清除。' },
  goal: {
    type: 'string',
    description: 'compile：本次目标（用户说了要做成什么时写，进计划的「本次执行」段）。',
  },
  full: { type: 'boolean', description: 'compile：true = 整卷版（内联正文，给人读）。' },
  output_root: {
    type: 'string',
    description:
      'configure：产出根目录（相对工作区或绝对路径），编译时拼在每个产出文件前面；{instance} 换成实例 id。空串 = 清除（默认 .workflow-lite/runs/{instance}/out），. = 工作区根目录。',
  },
  run_state: {
    type: 'boolean',
    description:
      'configure：记录运行状态。打开后每个工作流实例都带一份运行状态，执行时按计划末尾「运行状态」段用 state 记进度。',
  },
  instance: {
    type: 'string',
    description: 'resume / state：实例 id（缺省 = 本会话当前的实例；用户从画布上执行时会给出）。',
  },
  status: {
    type: 'string',
    enum: [...RUN_STATUSES],
    description: 'state：整体状态。',
  },
  note: {
    type: 'string',
    description:
      'state：整体的一句说明（waiting 写等什么、failed / cancelled 写原因）；空串 = 清掉。',
  },
  nodes: {
    type: 'array',
    description:
      'state：要改的步骤，每项一个。改 status 时插件自动补轮次、开始 / 结束时间和流水；done 带 summary、outputs，有条件出边的带 verdict（取它出边的条件值）；failed 带 error。',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true, description: '步骤 id（大小写与图一致）。' },
        status: { type: 'string', enum: [...NODE_STATUSES], description: '步骤状态。' },
        summary: { type: 'string', description: '一两句结论（200 字以内）；空串 = 清掉。' },
        outputs: {
          type: 'array',
          items: { type: 'string' },
          description: '这一轮实际写出的文件路径（照计划里给的路径写）。',
        },
        verdict: { type: 'string', description: '判定：它出边的条件值之一（如 pass / fail）。' },
        error: { type: 'string', description: '失败原因。' },
        by: { type: 'string', description: '谁做的：self / subagent / 队员名。' },
      },
    },
  },
  log: { type: 'string', description: 'state：往流水追加一条说明。' },
  all: { type: 'boolean', description: 'runs：true = 列所有会话的实例（缺省只列本会话的）。' },
  mode: {
    type: 'string',
    enum: [...EXECUTION_MODES],
    description:
      'configure：执行方式。auto 由主 agent 决定 / serial 本人串行 / subagent 主 agent 派子代理 / team 主 agent 当 Agent Team 的 Lead。',
  },
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
