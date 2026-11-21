/**
 * dsh-workflow-lite — 触发器的运行记录：插件数据库里，这台机器上的事，不随工作流导出。
 *
 * 卡片的配置（开关、工作区、shell、固定会话、HTTP 地址和令牌）都在图里；这里只记跑起来之后的：
 * - 每张卡片一行（{@link TriggerRun}）：从什么时候开始跑、下一次的时刻、连续失败、自动停用、
 *   定时检查上一次的结果、接续已经看过的实例、上一次的会话和触发编号、最近一次试的时刻；
 * - 负责的进程写下的运行情况（{@link LiveFile}）、「全部暂停」从什么时候起，各一行。
 *
 * 同一个数据目录可能有几个 DSH 进程在用，改一律在一个写事务里现读现改现写，不在内存里留副本。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/runRecords
 */

import type { DatabasePart, PluginDatabase } from '../store/database.ts'
import type { HookPortState } from './hooks.ts'
import type { Probe } from './poller.ts'

/** 一张触发卡片跑起来之后的记录。 */
export interface TriggerRun {
  /** 这一回开始跑的时刻（开关打开、定时规则改了重新算起）：「每隔多久」从这里数；关着的没有。 */
  since?: number
  /** 下一次触发的时刻，由负责触发的进程算出来写下。 */
  due?: number
  /** 算 `due` 时用的定时规则；和图里的对不上就重新算。 */
  rule?: string
  /** 上一次发进去的会话（「接着上一次的会话」用）。 */
  lastSession?: string
  /** 上一次发出去的那次触发的编号（跳过、排队看它跑完没有，见 `runEnd.ts`）。 */
  lastFire?: string
  /** 用户点了「视为已结束」的那一次触发的编号（当它已经结束）。 */
  waived?: string
  /** 连续没发出去的次数。 */
  failures?: number
  /** 被自动停用时的原因：图里的开关不动，停用期间不跑；用户再打开时清掉。 */
  stopped?: string
  /** 定时检查：上一次检查的结果。 */
  probe?: Probe
  /** 接续触发：那个工作流里已经处理过（触发过或判过不用触发）的、已结束的实例。 */
  seen?: string[]
  /** 模型上一次 `test_trigger` 的时刻：之后改过 `triggers/` 里的脚本就提醒它再试（见 `scriptAge.ts`）。 */
  tested?: number
}

/** 工作流名 → 卡片 id → 运行记录。 */
export type TriggerRuns = Record<string, Record<string, TriggerRun>>

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

/** 负责的进程写下的运行情况：写它的进程、各卡片的、HTTP 端口。 */
export interface LiveFile {
  pid: number
  sources: Record<string, Record<string, LiveStatus>>
  port?: HookPortState
}

const RUNS_PART: DatabasePart = {
  name: 'trigger-runs',
  version: 1,
  migrate(db) {
    db.exec(`CREATE TABLE trigger_runs (
      workflow TEXT NOT NULL,
      node TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (workflow, node)
    )`)
    db.exec(`CREATE TABLE trigger_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`)
  },
}

/** `trigger_state` 里的两行。 */
const LIVE_KEY = 'live'
const PAUSED_KEY = 'paused'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const whole = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

function parse(source: string): unknown {
  try {
    return JSON.parse(source)
  } catch {
    return undefined
  }
}

/** 读一行运行记录：认得的字段留下，空的去掉。 */
export function readRun(raw: unknown): TriggerRun {
  if (!isRecord(raw)) return {}
  const run: TriggerRun = {}
  for (const key of ['since', 'due', 'tested'] as const) {
    const value = whole(raw[key])
    if (value !== undefined) run[key] = value
  }
  for (const key of ['rule', 'lastSession', 'lastFire', 'waived', 'stopped'] as const) {
    const value = text(raw[key])
    if (value !== undefined) run[key] = value
  }
  const failures = whole(raw.failures)
  if (failures !== undefined && failures > 0) run.failures = failures
  if (isRecord(raw.probe)) {
    const probe: Probe = {}
    if (typeof raw.probe.ok === 'boolean') probe.ok = raw.probe.ok
    const digest = text(raw.probe.digest)
    if (digest !== undefined) probe.digest = digest
    if (Object.keys(probe).length > 0) run.probe = probe
  }
  if (Array.isArray(raw.seen)) {
    const seen = raw.seen.filter((id): id is string => typeof id === 'string' && id !== '')
    if (seen.length > 0) run.seen = seen
  }
  return run
}

/** 键按固定顺序排好的 JSON：内容一样写出来就一样（比较有没有改用）。 */
function encode(run: TriggerRun): string {
  return JSON.stringify(readRun(run))
}

export class RunRecords {
  private readonly database: PluginDatabase

  constructor(database: PluginDatabase) {
    this.database = database
  }

  private db() {
    return this.database.use(RUNS_PART)
  }

  /** 全部卡片的运行记录。 */
  all(): TriggerRuns {
    const runs: TriggerRuns = {}
    for (const row of this.db().prepare('SELECT workflow, node, data FROM trigger_runs').all()) {
      const { workflow, node, data } = row
      if (typeof workflow !== 'string' || typeof node !== 'string' || typeof data !== 'string') {
        continue
      }
      const group = runs[workflow] ?? {}
      group[node] = readRun(parse(data))
      runs[workflow] = group
    }
    return runs
  }

  /** 一张卡片的；没有记录是空的。 */
  get(workflow: string, node: string): TriggerRun {
    const row = this.db()
      .prepare('SELECT data FROM trigger_runs WHERE workflow = ? AND node = ?')
      .get(workflow, node)
    return typeof row?.data === 'string' ? readRun(parse(row.data)) : {}
  }

  /**
   * 读 → 改 → 写回，在一个写事务里。`change` 拿到全部记录，可以改、加、删；
   * 只写真变了的行，改完是空的记录删掉。
   */
  update<T>(change: (runs: TriggerRuns) => T): T {
    const db = this.db()
    return this.database.transaction(() => {
      const before = this.all()
      const runs = structuredClone(before)
      const result = change(runs)
      const upsert = db.prepare(
        `INSERT INTO trigger_runs (workflow, node, data) VALUES (?, ?, ?)
         ON CONFLICT (workflow, node) DO UPDATE SET data = excluded.data`,
      )
      const remove = db.prepare('DELETE FROM trigger_runs WHERE workflow = ? AND node = ?')
      for (const [workflow, group] of Object.entries(before)) {
        for (const node of Object.keys(group)) {
          const now = runs[workflow]?.[node]
          if (now === undefined || Object.keys(readRun(now)).length === 0) {
            remove.run(workflow, node)
          }
        }
      }
      for (const [workflow, group] of Object.entries(runs)) {
        for (const [node, run] of Object.entries(group)) {
          const data = encode(run)
          if (data === '{}') continue
          const old = before[workflow]?.[node]
          if (old !== undefined && encode(old) === data) continue
          upsert.run(workflow, node, data)
        }
      }
      return result
    })
  }

  /** 改一张卡片的（没有就从空的起）。 */
  updateOne<T>(workflow: string, node: string, change: (run: TriggerRun) => T): T {
    return this.update((runs) => {
      const group = runs[workflow] ?? {}
      const run = group[node] ?? {}
      const result = change(run)
      group[node] = run
      runs[workflow] = group
      return result
    })
  }

  /** 工作流改名：它的记录跟着走。 */
  rename(from: string, to: string): void {
    this.db().prepare('UPDATE trigger_runs SET workflow = ? WHERE workflow = ?').run(to, from)
  }

  /** 工作流删掉了：它的记录都删掉。 */
  forget(workflow: string): void {
    this.db().prepare('DELETE FROM trigger_runs WHERE workflow = ?').run(workflow)
  }

  // ── 运行情况、全部暂停 ─────────────────────────────────────

  private state(key: string): unknown {
    const row = this.db().prepare('SELECT value FROM trigger_state WHERE key = ?').get(key)
    return typeof row?.value === 'string' ? parse(row.value) : undefined
  }

  private setState(key: string, value: unknown): void {
    this.db()
      .prepare(
        `INSERT INTO trigger_state (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value))
  }

  live(): LiveFile | null {
    const raw = this.state(LIVE_KEY)
    if (!isRecord(raw) || typeof raw.pid !== 'number' || !isRecord(raw.sources)) return null
    return raw as unknown as LiveFile
  }

  writeLive(file: LiveFile): void {
    this.setState(LIVE_KEY, file)
  }

  /** 暂停着时是开始暂停的时刻；没暂停是 `undefined`。 */
  paused(): number | undefined {
    const raw = this.state(PAUSED_KEY)
    if (raw === undefined) return undefined
    return isRecord(raw) ? (whole(raw.since) ?? 0) : 0
  }

  /** 暂停（给开始的时刻；已经暂停着不动）或恢复（`null`）。 */
  setPaused(since: number | null): void {
    const db = this.db()
    if (since === null) {
      db.prepare('DELETE FROM trigger_state WHERE key = ?').run(PAUSED_KEY)
      return
    }
    this.database.transaction(() => {
      if (this.state(PAUSED_KEY) === undefined) this.setState(PAUSED_KEY, { since })
    })
  }
}
