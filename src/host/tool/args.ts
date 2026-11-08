/**
 * dsh-workflow-lite — `workflow_lite` 工具的参数形状，以及把参数整理成内部入参的纯函数。
 *
 * 接口与 `schema.ts` 里的参数声明同构；转换函数形状不对就回一句给模型看的错（字符串），对了回仓储 / 服务的入参。
 * 资源与展示设置的转换在 `resourceArgs.ts`。
 * @module @xiaoso/dsh-workflow-lite/host/tool/args
 */

import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { DisplaySpec } from '../../shared/display.ts'
import { NODE_STATUSES, RUN_STATUSES } from '../../shared/runState.ts'
import type { ExecutionMode, Handoff, InputAnswer, ReusePolicy } from '../../shared/types.ts'
import { type Action, INPUT_KINDS } from '../../shared/types.ts'
import type { NodePatch, StatePatch } from '../runs/runProgress.ts'
import type { InputUpsert } from '../store/repository.ts'

/** 工具的参数面（与下方注册处的 `parameters` 同构；抽成具名接口好让单测直接构造）。 */
export interface WorkflowLiteArgs {
  action: Action
  workflow?: string
  node?: string
  content?: string
  label?: string
  output?: string
  outputs?: { path: string; rule?: string; display?: DisplaySpec }[]
  description?: string
  no_output?: boolean
  from_template?: string
  to?: string
  source?: string
  target?: string
  when?: string
  goal?: string
  full?: boolean
  output_root?: string
  mode?: ExecutionMode
  reuse?: ReusePolicy
  set_goal?: boolean
  handoff?: 'result' | 'none'
  handoff_note?: string
  update?: boolean
  run_state?: boolean
  instance?: string
  all?: boolean
  status?: string
  note?: string
  nodes?: NodePatchArgs[]
  log?: string
  input?: InputArgs
  answers?: AnswerArgs[]
  resource?: ResourceArgs
  memory?: MemoryArgs
}

/** write_resource 的 memory（与参数声明同构）。 */
export interface MemoryArgs {
  type?: string
  id?: string
  step?: string
  name?: string
  description?: string
}

/** write_resource 的 resource（与参数声明同构）。 */
export interface ResourceArgs {
  label?: string
  description?: string
  items?: { kind: string; value: string; note?: string }[]
  display?: DisplaySpec
}

/** write_node 的 input（与参数声明同构）。 */
export interface InputArgs {
  question?: string
  kind?: string
  options?: string[]
  default?: string
  defaults?: string[]
  placeholder?: string
  hint?: string
  required?: boolean
  other?: boolean
}

/** compile 的 answers 里的一项。 */
export interface AnswerArgs {
  id: string
  value?: string
  values?: string[]
}

/** `state` 动作里一个步骤的改动（与参数声明同构）。 */
export interface NodePatchArgs {
  id: string
  status?: string
  summary?: string
  outputs?: string[]
  verdict?: string
  error?: string
  by?: string
}

/**
 * 把一个内部值**结构化地**转成无损 JSON——工具的规范返回值必须是 `JsonValue`，
 * 而我们内部用的是带具名接口的对象（它们没有索引签名，不能直接赋给 `JsonValue`）。
 * 这里逐层重建：`undefined` 丢弃（JSON 本来也没有它），非有限数字归 `null`，
 * 其余标量原样。**不做类型断言**。
 */
export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      return Number.isFinite(value) ? value : null
    case 'object': {
      if (Array.isArray(value)) return value.map((entry) => toJsonValue(entry))
      const out: Record<string, JsonValue> = {}
      for (const [key, entry] of Object.entries(value)) {
        if (entry === undefined) continue
        out[key] = toJsonValue(entry)
      }
      return out
    }
    default:
      return String(value)
  }
}

/** `compile` 的 answers（[{ id, value | values }]）→ 输入 id → 回答。形状不对就回一句给模型看的错。 */
export function answersOf(
  args: WorkflowLiteArgs,
): Record<string, InputAnswer> | string | undefined {
  if (args.answers === undefined) return undefined
  if (!Array.isArray(args.answers)) return 'answers 要写成 [{ id, value }]（多选用 values）'
  const answers: Record<string, InputAnswer> = {}
  for (const raw of args.answers) {
    if (typeof raw !== 'object' || raw === null || typeof raw.id !== 'string' || raw.id === '') {
      return 'answers 的每一项都要有 id（输入节点 id）'
    }
    if (Array.isArray(raw.values)) {
      if (raw.values.some((item) => typeof item !== 'string')) {
        return `answers.${raw.id}.values 必须是文字列表`
      }
      answers[raw.id] = raw.values
    } else if (typeof raw.value === 'string') {
      answers[raw.id] = raw.value
    } else {
      return `answers.${raw.id} 要给 value（文字题、单选）或 values（多选）`
    }
  }
  return answers
}

/** write_node 的 input 参数 → 仓储的入参。 */
export function inputUpsertOf(id: string, input: InputArgs): InputUpsert | string {
  const upsert: InputUpsert = { id }
  if (input.kind !== undefined) {
    const kind = INPUT_KINDS.find((candidate) => candidate === input.kind)
    if (kind === undefined) {
      return `input.kind 不认识：${input.kind}（可选：${INPUT_KINDS.join(' / ')}）`
    }
    upsert.kind = kind
  }
  for (const key of ['question', 'placeholder', 'hint'] as const) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'string') return `input.${key} 必须是文字`
    upsert[key] = value
  }
  if (input.options !== undefined) {
    if (!Array.isArray(input.options) || input.options.some((item) => typeof item !== 'string')) {
      return 'input.options 必须是文字列表'
    }
    upsert.options = input.options
  }
  if (input.default !== undefined) upsert.default = input.default
  if (input.defaults !== undefined) upsert.default = input.defaults
  if (input.required !== undefined) upsert.required = input.required === true
  if (input.other !== undefined) upsert.other = input.other === true
  return upsert
}

/** 把 `state` 的参数整理成服务的入参；状态值不认识就回一句给模型看的错。 */
export function statePatchOf(args: WorkflowLiteArgs): StatePatch | string {
  const patch: StatePatch = {}
  if (args.status !== undefined) {
    const status = RUN_STATUSES.find((candidate) => candidate === args.status)
    if (status === undefined)
      return `status 不认识：${args.status}（可选：${RUN_STATUSES.join(' / ')}）`
    patch.status = status
  }
  if (args.note !== undefined) patch.note = args.note
  if (args.log !== undefined) patch.log = args.log
  if (args.nodes !== undefined) {
    if (!Array.isArray(args.nodes)) return 'nodes 要写成 [{ id, status, summary, … }]'
    const nodes: Record<string, NodePatch> = {}
    for (const raw of args.nodes) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return 'nodes 的每一项要写成 { id, status, summary, … }'
      }
      const id = raw.id
      if (typeof id !== 'string' || id === '') return 'nodes 的每一项都要有 id（步骤 id）'
      if (nodes[id] !== undefined) return `nodes 里步骤 ${id} 出现了两次，合成一项`
      const node: NodePatch = {}
      if (raw.status !== undefined) {
        const status = NODE_STATUSES.find((candidate) => candidate === raw.status)
        if (status === undefined) {
          return `nodes.${id}.status 不认识：${raw.status}（可选：${NODE_STATUSES.join(' / ')}）`
        }
        node.status = status
      }
      for (const key of ['summary', 'verdict', 'error', 'by'] as const) {
        const value = raw[key]
        if (value === undefined) continue
        if (typeof value !== 'string') return `nodes.${id}.${key} 必须是文字`
        node[key] = value
      }
      if (raw.outputs !== undefined) {
        if (!Array.isArray(raw.outputs) || raw.outputs.some((item) => typeof item !== 'string')) {
          return `nodes.${id}.outputs 必须是文件路径的列表`
        }
        node.outputs = raw.outputs
      }
      nodes[id] = node
    }
    patch.nodes = nodes
  }
  return patch
}

/**
 * connect 的交接参数 → 仓储的入参：`undefined` = 不动，`null` = 回到缺省（交执行结果、不附说明），
 * `false` = 只管先后，对象 = 交执行结果并附说明。
 */
export function handoffOf(args: WorkflowLiteArgs): Handoff | false | null | undefined {
  if (args.handoff === 'none') return false
  if (args.handoff_note !== undefined) return { note: args.handoff_note }
  if (args.handoff === 'result') return null
  return undefined
}
