/**
 * dsh-workflow-lite — 触发器的本机状态：落盘位置与读写。
 *
 * 触发卡片的定义在图里（跟着工作流导出、进版本）；这里放的是这台机器上的事，都在 `<dataDir>/triggers/` 下：
 * - `state.json`：每张卡片的开关、选定的工作区和会话、下一次触发的时刻、连续失败次数；
 * - `history.json`：触发记录（最近 {@link HISTORY_MAX} 条）；
 * - `fires/<触发编号>.json`：一次触发的全部（触发说明、背景信息的原文），模型开始执行时实例据此记下来源；
 * - `owner.json`：现在由哪个 DSH 进程负责触发（见 `owner.ts`）。
 *
 * 同一个数据目录可能有几个 DSH 进程在用：到点触发只有负责的那个做，但开关、「立即触发一次」哪个进程都能改。
 * 所以每次修改都现读现写（进程内排队 + 原子写），不在内存里留副本。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/store
 */

import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { type FireChannel, isFireId } from '../../shared/trigger.ts'
import type { FireOutcome, FireRecord } from '../../shared/wire/trigger.ts'
import { ensureDir, readFileText, unlinkFile, writeFileAtomic } from '../store/atomic.ts'

export const TRIGGERS_DIR = 'triggers'
/** 触发记录留多少条。 */
export const HISTORY_MAX = 200

export function triggersDir(dataDir: string): string {
  return join(dataDir, TRIGGERS_DIR)
}

export function ownerFile(dataDir: string): string {
  return join(triggersDir(dataDir), 'owner.json')
}

function stateFile(dataDir: string): string {
  return join(triggersDir(dataDir), 'state.json')
}

function historyFile(dataDir: string): string {
  return join(triggersDir(dataDir), 'history.json')
}

function fireFile(dataDir: string, id: string): string {
  return join(triggersDir(dataDir), 'fires', `${id}.json`)
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
  /** 「固定会话」用的那个会话。 */
  session?: string
  /** 上一次发进去的会话（「接着上一次的会话」用）。 */
  lastSession?: string
  /** 连续没发出去的次数。 */
  failures?: number
  /** 被自动停用时的原因（开关同时被关掉）；再打开时清掉。 */
  stopped?: string
}

/** 工作流名 → 卡片 id → 状态。 */
export type TriggerLocals = Record<string, Record<string, TriggerLocal>>

/** 一次触发的全部：记录 + 那一刻的触发说明与背景信息。 */
export interface FireDetail {
  record: FireRecord
  note?: string
  info?: string
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
  for (const key of ['rule', 'workspace', 'session', 'lastSession', 'stopped'] as const) {
    const value = text(raw[key])
    if (value !== undefined) local[key] = value
  }
  const failures = whole(raw.failures)
  if (failures !== undefined && failures > 0) local.failures = failures
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

const CHANNELS: readonly FireChannel[] = ['schedule', 'now']
const OUTCOMES: readonly FireOutcome[] = ['sent', 'skipped', 'failed']

function readFire(raw: unknown): FireRecord | null {
  if (!isRecord(raw)) return null
  const channel = CHANNELS.find((candidate) => candidate === raw.channel)
  const outcome = OUTCOMES.find((candidate) => candidate === raw.outcome)
  const { id, workflow, node, name, at } = raw
  if (
    !isFireId(id) ||
    typeof workflow !== 'string' ||
    typeof node !== 'string' ||
    typeof name !== 'string' ||
    typeof at !== 'number' ||
    channel === undefined ||
    outcome === undefined
  ) {
    return null
  }
  const reason = text(raw.reason)
  const session = text(raw.session)
  const instance = text(raw.instance)
  return {
    id,
    workflow,
    node,
    name,
    channel,
    at,
    outcome,
    ...(reason === undefined ? {} : { reason }),
    ...(session === undefined ? {} : { session }),
    ...(instance === undefined ? {} : { instance }),
  }
}

function readFires(source: string | null): FireRecord[] {
  if (source === null) return []
  try {
    const raw: unknown = JSON.parse(source)
    if (!isRecord(raw) || !Array.isArray(raw.fires)) return []
    return raw.fires.map(readFire).filter((fire): fire is FireRecord => fire !== null)
  } catch {
    return []
  }
}

/** 触发器本机状态的读写。写一律现读现改现写，进程内排队。 */
export class TriggerStore {
  private chain: Promise<unknown> = Promise.resolve()
  private readonly dataDir: () => string

  constructor(dataDir: () => string) {
    this.dataDir = dataDir
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

  // ── 触发记录 ───────────────────────────────────────────────

  /** 触发记录，旧的在前。 */
  async fires(): Promise<FireRecord[]> {
    return readFires(await readFileText(historyFile(this.dataDir())))
  }

  /** 记一次触发（连同那一刻的触发说明与背景信息）；超出条数的旧记录连同它们的文件一起删。 */
  record(detail: FireDetail): Promise<void> {
    return this.queued(async () => {
      const dataDir = this.dataDir()
      await ensureDir(join(triggersDir(dataDir), 'fires'))
      await writeFileAtomic(
        fireFile(dataDir, detail.record.id),
        `${JSON.stringify(detail, null, 2)}\n`,
      )
      const fires = [...readFires(await readFileText(historyFile(dataDir))), detail.record]
      const dropped = fires.splice(0, Math.max(0, fires.length - HISTORY_MAX))
      await writeFileAtomic(
        historyFile(dataDir),
        `${JSON.stringify({ format: 1, fires }, null, 2)}\n`,
      )
      await Promise.all(dropped.map((fire) => unlinkFile(fireFile(dataDir, fire.id))))
    })
  }

  /** 一次触发的全部；编号不对、文件不在是 `null`。 */
  async detail(id: string): Promise<FireDetail | null> {
    if (!isFireId(id)) return null
    const source = await readFileText(fireFile(this.dataDir(), id))
    if (source === null) return null
    try {
      const raw: unknown = JSON.parse(source)
      if (!isRecord(raw)) return null
      const record = readFire(raw.record)
      if (record === null) return null
      const note = text(raw.note)
      const info = text(raw.info)
      return {
        record,
        ...(note === undefined ? {} : { note }),
        ...(info === undefined ? {} : { info }),
      }
    } catch {
      return null
    }
  }

  /** 这次触发建出了哪个实例：记进触发记录和它自己的文件。 */
  bind(id: string, instance: string): Promise<void> {
    return this.queued(async () => {
      const dataDir = this.dataDir()
      const fires = readFires(await readFileText(historyFile(dataDir)))
      const found = fires.find((fire) => fire.id === id)
      if (found !== undefined && found.instance !== instance) {
        found.instance = instance
        await writeFileAtomic(
          historyFile(dataDir),
          `${JSON.stringify({ format: 1, fires }, null, 2)}\n`,
        )
      }
      const detail = await this.detail(id)
      if (detail !== null && detail.record.instance !== instance) {
        detail.record.instance = instance
        await writeFileAtomic(fireFile(dataDir, id), `${JSON.stringify(detail, null, 2)}\n`)
      }
    })
  }

  /** 工作流改名：开关与设置跟着走。 */
  rename(from: string, to: string): Promise<void> {
    return this.update((locals) => {
      const group = locals[from]
      if (group === undefined) return
      delete locals[from]
      locals[to] = group
    })
  }
}
