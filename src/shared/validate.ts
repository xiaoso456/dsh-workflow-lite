/**
 * dsh-workflow-lite — 四级校验。
 *
 * **本节是校验级别的唯一出处**。四条级别的语义：
 * - **保存级**：结构性破损——拒绝加载 / 拒绝写入。JSON 不合法一律走这里，
 *   新结构没有"坏一个节点"这回事。
 * - **编译级**：语义问题——**允许落盘**（画布标红），但**阻塞编译**。
 * - **警告** / **提示**：不阻塞任何操作，走同一条 `warnings` 通道、带 `level` 区分。
 *
 * 处理性失败（IO 中断、写前哈希冲突、物化失败）**不是校验级别**，不进这里。
 *
 * 纯函数，不碰磁盘、不 import DSH 包。
 * @module @xiaoso/dsh-workflow-lite/shared/validate
 */

import {
  analyzeGraph,
  byId,
  classifyShape,
  cycleHasNoExit,
  edgeWhen,
  type GraphAnalysis,
} from './graph.ts'
import { WELL_KNOWN_WHEN } from './limits.ts'
import { idKey, outputSpecs } from './model.ts'
import {
  checkLabel,
  checkName,
  checkOutput,
  checkText,
  checkWhen,
  isVerdictWhen,
} from './naming.ts'
import { checkOutputRoot } from './outputPaths.ts'
import type {
  ValidationCode,
  ValidationLevel,
  ValidationProblem,
  WorkflowDocument,
  WorkflowEdge,
} from './types.ts'

export interface ValidateOptions {
  /** 图名——校验文件名约束用。 */
  workflowName: string
  /** 单图节点数上限（`Config.maxNodes`）。 */
  maxNodes: number
  /** `workflows/` 下存在同名**目录**（md 版遗留）——算撞名占位。 */
  dirCollision?: boolean
}

export interface ValidationReport {
  save: ValidationProblem[]
  compile: ValidationProblem[]
  warning: ValidationProblem[]
  hint: ValidationProblem[]
  /** 保存级为空才能加载。 */
  canLoad: boolean
  /** 编译级为空才能出计划。 */
  canCompile: boolean
}

function mk(
  level: ValidationLevel,
  code: ValidationCode,
  message: string,
  extra?: Pick<ValidationProblem, 'node' | 'edge'>,
): ValidationProblem {
  return { level, code, message, ...extra }
}

/** 边的条件键：`when` 缺省与空串同义（都是无条件边）。 */
function edgeKey(edge: WorkflowEdge): string {
  return `${idKey(edge.source)}\u0000${idKey(edge.target)}\u0000${edgeWhen(edge) ?? ''}`
}

/**
 * 校验一张图。
 * @param document - 已规范化的文档。
 * @param options - 图名与上限。
 * @param extra - 读入阶段已报出的问题（未知 `type`/字段、坐标补位、viewport 回落、
 *   旧结构检测…），按级别合进结果，避免上层再分拣一遍。
 */
export function validateDocument(
  document: WorkflowDocument,
  options: ValidateOptions,
  extra: readonly ValidationProblem[] = [],
  analysis: GraphAnalysis = analyzeGraph(document),
): ValidationReport {
  const save: ValidationProblem[] = []
  const compile: ValidationProblem[] = []
  const warning: ValidationProblem[] = []
  const hint: ValidationProblem[] = []

  // ── 保存级：图名与节点 id 的文件名约束 ──────────────────────
  const nameProblem = checkName(options.workflowName)
  if (nameProblem !== null) {
    save.push(mk('save', nameProblem.code, `图名不合法：${nameProblem.message}`))
  }
  if (options.dirCollision === true) {
    save.push(
      mk(
        'save',
        'workflow_dir_collision',
        `同名目录占位：workflows/${options.workflowName}/ 与同名 .json 不能并存`,
      ),
    )
  }

  // ── 保存级：工作流设置 ──────────────────────────────────────
  const root = document.settings?.outputRoot
  const rootProblem = root === undefined ? null : checkOutputRoot(root)
  if (rootProblem !== null) save.push(mk('save', rootProblem.code, rootProblem.message))

  // ── 保存级：id 唯一性（大小写不敏感——它们会撞同一个载荷文件名） ──
  const byKey = new Map<string, string[]>()
  for (const node of document.nodes) {
    const key = idKey(node.id)
    byKey.set(key, [...(byKey.get(key) ?? []), node.id])
  }
  for (const [key, ids] of byKey) {
    if (ids.length < 2) continue
    const distinct = new Set(ids)
    const code: ValidationCode = distinct.size > 1 ? 'node_id_case_collision' : 'node_id_duplicate'
    save.push(
      mk(
        'save',
        code,
        distinct.size > 1
          ? `节点 id 只差大小写：${ids.join(' / ')}——它们会撞同一个载荷文件名`
          : `节点 id 重复：${key}`,
        { node: ids[0] },
      ),
    )
  }
  for (const node of document.nodes) {
    const problem = checkName(node.id)
    if (problem !== null) {
      save.push(mk('save', problem.code, `节点 id 不合法：${problem.message}`, { node: node.id }))
    }
  }

  // ── 保存级：每个节点的字段规则 ──────────────────────────────
  for (const node of document.nodes) {
    const seenPaths = new Set<string>()
    for (const spec of outputSpecs(node.data.output)) {
      const problem =
        checkOutput(spec.path) ??
        (spec.rule === undefined ? null : checkText(spec.rule, '产出规则'))
      if (problem !== null) {
        save.push(
          mk('save', problem.code, `节点 ${node.id} 的 output 不合法：${problem.message}`, {
            node: node.id,
          }),
        )
      }
      // 同一个节点里把同一个文件声明两遍：两条规则会互相打架。
      if (seenPaths.has(spec.path)) {
        save.push(
          mk('save', 'output_invalid', `节点 ${node.id} 重复声明了产出 ${spec.path}`, {
            node: node.id,
          }),
        )
      }
      seenPaths.add(spec.path)
    }
    if (typeof node.data.description === 'string') {
      const problem = checkText(node.data.description, '描述')
      if (problem !== null) {
        save.push(
          mk('save', 'label_invalid', `节点 ${node.id} 的描述不合法：${problem.message}`, {
            node: node.id,
          }),
        )
      }
    }
    if (typeof node.data.label === 'string') {
      const problem = checkLabel(node.data.label)
      if (problem !== null) {
        save.push(
          mk('save', problem.code, `节点 ${node.id} 的 label 不合法：${problem.message}`, {
            node: node.id,
          }),
        )
      }
    }
  }

  // ── 保存级：边的字段规则与唯一性 ────────────────────────────
  const seenEdgeIds = new Map<string, number>()
  const seenEdgeKeys = new Map<string, WorkflowEdge[]>()
  for (const edge of document.edges) {
    seenEdgeIds.set(edge.id, (seenEdgeIds.get(edge.id) ?? 0) + 1)
    const key = edgeKey(edge)
    seenEdgeKeys.set(key, [...(seenEdgeKeys.get(key) ?? []), edge])
    if (edge.data?.when !== undefined) {
      const problem = checkWhen(edge.data.when)
      if (problem !== null) {
        save.push(
          mk('save', problem.code, `边 ${edge.id} 的 when 不合法：${problem.message}`, {
            edge: edge.id,
          }),
        )
      }
    }
  }
  for (const [id, count] of seenEdgeIds) {
    if (count > 1) save.push(mk('save', 'edge_id_duplicate', `边 id 重复：${id}`, { edge: id }))
  }

  // ── 保存级：悬空 edge（端点不存在 ⇒ 整图不可加载） ──────────
  for (const edge of analysis.danglingEdges) {
    save.push(
      mk(
        'save',
        'edge_dangling',
        `边 ${edge.source} → ${edge.target} 指向不存在的节点——它会让批次与分支静默少一条路径`,
        { edge: edge.id },
      ),
    )
  }

  // ── 编译级 ──────────────────────────────────────────────────
  if (document.nodes.length === 0) {
    compile.push(mk('compile', 'no_nodes', '图内没有节点，无法编译'))
  }
  if (document.nodes.length > options.maxNodes) {
    compile.push(
      mk(
        'compile',
        'too_many_nodes',
        `节点数 ${document.nodes.length} 超过上限 ${options.maxNodes}`,
      ),
    )
  }
  for (const node of document.nodes) {
    if (node.data.prompt === undefined || node.data.prompt === '') {
      compile.push(
        mk('compile', 'prompt_empty', `节点 ${node.id} 没有提示词正文——执行者会拿到一个空任务`, {
          node: node.id,
        }),
      )
    }
  }

  // ── 警告 ────────────────────────────────────────────────────
  for (const cycle of analysis.cycles) {
    if (cycleHasNoExit(cycle)) {
      warning.push(
        mk(
          'warning',
          'loop_without_exit',
          `循环体 ${cycle.nodes.join(' → ')} 没有出口——会无限重复`,
          { node: cycle.entry },
        ),
      )
    }
  }
  for (const node of document.nodes) {
    if (
      classifyShape(document.edges.filter((edge) => idKey(edge.source) === idKey(node.id))) ===
      'mixed'
    ) {
      warning.push(
        mk(
          'warning',
          'mixed_conditional_edges',
          `节点 ${node.id} 混用了有/无条件出边——并行还是分支有歧义`,
          { node: node.id },
        ),
      )
    }
  }
  for (const edges of seenEdgeKeys.values()) {
    if (edges.length < 2) continue
    const first = edges[0]
    if (first === undefined) continue
    warning.push(
      mk(
        'warning',
        'duplicate_edge',
        `边 ${first.source} → ${first.target}（when=${edgeWhen(first) ?? '无条件'}）重复写了两遍——编译器渲染时去重`,
        { edge: first.id },
      ),
    )
  }
  const outputOwners = new Map<string, string[]>()
  for (const node of document.nodes) {
    for (const { path } of outputSpecs(node.data.output)) {
      outputOwners.set(path, [...(outputOwners.get(path) ?? []), node.id])
    }
  }
  for (const [output, owners] of outputOwners) {
    if (owners.length < 2) continue
    warning.push(
      mk(
        'warning',
        'shared_output',
        `多个节点声明了同一个产出 ${output}：${[...owners].sort(byId).join(' / ')}`,
        { node: owners[0] },
      ),
    )
  }

  // ── 提示 ────────────────────────────────────────────────────
  for (const cycle of analysis.cycles) {
    if (cycle.backEdges.length > 1) {
      hint.push(
        mk(
          'hint',
          'multi_back_edges',
          `同一个循环体内出现多条回边（多环交叠）：${cycle.backEdges.join(' / ')}`,
          { node: cycle.entry },
        ),
      )
    }
  }
  const multiNode = document.nodes.length > 1
  for (const node of document.nodes) {
    const incoming = document.edges.filter((edge) => idKey(edge.target) === idKey(node.id))
    const outgoing = document.edges.filter((edge) => idKey(edge.source) === idKey(node.id))
    if (incoming.length > 0 && node.data.output === undefined) {
      hint.push(
        mk(
          'hint',
          'missing_output',
          `节点 ${node.id} 有入边但没写 output——可能是漏了产出声明，确实不产出请显式写 output: false`,
          { node: node.id },
        ),
      )
    }
    if (multiNode && incoming.length === 0 && outgoing.length === 0) {
      hint.push(
        mk('hint', 'stray_entry', `节点 ${node.id} 既没有上游也没有下游——孤立节点`, {
          node: node.id,
        }),
      )
    }

    const whens = new Set(
      outgoing
        .map((edge) => edgeWhen(edge))
        .filter((value): value is string => value !== undefined),
    )
    const preset = WELL_KNOWN_WHEN.filter((value) => whens.has(value))
    if (whens.size > 0 && preset.length === 1) {
      hint.push(
        mk(
          'hint',
          'branch_not_exhaustive',
          `节点 ${node.id} 的条件分支未穷尽：pass 与 fail 只出现了 ${preset[0]} 一个`,
          { node: node.id },
        ),
      )
    }
    for (const value of whens) {
      if (WELL_KNOWN_WHEN.includes(value as (typeof WELL_KNOWN_WHEN)[number])) continue
      // 自然语言条件是刻意的写法（由执行者判断），不提示；只提示自造的判定词。
      if (!isVerdictWhen(value)) continue
      hint.push(
        mk(
          'hint',
          'freeform_when',
          `节点 ${node.id} 用了自由文本 when=${value}——编译器只能原义引用，无法推断穷尽性`,
          { node: node.id },
        ),
      )
    }
  }

  // ── 合入读入阶段的问题 ──────────────────────────────────────
  for (const problem of extra) {
    if (problem.level === 'save') save.push(problem)
    else if (problem.level === 'compile') compile.push(problem)
    else if (problem.level === 'warning') warning.push(problem)
    else hint.push(problem)
  }

  return {
    save,
    compile,
    warning,
    hint,
    canLoad: save.length === 0,
    canCompile: compile.length === 0,
  }
}

/** 把一份报告摊平成一条通道（`warnings` 用；`problems` 只装编译级，见 8.2）。 */
export function toWarnings(
  report: ValidationReport,
): Array<{ level: 'warning' | 'hint' } & ValidationProblem> {
  return [...report.warning, ...report.hint].map((problem) => ({
    ...problem,
    level: problem.level === 'warning' ? 'warning' : 'hint',
  }))
}
