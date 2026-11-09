/**
 * dsh-workflow-lite — 派发计划编译器（产品核心）。
 *
 * **纯函数**：不碰磁盘、不看时钟、不用随机数——同一份 `PlanFacts` + 同一份 `GraphAnalysis`
 * + 同一份可选入参 ⇒ **逐字节相同**的输出。物化载荷是 I/O，不在这里。
 *
 * 只有一份段结构（见 `PLAN_SECTIONS`），两个视图共用：
 * - **派发版** {@link buildPlan}：「流程」表的最后一列给出任务描述的路径，**正文一个字都不进计划**。
 * - **整卷版** {@link buildFullText}：同一份段结构，去掉路径列，资源带上说明，末尾逐步骤内联正文。
 *
 * 派发版里路径指向的那些文件由 {@link buildTaskTexts} 给出正文：标题与位置、提示词原文，
 * 末尾附上通用约定、这一步读写的资源与回复要求。
 *
 * 导出成 skill（`PlanOptions.skill`）也是派发版，只换口径：没有插件、没有实例，见 {@link SkillPlan}。
 * 跟执行环境有关的措辞（执行方式、复用、会话目标、怎么加载 skill、运行状态）不写在这里，
 * 由 `shared/dialect.ts` 按口径给出——插件里点名 DSH 的工具，导出的 skill 里一个工具名都不出现。
 *
 * 排版按 Markdown 渲染后的样子写：定义在用到之前，同一件事只在一处说完；相邻的普通行会并成一段，
 * 所以各句要么各成一段、要么写成列表项；多行的用户文字逐行引用，不压成一行。
 *
 * 计划里的各节分在 `compile/` 下：`context`（渲染上下文与步骤顺序）、`preface`（概览、本次执行、开始之前）、
 * `rules`（怎么执行、约定）、`flow`（流程）、`resources`（资源）、`inputs`（用户输入）、`tasks`（任务描述与步骤正文）、
 * `problems`（编译级问题与注意事项）、`options`（可选入参的类型）、`format`（文字小工具）。这里只留对外的入口与段序。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/compile
 */

import { createHash } from 'node:crypto'
import { buildContext, isSolo, stepOrder } from './compile/context.ts'
import { flowSection } from './compile/flow.ts'
import type { PlanOptions } from './compile/options.ts'
import { beforeSection, overviewSection, runSection } from './compile/preface.ts'
import { compileProblemsOf, planNotes } from './compile/problems.ts'
import { resourcesSection } from './compile/resources.ts'
import { conventionsSection, executionSection } from './compile/rules.ts'
import { bodySection, taskText } from './compile/tasks.ts'
import type { GraphAnalysis } from './graph.ts'
import { PLAN_SECTIONS } from './limits.ts'
import { writeDocument } from './model.ts'
import type { PlanFacts, PlanId, PlanResult, WorkflowDocument } from './types.ts'

export type { PlanOptions, RunStateSection, SkillPlan } from './compile/options.ts'

// ─────────────────────────────────────────────────────────────
// 对外 API
// ─────────────────────────────────────────────────────────────

/**
 * 派发版：图 + 入参 → 派发计划文本。**纯函数，不碰磁盘。**
 *
 * 有**编译级**问题时返回 `plan: ''`（绝不返回一份残缺计划），`problems` 里是：
 * 内部判定的 `no_nodes` / `prompt_empty`，加上 `options.problems` 里编译级的那些。
 */
export function buildPlan(
  facts: PlanFacts,
  analysis: GraphAnalysis,
  options?: PlanOptions,
): PlanResult {
  const problems = compileProblemsOf(facts, options)
  if (problems.length > 0) return { plan: '', problems }
  return { plan: renderPlan(facts, analysis, options, false), problems: [] }
}

/**
 * 整卷版：**同一份段结构**，但把"路径引用"换成"内联正文"（给人和存档）。
 *
 * 「流程」表不再有「任务描述」列（路径是本机私有的、带不走），资源逐项带上说明，
 * 末尾追加「步骤正文」，按执行顺序逐步骤内联 `data.prompt` 原文。
 * 有编译级问题时返回空串（与派发版的失败姿态一致——不替它编内容、也不给空正文放行）。
 */
export function buildFullText(
  facts: PlanFacts,
  analysis: GraphAnalysis,
  options?: PlanOptions,
): string {
  if (compileProblemsOf(facts, options).length > 0) return ''
  return renderPlan(facts, analysis, options, true)
}

/**
 * 各步骤的任务描述（`id` → 正文）：标题与它在图里的位置、提示词原文，末尾附上通用约定、
 * 这一步读写的资源（写文件的定义在前，路径已拼好、说明原样）和回复要求。执行者只读这一份就知道
 * 写哪、怎么写，不靠编排者转述——转述几轮之后，同一份文件每轮的写法都不一样。
 */
export function buildTaskTexts(
  facts: PlanFacts,
  analysis: GraphAnalysis,
  options?: Pick<PlanOptions, 'skill'>,
): Map<string, string> {
  const ctx = buildContext(facts, analysis, options?.skill)
  const texts = new Map<string, string>()
  for (const id of analysis.nodeIds) {
    const prompt = ctx.nodes.get(id)?.data.prompt
    if (typeof prompt !== 'string') continue
    texts.set(id, taskText(facts, ctx, id, prompt))
  }
  return texts
}

/**
 * 内容寻址：`planId` = **图内容哈希**前 8 位（canonical writer 的字节 ⇒ 同内容必得同 `planId`
 * ⇒ 同目录幂等覆盖；异内容换目录，先前发出的计划不会被打穿）。
 */
export function planIdOf(document: WorkflowDocument): PlanId {
  return createHash('sha256').update(writeDocument(document), 'utf8').digest('hex').slice(0, 8)
}

// ─────────────────────────────────────────────────────────────
// 段结构
// ─────────────────────────────────────────────────────────────

/**
 * 段序：先说这是什么（概览）、这次的事实（本次执行）、动手前要做的（开始之前），
 * 再给规矩与定义（怎么执行、约定），然后是图本身（流程）和供查阅的总览（资源），最后是警告与运行状态。
 * 定义都在用到它之前；同一件事只在一处说完。
 */
function renderPlan(
  facts: PlanFacts,
  analysis: GraphAnalysis,
  options: PlanOptions | undefined,
  inline: boolean,
): string {
  const ctx = buildContext(facts, analysis, options?.skill)
  const sections: string[] = [
    overviewSection(facts, ctx, inline),
    runSection(facts, ctx, inline),
    beforeSection(facts, ctx, options),
    executionSection(facts, ctx),
    conventionsSection(ctx, inline, options),
    flowSection(facts, ctx, inline),
    resourcesSection(ctx, inline),
  ]
  // 只放影响执行的警告；提示（hint）是写给画图的人的修图建议，执行者用不上。
  const notes = planNotes(ctx.analysis, options).filter((note) => note.level === 'warning')
  if (notes.length > 0) {
    sections.push([PLAN_SECTIONS.notes, ...notes.map((note) => `- ${note.message}`)].join('\n'))
  }
  if (options?.runState !== undefined) {
    const run = {
      instance: options.runState.instance,
      workflow: facts.name,
      steps: stepOrder(ctx),
      solo: isSolo(ctx),
    }
    sections.push(ctx.dialect.runState(run).join('\n'))
  }
  if (inline) sections.push(bodySection(ctx))
  return `${sections.filter((section) => section !== '').join('\n\n')}\n`
}
