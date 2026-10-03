/**
 * dsh-workflow-lite — 运行状态：格式、校验、初始状态与派生量。
 *
 * 一个工作流实例一份 YAML 状态文件，执行期间由主 agent 维护。本模块**只处理解析后的普通对象**，不碰 YAML、不碰磁盘：
 * host（建实例、画布显示）、随 skill 分发的校验脚本、单测三边共用同一套规则。
 *
 * 校验结论是给模型看的——每条都写成「路径: 哪里不对（可选值…）」，照着就能改。
 *
 * @module @xiaoso/dsh-workflow-lite/shared/runState
 */

import { edgeWhen } from './graph.ts'
import { isStep } from './model.ts'
import { flowEdges } from './resources.ts'
import {
  EXECUTION_MODES,
  type ExecutionMode,
  type InputAnswer,
  type WorkflowDocument,
} from './types.ts'

// ─────────────────────────────────────────────────────────────
// 词汇表
// ─────────────────────────────────────────────────────────────

export const RUN_STATE_VERSION = 1

/** 整次执行的状态。 */
export const RUN_STATUSES = [
  'pending',
  'running',
  'waiting',
  'done',
  'failed',
  'cancelled',
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** 单个步骤的状态。 */
export const NODE_STATUSES = ['pending', 'running', 'waiting', 'done', 'failed', 'skipped'] as const
export type NodeStatus = (typeof NODE_STATUSES)[number]

/** 流水里的事件。 */
export const LOG_EVENTS = [
  'start',
  'done',
  'failed',
  'waiting',
  'skipped',
  'resume',
  'transfer',
  'edit',
  'note',
] as const
export type LogEvent = (typeof LOG_EVENTS)[number]

/** 摘要的长度上限（码位）。建议一两句、200 字以内；超过这个数就是贴原文了。 */
export const SUMMARY_MAX = 500

export interface NodeRunState {
  status: NodeStatus
  /** 第几轮，从 1 起；开始过就必填。 */
  round?: number
  startedAt?: string
  finishedAt?: string
  /** 谁做的：`self` / `subagent` / 队员名。 */
  by?: string
  /** 这一轮的判定：必须是它出边 `when` 的值之一。 */
  verdict?: string
  summary?: string
  outputs?: string[]
  error?: string
}

export interface RunLogEntry {
  at: string
  /** 省略 = 整次执行的事件。 */
  node?: string
  event: LogEvent
  round?: number
  verdict?: string
  detail?: string
  /** `user` = 用户在画布上改的（插件写入）；省略 = 主 agent。 */
  by?: 'user'
}

export interface RunState {
  version: typeof RUN_STATE_VERSION
  instance: string
  workflow: string
  plan: string
  /** 图快照的绝对路径。 */
  graph: string
  mode: ExecutionMode
  goal?: string
  status: RunStatus
  updatedAt: string
  note?: string
  /** 每个步骤一项（文件节点不在这里），键是步骤 id。 */
  nodes: Record<string, NodeRunState>
  log: RunLogEntry[]
}

/** 身份字段：插件写，模型不改。 */
export const IDENTITY_KEYS = ['version', 'instance', 'workflow', 'plan', 'graph', 'mode'] as const

const TOP_KEYS = [...IDENTITY_KEYS, 'goal', 'status', 'updatedAt', 'note', 'nodes', 'log'] as const
const NODE_KEYS = [
  'status',
  'round',
  'startedAt',
  'finishedAt',
  'by',
  'verdict',
  'summary',
  'outputs',
  'error',
] as const
const LOG_KEYS = ['at', 'node', 'event', 'round', 'verdict', 'detail', 'by'] as const

// ─────────────────────────────────────────────────────────────
// 从图快照取校验要用的事实
// ─────────────────────────────────────────────────────────────

/** 校验要对照的图事实：有哪些步骤、各步骤的判定能取哪些值。 */
export interface RunGraphFacts {
  /** 步骤 id，按图里的顺序。 */
  steps: string[]
  /** 步骤 id → 它出边（到步骤的）`when` 的取值；没有条件出边的不在表里。 */
  verdicts: Record<string, string[]>
}

export function graphFacts(document: WorkflowDocument): RunGraphFacts {
  const steps = document.nodes.filter(isStep).map((node) => node.id)
  const verdicts: Record<string, string[]> = {}
  for (const edge of flowEdges(document)) {
    const when = edgeWhen(edge)
    if (when === undefined) continue
    const list = verdicts[edge.source] ?? []
    if (!list.includes(when)) list.push(when)
    verdicts[edge.source] = list
  }
  return { steps, verdicts }
}

// ─────────────────────────────────────────────────────────────
// 校验
// ─────────────────────────────────────────────────────────────

export interface RunStateIssue {
  /** 出问题的位置，例如 `nodes.review.status`；整份文件的问题是空串。 */
  path: string
  message: string
}

/** 身份字段要对得上的值（host 知道它建的是哪个实例）。 */
export interface RunStateExpect {
  instance?: string
  workflow?: string
  plan?: string
}

export interface RunStateCheck {
  /** 没有问题时是规整后的状态；有问题时为 `null`。 */
  state: RunState | null
  issues: RunStateIssue[]
}

/** ISO 8601，带时区（`Z` 或 `+08:00`）。秒和小数秒可省。 */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function choices(list: readonly string[]): string {
  return `可选值：${list.join(' / ')}`
}

/** YAML 会把 `12345678` 这样的写法读成数字：身份字段与判定按字符串比。 */
function scalarText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/**
 * 校验一份解析后的状态。`facts` 给了就对照图快照（步骤齐不齐、判定取值对不对）；
 * `expect` 给了就核对身份字段。
 */
export function validateRunState(
  value: unknown,
  facts?: RunGraphFacts,
  expect?: RunStateExpect,
): RunStateCheck {
  const issues: RunStateIssue[] = []
  const issue = reporter(issues)
  if (!isRecord(value)) {
    issue('', '顶层必须是一个映射（key: value 的形式）')
    return { state: null, issues }
  }

  for (const key of Object.keys(value)) {
    if (!(TOP_KEYS as readonly string[]).includes(key)) {
      issue(key, `不认识的字段（顶层只有：${TOP_KEYS.join(', ')}）`)
    }
  }

  if (value.version !== RUN_STATE_VERSION) issue('version', `必须是 ${RUN_STATE_VERSION}`)
  const identity: Record<'instance' | 'workflow' | 'plan' | 'graph', string> = {
    instance: '',
    workflow: '',
    plan: '',
    graph: '',
  }
  for (const key of ['instance', 'workflow', 'plan', 'graph'] as const) {
    const text = scalarText(value[key])
    if (text === undefined || text === '') {
      issue(key, '缺失或为空（这是插件写的身份字段，不要改它）')
      continue
    }
    identity[key] = text
    const expected = key === 'graph' ? undefined : expect?.[key]
    if (expected !== undefined && text !== expected) {
      issue(key, `应为 ${expected}（身份字段不要改）`)
    }
  }
  const mode = EXECUTION_MODES.find((candidate) => candidate === value.mode)
  if (mode === undefined) issue('mode', `缺失或不认识；${choices(EXECUTION_MODES)}`)
  if (value.goal !== undefined && typeof value.goal !== 'string') issue('goal', '必须是文字')

  const status = RUN_STATUSES.find((candidate) => candidate === value.status)
  if (status === undefined) issue('status', `缺失或不认识；${choices(RUN_STATUSES)}`)
  checkTime(value.updatedAt, 'updatedAt', true, issue)
  if (value.note !== undefined && typeof value.note !== 'string') issue('note', '必须是文字')

  const nodes: Record<string, NodeRunState> = {}
  if (!isRecord(value.nodes)) {
    issue('nodes', '缺失，或不是映射（每个步骤 id 一项）')
  } else {
    for (const [id, raw] of Object.entries(value.nodes)) {
      const node = checkNode(raw, `nodes.${id}`, facts?.verdicts[id], issues)
      if (node !== null) nodes[id] = node
    }
    if (facts !== undefined) {
      const present = Object.keys(value.nodes)
      for (const id of facts.steps) {
        if (!present.includes(id)) {
          const near = present.find((key) => key.toLowerCase() === id.toLowerCase())
          issue(
            `nodes.${id}`,
            near === undefined
              ? '缺少这个步骤'
              : `缺少这个步骤（有一个 ${near}，大小写要和图里一致）`,
          )
        }
      }
      for (const id of present) {
        // 只差大小写的已经在上面那条里说了。
        if (!facts.steps.some((step) => step.toLowerCase() === id.toLowerCase())) {
          issue(`nodes.${id}`, '图里没有这个步骤（文件节点不用写进 nodes）')
        }
      }
    }
    if (status === 'done') {
      for (const [id, node] of Object.entries(nodes)) {
        if (node.status === 'running' || node.status === 'waiting') {
          issue(`nodes.${id}.status`, `整体已经是 done，这个步骤却还是 ${node.status}`)
        }
      }
    }
  }

  const log: RunLogEntry[] = []
  if (!Array.isArray(value.log)) {
    issue('log', '缺失，或不是列表（没有事件时写 `log: []`）')
  } else {
    value.log.forEach((raw, index) => {
      const entry = checkLog(raw, `log[${index}]`, facts, issues)
      if (entry !== null) log.push(entry)
    })
  }

  if (issues.length > 0 || mode === undefined || status === undefined)
    return { state: null, issues }
  return {
    state: {
      version: RUN_STATE_VERSION,
      instance: identity.instance,
      workflow: identity.workflow,
      plan: identity.plan,
      graph: identity.graph,
      mode,
      ...(typeof value.goal === 'string' ? { goal: value.goal } : {}),
      status,
      updatedAt: value.updatedAt as string,
      ...(typeof value.note === 'string' ? { note: value.note } : {}),
      nodes,
      log,
    },
    issues,
  }
}

type Report = (path: string, message: string) => void

function checkTime(value: unknown, path: string, required: boolean, issue: Report): void {
  if (value === undefined) {
    if (required) issue(path, '缺失（时间写成 2026-10-02T14:30:00+08:00 这样，带时区）')
    return
  }
  if (typeof value !== 'string' || !ISO_TIME.test(value)) {
    issue(path, '时间格式不对：写成 2026-10-02T14:30:00+08:00 这样（ISO 8601，带时区）')
  }
}

function reporter(issues: RunStateIssue[]): Report {
  return (path, message) => {
    issues.push({ path, message })
  }
}

function checkNode(
  raw: unknown,
  path: string,
  verdicts: readonly string[] | undefined,
  issues: RunStateIssue[],
): NodeRunState | null {
  const issue = reporter(issues)
  if (!isRecord(raw)) {
    issue(path, '必须是映射（至少有 status）')
    return null
  }
  const before = issues.length
  for (const key of Object.keys(raw)) {
    if (!(NODE_KEYS as readonly string[]).includes(key)) {
      issue(`${path}.${key}`, `不认识的字段（步骤只有：${NODE_KEYS.join(', ')}）`)
    }
  }
  const status = NODE_STATUSES.find((candidate) => candidate === raw.status)
  if (status === undefined) issue(`${path}.status`, `缺失或不认识；${choices(NODE_STATUSES)}`)
  const started = status !== undefined && status !== 'pending' && status !== 'skipped'
  if (raw.round !== undefined) {
    if (typeof raw.round !== 'number' || !Number.isInteger(raw.round) || raw.round < 1) {
      issue(`${path}.round`, '必须是从 1 起的整数')
    }
  } else if (started) {
    issue(`${path}.round`, `状态是 ${status}，要写 round（第几轮，从 1 起）`)
  }
  checkTime(raw.startedAt, `${path}.startedAt`, status === 'running', issue)
  checkTime(raw.finishedAt, `${path}.finishedAt`, status === 'done' || status === 'failed', issue)
  for (const key of ['by', 'summary', 'error'] as const) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string')
      issue(`${path}.${key}`, '必须是文字')
  }
  if (typeof raw.summary === 'string' && [...raw.summary].length > SUMMARY_MAX) {
    issue(`${path}.summary`, `太长了（${[...raw.summary].length} 字）：写一两句结论就够，别贴原文`)
  }
  if (status === 'failed' && (typeof raw.error !== 'string' || raw.error.trim() === '')) {
    issue(`${path}.error`, '状态是 failed，要写失败原因')
  }
  const verdict = raw.verdict === undefined ? undefined : scalarText(raw.verdict)
  if (raw.verdict !== undefined && verdict === undefined) issue(`${path}.verdict`, '必须是文字')
  if (verdict !== undefined) {
    if (verdicts === undefined) {
      issue(`${path}.verdict`, '这个步骤没有条件出边，不用写 verdict')
    } else if (!verdicts.includes(verdict)) {
      issue(`${path}.verdict`, `不在它出边的条件里；${choices(verdicts)}`)
    }
  } else if (status === 'done' && verdicts !== undefined) {
    issue(`${path}.verdict`, `这个步骤有条件出边，done 时要写 verdict；${choices(verdicts)}`)
  }
  if (raw.outputs !== undefined) {
    if (!Array.isArray(raw.outputs) || raw.outputs.some((item) => typeof item !== 'string')) {
      issue(`${path}.outputs`, '必须是文件路径的列表，例如 [docs/review.md]')
    }
  }
  if (issues.length > before || status === undefined) return null
  return {
    status,
    ...(typeof raw.round === 'number' ? { round: raw.round } : {}),
    ...(typeof raw.startedAt === 'string' ? { startedAt: raw.startedAt } : {}),
    ...(typeof raw.finishedAt === 'string' ? { finishedAt: raw.finishedAt } : {}),
    ...(typeof raw.by === 'string' ? { by: raw.by } : {}),
    ...(verdict === undefined ? {} : { verdict }),
    ...(typeof raw.summary === 'string' ? { summary: raw.summary } : {}),
    ...(Array.isArray(raw.outputs) ? { outputs: raw.outputs as string[] } : {}),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  }
}

function checkLog(
  raw: unknown,
  path: string,
  facts: RunGraphFacts | undefined,
  issues: RunStateIssue[],
): RunLogEntry | null {
  const issue = reporter(issues)
  if (!isRecord(raw)) {
    issue(path, '必须是映射（至少有 at 和 event）')
    return null
  }
  const before = issues.length
  for (const key of Object.keys(raw)) {
    if (!(LOG_KEYS as readonly string[]).includes(key)) {
      issue(`${path}.${key}`, `不认识的字段（流水只有：${LOG_KEYS.join(', ')}）`)
    }
  }
  checkTime(raw.at, `${path}.at`, true, issue)
  const event = LOG_EVENTS.find((candidate) => candidate === raw.event)
  if (event === undefined) issue(`${path}.event`, `缺失或不认识；${choices(LOG_EVENTS)}`)
  const node = raw.node === undefined ? undefined : scalarText(raw.node)
  if (raw.node !== undefined && node === undefined) issue(`${path}.node`, '必须是步骤 id')
  if (node !== undefined && facts !== undefined && !facts.steps.includes(node)) {
    issue(`${path}.node`, `图里没有步骤 ${node}`)
  }
  if (
    raw.round !== undefined &&
    (typeof raw.round !== 'number' || !Number.isInteger(raw.round) || raw.round < 1)
  ) {
    issue(`${path}.round`, '必须是从 1 起的整数')
  }
  const verdict = raw.verdict === undefined ? undefined : scalarText(raw.verdict)
  if (raw.verdict !== undefined && verdict === undefined) issue(`${path}.verdict`, '必须是文字')
  if (raw.detail !== undefined && typeof raw.detail !== 'string')
    issue(`${path}.detail`, '必须是文字')
  if (raw.by !== undefined && raw.by !== 'user') {
    issue(`${path}.by`, '只有插件替用户写的条目才带 by: user；你自己写的条目不要带 by')
  }
  if (issues.length > before || event === undefined) return null
  return {
    at: raw.at as string,
    ...(node === undefined ? {} : { node }),
    event,
    ...(typeof raw.round === 'number' ? { round: raw.round } : {}),
    ...(verdict === undefined ? {} : { verdict }),
    ...(typeof raw.detail === 'string' ? { detail: raw.detail } : {}),
    ...(raw.by === 'user' ? { by: 'user' as const } : {}),
  }
}

// ─────────────────────────────────────────────────────────────
// 初始状态
// ─────────────────────────────────────────────────────────────

export interface InitialRunInput {
  instance: string
  workflow: string
  plan: string
  graph: string
  mode: ExecutionMode
  goal?: string
  /** 建立时刻（ISO 8601，带时区）。 */
  now: string
  steps: readonly string[]
}

/** 插件建实例时写下的初始状态：整体 `pending`，每个步骤 `pending`，流水为空。 */
export function initialRunState(input: InitialRunInput): RunState {
  const nodes: Record<string, NodeRunState> = {}
  for (const id of input.steps) nodes[id] = { status: 'pending' }
  return {
    version: RUN_STATE_VERSION,
    instance: input.instance,
    workflow: input.workflow,
    plan: input.plan,
    graph: input.graph,
    mode: input.mode,
    ...(input.goal === undefined || input.goal === '' ? {} : { goal: input.goal }),
    status: 'pending',
    updatedAt: input.now,
    nodes,
    log: [],
  }
}

/** 本地时间的 ISO 8601（带时区偏移，不用 `Z`：人读状态文件时一眼就是本地钟点）。 */
export function isoNow(date: Date = new Date()): string {
  const pad = (n: number, width = 2): string => String(Math.abs(n)).padStart(width, '0')
  const offset = -date.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  )
}

// ─────────────────────────────────────────────────────────────
// 派生量（画布与工具摘要用）
// ─────────────────────────────────────────────────────────────

export interface RunProgress {
  done: number
  total: number
  running: string[]
  failed: string[]
  waiting: string[]
}

export function progressOf(state: RunState): RunProgress {
  const entries = Object.entries(state.nodes)
  const pick = (status: NodeStatus): string[] =>
    entries.filter(([, node]) => node.status === status).map(([id]) => id)
  return {
    done: entries.filter(([, node]) => node.status === 'done' || node.status === 'skipped').length,
    total: entries.length,
    running: pick('running'),
    failed: pick('failed'),
    waiting: pick('waiting'),
  }
}

/** 一个步骤开始过没有（做过至少一轮，或正在做）。 */
function started(node: NodeRunState | undefined): boolean {
  return node !== undefined && ((node.round ?? 0) >= 1 || node.status === 'running')
}

/**
 * 走过的线：不要求模型记边，按状态推。
 * - 步骤 → 步骤：源做过、目标开始过；条件边还要求源在某一轮给过这个判定
 *   （流水里该步骤 `done` 的判定 + 当前的判定，所以循环里先 fail 后 pass 两条都算）。
 * - 步骤 ↔ 文件：步骤开始过就算。
 */
export function takenEdges(document: WorkflowDocument, state: RunState): Set<string> {
  const verdicts = new Map<string, Set<string>>()
  const add = (id: string, verdict: string | undefined): void => {
    if (verdict === undefined) return
    const set = verdicts.get(id) ?? new Set<string>()
    set.add(verdict)
    verdicts.set(id, set)
  }
  for (const [id, node] of Object.entries(state.nodes)) add(id, node.verdict)
  for (const entry of state.log) {
    if (entry.node !== undefined && entry.event === 'done') add(entry.node, entry.verdict)
  }
  const steps = new Set(document.nodes.filter(isStep).map((node) => node.id))
  const taken = new Set<string>()
  for (const edge of document.edges) {
    const sourceStep = steps.has(edge.source)
    const targetStep = steps.has(edge.target)
    if (sourceStep && targetStep) {
      const source = state.nodes[edge.source]
      if (!started(source) || !started(state.nodes[edge.target])) continue
      const when = edgeWhen(edge)
      if (when !== undefined && verdicts.get(edge.source)?.has(when) !== true) continue
      taken.add(edge.id)
    } else if (sourceStep || targetStep) {
      if (started(state.nodes[sourceStep ? edge.source : edge.target])) taken.add(edge.id)
    }
  }
  return taken
}

// ─────────────────────────────────────────────────────────────
// 实例（索引记录与画布线格式）
// ─────────────────────────────────────────────────────────────

/** 实例索引 `instances.json` 里的一条（只有插件写）。 */
export interface InstanceRecord {
  id: string
  workflow: string
  planId: string
  mode: ExecutionMode
  goal?: string
  /** 建立时的会话工作区。 */
  cwd?: string
  /**
   * 状态文件的绝对路径。没有 = 这个实例**不记运行状态**：工作流没开「记录运行状态」时，
   * 画布上点「执行」照样建实例（图的快照 + 归属会话），只是没有状态文件。
   */
  statePath?: string
  /** 它所属的会话（只有一个）；没有会话的调用建出来的实例没有归属。 */
  session?: string
  /** 建立时刻（epoch 毫秒）。 */
  createdAt: number
  /** 用户改了状态、但当时没能通知到模型时暂存的通知正文；交付后删掉。 */
  pendingNotice?: string
}

/** 列表里的一项：索引记录 + 现读的状态摘要。 */
export interface InstanceSummary {
  id: string
  workflow: string
  planId: string
  mode: ExecutionMode
  goal?: string
  cwd?: string
  /** 没有 = 不记运行状态（见 `InstanceRecord.statePath`）。 */
  statePath?: string
  session?: string
  createdAt: number
  /** 是不是请求方会话的当前实例。 */
  current: boolean
  status?: RunStatus
  done?: number
  total?: number
  updatedAt?: string
  /** 状态文件读不出来：不见了，或格式不对。 */
  stateProblem?: 'missing' | 'invalid'
}

/** 画布读一个实例：快照 + 解析后的状态 + 校验结论。 */
export interface InstanceView {
  summary: InstanceSummary
  document: WorkflowDocument
  /** 合法时的状态；不合法或文件不在时为 `null`（画布保留上一次合法的样子）。 */
  state: RunState | null
  issues: RunStateIssue[]
  /** 状态文件的修改时间（epoch 毫秒）；文件不在时为 0。 */
  mtime: number
  /**
   * 快照里每个资源的文件与文件夹在不在（资源 id → 按项的顺序：在 / 不在；网址、Skill、自定义是 `null`）。
   */
  files: Record<string, (boolean | null)[]>
  /** 用户执行前对输入节点的回答（已补上默认值；输入 id → 回答）。 */
  answers: Record<string, InputAnswer>
}

/** 用户在画布上的一处改动。`null` = 删掉这个字段。 */
export type EditValue = string | number | string[] | null

export interface StateEdit {
  /** 字段路径：`['status']`、`['note']`、`['nodes', '<步骤 id>', '<字段>']`。 */
  path: string[]
  /** 改之前的值（缺省 / 没有 = `null`）：插件写之前核对文件里还是它，对不上就是冲突。 */
  from: EditValue
  to: EditValue
}

/** 用户能改的字段。 */
export const EDITABLE_TOP = ['status', 'note'] as const
export const EDITABLE_NODE = [
  'status',
  'round',
  'startedAt',
  'finishedAt',
  'verdict',
  'summary',
  'error',
] as const

/** 一处改动的路径是不是用户能改的。 */
export function editablePath(path: readonly string[]): boolean {
  if (path.length === 1) return (EDITABLE_TOP as readonly string[]).includes(path[0] ?? '')
  return (
    path.length === 3 &&
    path[0] === 'nodes' &&
    (EDITABLE_NODE as readonly string[]).includes(path[2] ?? '')
  )
}

/**
 * 用户把一个步骤改成某个状态时，连带要改的字段——让改完的状态照样合法、也合乎语义：
 * - `running`：从 `done` / `failed` / `pending` 进来算新的一轮（`round` +1），写开始时间；
 * - `done`：补上轮次与结束时间；
 * - `failed`：补上轮次、结束时间和失败原因（没有就写"用户标记为失败"）；
 * - `pending`（重跑）：清掉这一轮的结束时间与判定；
 * - `waiting` / `skipped`：只改状态（`waiting` 没轮次时补成 1）。
 * 返回的是字段 → 新值（`null` = 删掉）。
 */
export function statusFields(
  node: NodeRunState,
  to: NodeStatus,
  now: string,
): Partial<Record<(typeof EDITABLE_NODE)[number], EditValue>> {
  const round = node.round ?? 0
  const fields: Partial<Record<(typeof EDITABLE_NODE)[number], EditValue>> = { status: to }
  if (to === node.status) return fields
  if (to === 'running') {
    fields.round = node.status === 'waiting' && round >= 1 ? round : round + 1
    fields.startedAt = now
    fields.finishedAt = null
    fields.verdict = null
    fields.error = null
  } else if (to === 'done') {
    if (round < 1) fields.round = 1
    fields.finishedAt = now
    fields.error = null
  } else if (to === 'failed') {
    if (round < 1) fields.round = 1
    fields.finishedAt = now
    if (node.error === undefined || node.error.trim() === '') fields.error = '用户标记为失败'
  } else if (to === 'pending') {
    fields.finishedAt = null
    fields.verdict = null
    fields.error = null
  } else if (to === 'waiting') {
    if (round < 1) fields.round = 1
  }
  return fields
}
