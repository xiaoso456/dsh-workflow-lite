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

import { edgeKind, fileGraph, flowEdges, nodeIndex } from './files.ts'
import {
  analyzeGraph,
  byId,
  classifyShape,
  cycleHasNoExit,
  edgeWhen,
  type GraphAnalysis,
} from './graph.ts'
import { WELL_KNOWN_WHEN } from './limits.ts'
import { idKey, isFile, isStep, outputSpecs } from './model.ts'
import {
  checkLabel,
  checkName,
  checkOutput,
  checkText,
  checkWhen,
  isVerdictWhen,
} from './naming.ts'
import { checkOutputRoot, outputKey } from './outputPaths.ts'
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

  const steps = document.nodes.filter(isStep)
  const nodes = nodeIndex(document)
  const flow = flowEdges(document)

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
    if (isFile(node)) {
      const problem =
        checkOutput(node.data.path) ??
        (node.data.rule === undefined ? null : checkText(node.data.rule, '生成规则'))
      if (problem !== null) {
        save.push(
          mk('save', problem.code, `文件 ${node.id} 不合法：${problem.message}`, { node: node.id }),
        )
      }
      continue
    }
    for (const spec of outputSpecs(node.data.output)) {
      const problem = checkOutput(spec.path)
      if (problem !== null) {
        save.push(
          mk('save', problem.code, `节点 ${node.id} 的 output 不合法：${problem.message}`, {
            node: node.id,
          }),
        )
      }
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
    const handoff = edge.data?.handoff
    if (
      handoff !== undefined &&
      handoff !== false &&
      checkText(handoff.note, '交接说明') !== null
    ) {
      save.push(mk('save', 'handoff_invalid', `边 ${edge.id} 的交接说明太长`, { edge: edge.id }))
    }
    // 线的种类由两端决定：条件与交接只属于步骤间的线，写入方式只属于步骤 → 文件。
    const kind = edgeKind(nodes, edge)
    const misplaced =
      kind === 'invalid'
        ? '文件不能直接连到文件'
        : kind !== 'flow' && (edge.data?.when !== undefined || handoff !== undefined)
          ? '连着文件的线不能带条件或交接'
          : kind !== 'write' && edge.data?.update === true
            ? '只有「步骤 → 文件」的线才有写入方式'
            : null
    if (misplaced !== null) {
      save.push(mk('save', 'file_edge_invalid', `边 ${edge.id}：${misplaced}`, { edge: edge.id }))
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
  if (steps.length === 0) {
    compile.push(mk('compile', 'no_nodes', '图内没有步骤，无法编译'))
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
  for (const node of steps) {
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
  for (const node of steps) {
    if (classifyShape(flow.filter((edge) => idKey(edge.source) === idKey(node.id))) === 'mixed') {
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
  // 两个文件节点指向同一个路径：它们其实是同一份文件，应该合成一个。
  const pathOwners = new Map<string, string[]>()
  for (const node of document.nodes) {
    if (!isFile(node)) continue
    const key = outputKey(node.data.path)
    pathOwners.set(key, [...(pathOwners.get(key) ?? []), node.id])
  }
  for (const [path, owners] of pathOwners) {
    if (owners.length < 2) continue
    warning.push(
      mk(
        'warning',
        'shared_output',
        `文件 ${[...owners].sort(byId).join(' / ')} 指向同一个路径 ${path}——它们是同一份文件，合成一个文件节点再让各步骤连过来`,
        { node: owners[0] },
      ),
    )
  }
  const files = fileGraph(document)
  for (const info of files.values()) {
    // 不止一个步骤整份写它：后写的会把先写的覆盖掉。
    const producers = info.writers.filter((writer) => !writer.update).map((writer) => writer.id)
    if (producers.length > 1) {
      warning.push(
        mk(
          'warning',
          'file_overwritten',
          `${[...producers].sort(byId).join(' / ')} 都整份写入 ${info.file.data.path}——后写的会覆盖先写的；要接着写请把后面的改成「更新」`,
          { node: info.file.id },
        ),
      )
    }
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
  for (const info of files.values()) {
    const { file } = info
    if (info.writers.length === 0 && info.readers.length === 0) {
      hint.push(
        mk('hint', 'stray_entry', `文件 ${file.data.path} 没有连任何步骤`, { node: file.id }),
      )
      continue
    }
    if (info.writers.length === 0) {
      hint.push(
        mk('hint', 'file_unwritten', `没有步骤写入 ${file.data.path}——如果它是现成的文件可以忽略`, {
          node: file.id,
        }),
      )
      continue
    }
    // 读它的步骤不在任何一个写它的步骤下游：执行到它时，这份文件可能还没写出来。
    for (const reader of info.readers) {
      if (info.writers.some((writer) => writer.id === reader)) continue
      const reached = info.writers.some((writer) => reaches(analysis, writer.id, reader))
      if (reached) continue
      hint.push(
        mk(
          'hint',
          'file_order',
          `${reader} 读取 ${file.data.path}，但写它的步骤不在 ${reader} 的上游——执行到 ${reader} 时它可能还没写出来`,
          { node: reader },
        ),
      )
    }
  }

  const multiStep = steps.length > 1
  for (const node of steps) {
    const incoming = flow.filter((edge) => idKey(edge.target) === idKey(node.id))
    const outgoing = flow.filter((edge) => idKey(edge.source) === idKey(node.id))
    if (multiStep && incoming.length === 0 && outgoing.length === 0) {
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

/** 从步骤 `from` 沿步骤间的线（含回边）能不能走到 `to`。 */
function reaches(analysis: GraphAnalysis, from: string, to: string): boolean {
  const seen = new Set([idKey(from)])
  const queue = [from]
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const next of analysis.successors.get(current) ?? []) {
      if (idKey(next) === idKey(to)) return true
      if (seen.has(idKey(next))) continue
      seen.add(idKey(next))
      queue.push(next)
    }
  }
  return false
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
