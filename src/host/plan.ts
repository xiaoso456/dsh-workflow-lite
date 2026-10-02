/**
 * dsh-workflow-lite — 编译编排。
 *
 * 纯函数编译器（`shared/compile.ts`）不认识磁盘；这一层负责**把它需要的东西凑齐**：
 * 图（从仓储读，或实例的快照）、任务描述的路径、以及该图的校验结论（进 ⑥ 段）。
 *
 * 计划永远对着一个**工作流实例**出：
 * - 给了实例（`options.instance`）：任务描述写进实例目录的 `tasks/`，产出根目录里的 `{instance}`
 *   换成实例 id，开了「记录运行状态」就带上「运行状态」段——这就是模型拿到的那份；
 * - 没给（画布预览、整卷版）：同一份计划，只是实例 id 还没有，路径与段落里留着 `{instance}`，
 *   不写任何文件。预览与执行时拿到的内容逐段对得上。
 *
 * 失败姿态：有编译级问题时 `plan` 为空串、`problems` 必填，
 * **绝不返回一份残缺计划**；写任务描述失败 ⇒ `io_error`（图本身没坏，不该是 `invalid_args`）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/plan
 */

import { join } from 'node:path'
import { buildFullText, buildPlan, planIdOf } from '../shared/compile.ts'
import { analyzeGraph } from '../shared/graph.ts'
import { isStep } from '../shared/model.ts'
import { bindRoot, INSTANCE_TOKEN, rootOf } from '../shared/outputPaths.ts'
import type {
  PlanId,
  PlanResult,
  ToolWarning,
  ValidationProblem,
  WorkflowDocument,
} from '../shared/types.ts'
import { ensureWorkspaceIgnore, instanceDir, TASKS_DIR } from './runs/store.ts'
import { materialize } from './store/materialize.ts'
import { type Outcome, problemsToWarnings, type Repository } from './store/repository.ts'

/** 计划对着的实例。 */
export interface PlanInstance {
  id: string
  /** 实例目录（任务描述 `tasks/`、状态 `state.yaml`、默认产出 `out/` 都在这里）。 */
  dir: string
  /** 记运行状态：计划末尾带「运行状态」段。 */
  tracked: boolean
}

/** 编译入参。 */
export interface CompileOptions {
  /** `true` = 整卷版（内联正文，给人读）；缺省 = 派发版。 */
  full?: boolean
  goal?: string
  /** 实例：给了就按它出计划、把任务描述写进实例目录；不给是预览（留 `{instance}`，不写文件）。 */
  instance?: PlanInstance
}

export interface CompileBundle {
  /** 内容哈希前 8 位（实例的快照把实例 id 定进了产出根目录，所以每个实例各不相同）。 */
  planId: PlanId
  /** 派发计划（或整卷版）文本；有编译级问题时为空串。 */
  plan: string
  /** **只装编译级问题**（阻塞编译的那几条）。 */
  problems: ValidationProblem[]
  /** 警告与提示（非阻塞），含该图读入阶段报出的那些。 */
  warnings: ToolWarning[]
  /** 任务描述路径（步骤 id → 绝对路径）；预览时路径里是 `{instance}`。 */
  payloadPaths: Record<string, string>
}

/**
 * 编译一张图（仓储里的模板）。
 *
 * - 保存级问题 ⇒ `blocked`（图都加载不了，谈不上编译）；图不存在 ⇒ `not_found`。
 * - 编译级问题 ⇒ 成功返回但 `plan` 为空串、`problems` 非空，**且不写文件**。
 */
export async function compileWorkflow(
  repository: Repository,
  dataDir: string,
  name: string,
  options: CompileOptions = {},
  /** 执行者的工作区根；由调用方从会话取（工具从 `exec` 取，RPC 从前端给）。 */
  cwd?: string,
): Promise<Outcome<CompileBundle>> {
  const load = await repository.load(name)
  if (!load.loadable || load.document === null) {
    if (!load.exists) {
      return { ok: false, error: { code: 'not_found', message: `图 ${name} 不存在` } }
    }
    return {
      ok: false,
      error: {
        code: 'blocked',
        message: `图 ${name} 有保存级问题，无法加载：${load.problems.map((p) => p.message).join('；')}`,
        detail: { problems: load.problems },
      },
    }
  }

  return compileDocument(dataDir, name, load.document, load.problems, options, cwd)
}

/**
 * 编译一份已经读进来的图（工作流实例的快照走这里：它不在 `workflows/` 里）。
 * @param problems - 该图的校验结论（进 ⑥ 段与 `warnings`）。
 */
export async function compileDocument(
  dataDir: string,
  name: string,
  document: WorkflowDocument,
  problems: readonly ValidationProblem[],
  options: CompileOptions = {},
  cwd?: string,
): Promise<Outcome<CompileBundle>> {
  const analysis = analyzeGraph(document)
  const planId = planIdOf(document)
  const instance = options.instance
  const id = instance?.id ?? INSTANCE_TOKEN
  const dir = instance?.dir ?? instanceDir(dataDir, INSTANCE_TOKEN, cwd)
  // 产出根目录：没配用默认值（`.workflow-lite/runs/{instance}/out`），有实例就换上实例 id。
  const root =
    instance === undefined ? rootOf(document.settings) : bindRoot(rootOf(document.settings), id)
  const planned: WorkflowDocument = {
    ...document,
    settings: { ...document.settings, outputRoot: root },
  }
  const payloadPaths = new Map<string, string>(
    // 只有步骤有任务描述（文件节点是数据，不是任务）。
    document.nodes.filter(isStep).map((node) => [node.id, join(dir, TASKS_DIR, `${node.id}.md`)]),
  )
  const tracked = instance === undefined ? document.settings?.runState === true : instance.tracked

  const facts = {
    name,
    document: planned,
    ...(options.goal === undefined ? {} : { goal: options.goal }),
    ...(cwd === undefined ? {} : { cwd }),
    instance: id,
    payloadPaths,
  }
  const planOptions = { problems, ...(tracked ? { runState: { instance: id } } : {}) }

  const warnings = problemsToWarnings([...problems])
  const asRecord = (): Record<string, string> => Object.fromEntries(payloadPaths)

  if (options.full === true) {
    // 整卷版：给人读的，**不写文件**（它是预览 / 导出，不是派发）。
    const text = buildFullText(facts, analysis, planOptions)
    return {
      ok: true,
      result: {
        planId,
        plan: text,
        problems: text === '' ? compileProblemsOf(problems) : [],
        warnings,
        payloadPaths: asRecord(),
      },
    }
  }

  const result: PlanResult = buildPlan(facts, analysis, planOptions)
  if (result.problems.length > 0) {
    // 编译级 ⇒ 不出计划、也不写文件（不留下与计划对不上的任务描述）。
    return {
      ok: true,
      result: { planId, plan: '', problems: result.problems, warnings, payloadPaths: asRecord() },
    }
  }

  if (instance !== undefined) {
    // 写任务描述：编译唯一的 I/O。失败 ⇒ io_error。
    const payloads = new Map<string, string>(
      document.nodes
        .filter(isStep)
        .filter((node) => typeof node.data.prompt === 'string')
        .map((node) => [node.id, node.data.prompt ?? '']),
    )
    try {
      await materialize(join(instance.dir, TASKS_DIR), payloads)
      if (cwd !== undefined) await ensureWorkspaceIgnore(cwd)
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'io_error',
          message: `写任务描述失败：${error instanceof Error ? error.message : String(error)}`,
          detail: { planId, workflow: name, instance: instance.id },
        },
      }
    }
  }
  return {
    ok: true,
    result: { planId, plan: result.plan, problems: [], warnings, payloadPaths: asRecord() },
  }
}

/** 从一份问题清单里挑出编译级——整卷版被拒时要把它们回告出去。 */
function compileProblemsOf(problems: readonly ValidationProblem[]): ValidationProblem[] {
  return problems.filter((problem) => problem.level === 'compile')
}

/** 该图的警告与提示（画布校验面板用）。 */
export function nonBlockingProblems(problems: readonly ValidationProblem[]): ValidationProblem[] {
  return problems.filter((problem) => problem.level === 'warning' || problem.level === 'hint')
}
