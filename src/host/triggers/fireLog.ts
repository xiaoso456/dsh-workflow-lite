/**
 * dsh-workflow-lite — 触发记录：插件数据库里的 `trigger_fires` 表（一次触发一行，连同那一刻的触发说明、触发条件、背景信息）。
 *
 * 每张卡片各记各的，互相不挤；工作流改名时跟着换名字，删掉时一起删。
 * 读的都按「工作流 + 卡片 + 时刻」走索引：「触发」页 5 秒一次的列表只取每张卡片最近一次，不读整张表；
 * 列记录时只读记录本身那几列，不带原文。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/fireLog
 */

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { FIRE_CHANNELS, isFireId } from '../../shared/trigger.ts'
import type { FireOutcome, FireRecord, TriggerActivitySlot } from '../../shared/wire/trigger.ts'
import type { DatabasePart, PluginDatabase } from '../store/database.ts'

/** 近况按多长一格计数（15 分钟：各时区的整点、半点都落在格子边上）。 */
export const SLOT_MS = 15 * 60_000

/** 一次触发的全部：记录 + 那一刻的触发说明、触发条件与背景信息。 */
export interface FireDetail {
  record: FireRecord
  note?: string
  condition?: string
  info?: string
  /** 合并窗口里并进来了几次（多于一次才写）。 */
  merged?: number
}

/** 表的样子。`seq` 是记下的先后（同一时刻的按它排）；`info_file` 是背景信息全文另存过文件。 */
const FIRES_PART: DatabasePart = {
  name: 'trigger_fires',
  version: 1,
  migrate(db) {
    db.exec(`
      CREATE TABLE trigger_fires (
        seq INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        workflow TEXT NOT NULL,
        node TEXT NOT NULL,
        name TEXT NOT NULL,
        channel TEXT NOT NULL,
        at INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        reason TEXT,
        session TEXT,
        instance TEXT,
        declined TEXT,
        note TEXT,
        condition TEXT,
        info TEXT,
        merged INTEGER,
        info_file INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX trigger_fires_card ON trigger_fires (workflow, node, at);
      CREATE INDEX trigger_fires_session ON trigger_fires (session, at);
    `)
  },
}

/** 记录本身那几列（列记录时只读这些，不带原文）。 */
const RECORD = 'id, workflow, node, name, channel, at, outcome, reason, session, instance, declined'
const NEWEST = 'ORDER BY at DESC, seq DESC'

const OUTCOMES: readonly FireOutcome[] = ['sent', 'skipped', 'failed']

type Row = Record<string, SQLOutputValue>

const text = (value: SQLOutputValue | undefined): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const count = (value: SQLOutputValue | undefined): number =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0

/** 一行 → 记录；别的版本写进来的认不出的渠道、结果不要。 */
function toRecord(row: Row): FireRecord | null {
  const channel = FIRE_CHANNELS.find((candidate) => candidate === row.channel)
  const outcome = OUTCOMES.find((candidate) => candidate === row.outcome)
  const { id, workflow, node, name } = row
  if (
    channel === undefined ||
    outcome === undefined ||
    typeof id !== 'string' ||
    typeof workflow !== 'string' ||
    typeof node !== 'string' ||
    typeof name !== 'string'
  ) {
    return null
  }
  const reason = text(row.reason)
  const session = text(row.session)
  const instance = text(row.instance)
  const declined = text(row.declined)
  return {
    id,
    workflow,
    node,
    name,
    channel,
    at: count(row.at),
    outcome,
    ...(reason === undefined ? {} : { reason }),
    ...(session === undefined ? {} : { session }),
    ...(instance === undefined ? {} : { instance }),
    ...(declined === undefined ? {} : { declined }),
  }
}

function toRecords(rows: Row[]): FireRecord[] {
  return rows.map(toRecord).filter((record): record is FireRecord => record !== null)
}

export class FireLog {
  private readonly database: PluginDatabase

  constructor(database: PluginDatabase) {
    this.database = database
  }

  private get db(): DatabaseSync {
    return this.database.use(FIRES_PART)
  }

  /** @param infoFile - 背景信息全文另存了文件（删记录时一起删）。 */
  record(detail: FireDetail, infoFile: boolean): void {
    const { record } = detail
    this.db
      .prepare(
        `INSERT INTO trigger_fires (${RECORD}, note, condition, info, merged, info_file)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.workflow,
        record.node,
        record.name,
        record.channel,
        record.at,
        record.outcome,
        record.reason ?? null,
        record.session ?? null,
        record.instance ?? null,
        record.declined ?? null,
        detail.note ?? null,
        detail.condition ?? null,
        detail.info ?? null,
        detail.merged ?? null,
        infoFile ? 1 : 0,
      )
  }

  /** 一张卡片最近一次触发。 */
  last(workflow: string, node: string): FireRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT ${RECORD} FROM trigger_fires WHERE workflow = ? AND node = ? ${NEWEST} LIMIT 1`,
      )
      .get(workflow, node)
    return row === undefined ? undefined : (toRecord(row) ?? undefined)
  }

  /** 最近 `limit` 次，新的在前；不给卡片就是这个工作流所有卡片的。 */
  recent(workflow: string, node: string | undefined, limit: number): FireRecord[] {
    return toRecords(
      node === undefined
        ? this.db
            .prepare(`SELECT ${RECORD} FROM trigger_fires WHERE workflow = ? ${NEWEST} LIMIT ?`)
            .all(workflow, limit)
        : this.db
            .prepare(
              `SELECT ${RECORD} FROM trigger_fires WHERE workflow = ? AND node = ? ${NEWEST} LIMIT ?`,
            )
            .all(workflow, node, limit),
    )
  }

  /** `since` 之后（不含）这张卡片发出去了几次。 */
  sentSince(workflow: string, node: string, since: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM trigger_fires
         WHERE workflow = ? AND node = ? AND at > ? AND outcome = 'sent'`,
      )
      .get(workflow, node, since)
    return count(row?.n)
  }

  /** 这个会话里、`since` 以来发进去了还没对上实例的最早一次（实例认领来源用）。 */
  unclaimed(workflow: string, session: string, since: number): FireRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT ${RECORD} FROM trigger_fires
         WHERE session = ? AND at >= ? AND workflow = ? AND outcome = 'sent' AND instance IS NULL
         ORDER BY at, seq LIMIT 1`,
      )
      .get(session, since, workflow)
    return row === undefined ? undefined : (toRecord(row) ?? undefined)
  }

  /** 这张卡片 `[since, until]` 里每 {@link SLOT_MS} 一格、每种结果各几次（没有的格子不给）。 */
  activity(workflow: string, node: string, since: number, until: number): TriggerActivitySlot[] {
    const slots: TriggerActivitySlot[] = []
    for (const row of this.db
      .prepare(
        `SELECT (at / ${String(SLOT_MS)}) * ${String(SLOT_MS)} AS slot, outcome, COUNT(*) AS n
         FROM trigger_fires WHERE workflow = ? AND node = ? AND at >= ? AND at <= ?
         GROUP BY slot, outcome ORDER BY slot`,
      )
      .all(workflow, node, since, until)) {
      const outcome = OUTCOMES.find((candidate) => candidate === row.outcome)
      if (outcome !== undefined) slots.push({ at: count(row.slot), outcome, count: count(row.n) })
    }
    return slots
  }

  /** 一次触发的全部；编号不对、不在是 `null`。 */
  detail(id: string): FireDetail | null {
    if (!isFireId(id)) return null
    const row = this.db
      .prepare(`SELECT ${RECORD}, note, condition, info, merged FROM trigger_fires WHERE id = ?`)
      .get(id)
    if (row === undefined) return null
    const record = toRecord(row)
    if (record === null) return null
    const note = text(row.note)
    const condition = text(row.condition)
    const info = text(row.info)
    const merged = count(row.merged)
    return {
      record,
      ...(note === undefined ? {} : { note }),
      ...(condition === undefined ? {} : { condition }),
      ...(info === undefined ? {} : { info }),
      ...(merged < 2 ? {} : { merged }),
    }
  }

  /** 给一条记录补上后来才知道的事：建出的实例、模型判断不需要的原因。 */
  amend(id: string, patch: Pick<FireRecord, 'instance' | 'declined'>): void {
    this.db
      .prepare(
        `UPDATE trigger_fires SET instance = COALESCE(?, instance), declined = COALESCE(?, declined)
         WHERE id = ?`,
      )
      .run(patch.instance ?? null, patch.declined ?? null, id)
  }

  /** 工作流改名：它的触发记录跟着换名字。 */
  rename(from: string, to: string): void {
    this.db.prepare('UPDATE trigger_fires SET workflow = ? WHERE workflow = ?').run(to, from)
  }

  /**
   * 工作流删掉了：它的触发记录一起删。
   * @returns 另存过背景信息全文的那些触发编号（由调用方删文件）。
   */
  forget(workflow: string): string[] {
    const db = this.db
    return this.database.transaction(() => {
      const files = db
        .prepare('SELECT id FROM trigger_fires WHERE workflow = ? AND info_file = 1')
        .all(workflow)
      db.prepare('DELETE FROM trigger_fires WHERE workflow = ?').run(workflow)
      return files.map((row) => String(row.id))
    })
  }
}
