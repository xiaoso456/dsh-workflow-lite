/**
 * dsh-workflow-lite — 计划里的用户输入：执行前问过用户的问题与回答（「本次执行」和任务描述各一种写法）。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/compile/inputs
 */

import {
  customAnswers,
  describeInput,
  effectiveAnswer,
  inputReaders,
  orderedInputs,
} from '../inputs.ts'
import type { InputAnswer, InputData, InputNode, PlanFacts } from '../types.ts'
import { type RenderContext, stepOrder } from './context.ts'
import { code, quoteLines } from './format.ts'

/** 一个问题交给谁：没连步骤就是所有步骤，连了的按执行顺序列。 */
export function readersText(ctx: RenderContext, inputId: string): string {
  const readers = new Set(inputReaders(ctx.document, inputId))
  if (readers.size === 0) return '交给所有步骤'
  return `交给 ${stepOrder(ctx)
    .filter((id) => readers.has(id))
    .map(code)
    .join('、')}`
}

/** 预览时还没有回答。 */
const ANSWER_LATER = '（执行时由用户填写）'
/** 可不填的问题用户没填。 */
const ANSWER_EMPTY = '（用户没有填写）'
/** 任务描述里还不知道回答（导出的 skill、没给回答的编译）。 */
const ANSWER_RELAYED = '开始前问过用户，回答由编排者随任务转交给你。'

/** 回答写成一段字；用户自填的部分前面注明，免得被当成图里预设的选项。 */
function answerText(data: InputData, answer: InputAnswer): string {
  const custom = new Set(customAnswers(data, answer))
  if (custom.size === 0) return Array.isArray(answer) ? answer.join('、') : answer.trim()
  const mark = (value: string): string => (custom.has(value) ? `${CUSTOM_MARK}${value}` : value)
  return Array.isArray(answer) ? answer.map(mark).join('、') : mark(answer.trim())
}

/** 用户没从选项里挑、自己填的内容前面的标注。 */
const CUSTOM_MARK = '（用户自填）'

/**
 * 用户输入：每个问题一项（`indent` 是列表的缩进），按画布上的阅读顺序。问题原样写、后面注明交给谁；
 * 回答多行时逐行引用。占位与说明是给填写的人看的，不进计划。
 */
export function inputLines(facts: PlanFacts, ctx: RenderContext, indent: string): string[] {
  const lines: string[] = []
  for (const input of orderedInputs(facts.document)) {
    const to = readersText(ctx, input.id)
    lines.push(
      `${indent}- 问：${input.data.question.trim()}（${to}）`,
      ...answerLines(facts, input, facts.answers === undefined ? ANSWER_LATER : undefined, indent),
    )
  }
  return lines
}

/**
 * 一个问题的回答（`答：` 一行，多行的逐行引用）。还没有回答时写 `pending`；
 * 给了回答但这一题没填（可不填的）写「用户没有填写」。
 */
function answerLines(
  facts: PlanFacts,
  input: InputNode,
  pending: string | undefined,
  indent: string,
): string[] {
  const answer = facts.answers === undefined ? undefined : effectiveAnswer(input, facts.answers)
  if (answer === undefined) return [`${indent}  答：${pending ?? ANSWER_EMPTY}`]
  const text = answerText(input.data, answer)
  if (!text.includes('\n')) return [`${indent}  答：${text}`]
  return [`${indent}  答：`, ...quoteLines(text, `${indent}  `)]
}

/**
 * 任务描述里的「用户输入」：连到这一步的问题，加上没连线、交给所有步骤的。回答已知（插件里建实例时）
 * 就直接写上；还不知道（导出的 skill、没给回答的编译）写明由编排者转交，问题后面带上题型、选项与默认值——
 * 提示词常按选项分情况写（「回答是 A 就……」），执行者得知道可能收到哪几种回答。
 */
export function taskInputLines(facts: PlanFacts, id: string): string[] {
  const lines: string[] = []
  for (const input of orderedInputs(facts.document)) {
    const readers = inputReaders(facts.document, input.id)
    if (readers.length > 0 && !readers.includes(id)) continue
    const question = input.data.question.trim()
    lines.push(
      facts.answers === undefined
        ? `- 问：${question}（${describeInput(input.data)}）`
        : `- 问：${question}`,
      ...answerLines(facts, input, facts.answers === undefined ? ANSWER_RELAYED : undefined, ''),
    )
  }
  return lines
}
