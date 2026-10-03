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
import { inputKind, isChoiceKind, normalizeAnswer } from './inputs.ts'
import {
  CONTROL_CHARS,
  MAX_OPTIONS,
  MAX_RESOURCE_ITEMS,
  MAX_RESOURCE_TEXT_CODEPOINTS,
  MAX_VALUE_CODEPOINTS,
  WELL_KNOWN_WHEN,
} from './limits.ts'
import { idKey, isInput, isResource, isStep, outputSpecs } from './model.ts'
import {
  checkLabel,
  checkName,
  checkOutput,
  checkText,
  checkWhen,
  codepointLength,
  isVerdictWhen,
} from './naming.ts'
import { checkOutputRoot, outputKey } from './outputPaths.ts'
import {
  edgeKind,
  flowEdges,
  isWritable,
  nodeIndex,
  resourceGraph,
  resourceTitle,
} from './resources.ts'
import type {
  InputData,
  ResourceData,
  ResourceItem,
  ValidationCode,
  ValidationLevel,
  ValidationProblem,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowNode,
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
    if (isInput(node)) {
      const problem = inputProblem(node.data)
      if (problem !== null) {
        save.push(
          mk('save', 'input_invalid', `输入 ${node.id} 不合法：${problem.message}`, {
            node: node.id,
          }),
        )
      }
      continue
    }
    if (isResource(node)) {
      const problem = resourceProblem(node.data)
      if (problem !== null) {
        save.push(
          mk('save', 'resource_invalid', `资源 ${node.id} 不合法：${problem.message}`, {
            node: node.id,
          }),
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
    // 线的种类由两端决定：条件与交接只属于步骤间的线，写入方式只属于步骤 → 资源。
    const kind = edgeKind(nodes, edge)
    const misplaced =
      kind === 'invalid'
        ? invalidReason(nodes.get(idKey(edge.source)), nodes.get(idKey(edge.target)))
        : kind !== 'flow' && (edge.data?.when !== undefined || handoff !== undefined)
          ? '连着资源或输入的线不能带条件或交接'
          : kind !== 'write' && edge.data?.update === true
            ? '只有「步骤 → 资源」的线才有写入方式'
            : null
    if (misplaced !== null) {
      save.push(
        mk('save', 'resource_edge_invalid', `边 ${edge.id}：${misplaced}`, { edge: edge.id }),
      )
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

  for (const node of document.nodes) {
    if (!isInput(node)) continue
    if (node.data.question.trim() === '') {
      compile.push(
        mk('compile', 'input_question_empty', `输入 ${node.id} 还没写问题——执行时没法问用户`, {
          node: node.id,
        }),
      )
    }
    if (isChoiceKind(inputKind(node.data)) && (node.data.options?.length ?? 0) === 0) {
      compile.push(
        mk('compile', 'input_options_empty', `输入 ${node.id} 是选择题，但还没有选项`, {
          node: node.id,
        }),
      )
    }
  }

  const resources = resourceGraph(document)
  for (const info of resources.values()) {
    const { resource } = info
    if (resource.data.items.length === 0) {
      compile.push(
        mk('compile', 'resource_empty', `资源 ${resource.id} 还是空的——添加文件、网址等内容`, {
          node: resource.id,
        }),
      )
      continue
    }
    const blank = resource.data.items.findIndex((item) => item.value.trim() === '')
    if (blank >= 0) {
      compile.push(
        mk('compile', 'resource_item_empty', `资源 ${resource.id} 的第 ${blank + 1} 项还没填`, {
          node: resource.id,
        }),
      )
    }
    if (info.writers.length > 0 && !resource.data.items.some(isWritable)) {
      compile.push(
        mk(
          'compile',
          'resource_unwritable',
          `${info.writers.map((writer) => writer.id).join(' / ')} 写资源 ${resource.id}，但它里面没有文件或文件夹——网址、Skill、自定义只能读`,
          { node: resource.id },
        ),
      )
    }
  }

  // ── 警告 ────────────────────────────────────────────────────
  for (const node of document.nodes) {
    if (!isInput(node) || node.data.default === undefined) continue
    if (!isChoiceKind(inputKind(node.data)) || (node.data.options?.length ?? 0) === 0) continue
    const picked = normalizeAnswer(node.data, node.data.default)
    const given = [node.data.default].flat()
    if (picked === undefined || [picked].flat().length !== given.length) {
      warning.push(
        mk(
          'warning',
          'input_default_invalid',
          `输入 ${node.id} 的默认值 ${given.join('、')} 不在选项里——执行时会当没有默认值`,
          { node: node.id },
        ),
      )
    }
  }
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
  // 两个被写的资源里放着同一个路径：它们其实是同一份东西，应该放进一个资源。
  const pathOwners = new Map<string, string[]>()
  for (const info of resources.values()) {
    if (info.writers.length === 0) continue
    const keys = new Set(
      info.resource.data.items
        .filter((item) => isWritable(item) && item.value.trim() !== '')
        .map((item) => outputKey(item.value)),
    )
    for (const key of keys) pathOwners.set(key, [...(pathOwners.get(key) ?? []), info.resource.id])
  }
  for (const [path, owners] of pathOwners) {
    if (owners.length < 2) continue
    warning.push(
      mk(
        'warning',
        'shared_output',
        `资源 ${[...owners].sort(byId).join(' / ')} 都写 ${path}——它们是同一份东西，放进一个资源再让各步骤连过来`,
        { node: owners[0] },
      ),
    )
  }
  for (const info of resources.values()) {
    // 不止一个步骤整份写它：后写的会把先写的覆盖掉。
    const producers = info.writers.filter((writer) => !writer.update).map((writer) => writer.id)
    if (producers.length > 1) {
      warning.push(
        mk(
          'warning',
          'resource_overwritten',
          `${[...producers].sort(byId).join(' / ')} 都整份写入资源 ${resourceTitle(info.resource)}——后写的会覆盖先写的；要接着写请把后面的改成「更新」`,
          { node: info.resource.id },
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
  for (const info of resources.values()) {
    if (info.writers.length === 0) continue
    const title = resourceTitle(info.resource)
    // 读它的步骤不在任何一个写它的步骤下游：执行到它时，这份东西可能还没写出来。
    for (const reader of info.readers) {
      if (info.writers.some((writer) => writer.id === reader)) continue
      const reached = info.writers.some((writer) => reaches(analysis, writer.id, reader))
      if (reached) continue
      hint.push(
        mk(
          'hint',
          'resource_order',
          `${reader} 读取资源 ${title}，但写它的步骤不在 ${reader} 的上游——执行到 ${reader} 时它可能还没写出来`,
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

/** 输入节点的字段规则（保存级）：问题一行、各段文字不超长、选项不太多。 */
function inputProblem(data: InputData): { message: string } | null {
  if (/[\r\n]/u.test(data.question)) {
    return { message: '问题不得包含换行（要多说几句请写在说明里）' }
  }
  const texts: [string | undefined, string][] = [
    [data.question, '问题'],
    [data.placeholder, '占位'],
    [data.hint, '说明'],
    [typeof data.default === 'string' ? data.default : undefined, '默认值'],
    ...(data.options ?? []).map((option): [string, string] => [option, '选项']),
  ]
  for (const [text, what] of texts) {
    const problem = text === undefined ? null : checkText(text, what)
    if (problem !== null) return problem
  }
  if ((data.options?.length ?? 0) > MAX_OPTIONS) {
    return { message: `选项不能超过 ${MAX_OPTIONS} 个` }
  }
  return null
}

/** skill 名的写法（DSH 的 kebab-case 约定）。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u

/** 资源里一项的写法与长度（保存级）。属性面板的编辑框也拿它当场提示。 */
export function itemProblem(item: ResourceItem): { message: string } | null {
  if (item.kind === 'text') {
    return codepointLength(item.value) > MAX_RESOURCE_TEXT_CODEPOINTS
      ? { message: `自定义内容不能超过 ${MAX_RESOURCE_TEXT_CODEPOINTS} 个字` }
      : null
  }
  const value = item.value.trim()
  if (CONTROL_CHARS.test(value)) return { message: '不能包含换行或控制字符' }
  if (codepointLength(value) > MAX_VALUE_CODEPOINTS) {
    return { message: `不能超过 ${MAX_VALUE_CODEPOINTS} 个字` }
  }
  if (item.kind === 'skill' && value !== '' && !SKILL_NAME.test(value)) {
    return { message: `skill 名 ${value} 不合法（小写字母、数字与 -）` }
  }
  if ((item.kind === 'file' || item.kind === 'folder') && /^~([\\/]|$)/u.test(value)) {
    return { message: '不支持 ~（不会被展开），请写完整路径' }
  }
  if (item.note !== undefined) return checkText(item.note, '说明')
  return null
}

/** 资源节点的字段规则（保存级）：名字、描述、每一项的写法与长度、项数。 */
export function resourceProblem(data: ResourceData): { message: string } | null {
  if (data.label !== undefined) {
    const problem = checkLabel(data.label)
    if (problem !== null) return { message: `名字：${problem.message}` }
  }
  if (data.description !== undefined) {
    const problem = checkText(data.description, '描述')
    if (problem !== null) return problem
  }
  if (data.items.length > MAX_RESOURCE_ITEMS) {
    return { message: `一个资源最多放 ${MAX_RESOURCE_ITEMS} 项` }
  }
  for (const [index, item] of data.items.entries()) {
    const problem = itemProblem(item)
    if (problem !== null) return { message: `第 ${index + 1} 项：${problem.message}` }
  }
  return null
}

/** 两端都在、但种类不成立的线错在哪。 */
function invalidReason(source: WorkflowNode | undefined, target: WorkflowNode | undefined): string {
  if (target !== undefined && isInput(target)) return '不能连进输入节点——输入只往外连到步骤'
  if (source !== undefined && isInput(source)) return '输入节点只能连到步骤'
  return '资源不能直接连到资源'
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
