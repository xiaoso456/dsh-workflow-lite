/**
 * dsh-workflow-lite — 计划的编译级问题与「注意事项」：什么情况下出不了计划，哪些警告进计划。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/compile/problems
 */

import { byId, cycleHasNoExit, type GraphAnalysis } from '../graph.ts'
import { describeInput, effectiveAnswer, orderedInputs } from '../inputs.ts'
import { isStep } from '../model.ts'
import type { PlanFacts, ValidationCode, ValidationProblem } from '../types.ts'
import type { PlanOptions } from './options.ts'

/** 无出口循环的「注意事项」警告文案——与校验层（`shared/validate.ts`）的警告文案逐字一致。 */
const LOOP_WITHOUT_EXIT_MESSAGE =
  '循环体没有出口（环上没有任何指向环外的条件边）——会无限重复，自环同理'

/** 编译级问题：内部可判定的两条（`no_nodes` / `prompt_empty`）+ 调用方带进来的。 */
export function compileProblemsOf(facts: PlanFacts, options?: PlanOptions): ValidationProblem[] {
  const collected: ValidationProblem[] = []
  const seen = new Set<string>()
  const add = (problem: ValidationProblem): void => {
    const key = problemKey(problem)
    if (seen.has(key)) return
    seen.add(key)
    collected.push(problem)
  }

  for (const problem of options?.problems ?? []) {
    if (problem.level === 'compile') add(problem)
  }

  const steps = facts.document.nodes.filter(isStep)
  if (steps.length === 0) {
    add({ level: 'compile', code: 'no_nodes', message: '图内没有步骤，无法编译' })
  }
  for (const id of steps.map((node) => node.id).sort(byId)) {
    const prompt = steps.find((node) => node.id === id)?.data.prompt
    if (prompt === undefined || prompt === '') {
      add({
        level: 'compile',
        code: 'prompt_empty',
        message: `节点 ${id} 的提示词正文缺失或为空串，阻塞编译`,
        node: id,
      })
    }
  }
  // 真要执行时（给了回答）：必填的问题没有回答、也没有默认值，就出不了计划。预览不查。
  const answers = facts.answers
  if (answers !== undefined) {
    for (const input of orderedInputs(facts.document)) {
      if (input.data.required !== true || effectiveAnswer(input, answers) !== undefined) continue
      add({
        level: 'compile',
        code: 'input_missing',
        message: `输入 ${input.id} 还没有回答：「${input.data.question.trim()}」（${describeInput(input.data)}）——先问用户，再把回答放进 answers 重新编译`,
        node: input.id,
      })
    }
  }
  return collected
}

interface PlanNote {
  level: 'warning' | 'hint'
  code: ValidationCode
  message: string
  node?: string
  edge?: string
}

/**
 * 该图的警告与提示，逐字取自校验结论（`shared/validate.ts`）；计划的「注意事项」只取其中的警告。
 * 调用方没报「循环无出口」而图里确有这种环时，这里补一条——不编含糊话，走警告。
 */
export function planNotes(analysis: GraphAnalysis, options?: PlanOptions): PlanNote[] {
  const collected: PlanNote[] = []
  const seen = new Set<string>()
  const add = (note: PlanNote): void => {
    const key = `${note.level}|${note.code}|${note.node ?? ''}|${note.edge ?? ''}|${note.message}`
    if (seen.has(key)) return
    seen.add(key)
    collected.push(note)
  }

  for (const problem of options?.problems ?? []) {
    if (problem.level !== 'warning' && problem.level !== 'hint') continue
    add({
      level: problem.level,
      code: problem.code,
      message: problem.message,
      node: problem.node,
      edge: problem.edge,
    })
  }

  if (!collected.some((note) => note.code === 'loop_without_exit')) {
    for (const cycle of analysis.cycles) {
      if (!cycleHasNoExit(cycle)) continue
      add({
        level: 'warning',
        code: 'loop_without_exit',
        message: LOOP_WITHOUT_EXIT_MESSAGE,
        node: cycle.entry,
      })
    }
  }

  return collected.sort(compareNotes)
}

/** 排序一律可判定：级别 → 节点 `id` → 边 `id` → 机器码 → 文案。 */
function compareNotes(a: PlanNote, b: PlanNote): number {
  const byLevel = noteRank(a.level) - noteRank(b.level)
  if (byLevel !== 0) return byLevel
  const byNode = byId(a.node ?? '', b.node ?? '')
  if (byNode !== 0) return byNode
  const byEdge = byId(a.edge ?? '', b.edge ?? '')
  if (byEdge !== 0) return byEdge
  const byCode = byId(a.code, b.code)
  if (byCode !== 0) return byCode
  return byId(a.message, b.message)
}

function noteRank(level: 'warning' | 'hint'): number {
  return level === 'warning' ? 0 : 1
}

function problemKey(problem: ValidationProblem): string {
  return `${problem.level}|${problem.code}|${problem.node ?? ''}|${problem.edge ?? ''}|${problem.message}`
}
