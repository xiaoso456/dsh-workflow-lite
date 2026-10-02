/**
 * dsh-workflow-lite — 编译编排。
 *
 * 纯函数编译器（`shared/compile.ts`）不认识磁盘；这一层负责**把它需要的三样东西凑齐**：
 * 图（从仓储读）、路径映射（`planId` 决定）、以及该图的校验结论（进 ⑥ 段）。
 * **物化**（把载荷写进 `.dispatch/<图名>/<planId>/`）也只在这里发生——它是编译唯一的 I/O。
 *
 * 失败姿态：有编译级问题时 `plan` 为空串、`problems` 必填，
 * **绝不返回一份残缺计划**；物化失败 ⇒ `io_error`（图本身没坏，不该是 `invalid_args`）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/plan
 */

import { buildFullText, buildPlan, planIdOf, type RunStateSection } from '../shared/compile.ts'
import { analyzeGraph } from '../shared/graph.ts'
import { isStep } from '../shared/model.ts'
import { bindRoot, rootOf } from '../shared/outputPaths.ts'
import type {
  PlanId,
  PlanResult,
  ToolWarning,
  ValidationProblem,
  WorkflowDocument,
} from '../shared/types.ts'
import { ensureWorkspaceIgnore } from './runs/store.ts'
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
  /**
   * 这次编译要记运行状态：计划没问题之后调用它建实例，拿回「运行状态」段要的路径与实例的快照。
   * 只有工具的 `compile` / `resume` 传它；画布预览不传（预览不该建实例）。
   */
  prepareRun?: (planId: PlanId, document: WorkflowDocument) => Promise<Outcome<PreparedRun>>
  /** 计划要拿去执行（不是预览）：产出根目录里的 `{instance}` 必须换成实际的值。 */
  execute?: boolean
}

/** 建好的实例：计划末尾那段要的路径，加上回给调用方的实例信息。 */
export interface PreparedRun {
  /** 不记运行状态的实例没有这一段。 */
  section?: RunStateSection
  info: Record<string, string>
  /** 新建的实例：快照（产出根目录已换上实例 id），计划按它出。复用 / 恢复时不给。 */
  document?: WorkflowDocument
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
  /** 记运行状态时建好的实例（`instance` / `statePath` …）。 */
  run?: Record<string, string>
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

  return compileDocument(dataDir, name, load.document, load.problems, options, cwd)
}

/**
 * 编译一份已经读进来的图（工作流实例的快照走这里：它不在 `workflows/` 里）。
 *
 * 产出根目录没配时用默认值 `.workflow-lite/runs/{instance}/out`：
 * - 记运行状态的执行：先确认图编译得出计划，再建实例（快照里的根目录换上实例 id），按快照出计划；
 * - 不记状态的执行（`execute`）：没有实例 id，`{instance}` 换成 planId（同一张图反复编译落在同一处）；
 * - 预览：记号原样留着。
 *
 * @param problems - 该图读入时的全部问题（进 ⑥ 段与 `warnings`）。
 */
export async function compileDocument(
  dataDir: string,
  name: string,
  document: WorkflowDocument,
  problems: readonly ValidationProblem[],
  options: CompileOptions = {},
  cwd?: string,
): Promise<Outcome<CompileBundle>> {
  const base = {
    ...(options.full === true ? { full: true } : {}),
    ...(options.goal === undefined ? {} : { goal: options.goal }),
  }
  const prepare = options.prepareRun
  if (prepare === undefined || options.full === true || document.settings?.runState !== true) {
    const bind = options.execute === true || prepare !== undefined ? planIdOf(document) : undefined
    return compileOnce(dataDir, name, document, problems, { ...base, bind, materialize: true }, cwd)
  }
  // 有编译级问题就不建实例（先空跑一遍，不物化）。
  const check = await compileOnce(dataDir, name, document, problems, base, cwd)
  if (!check.ok || check.result.problems.length > 0) return check
  const prepared = await prepare(check.result.planId, document)
  if (!prepared.ok) return prepared
  const final = await compileOnce(
    dataDir,
    name,
    prepared.result.document ?? document,
    problems,
    {
      ...base,
      materialize: true,
      ...(prepared.result.section === undefined ? {} : { runState: prepared.result.section }),
    },
    cwd,
  )
  return final.ok ? { ok: true, result: { ...final.result, run: prepared.result.info } } : final
}

async function compileOnce(
  dataDir: string,
  name: string,
  source: WorkflowDocument,
  problems: readonly ValidationProblem[],
  options: {
    full?: boolean
    goal?: string
    /** 根目录里 `{instance}` 换成什么（不给 = 原样留着）。 */
    bind?: string | undefined
    /** 写载荷（`false` = 只看出不出得了计划）。 */
    materialize?: boolean
    runState?: RunStateSection
  },
  cwd: string | undefined,
): Promise<Outcome<CompileBundle>> {
  const analysis = analyzeGraph(source)
  const planId = planIdOf(source)
  const root =
    options.bind === undefined
      ? rootOf(source.settings)
      : bindRoot(rootOf(source.settings), options.bind)
  const document: WorkflowDocument = {
    ...source,
    settings: { ...source.settings, outputRoot: root },
  }
  const payloadPaths = new Map<string, string>(
    // 只有步骤有载荷（文件节点是数据，不是任务）。
    document.nodes
      .filter(isStep)
      .map((node) => [node.id, payloadFile(dataDir, name, planId, node.id)]),
  )

  const facts = {
    name,
    document,
    ...(options.goal === undefined ? {} : { goal: options.goal }),
    ...(cwd === undefined ? {} : { cwd }),
    payloadPaths,
  }

  const warnings = problemsToWarnings([...problems])
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

  const result: PlanResult = buildPlan(facts, analysis, {
    problems,
    ...(options.runState === undefined ? {} : { runState: options.runState }),
  })
  if (result.problems.length > 0) {
    // 编译级 ⇒ 不出计划、也不物化（不留下与计划对不上的载荷）。
    return {
      ok: true,
      result: { planId, plan: '', problems: result.problems, warnings, payloadPaths: asRecord() },
    }
  }
  if (options.materialize !== true) {
    return {
      ok: true,
      result: { planId, plan: result.plan, problems: [], warnings, payloadPaths: asRecord() },
    }
  }

  // 物化：编译唯一的 I/O。失败 ⇒ io_error。
  const payloads = new Map<string, string>(
    document.nodes
      .filter(isStep)
      .filter((node) => typeof node.data.prompt === 'string')
      .map((node) => [node.id, node.data.prompt ?? '']),
  )
  try {
    await materialize(dataDir, name, planId, payloads)
    // 产出落在工作区的 `.workflow-lite/` 下时，那个目录要有忽略一切的 .gitignore。
    if (options.bind !== undefined && cwd !== undefined) await ensureWorkspaceIgnore(cwd, root)
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
