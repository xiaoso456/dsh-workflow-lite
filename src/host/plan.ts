/**
 * dsh-workflow-lite — 编译编排。
 *
 * 纯函数编译器（`shared/compile.ts`）不认识磁盘；这一层负责**把它需要的三样东西凑齐**：
 * 图（从仓储读）、路径映射（`planId` 决定）、以及该图的校验结论（进 ⑥ 段）。
 * **物化**（把载荷写进 `.dispatch/<图名>/<planId>/`）也只在这里发生——它是编译唯一的 I/O。
 *
 * 失败姿态照 §5.1 / §5.5：有编译级问题时 `plan` 为空串、`problems` 必填，
 * **绝不返回一份残缺计划**；物化失败 ⇒ `io_error`（图本身没坏，不该是 `invalid_args`）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/plan
 */

import { buildFullText, buildPlan, planIdOf } from '../shared/compile.ts'
import { analyzeGraph } from '../shared/graph.ts'
import type {
  PlanId,
  PlanResult,
  ToolWarning,
  ValidationProblem,
  WorkflowDocument,
} from '../shared/types.ts'
import { materialize } from './store/materialize.ts'
import { payloadFile } from './store/paths.ts'
import { type Outcome, problemsToWarnings, type Repository } from './store/repository.ts'

/** 编译入参：图名 + 本次目标 + 工作区路径（后两者进 ⑤ 动态尾）。 */
export interface CompileOptions {
  /** `true` = 整卷版（内联正文，给人读）；缺省 = 派发版。 */
  full?: boolean
  goal?: string
  /** 执行者的工作区根；取不到时 ⑤ 渲染「工作区路径：未指定」。 */
  cwd?: string
}

export interface CompileBundle {
  /** 内容寻址：图内容哈希前 8 位。载荷路径由它决定。 */
  planId: PlanId
  /** 派发计划（或整卷版）文本；有编译级问题时为空串。 */
  plan: string
  /** **只装编译级问题**（阻塞编译的那几条）。 */
  problems: ValidationProblem[]
  /** 警告与提示（非阻塞），含该图读入阶段报出的那些。 */
  warnings: ToolWarning[]
  /** 载荷路径映射（节点 id → 绝对路径）——画布展示与测试都要它。 */
  payloadPaths: Record<string, string>
}

/**
 * 编译一张图。
 *
 * - 保存级问题 ⇒ `blocked`（图都加载不了，谈不上编译）；图不存在 ⇒ `not_found`。
 * - 编译级问题 ⇒ 成功返回但 `plan` 为空串、`problems` 非空，**且不物化**。
 * - 正常 ⇒ 物化载荷 + 返回计划。
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

  const document: WorkflowDocument = load.document
  const analysis = analyzeGraph(document)
  const planId = planIdOf(document)
  const payloadPaths = new Map<string, string>(
    document.nodes.map((node) => [node.id, payloadFile(dataDir, name, planId, node.id)]),
  )

  const facts = {
    name,
    document,
    ...(options.goal === undefined ? {} : { goal: options.goal }),
    ...(cwd === undefined ? {} : { cwd }),
    payloadPaths,
  }

  const problems = load.problems
  const warnings = problemsToWarnings(problems)
  const asRecord = (): Record<string, string> => Object.fromEntries(payloadPaths)

  if (options.full === true) {
    // 整卷版：给人读的，**不物化**（它是预览/导出，不是派发）。
    const text = buildFullText(facts, analysis, { problems })
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

  const result: PlanResult = buildPlan(facts, analysis, { problems })
  if (result.problems.length > 0) {
    // 编译级 ⇒ 不出计划、也不物化（不留下与计划对不上的载荷）。
    return {
      ok: true,
      result: { planId, plan: '', problems: result.problems, warnings, payloadPaths: asRecord() },
    }
  }

  // 物化：编译唯一的 I/O。失败 ⇒ io_error。
  const payloads = new Map<string, string>(
    document.nodes
      .filter((node) => typeof node.data.prompt === 'string')
      .map((node) => [node.id, node.data.prompt ?? '']),
  )
  try {
    await materialize(dataDir, name, planId, payloads)
  } catch (error) {
    return {
      ok: false,
      error: {
        code: 'io_error',
        message: `物化载荷失败：${error instanceof Error ? error.message : String(error)}`,
        detail: { planId, workflow: name },
      },
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
