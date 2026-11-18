/**
 * dsh-workflow-lite — 触发器的本机状态：落盘位置与读写。
 *
 * 触发卡片的定义在图里（跟着工作流导出、进版本）；这里放的是这台机器上的事，都在 `<dataDir>/triggers/` 下：
 * - `state.json`：每张卡片的开关、选定的工作区和会话、下一次触发的时刻、连续失败次数；
 * - `fires/<触发编号>.txt`：背景信息太长时另存的全文，发进会话的消息里只放开头和这个文件的路径；
 * - `owner.json`：现在由哪个 DSH 进程负责触发（见 `owner.ts`）；
 * - `live.json`：负责的进程写下的运行情况（程序在不在跑、上次检查、端口开没开），别的进程据此显示状态；
 * - `data/<工作流>/<卡片>/`：给这张卡片的脚本自己记东西（上次看到的提交、处理过的文件），
 *   运行时经环境变量 `TRIGGER_DATA_DIR` 告诉脚本；试运行用 `data-test/` 下同样的位置，不弄乱真的那份。
 *
 * 触发记录（连同每次的触发说明、背景信息）与检查命令、监听程序最近的输出在插件数据库里，
 * 见 {@link FireLog}、{@link OutputLog}。
 *
 * 同一个数据目录可能有几个 DSH 进程在用：到点触发只有负责的那个做，但开关、「立即触发一次」哪个进程都能改。
 * 所以每次修改都现读现写（进程内排队 + 原子写），不在内存里留副本。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/store
 */

import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { FireRecord, FireSettled, TriggerActivitySlot } from '../../shared/wire/trigger.ts'
import {
  ensureDir,
  readFileText,
  removeTree,
  renameDir,
  unlinkFile,
  writeFileAtomic,
} from '../store/atomic.ts'
import type { PluginDatabase } from '../store/database.ts'
import { pathKind } from '../store/paths.ts'
import { type FireDetail, FireLog, type QueuedCount } from './fireLog.ts'
import type { HookPortState } from './hooks.ts'
import { OutputLog } from './outputLog.ts'
import type { Probe } from './poller.ts'

export const TRIGGERS_DIR = 'triggers'
/** 背景信息超过这么多字符就另存成文本文件，消息里只放开头。 */
export const INFO_INLINE_CHARS = 4000

export function triggersDir(dataDir: string): string {
  return join(dataDir, TRIGGERS_DIR)
}

export function ownerFile(dataDir: string): string {
  return join(triggersDir(dataDir), 'owner.json')
}

function stateFile(dataDir: string): string {
  return join(triggersDir(dataDir), 'state.json')
}

/** 一次触发的背景信息全文（太长时才有）。 */
export function fireInfoFile(dataDir: string, id: string): string {
  return join(triggersDir(dataDir), 'fires', `${id}.txt`)
}

/** 脚本自己记东西的目录在哪两处：真打开后用的、试运行用的。 */
const CARD_DATA = { live: 'data', trial: 'data-test' } as const

/** 运行时给命令的环境变量：卡片的数据目录。 */
export const CARD_DATA_ENV = 'TRIGGER_DATA_DIR'

/**
 * 一张卡片给脚本记东西的目录（不随工作流导出）。`trial` = 试运行用的那份，和真的分开：
 * 试的时候脚本记下「看过了」，真打开后不会因此漏掉。
 */
export function cardDataDir(
  dataDir: string,
  workflow: string,
  node: string,
  trial = false,
): string {
  return join(triggersDir(dataDir), trial ? CARD_DATA.trial : CARD_DATA.live, workflow, node)
}

function liveFile(dataDir: string): string {
  return join(triggersDir(dataDir), 'live.json')
}

/** 「全部暂停」：文件在就是暂停着，里面记着从什么时候起。 */
function pausedFile(dataDir: string): string {
  return join(triggersDir(dataDir), 'paused.json')
}

/** 触发编号：`f-<YYYYMMDD>-<HHmmss>-<4 位十六进制>`。 */
export function newFireId(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  return `f-${day}-${time}-${randomBytes(2).toString('hex')}`
}

/** 一张触发卡片在这台机器上的状态。 */
export interface TriggerLocal {
  enabled: boolean
  /** 打开开关的时刻（定时规则改了就重新算起）：「每隔多久」从这里数。 */
  since?: number
  /** 下一次触发的时刻，由负责触发的进程算出来写下。 */
  due?: number
  /** 算 `due` 时用的定时规则；和图里的对不上就重新算。 */
  rule?: string
  /** 新建会话用的工作区目录。 */
  workspace?: string
  /** 定时检查、监听：这张卡片自己选的 shell（程序的完整路径）；没有就跟着默认。 */
  shell?: string
  /** 「固定会话」用的那个会话。 */
  session?: string
  /** 上一次发进去的会话（「接着上一次的会话」用）。 */
  lastSession?: string
  /** 上一次发出去的那次触发的编号（跳过、排队看它跑完没有，见 `runEnd.ts`）。 */
  lastFire?: string
  /** 用户点了「视为已结束」的那一次触发的编号（当它已经结束）。 */
  waived?: string
  /** 连续没发出去的次数。 */
  failures?: number
  /** 被自动停用时的原因（开关同时被关掉）；再打开时清掉。 */
  stopped?: string
  /** 用户确认过的命令、工作区与 shell 的记号（{@link approvalOf}）；和现在的对不上就要重新确认。 */
  approved?: string
  /** HTTP 触发：地址（`/trigger/` 后面那一段）与令牌。 */
  hook?: string
  token?: string
  /** HTTP 触发：不校验令牌（令牌照样留着，再打开校验还用它）。 */
  noToken?: true
  /** 定时检查：上一次检查的结果。 */
  probe?: Probe
  /** 接续触发：那个工作流里已经处理过（触发过或判过不用触发）的、已结束的实例。 */
  seen?: string[]
  /** 模型上一次 `test_trigger` 的时刻：之后改过 `triggers/` 里的脚本就提醒它再试（见 `scriptAge.ts`）。 */
  tested?: number
}

/**
 * 确认过的命令、工作区与 shell 的记号：哪一样改了都对不上。
 * `shell` 是实际要用的那个（卡片自己选的，或设置里的默认）；用系统的（空着）时记号和加 shell 之前一样，
 * 以前确认过的卡片不用重新确认。
 */
export function approvalOf(command: string, workspace: string | undefined, shell?: string): string {
  const base = [command, workspace ?? '']
  return JSON.stringify(shell === undefined || shell === '' ? base : [...base, shell])
}

/** 工作流名 → 卡片 id → 状态。 */
export type TriggerLocals = Record<string, Record<string, TriggerLocal>>

export type { FireDetail }

/** 负责的进程写下的一张卡片的运行情况。 */
export interface LiveStatus {
  /** `running` 程序在跑、在按间隔检查、地址开着；`restarting` 程序退出了等着重启；`error` 起不来。 */
  state: 'running' | 'restarting' | 'error'
  /** 给人看的一句（退出原因、上次检查的情况）。 */
  note?: string
  /** 程序这次启动的时刻。 */
  since?: number
  /** 下一次检查、下一次重启的时刻。 */
  next?: number
  /** 定时检查上一次检查。 */
  checked?: { at: number; met: boolean }
  /** 连着重启了几次。 */
  restarts?: number
  /** 监听程序最近打出的一行（画布卡片上显示；去掉了终端颜色、截短）。 */
  line?: { at: number; text: string }
  /** 监听程序最近一次记下输出（哪一路都算）的时刻：界面据此重读最近的输出。 */
  output?: number
}

/** `live.json`：写它的进程、各卡片的运行情况、HTTP 端口。 */
export interface LiveFile {
  pid: number
  sources: Record<string, Record<string, LiveStatus>>
  port?: HookPortState
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const whole = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

function readLocal(raw: unknown): TriggerLocal | null {
  if (!isRecord(raw)) return null
  const local: TriggerLocal = { enabled: raw.enabled === true }
  const since = whole(raw.since)
  if (since !== undefined) local.since = since
  const due = whole(raw.due)
  if (due !== undefined) local.due = due
  const tested = whole(raw.tested)
  if (tested !== undefined) local.tested = tested
  for (const key of [
    'rule',
    'workspace',
    'shell',
    'session',
    'lastSession',
    'lastFire',
    'waived',
    'stopped',
    'approved',
    'hook',
    'token',
  ] as const) {
    const value = text(raw[key])
    if (value !== undefined) local[key] = value
  }
  if (raw.noToken === true) local.noToken = true
  const failures = whole(raw.failures)
  if (failures !== undefined && failures > 0) local.failures = failures
  if (isRecord(raw.probe)) {
    const probe: Probe = {}
    if (typeof raw.probe.ok === 'boolean') probe.ok = raw.probe.ok
    const digest = text(raw.probe.digest)
    if (digest !== undefined) probe.digest = digest
    if (Object.keys(probe).length > 0) local.probe = probe
  }
  if (Array.isArray(raw.seen)) {
    const seen = raw.seen.filter((id): id is string => typeof id === 'string' && id !== '')
    if (seen.length > 0) local.seen = seen
  }
  return local
}

function readLocals(source: string | null): TriggerLocals {
  if (source === null) return {}
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    return {}
  }
  if (!isRecord(raw) || !isRecord(raw.triggers)) return {}
  const locals: TriggerLocals = {}
  for (const [workflow, nodes] of Object.entries(raw.triggers)) {
    if (!isRecord(nodes)) continue
    const group: Record<string, TriggerLocal> = {}
    for (const [node, value] of Object.entries(nodes)) {
      const local = readLocal(value)
      if (local !== null) group[node] = local
    }
    if (Object.keys(group).length > 0) locals[workflow] = group
  }
  return locals
}

/** 触发器本机状态的读写。写一律现读现改现写，进程内排队。 */
export class TriggerStore {
  private chain: Promise<unknown> = Promise.resolve()
  private readonly dataDir: () => string
  private readonly log: FireLog
  /** 检查命令、监听程序最近的输出（负责的进程写，哪个进程都能读、清空）。 */
  readonly outputs: OutputLog

  constructor(dataDir: () => string, database: PluginDatabase) {
    this.dataDir = dataDir
    this.log = new FireLog(database)
    this.outputs = new OutputLog(database)
  }

  private queued<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task)
    this.chain = run.catch(() => {})
    return run
  }

  // ── 开关与设置 ─────────────────────────────────────────────

  async locals(): Promise<TriggerLocals> {
    return readLocals(await readFileText(stateFile(this.dataDir())))
  }

  /** 读 → 改 → 写回；没改就不写盘。空的分组顺手删掉。 */
  update<T>(change: (locals: TriggerLocals) => T): Promise<T> {
    return this.queued(async () => {
      const file = stateFile(this.dataDir())
      const source = await readFileText(file)
      const locals = readLocals(source)
      const before = JSON.stringify(locals)
      const result = change(locals)
      for (const [workflow, nodes] of Object.entries(locals)) {
        if (Object.keys(nodes).length === 0) delete locals[workflow]
      }
      if (JSON.stringify(locals) !== before) {
        await ensureDir(triggersDir(this.dataDir()))
        await writeFileAtomic(file, `${JSON.stringify({ format: 1, triggers: locals }, null, 2)}\n`)
      }
      return result
    })
  }

  // ── 触发记录（插件数据库里，见 FireLog）────────────────────

  /** 记一次触发（连同那一刻的触发说明与背景信息）；背景信息太长时另存全文。 */
  async record(detail: FireDetail): Promise<void> {
    const dataDir = this.dataDir()
    const long = detail.info !== undefined && detail.info.length > INFO_INLINE_CHARS
    if (long) {
      await ensureDir(join(triggersDir(dataDir), 'fires'))
      await writeFileAtomic(fireInfoFile(dataDir, detail.record.id), detail.info ?? '')
    }
    this.log.record(detail, long)
  }

  /** 一张卡片最近一次触发。 */
  async last(workflow: string, node: string): Promise<FireRecord | undefined> {
    return this.log.last(workflow, node)
  }

  /** 最近 `limit` 次，新的在前；不给卡片就是这个工作流所有卡片的。 */
  async history(workflow: string, node: string | undefined, limit: number): Promise<FireRecord[]> {
    return this.log.recent(workflow, node, limit)
  }

  /** `since` 之后这张卡片收下了几次（发出去的、排着的）。 */
  async sentSince(workflow: string, node: string, since: number): Promise<number> {
    return this.log.sentSince(workflow, node, since)
  }

  /** 有排着的那些卡片、各几个。 */
  async queuedCounts(): Promise<QueuedCount[]> {
    return this.log.queuedCounts()
  }

  /** 这张卡片排着几个。 */
  async queuedCount(workflow: string, node: string): Promise<number> {
    return this.log.queuedCount(workflow, node)
  }

  /** 这张卡片排着的，先来的在前。 */
  async queuedFires(workflow: string, node: string): Promise<FireRecord[]> {
    return this.log.queued(workflow, node)
  }

  /** 排着的这一次轮到了，记下结果；已经不是排着的回 `false`。 */
  async release(
    id: string,
    outcome: FireSettled,
    extra: { reason?: string; session?: string },
    sentAt: number,
  ): Promise<boolean> {
    return this.log.release(id, outcome, extra, sentAt)
  }

  /** 排着的这一次不再执行（记成跳过）；已经不是排着的回 `false`。 */
  async cancel(id: string, reason: string): Promise<boolean> {
    return this.log.cancel(id, reason)
  }

  /** 这张卡片排着的都不再执行（记成跳过），回几个。 */
  async drop(workflow: string, node: string, reason: string): Promise<number> {
    return this.log.drop(workflow, node, reason)
  }

  /** 这个会话里、`since` 以来发进去了还没对上实例的最早一次。 */
  async unclaimed(
    workflow: string,
    session: string,
    since: number,
  ): Promise<FireRecord | undefined> {
    return this.log.unclaimed(workflow, session, since)
  }

  /** 这张卡片 `since` 到 `until` 每一小格各种结果几次。 */
  async activity(
    workflow: string,
    node: string,
    since: number,
    until: number,
  ): Promise<TriggerActivitySlot[]> {
    return this.log.activity(workflow, node, since, until)
  }

  /** 一次触发的背景信息全文另存在哪（太长时才写这个文件）。 */
  infoPath(id: string): string {
    return fireInfoFile(this.dataDir(), id)
  }

  /** 一次触发的全部；编号不对、记录不在是 `null`。 */
  async detail(id: string): Promise<FireDetail | null> {
    return this.log.detail(id)
  }

  /** 这次触发建出了哪个实例。 */
  async bind(id: string, instance: string): Promise<void> {
    this.log.bind(id, instance)
  }

  /** 这个会话里 `since` 以来还没对上实例的同一个工作流的触发，都记成接进了实例 `instance`。 */
  async join(workflow: string, session: string, since: number, instance: string): Promise<void> {
    this.log.join(workflow, session, since, instance)
  }

  /** 记到这个实例上的触发，从早到晚。 */
  async ofInstance(instance: string): Promise<FireRecord[]> {
    return this.log.ofInstance(instance)
  }

  /** 模型按触发条件判断这次不需要执行：记下它给的原因。 */
  async decline(id: string, reason: string): Promise<void> {
    this.log.decline(id, reason)
  }

  // ── 运行情况与最近的输出（负责的进程写，谁都能读）─────────────────

  async live(): Promise<LiveFile | null> {
    const source = await readFileText(liveFile(this.dataDir()))
    if (source === null) return null
    try {
      const raw: unknown = JSON.parse(source)
      if (!isRecord(raw) || typeof raw.pid !== 'number' || !isRecord(raw.sources)) return null
      return raw as unknown as LiveFile
    } catch {
      return null
    }
  }

  async writeLive(file: LiveFile): Promise<void> {
    await ensureDir(triggersDir(this.dataDir()))
    await writeFileAtomic(liveFile(this.dataDir()), `${JSON.stringify(file, null, 2)}\n`)
  }

  // ── 全部暂停 ───────────────────────────────────────────────

  /** 暂停着时是开始暂停的时刻；没暂停是 `undefined`。 */
  async paused(): Promise<number | undefined> {
    const source = await readFileText(pausedFile(this.dataDir()))
    if (source === null) return undefined
    try {
      const raw: unknown = JSON.parse(source)
      return isRecord(raw) ? (whole(raw.since) ?? 0) : 0
    } catch {
      // 文件在但坏了：仍按暂停算（宁可不触发）。
      return 0
    }
  }

  /** 暂停（给开始的时刻）或恢复（`null`）。 */
  setPaused(since: number | null): Promise<void> {
    return this.queued(async () => {
      const file = pausedFile(this.dataDir())
      if (since === null) {
        await unlinkFile(file)
        return
      }
      if ((await readFileText(file)) !== null) return
      await ensureDir(triggersDir(this.dataDir()))
      await writeFileAtomic(file, `${JSON.stringify({ since }, null, 2)}\n`)
    })
  }

  /** 工作流改名：开关、设置、触发记录、最近的输出和脚本的数据目录都跟着走。 */
  async rename(from: string, to: string): Promise<void> {
    this.log.rename(from, to)
    this.outputs.rename(from, to)
    for (const area of Object.values(CARD_DATA)) {
      const base = join(triggersDir(this.dataDir()), area)
      await moveIfThere(join(base, from), join(base, to))
    }
    await this.update((locals) => {
      const group = locals[from]
      if (group === undefined) return
      delete locals[from]
      locals[to] = group
    })
  }

  /** 工作流删掉了：它的触发记录连同另存的全文、最近的输出、脚本的数据目录一起删（开关与设置由对账清掉）。 */
  async forget(workflow: string): Promise<void> {
    this.outputs.forget(workflow)
    for (const area of Object.values(CARD_DATA)) {
      await removeTree(join(triggersDir(this.dataDir()), area, workflow))
    }
    const files = this.log.forget(workflow)
    await Promise.all(files.map((id) => unlinkFile(fireInfoFile(this.dataDir(), id))))
  }
}

/** 目录在就挪过去（目标的上一级没有就先建）；不在就算了。 */
async function moveIfThere(from: string, to: string): Promise<void> {
  if ((await pathKind(from)) !== 'dir') return
  await ensureDir(dirname(to))
  await renameDir(from, to)
}
