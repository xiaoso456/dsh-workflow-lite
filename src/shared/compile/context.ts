/**
 * dsh-workflow-lite — 计划编译器的渲染上下文：把图整理成按 `id` 查的表，以及步骤顺序、入出边顺序这些各节共用的取数。
 *
 * 同一份图 + 同一份入参 ⇒ 同一份上下文；这里不写任何措辞，跟执行环境有关的话在 `shared/dialect.ts`。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/compile/context
 */

import { type Dialect, DSH_DIALECT, PORTABLE_DIALECT } from '../dialect.ts'
import { byId, edgeWhen, type GraphAnalysis } from '../graph.ts'
import { idKey, isStep } from '../model.ts'
import { normalizeRoot } from '../outputPaths.ts'
import { type ResourceInfo, resourceGraph } from '../resources.ts'
import type { PlanFacts, StepNode, WorkflowDocument, WorkflowEdge } from '../types.ts'
import type { SkillPlan } from './options.ts'

export interface RenderContext {
  /** 图分析（环、回边、批次、出边形态）。 */
  analysis: GraphAnalysis
  /** 规范 `id` → 步骤。同 `id` 重复（保存级）时稳定地取文件中第一条。 */
  nodes: ReadonlyMap<string, StepNode>
  /** `idKey` → 规范 `id`（图内大小写不敏感唯一，渲染一律用规范大小写）。 */
  keyToId: ReadonlyMap<string, string>
  /** 目标节点（规范 `id`）→ 指向它的活边（悬空边是保存级，不参与渲染）。 */
  inEdges: ReadonlyMap<string, readonly WorkflowEdge[]>
  /** 源节点（规范 `id`）→ 由它出发的活边。 */
  outEdges: ReadonlyMap<string, readonly WorkflowEdge[]>
  /** 产出根目录（规范化后）；没配 = 工作区根。 */
  root: string | undefined
  /** 原图（资源读写按它统计）。 */
  document: WorkflowDocument
  /** 导出成 skill（见 {@link SkillPlan}）。 */
  skill: SkillPlan | undefined
  /** 跟执行环境有关的措辞（见 `shared/dialect.ts`）。 */
  dialect: Dialect
}

export function buildContext(
  facts: PlanFacts,
  analysis: GraphAnalysis,
  skill?: SkillPlan,
): RenderContext {
  // 只认步骤：连着资源的线两端有一头不在这里，自然不进前置、分支与循环。
  const steps = facts.document.nodes.filter(isStep)
  const keyToId = new Map<string, string>()
  for (const node of steps) {
    const key = idKey(node.id)
    if (!keyToId.has(key)) keyToId.set(key, node.id)
  }

  const nodes = new Map<string, StepNode>()
  for (const node of steps) {
    const canonical = keyToId.get(idKey(node.id))
    if (canonical === undefined || nodes.has(canonical)) continue
    nodes.set(canonical, node)
  }

  const inEdges = new Map<string, WorkflowEdge[]>()
  const outEdges = new Map<string, WorkflowEdge[]>()
  for (const id of analysis.nodeIds) {
    inEdges.set(id, [])
    outEdges.set(id, [])
  }
  for (const edge of facts.document.edges) {
    const source = keyToId.get(idKey(edge.source))
    const target = keyToId.get(idKey(edge.target))
    if (source === undefined || target === undefined) continue
    outEdges.get(source)?.push(edge)
    inEdges.get(target)?.push(edge)
  }

  const root = normalizeRoot(facts.document.settings?.outputRoot)
  return {
    analysis,
    nodes,
    keyToId,
    inEdges,
    outEdges,
    root,
    document: facts.document,
    skill,
    // 导出成 skill 就是通用口径；其余（插件里执行、预览、整卷版）都是 DSH 口径。
    dialect: skill === undefined ? DSH_DIALECT : PORTABLE_DIALECT,
  }
}

/** 边的源节点（规范 `id`）。 */
export function sourceIdOf(ctx: RenderContext, edge: WorkflowEdge): string | undefined {
  return ctx.keyToId.get(idKey(edge.source))
}

/** 边的目标节点（规范 `id`）。 */
export function targetIdOf(ctx: RenderContext, edge: WorkflowEdge): string | undefined {
  return ctx.keyToId.get(idKey(edge.target))
}

/** 条件出边按「目标 `id` → `when` → 边 `id`」排——纯 `id` 码位序，不随数组序变。 */
export function sortOutgoing(ctx: RenderContext, edges: readonly WorkflowEdge[]): WorkflowEdge[] {
  return [...edges].sort((a, b) => {
    const byTarget = byId(targetIdOf(ctx, a) ?? '', targetIdOf(ctx, b) ?? '')
    if (byTarget !== 0) return byTarget
    const byWhen = byId(edgeWhen(a) ?? '', edgeWhen(b) ?? '')
    if (byWhen !== 0) return byWhen
    return byId(a.id, b.id)
  })
}

/** 入边按「源 `id` 码位序」排（前置列与输入句子共用）。 */
function sortIncoming(ctx: RenderContext, edges: readonly WorkflowEdge[]): WorkflowEdge[] {
  return [...edges].sort((a, b) => {
    const bySource = byId(sourceIdOf(ctx, a) ?? '', sourceIdOf(ctx, b) ?? '')
    if (bySource !== 0) return bySource
    const byWhen = byId(edgeWhen(a) ?? '', edgeWhen(b) ?? '')
    if (byWhen !== 0) return byWhen
    return byId(a.id, b.id)
  })
}

/** 入边：环外的在前、回边在后，各按源 `id` 码位序。 */
export function incomingInOrder(ctx: RenderContext, id: string): WorkflowEdge[] {
  const forward: WorkflowEdge[] = []
  const back: WorkflowEdge[] = []
  for (const edge of ctx.inEdges.get(id) ?? []) {
    if (ctx.analysis.backEdges.has(edge.id)) back.push(edge)
    else forward.push(edge)
  }
  return [...sortIncoming(ctx, forward), ...sortIncoming(ctx, back)]
}

/** 步骤的阅读顺序：按批次（同批次按 `id` 码位序），批次里没有的接在后面。 */
export function stepOrder(ctx: RenderContext): string[] {
  const ordered = ctx.analysis.batches.flatMap((batch) => batch.nodes)
  const seen = new Set(ordered)
  return [...ordered, ...ctx.analysis.nodeIds.filter((id) => !seen.has(id))]
}

/** 执行方式是串行：你本人逐个做，不派子代理、不建团队。 */
export function isSolo(ctx: RenderContext): boolean {
  return ctx.document.settings?.mode === 'serial'
}

/** 有内容的资源，按 id 码位序（空资源不写）。 */
export function nonEmptyResources(ctx: RenderContext): ResourceInfo[] {
  return [...resourceGraph(ctx.document).values()]
    .filter((info) => info.resource.data.items.length > 0)
    .sort((a, b) => byId(a.resource.id, b.resource.id))
}
