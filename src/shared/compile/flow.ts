/**
 * dsh-workflow-lite — 计划的「流程」一节：清单表、执行批次、分支、循环、交接（另有安排的线）。
 *
 * 步骤按执行顺序（批次序，同批次按 `id` 码位序）列；其余的序一律是 `id` 的**码位序**（{@link byId}）。
 * 计划里的步骤引用：「流程」表**首列**写 `label（id）`（{@link displayName}），
 * 其余位置一律写 `id`——`id` 唯一，且与载荷文件名一致。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/compile/flow
 */

import { byId, edgeWhen } from '../graph.ts'
import { PLAN_SECTIONS, VERDICT_PREFIX } from '../limits.ts'
import { displayName } from '../model.ts'
import { isVerdictWhen } from '../naming.ts'
import { isMemory } from '../presets.ts'
import { resolveHandoff, stepResources } from '../resources.ts'
import type { CycleGroup, PlanFacts, WorkflowEdge } from '../types.ts'
import {
  incomingInOrder,
  type RenderContext,
  sortOutgoing,
  sourceIdOf,
  stepOrder,
  targetIdOf,
} from './context.ts'
import { code, quoteLines } from './format.ts'

/** 「流程」的小标题。执行批次的括注只说图里有的：没有循环不提回边，没有分支不提互斥分支。 */
function batchHeading(loops: boolean, branches: boolean): string {
  const layer = loops ? '按前置分层、忽略回边' : '按前置分层'
  const tail = branches ? '同一批次不代表同时执行——互斥分支只会走一条' : '同一批次不代表同时执行'
  return `**执行批次**（${layer}；${tail}）：`
}
const BRANCH_HEADING = '**分支**：'
const HANDOFF_HEADING = '**交接**（下面这几条线另有安排，其余的线只交执行结果）：'
const LOOP_HEADING =
  '**循环**（每转一圈都重新读一次任务描述；循环里的产出会被反复覆盖，验收以**最终一轮**为准）：'

/** 无出口循环：不给假模板，直接把后果说清（措辞取自校验层）。 */
const NO_EXIT_LINE = '**没有出口**——环上没有任何指向环外的条件边，会无限重复。'

/** 「流程」表没有值的单元格。 */
const DASH = '—'

/** 一个步骤读、写的资源 id（按连线在文件里的顺序）。 */
function resourcesOf(ctx: RenderContext, id: string) {
  const linked = stepResources(ctx.document, id)
  // 既读又写的资源只记在写入列（在原文件上更新本来就要先读）。
  const written = new Set(linked.writes.map((item) => item.resource.id))
  return {
    reads: linked.reads
      .filter((item) => !written.has(item.resource.id))
      .map((item) => item.resource.id),
    writes: linked.writes.map((item) => ({ id: item.resource.id, update: item.update })),
  }
}

/**
 * 把一句自然语言条件写进计划：压成一行、用「」括起来（不用反引号——条件里可能本来就有反引号）。
 */
function condition(text: string): string {
  return `「${text.replace(/\s+/gu, ' ').trim()}」`
}

/** 流程：清单表（按执行顺序）、执行批次、分支、循环、交接（另有安排的线）。 */
export function flowSection(facts: PlanFacts, ctx: RenderContext, inline: boolean): string {
  const branches = branchLines(ctx)
  const loops = cycleLines(ctx)
  const lines = [
    PLAN_SECTIONS.flow,
    ...tableLines(facts, ctx, inline),
    '',
    batchHeading(loops.length > 0, branches.length > 0),
  ]
  for (const [index, batch] of ctx.analysis.batches.entries()) {
    lines.push(`${index + 1}. ${batch.nodes.map(code).join('、')}`)
  }
  if (branches.length > 0) lines.push('', BRANCH_HEADING, ...branches)
  if (loops.length > 0) lines.push('', LOOP_HEADING, ...loops)
  const handoffs = handoffLines(ctx)
  if (handoffs.length > 0) lines.push('', HANDOFF_HEADING, ...handoffs)
  return lines.join('\n')
}

/** 清单表：按执行顺序（{@link stepOrder}）；首列是 `label（id）`。 */
function tableLines(facts: PlanFacts, ctx: RenderContext, inline: boolean): string[] {
  const lines: string[] = [
    inline ? '| 步骤 | 前置 | 读取 | 写入 |' : '| 步骤 | 前置 | 读取 | 写入 | 任务描述 |',
    inline ? '|---|---|---|---|' : '|---|---|---|---|---|',
  ]
  for (const id of stepOrder(ctx)) {
    const node = ctx.nodes.get(id)
    const cells = [
      displayName(id, node?.data.label),
      predecessorsCell(ctx, id),
      ...resourceCells(ctx, id),
    ]
    if (!inline) cells.push(pathCell(facts, id))
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines
}

/**
 * 前置列：无入边写 `—`；多条用 `；` 分隔，环外入边在前、回边在后（各按源 `id` 码位序）。
 * 条件与回边的写法和「交接」、任务描述的位置行一样（见 {@link edgeGuard}）。
 */
function predecessorsCell(ctx: RenderContext, id: string): string {
  const items: string[] = []
  for (const edge of incomingInOrder(ctx, id)) {
    const source = sourceIdOf(ctx, edge)
    if (source === undefined) continue
    items.push(`${source}${edgeGuard(ctx, edge, '循环回来时', true)}`)
  }
  return items.length === 0 ? DASH : items.join('；')
}

/** 读取列与写入列：资源 id 原样写、不加反引号，多个用 `、` 隔开；在原文件上更新的标「（更新）」。 */
function resourceCells(ctx: RenderContext, id: string): [string, string] {
  const { reads, writes } = resourcesOf(ctx, id)
  const memory = (resourceId: string): boolean => {
    const node = ctx.document.nodes.find((candidate) => candidate.id === resourceId)
    return node !== undefined && isMemory(node)
  }
  return [
    reads.length === 0 ? DASH : reads.join('、'),
    writes.length === 0
      ? DASH
      : writes
          // id 照名字起、名字里本来就带「（更新）」的，不再标一遍。
          .map((item) =>
            memory(item.id)
              ? `${item.id}（记忆）`
              : item.update && !item.id.endsWith('（更新）')
                ? `${item.id}（更新）`
                : item.id,
          )
          .join('、'),
  ]
}

/** 任务描述路径：host 算好的路径；映射缺失时给 `—`（不编路径）。 */
function pathCell(facts: PlanFacts, id: string): string {
  const path = facts.payloadPaths.get(id)
  return path === undefined ? DASH : code(path)
}

/** 出边里的条件边（≥1 条 ⇒ 该节点必须在回复末行给出判定）。 */
function conditionalEdgesOf(ctx: RenderContext, id: string): WorkflowEdge[] {
  return (ctx.outEdges.get(id) ?? []).filter((edge) => edgeWhen(edge) !== undefined)
}

/**
 * 分支：每个带条件出边的步骤一项，把「回复里要给什么」和「哪个结果走哪」写在一起。
 * 判定词要的是回复最后一行的 `VERDICT:`；自然语言条件由你对照产出判断。
 * 只有一条出边、但它带着自然语言条件的步骤也在这里写明（否则那句条件在计划里无处可见）。
 */
function branchLines(ctx: RenderContext): string[] {
  const lines: string[] = []
  for (const id of stepOrder(ctx)) {
    const conditional = sortOutgoing(ctx, conditionalEdgesOf(ctx, id))
    if (conditional.length === 0) continue
    const single = (ctx.outEdges.get(id) ?? []).length <= 1
    const values = verdictValues(ctx, id)
    const rules: string[] = []
    if (values.length > 0) rules.push(`回复的最后一行必须是 ${values.join(' 或 ')}，不得省略`)
    if (conditional.some((edge) => !isVerdictWhen(edgeWhen(edge) ?? ''))) {
      rules.push('完成后由你对照它的产出判断条件是否成立（它的回复要把结果写清楚，足以判断）')
    }
    const routes: string[] = []
    for (const edge of conditional) {
      const when = edgeWhen(edge)
      const target = targetIdOf(ctx, edge)
      if (when === undefined || target === undefined) continue
      if (isVerdictWhen(when)) routes.push(`${code(`${VERDICT_PREFIX}${when}`)} → ${code(target)}`)
      else if (single) routes.push(`只有当${condition(when)}时才走 ${code(target)}`)
      else routes.push(`${condition(when)} → ${code(target)}`)
    }
    lines.push(`- ${code(id)}：${rules.join('；')}。${routes.join('；')}。`)
  }
  return lines
}

/**
 * 循环：每个 SCC 一项。**环内步骤按批次序串联、入口首尾各出现一次**；出口在环外，
 * 写成「重复执行，直到…给出 `VERDICT: …` 时走…，离开循环」。没有出口时不编含糊话——直接说清后果。
 */
function cycleLines(ctx: RenderContext): string[] {
  const lines: string[] = []
  for (const cycle of ctx.analysis.cycles) {
    const chain = cycleChain(ctx, cycle)
    const exits: string[] = []
    for (const exitId of cycle.exits) {
      const edge = ctx.analysis.edgesById.get(exitId)
      if (edge === undefined) continue
      const when = edgeWhen(edge)
      const source = sourceIdOf(ctx, edge)
      const target = targetIdOf(ctx, edge)
      if (when === undefined || source === undefined || target === undefined) continue
      exits.push(
        isVerdictWhen(when)
          ? `${code(source)} 给出 ${code(`${VERDICT_PREFIX}${when}`)} 时走 ${code(target)}`
          : `${code(source)} 完成后${condition(when)}成立时走 ${code(target)}`,
      )
    }
    lines.push(
      exits.length === 0
        ? `- ${chain}：${NO_EXIT_LINE}`
        : `- ${chain}：重复执行，直到 ${exits.join('，或 ')}，离开循环。`,
    )
  }
  return lines
}

/** 环内步骤：`入口` + 批次序（同批次按 `id` 码位序）+ `入口`（首尾各一次）。 */
function cycleChain(ctx: RenderContext, cycle: CycleGroup): string {
  const members = new Set(cycle.nodes)
  const ordered: string[] = [cycle.entry]
  for (const batch of ctx.analysis.batches) {
    for (const id of batch.nodes) {
      if (members.has(id) && id !== cycle.entry) ordered.push(id)
    }
  }
  for (const id of cycle.nodes) {
    if (!ordered.includes(id)) ordered.push(id)
  }
  ordered.push(cycle.entry)
  return ordered.map(code).join(' → ')
}

/** 图里有没有附了交接说明的线、只管先后的线（步骤之间的线）。 */
export function specialHandoffs(ctx: RenderContext): { note: boolean; orderOnly: boolean } {
  const kinds = { note: false, orderOnly: false }
  for (const id of ctx.analysis.nodeIds) {
    for (const edge of ctx.inEdges.get(id) ?? []) {
      if (sourceIdOf(ctx, edge) === undefined) continue
      const handoff = resolveHandoff(edge.data?.handoff)
      if (!handoff.result) kinds.orderOnly = true
      else if (handoff.note !== undefined) kinds.note = true
    }
  }
  return kinds
}

/**
 * 「流程」的「交接」：附了交接说明的线（执行结果和说明一起交）、只管先后的线，一条线一项。
 * 和「流程」表一样按**下游**的执行顺序排（{@link stepOrder}），同一下游的几条和前置列同序（环外的在前、回边在后）；
 * 条件的写法同任务描述的位置行（{@link edgeGuard}）。
 */
function handoffLines(ctx: RenderContext): string[] {
  const lines: string[] = []
  for (const id of stepOrder(ctx)) {
    for (const edge of incomingInOrder(ctx, id)) {
      const source = sourceIdOf(ctx, edge)
      if (source === undefined) continue
      const handoff = resolveHandoff(edge.data?.handoff)
      if (handoff.result && handoff.note === undefined) continue

      const guard = edgeGuard(ctx, edge, '循环回来时')
      const note = (handoff.note ?? '').trim()
      const multiline = handoff.result && note.includes('\n')
      const body = !handoff.result
        ? '只管先后，不交执行结果。'
        : multiline
          ? '交执行结果，并附上交接说明：'
          : `交执行结果，并附上交接说明：${note}`
      lines.push(`- ${code(source)} → ${code(id)}${guard}：${body}`)
      // 多行的交接说明逐行引用，不压成一行。
      if (multiline) lines.push(...quoteLines(note, '  '))
    }
  }
  return lines
}

/** 判定取值集合：该步骤全部带判定词的出边的取值，去重后**按码位序升序**、各自加反引号。 */
export function verdictValues(ctx: RenderContext, id: string): string[] {
  const values = new Set<string>()
  for (const edge of conditionalEdgesOf(ctx, id)) {
    const when = edgeWhen(edge)
    if (when !== undefined && isVerdictWhen(when)) values.add(when)
  }
  return [...values].sort(byId).map((value) => code(`${VERDICT_PREFIX}${value}`))
}

/**
 * 一条线走的条件，接在线的一端后面：`（\`VERDICT: pass\` 时，循环回来时）`；没有条件、不是回边就是空串。
 * 任务描述的位置行、计划的「流程」表与「交接」共用，同一条线几处写法一样。`back` 是回边那一截怎么说；
 * `brief` 时自然语言条件只写「满足条件时」（表格单元格里放不下一段话，原文在表下的分支里）。
 */
export function edgeGuard(
  ctx: RenderContext,
  edge: WorkflowEdge,
  back: string,
  brief = false,
): string {
  const when = edgeWhen(edge)
  const parts: string[] = []
  if (when !== undefined) {
    parts.push(
      isVerdictWhen(when)
        ? `${code(`${VERDICT_PREFIX}${when}`)} 时`
        : brief
          ? '满足条件时'
          : `${condition(when)}时`,
    )
  }
  if (ctx.analysis.backEdges.has(edge.id)) parts.push(back)
  return parts.length === 0 ? '' : `（${parts.join('，')}）`
}
