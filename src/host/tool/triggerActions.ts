/**
 * dsh-workflow-lite — `workflow_lite` 里触发卡片那几样：读一张卡片（定义 + 本机的情况，按需带触发记录、
 * 最近的输出、排队）、改本机设置、试一张卡片、处理排队。
 *
 * 定义在图里（`write_trigger` 的 `trigger` 由仓储写），这里只管本机那一面，经 {@link TriggerPort} 找触发器服务。
 * 模型能自己开关：`local.enabled = true` 打开要跑命令的卡片时，同时确认「这条命令在这个工作区、用这个 shell 运行」
 * （和用户在画布上确认一样，命令、工作区、shell 改了要再确认）。
 * 时刻一律写成本机时间的「YYYY-MM-DD HH:mm:ss」，模型照着念给用户。
 *
 * @module @xiaoso/dsh-workflow-lite/host/tool/triggerActions
 */

import { upcomingFires } from '../../shared/schedule.ts'
import { commandOf, filterOf, launchOf, sourceText } from '../../shared/trigger.ts'
import { TRIGGER_MARK } from '../../shared/triggerMark.ts'
import type { TriggerIndexEntry, TriggerNode, TriggerSource } from '../../shared/types.ts'
import type { FireRecord, TriggerSetRequest, TriggerView } from '../../shared/wire/trigger.ts'
import type { Outcome } from '../store/repoResult.ts'
import { fail, ok } from '../store/repoResult.ts'
import type { CardTestResult } from '../triggers/cardTest.ts'
import type { TriggerService } from '../triggers/service.ts'
import { cardDataDir, cardSecretsDir } from '../triggers/store.ts'
import type { TriggerLocalArgs, WorkflowLiteArgs } from './args.ts'

/** 工具用到的触发器服务那一面。 */
export type TriggerPort = Pick<
  TriggerService,
  | 'decline'
  | 'list'
  | 'all'
  | 'readiness'
  | 'untested'
  | 'set'
  | 'history'
  | 'output'
  | 'outputLinesOf'
  | 'detail'
  | 'test'
  | 'waive'
  | 'clearQueue'
  | 'cancelQueued'
>

/** read 的 include 可选的几样。 */
export const TRIGGER_INCLUDES = ['history', 'output', 'queue'] as const
/** trigger_queue 的几种做法。 */
export const QUEUE_OPS = ['waive', 'clear', 'cancel'] as const

/** 触发记录缺省几条、最多几条；最近的输出缺省几条，最新几条带上末尾的行。 */
const HISTORY_DEFAULT = 10
const HISTORY_MAX = 50
const OUTPUT_DEFAULT = 10
const OUTPUT_WITH_LINES = 3
const OUTPUT_TAIL = 20
/** 定时给接下来几次。 */
const UPCOMING = 3

/**
 * 要跑命令的卡片，命令的输出怎么算：每次读、写这张卡片都带上，模型不用回去翻 skill 也记得住
 * （对话被压缩后 skill 的细则常常就不在了）。不跑命令的是 `undefined`。
 */
export function outputRule(source: TriggerSource): string | undefined {
  if (source.kind === 'listen') {
    return `只有标准输出里 ${TRIGGER_MARK} 开头的行会触发，标记后面是背景信息；别的输出都是日志、不触发，启动时不要打事件。改了脚本要再 test_trigger。`
  }
  if (source.kind === 'schedule' && source.check !== undefined) {
    return `退出码 0 算满足；标准输出里有 ${TRIGGER_MARK} 开头的行时只有它们是背景信息、拿来比较，没有时整段标准输出都是。改了脚本要再 test_trigger。`
  }
  return undefined
}

/** 本机时间的「YYYY-MM-DD HH:mm:ss」。 */
export function stamp(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** 一条触发记录给模型看的样子。 */
function fireOf(record: FireRecord): Record<string, unknown> {
  return {
    id: record.id,
    at: stamp(record.at),
    channel: record.channel,
    outcome: record.outcome,
    ...(record.sentAt === undefined ? {} : { sentAt: stamp(record.sentAt) }),
    ...(record.reason === undefined ? {} : { reason: record.reason }),
    ...(record.declined === undefined ? {} : { declined: record.declined }),
    ...(record.session === undefined ? {} : { session: record.session }),
    ...(record.instance === undefined ? {} : { instance: record.instance }),
    ...(record.preview === undefined ? {} : { preview: record.preview }),
  }
}

/** 一张卡片在本机的情况（读、改完之后都回它）。 */
async function localOf(
  port: TriggerPort,
  dataDir: string,
  workflow: string,
  node: TriggerNode,
  view: TriggerView | undefined,
  now: number,
): Promise<Record<string, unknown>> {
  const { source } = node.data
  const local = view ?? { node: node.id, enabled: false, state: 'off' as const }
  const upcoming =
    local.enabled && source.kind === 'schedule'
      ? [
          ...(local.next === undefined ? [] : [local.next]),
          ...upcomingFires(source.schedule, new Date(local.next ?? now), UPCOMING).map((date) =>
            date.getTime(),
          ),
        ].slice(0, UPCOMING)
      : []
  const toEnable = await port.readiness(workflow, node.id)
  const retest = await port.untested(workflow, node.id)
  return {
    enabled: local.enabled,
    state: local.state,
    ...(local.problem === undefined ? {} : { problem: local.problem }),
    ...(toEnable.length === 0 ? {} : { toEnable }),
    ...(retest === null ? {} : { retest }),
    ...(local.workspace === undefined ? {} : { workspace: local.workspace }),
    ...(local.runShell === undefined ? {} : { shell: local.runShell }),
    ...(local.approved === undefined ? {} : { approved: local.approved }),
    ...(local.session === undefined ? {} : { session: local.session }),
    ...(local.endpoint === undefined ? {} : { endpoint: local.endpoint }),
    ...(upcoming.length === 0 ? {} : { next: upcoming.map(stamp) }),
    ...(local.checked === undefined
      ? {}
      : { checked: { at: stamp(local.checked.at), met: local.checked.met } }),
    ...(local.line === undefined
      ? {}
      : { line: { at: stamp(local.line.at), text: local.line.text } }),
    ...(local.last === undefined ? {} : { last: fireOf(local.last) }),
    ...(local.queued === undefined ? {} : { queued: local.queued }),
    ...(local.waiting === undefined
      ? {}
      : {
          waiting: {
            fire: local.waiting.fire,
            at: stamp(local.waiting.at),
            ...(local.waiting.session === undefined ? {} : { session: local.waiting.session }),
            ...(local.waiting.instance === undefined ? {} : { instance: local.waiting.instance }),
            ...(local.waiting.status === undefined ? {} : { status: local.waiting.status }),
          },
        }),
    dataDir: cardDataDir(dataDir, workflow, node.id),
    secretsDir: cardSecretsDir(dataDir, workflow, node.id),
  }
}

/** `read` 指到一张触发卡片：定义（连缺省值、一句话说法）+ 本机的情况，`include` 给了的再带上。 */
export async function readTrigger(
  port: TriggerPort,
  dataDir: string,
  workflow: string,
  node: TriggerNode,
  args: Pick<WorkflowLiteArgs, 'include' | 'limit' | 'fire'>,
  now: number,
): Promise<Record<string, unknown>> {
  const list = await port.list(workflow)
  const view = list.triggers.find((candidate) => candidate.node === node.id)
  const include = new Set(args.include ?? [])
  const limit = (fallback: number): number =>
    Math.min(Math.max(Math.trunc(args.limit ?? fallback), 1), HISTORY_MAX)
  const result: Record<string, unknown> = {
    workflow,
    node,
    effective: {
      text: sourceText(node.data.source),
      ...withRule(node.data.source),
      filter: filterOf(node.data),
      launch: launchOf(node.data),
    },
    local: await localOf(port, dataDir, workflow, node, view, now),
    ...(list.paused === undefined ? {} : { paused: stamp(list.paused) }),
    ...(list.owner !== undefined && !list.owner.mine ? { elsewhere: list.owner.pid } : {}),
  }
  if (include.has('history')) {
    result.history = (await port.history(workflow, node.id, limit(HISTORY_DEFAULT))).map(fireOf)
  }
  if (include.has('output')) {
    const { entries } = port.output(workflow, node.id, 'all', limit(OUTPUT_DEFAULT))
    const newest = entries.slice(0, OUTPUT_WITH_LINES).map((entry) => entry.id)
    const lines = new Map(
      port
        .outputLinesOf(workflow, node.id, newest, OUTPUT_TAIL)
        .entries.map((entry) => [entry.id, entry]),
    )
    result.output = entries.map((entry) => {
      const tail = lines.get(entry.id)
      return {
        kind: entry.kind,
        at: stamp(entry.at),
        ...(entry.last === undefined ? {} : { last: stamp(entry.last) }),
        ...(entry.end === undefined ? {} : { end: stamp(entry.end) }),
        verdict: entry.verdict,
        code: entry.code,
        ...(entry.note === undefined ? {} : { note: entry.note }),
        ...(entry.ms === undefined ? {} : { ms: entry.ms }),
        ...(entry.count === undefined ? {} : { count: entry.count }),
        ...(tail === undefined
          ? { preview: entry.preview }
          : {
              lines: tail.lines.map(
                (line) => `${line.stream === 'err' ? '[err] ' : ''}${line.text}`,
              ),
              ...(tail.total > tail.lines.length ? { total: tail.total } : {}),
            }),
      }
    })
  }
  if (include.has('queue')) {
    const queued = (await port.history(workflow, node.id, HISTORY_MAX))
      .filter((record) => record.outcome === 'queued')
      .reverse()
    result.queue = queued.map(fireOf)
  }
  if (args.fire !== undefined && args.fire !== '') {
    result.fire = { id: args.fire, ...(await port.detail(args.fire)) }
  }
  return result
}

/**
 * `list` 里的触发卡片总览：这台机器上所有工作流的卡片各一行（开没开、状态、问题），
 * 用户问「哪个触发器出问题了」时不用逐个工作流去读。没有卡片时是 `undefined`。
 */
export async function triggerOverview(
  port: TriggerPort,
): Promise<Record<string, unknown> | undefined> {
  const all = await port.all()
  if (all.triggers.length === 0) return undefined
  return {
    cards: all.triggers.map(({ workflow, view, name, data }) => ({
      workflow,
      node: view.node,
      name,
      kind: data.source.kind,
      enabled: view.enabled,
      state: view.state,
      ...(view.problem === undefined ? {} : { problem: view.problem }),
    })),
    ...(all.paused === undefined ? {} : { paused: stamp(all.paused) }),
    ...(all.owner !== undefined && !all.owner.mine ? { elsewhere: all.owner.pid } : {}),
  }
}

/** 不带 node 的 `read`：每张触发卡片的定义，加上开没开、现在什么状态。 */
export async function triggerIndex(
  port: TriggerPort | undefined,
  workflow: string,
  nodes: readonly TriggerNode[],
): Promise<TriggerIndexEntry[]> {
  const views =
    port === undefined
      ? new Map<string, TriggerView>()
      : new Map((await port.list(workflow)).triggers.map((view) => [view.node, view]))
  return nodes.map((node) => {
    const view = views.get(node.id)
    return {
      id: node.id,
      ...node.data,
      ...(view === undefined
        ? {}
        : {
            enabled: view.enabled,
            state: view.state,
            ...(view.problem === undefined ? {} : { problem: view.problem }),
          }),
    }
  })
}

/**
 * write_trigger 的 local → 服务的设置请求；形状不对回一句原因。
 * 打开要跑命令的卡片时带上图里现在的命令作确认（服务按改完的工作区、shell 记下）。
 */
export function localRequest(
  workflow: string,
  node: TriggerNode,
  local: TriggerLocalArgs,
  currentSession: string | undefined,
): TriggerSetRequest | string {
  if (typeof local !== 'object' || local === null) return 'local 要写成 { workspace, shell, … }'
  const request: TriggerSetRequest = { workflow, node: node.id }
  const command = commandOf(node.data.source)
  if (local.enabled !== undefined) {
    if (typeof local.enabled !== 'boolean') return 'local.enabled 要是 true / false'
    request.enabled = local.enabled
    if (local.enabled && command !== undefined) request.approve = command
  }
  for (const key of ['workspace', 'shell', 'hook', 'token'] as const) {
    const value = local[key]
    if (value === undefined) continue
    if (typeof value !== 'string') return `local.${key} 要是文字`
    request[key] = value
  }
  if (local.session !== undefined) {
    if (typeof local.session !== 'string') return 'local.session 要是文字'
    if (local.session === 'current') {
      if (currentSession === undefined) return '拿不到当前会话的 id'
      request.session = currentSession
    } else request.session = local.session
  }
  if (local.noToken !== undefined) {
    if (typeof local.noToken !== 'boolean') return 'local.noToken 要是 true / false'
    request.noToken = local.noToken
  }
  return request
}

/** 一张卡片现在在本机的情况（写了定义、没改本机设置时也回给模型）。 */
export async function localNow(
  port: TriggerPort,
  dataDir: string,
  workflow: string,
  node: TriggerNode,
  now: number,
): Promise<Record<string, unknown>> {
  const view = (await port.list(workflow)).triggers.find((candidate) => candidate.node === node.id)
  return localOf(port, dataDir, workflow, node, view, now)
}

/** 带上 {@link outputRule}（有的话）。 */
export function withRule(source: TriggerSource): { output?: string } {
  const rule = outputRule(source)
  return rule === undefined ? {} : { output: rule }
}

/** 写完卡片后接下来做什么（写在返回值里，模型照着做）。 */
export function nextStep(local: Record<string, unknown> | undefined): string {
  if (local === undefined) return '先用 test_trigger 试一遍，再用 local.enabled 打开。'
  const toEnable = Array.isArray(local.toEnable) && local.toEnable.length > 0
  // 要再试的提醒放在最前，后面照常说开关的情况（它不算打开前还差的）。
  const retest = typeof local.retest === 'string' ? `${local.retest}。` : ''
  if (local.enabled === true) {
    if (toEnable) {
      return `${retest}卡片开着但还不能触发：按 toEnable 补齐（命令、工作区、shell 改过的再给一次 local.enabled = true）。`
    }
    return retest === '' ? '卡片开着。' : `${retest}卡片已经开着，按现在的脚本在跑。`
  }
  if (retest !== '') {
    return toEnable
      ? `${retest}卡片关着：按 toEnable 补齐后用 local.enabled 打开。`
      : `${retest}卡片关着：过了再用 local.enabled 打开。`
  }
  return toEnable
    ? '卡片关着：先用 test_trigger 试一遍，按 toEnable 补齐后用 local.enabled 打开。'
    : '卡片关着：先用 test_trigger 试一遍，再用 local.enabled 打开。'
}

/** 改完本机设置后回这张卡片的本机情况。 */
export async function applyLocal(
  port: TriggerPort,
  dataDir: string,
  node: TriggerNode,
  request: TriggerSetRequest,
  now: number,
): Promise<Outcome<Record<string, unknown>>> {
  const outcome = await port.set(request)
  if (!outcome.ok) return outcome
  const view = outcome.result.triggers.find((candidate) => candidate.node === node.id)
  return ok(await localOf(port, dataDir, request.workflow, node, view, now))
}

/** test_trigger 的结果：时刻换成本机时间，带上打开前还差什么。 */
export async function testTrigger(
  port: TriggerPort,
  workflow: string,
  node: string,
  args: Pick<WorkflowLiteArgs, 'workspace' | 'seconds' | 'poke' | 'body'>,
): Promise<Outcome<Record<string, unknown>>> {
  const outcome = await port.test({
    workflow,
    node,
    ...(args.workspace === undefined ? {} : { workspace: args.workspace }),
    options: {
      ...(args.seconds === undefined ? {} : { seconds: args.seconds }),
      ...(args.poke === undefined ? {} : { poke: args.poke }),
      ...(args.body === undefined ? {} : { body: args.body }),
    },
  })
  if (!outcome.ok) return outcome
  const { verdict, summary, ...result }: CardTestResult = outcome.result
  const toEnable = await port.readiness(workflow, node)
  // 结论在前：verdict、summary 先读到，细节在后。
  return ok({
    verdict,
    summary,
    ...result,
    ...(result.next === undefined ? {} : { next: result.next.map(stamp) }),
    ...(result.runs === undefined
      ? {}
      : { runs: result.runs.map((run) => ({ ...run, at: stamp(run.at) })) }),
    ...(toEnable.length === 0 ? {} : { toEnable }),
  })
}

/** trigger_queue：视为上次执行已结束 / 清空排着的 / 取消排着的一个。 */
export async function queueAction(
  port: TriggerPort,
  workflow: string,
  node: string,
  op: string | undefined,
  fire: string | undefined,
): Promise<Outcome<Record<string, unknown>>> {
  if (op === 'waive') {
    const outcome = await port.waive(workflow, node)
    return outcome.ok ? ok({ waived: true }) : outcome
  }
  if (op === 'clear') {
    const outcome = await port.clearQueue(workflow, node)
    return outcome.ok ? ok(outcome.result) : outcome
  }
  if (op === 'cancel') {
    if (fire === undefined || fire === '')
      return fail('invalid_args', 'cancel 要带 fire（排着的那次的触发编号）')
    const outcome = await port.cancelQueued(fire)
    return outcome.ok ? ok({ cancelled: fire }) : outcome
  }
  return fail('invalid_args', `queue 要是 ${QUEUE_OPS.join(' / ')} 之一`)
}
