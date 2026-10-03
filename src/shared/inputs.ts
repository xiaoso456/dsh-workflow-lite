/**
 * dsh-workflow-lite — 输入节点：执行前问用户的问题，与用户的回答。
 *
 * 一个输入节点 = 一个问题。连到哪些步骤（输入 → 步骤），回答就交给哪些步骤；一条都没连 = 交给整个工作流。
 * 用户点「执行」时按画布上从上到下、从左到右的顺序把问题摆出来填；编译时问题与回答进计划，
 * 占位与说明只给填写的人看。
 *
 * 编译器、校验、画布、工具、实例都从这里取解释。纯函数，不碰磁盘、不 import DSH 包。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/inputs
 */

import { byId } from './graph.ts'
import { idKey, isInput, readAnswer } from './model.ts'
import { edgeKind, nodeIndex } from './resources.ts'
import type { InputAnswer, InputData, InputKind, InputNode, WorkflowDocument } from './types.ts'

/** 交互方式（缺省 = 单行文字）。 */
export function inputKind(data: InputData): InputKind {
  return data.kind ?? 'text'
}

/** 要从选项里选的两种。 */
export function isChoiceKind(kind: InputKind): boolean {
  return kind === 'choice' || kind === 'multi'
}

/** 图里的输入节点，按画布上的阅读顺序：从上到下、同一行从左到右，再按 id。 */
export function orderedInputs(document: WorkflowDocument): InputNode[] {
  return document.nodes
    .filter(isInput)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || byId(a.id, b.id))
}

/** 回答交给哪些步骤（按 id 码位序）；空 = 交给整个工作流。 */
export function inputReaders(document: WorkflowDocument, inputId: string): string[] {
  const nodes = nodeIndex(document)
  const key = idKey(inputId)
  const readers = new Set<string>()
  for (const edge of document.edges) {
    if (idKey(edge.source) !== key || edgeKind(nodes, edge) !== 'ask') continue
    const step = nodes.get(idKey(edge.target))
    if (step !== undefined) readers.add(step.id)
  }
  return [...readers].sort(byId)
}

/** 一个步骤用到的输入节点（按阅读顺序）。 */
export function stepInputs(document: WorkflowDocument, stepId: string): InputNode[] {
  const nodes = nodeIndex(document)
  const key = idKey(stepId)
  const used = new Set<string>()
  for (const edge of document.edges) {
    if (idKey(edge.target) === key && edgeKind(nodes, edge) === 'ask') used.add(idKey(edge.source))
  }
  return orderedInputs(document).filter((input) => used.has(idKey(input.id)))
}

/**
 * 一份回答按题型取形（见 `readAnswer`）。单选 / 多选只留选项里有的那些；文字题原样。
 * @returns 没有有效回答时 `undefined`。
 */
export function normalizeAnswer(data: InputData, raw: unknown): InputAnswer | undefined {
  const kind = inputKind(data)
  const answer = readAnswer(kind, raw)
  if (answer === undefined || !isChoiceKind(kind)) return answer
  const options = data.options ?? []
  if (Array.isArray(answer)) {
    const picked = options.filter((option) => answer.includes(option))
    return picked.length > 0 ? picked : undefined
  }
  return options.includes(answer) ? answer : undefined
}

/** 实际用的回答：用户给的；没给就用默认值（默认值同样按题型取形）。 */
export function effectiveAnswer(
  input: InputNode,
  answers: Readonly<Record<string, InputAnswer>>,
): InputAnswer | undefined {
  const given = findAnswer(answers, input.id)
  return normalizeAnswer(input.data, given) ?? normalizeAnswer(input.data, input.data.default)
}

/** 按 id（大小写不敏感）取回答。 */
function findAnswer(
  answers: Readonly<Record<string, InputAnswer>>,
  id: string,
): InputAnswer | undefined {
  if (Object.hasOwn(answers, id)) return answers[id]
  const key = idKey(id)
  const found = Object.keys(answers).find((candidate) => idKey(candidate) === key)
  return found === undefined ? undefined : answers[found]
}

export interface AnswerCheck {
  /** 规范化后的回答（输入 id → 回答；已经补上默认值，没回答的不在里面）。 */
  answers: Record<string, InputAnswer>
  /** 填得不对的：选了不在选项里的、对不上任何输入节点的。 */
  errors: string[]
  /** 必填却还空着的输入节点。 */
  missing: InputNode[]
}

/**
 * 核对一份回答（来自「执行」对话框或工具的 `answers`）：补上默认值、挑出填错的与漏填的。
 * @param raw - 输入 id → 回答；不是对象当没回答。
 */
export function checkAnswers(document: WorkflowDocument, raw: unknown): AnswerCheck {
  const given: Record<string, InputAnswer> = {}
  const errors: string[] = []
  const inputs = orderedInputs(document)
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    for (const [id, value] of Object.entries(raw)) {
      const input = inputs.find((candidate) => idKey(candidate.id) === idKey(id))
      if (input === undefined) {
        errors.push(`没有输入节点 ${id}`)
        continue
      }
      const answer = readAnswer(inputKind(input.data), value)
      if (answer === undefined) continue
      const normalized = normalizeAnswer(input.data, answer)
      if (normalized === undefined) {
        errors.push(
          `输入 ${input.id}（${input.data.question}）的回答不在选项里：${[answer].flat().join('、')}（可选：${(input.data.options ?? []).join(' / ')}）`,
        )
        continue
      }
      given[input.id] = normalized
    }
  }
  const answers: Record<string, InputAnswer> = {}
  const missing: InputNode[] = []
  for (const input of inputs) {
    const answer = effectiveAnswer(input, given)
    if (answer !== undefined) answers[input.id] = answer
    else if (input.data.required === true) missing.push(input)
  }
  return { answers, errors, missing }
}

/** 两份回答是否相同（实例复用时比）。 */
export function sameAnswers(
  a: Readonly<Record<string, InputAnswer>>,
  b: Readonly<Record<string, InputAnswer>>,
): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) return false
  }
  return true
}

/** 一个问题的写法提示（给模型问用户时看）：「单选：A / B，默认 A」这类。 */
export function describeInput(data: InputData): string {
  const kind = inputKind(data)
  const parts: string[] = []
  if (kind === 'choice') parts.push(`单选：${(data.options ?? []).join(' / ')}`)
  else if (kind === 'multi') parts.push(`多选：${(data.options ?? []).join(' / ')}`)
  else parts.push(kind === 'textarea' ? '多行文字' : '一句话')
  if (data.default !== undefined) parts.push(`默认 ${[data.default].flat().join('、')}`)
  parts.push(data.required === true ? '必填' : '可不填')
  return parts.join('，')
}
