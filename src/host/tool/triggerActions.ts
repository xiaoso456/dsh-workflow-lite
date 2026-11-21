/**
 * dsh-workflow-lite — `workflow_lite` 里触发卡片那几样：读一张卡片（定义 + 跑起来的情况，按需带触发记录、
 * 最近的输出、排队）、改设置、试一张卡片、处理排队。
 *
 * 定义和设置都在图里：`write_trigger` 的 `trigger` 由仓储写，`local`（开关、工作区、shell、工作目录、固定会话、
 * HTTP 地址和令牌）经 {@link TriggerPort} 交给触发器服务核对后写回图里。
 * 时刻一律写成本机时间的「YYYY-MM-DD HH:mm:ss」，模型照着念给用户。
 *
 * @module @xiaoso/dsh-workflow-lite/host/tool/triggerActions
 */

import { upcomingFires } from '../../shared/schedule.ts'
import { filterOf, launchOf, sourceText } from '../../shared/trigger.ts'
import { hookPath } from '../../shared/triggerHttp.ts'
import { TRIGGER_MARK } from '../../shared/triggerMark.ts'
import type { TriggerIndexEntry, TriggerNode, TriggerSource } from '../../shared/types.ts'
import type { FireRecord, TriggerListResponse, TriggerView } from '../../shared/wire/trigger.ts'
import { assetsDir } from '../store/paths.ts'
import type { Outcome } from '../store/repoResult.ts'
import { fail, ok } from '../store/repoResult.ts'
import { cardDataDir, cardDir, cardSecretsDir } from '../triggers/cardDirs.ts'
import type { CardTestResult } from '../triggers/cardTest.ts'
import type { TriggerService } from '../triggers/service.ts'
import type { SettingsChange } from '../triggers/settings.ts'
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

/** 一张卡片的设置和跑起来的情况（读、改完之后都回它）。 */
async function localOf(
  port: TriggerPort,
  dataDir: string,
  workflow: string,
  node: TriggerNode,
  list: TriggerListResponse,
  now: number,
): Promise<Record<string, unknown>> {
  const { data } = node
  const { source } = data
  const view: TriggerView = list.triggers.find((candidate) => candidate.node === node.id) ?? {
    node: node.id,
    enabled: data.enabled === true,
    state: 'off',
  }
  const upcoming =
    view.enabled && source.kind === 'schedule'
      ? [
          ...(view.next === undefined ? [] : [view.next]),
          ...upcomingFires(source.schedule, new Date(view.next ?? now), UPCOMING).map((date) =>
            date.getTime(),
          ),
        ].slice(0, UPCOMING)
      : []
  const toEnable = await port.readiness(workflow, node.id)
  const retest = await port.untested(workflow, node.id)
  return {
    enabled: view.enabled,
    state: view.state,
    ...(view.problem === undefined ? {} : { problem: view.problem }),
    ...(toEnable.length === 0 ? {} : { toEnable }),
    ...(retest === null ? {} : { retest }),
    ...(data.workspace === undefined ? {} : { workspace: data.workspace }),
    ...(view.runShell === undefined ? {} : { shell: view.runShell }),
    ...(data.cwd === undefined ? {} : { cwd: data.cwd }),
    ...(data.launch?.sessionId === undefined ? {} : { session: data.launch.sessionId }),
    ...(source.kind === 'http' && source.hook !== undefined
      ? {
          endpoint: {
            url: `${list.hookOrigin}${hookPath(source.hook)}`,
            hook: source.hook,
            ...(source.token === undefined ? {} : { token: source.token }),
            ...(source.noToken === true ? { noToken: true } : {}),
          },
        }
      : {}),
    ...(upcoming.length === 0 ? {} : { next: upcoming.map(stamp) }),
    ...(view.checked === undefined
      ? {}
      : { checked: { at: stamp(view.checked.at), met: view.checked.met } }),
    ...(view.line === undefined ? {} : { line: { at: stamp(view.line.at), text: view.line.text } }),
    ...(view.last === undefined ? {} : { last: fireOf(view.last) }),
    ...(view.queued === undefined ? {} : { queued: view.queued }),
    ...(view.waiting === undefined
      ? {}
      : {
          waiting: {
            fire: view.waiting.fire,
            at: stamp(view.waiting.at),
            ...(view.waiting.session === undefined ? {} : { session: view.waiting.session }),
            ...(view.waiting.instance === undefined ? {} : { instance: view.waiting.instance }),
            ...(view.waiting.status === undefined ? {} : { status: view.waiting.status }),
          },
        }),
    cardDir: cardDir(assetsDir(dataDir, workflow), node.id),
    dataDir: cardDataDir(assetsDir(dataDir, workflow), node.id),
    secretsDir: cardSecretsDir(assetsDir(dataDir, workflow), node.id),
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
    local: await localOf(port, dataDir, workflow, node, list, now),
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

/** 不带 node 的 `read`：每张触发卡片的定义和设置，加上现在什么状态。 */
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
            state: view.state,
            ...(view.problem === undefined ? {} : { problem: view.problem }),
          }),
    }
  })
}

/** write_trigger 的 local → 服务的设置改动；形状不对回一句原因。 */
export function localChange(
  local: TriggerLocalArgs,
  currentSession: string | undefined,
): SettingsChange | string {
  if (typeof local !== 'object' || local === null) return 'local 要写成 { workspace, shell, … }'
  const change: SettingsChange = {}
  if (local.enabled !== undefined) {
    if (typeof local.enabled !== 'boolean') return 'local.enabled 要是 true / false'
    change.enabled = local.enabled
  }
  for (const key of ['workspace', 'shell', 'cwd', 'hook', 'token'] as const) {
    const value = local[key]
    if (value === undefined) continue
    if (typeof value !== 'string') return `local.${key} 要是文字`
    change[key] = value
  }
  if (local.session !== undefined) {
    if (typeof local.session !== 'string') return 'local.session 要是文字'
    if (local.session === 'current') {
      if (currentSession === undefined) return '拿不到当前会话的 id'
      change.session = currentSession
    } else change.session = local.session
  }
  if (local.noToken !== undefined) {
    if (typeof local.noToken !== 'boolean') return 'local.noToken 要是 true / false'
    change.noToken = local.noToken
  }
  if (local.resetToken !== undefined) {
    if (local.resetToken !== true) return 'local.resetToken 只能是 true'
    change.resetToken = true
  }
  return change
}

/** 一张卡片现在的设置和跑起来的情况（写了定义、没改设置时也回给模型）。 */
export async function localNow(
  port: TriggerPort,
  dataDir: string,
  workflow: string,
  node: TriggerNode,
  now: number,
): Promise<Record<string, unknown>> {
  return localOf(port, dataDir, workflow, node, await port.list(workflow), now)
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
      return `${retest}卡片开着但还不能触发：按 toEnable 补齐。`
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
