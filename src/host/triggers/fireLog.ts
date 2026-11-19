/**
 * dsh-workflow-lite — 触发记录：插件数据库里的 `trigger_fires` 表（一次触发一行，连同那一刻的触发说明、触发条件、背景信息）。
 *
 * 每张卡片各记各的，互相不挤；工作流改名时跟着换名字，删掉时一起删。
 * 上一次没跑完、卡片设成排队时，这一次先记成「排队中」（`queued`），轮到了原地改成发出去或没发出去（`sent_at` 记轮到的时刻）；
 * 排着的另有一个只收这些行的索引，每一轮问「哪些卡片有排着的」只碰这几行。
 * 读的都按「工作流 + 卡片 + 时刻」走索引：「触发」页 5 秒一次的列表只取每张卡片最近一次，不读整张表；
 * 列记录时只读记录本身那几列，不带原文。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/fireLog
 */

import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import { readSessionAgent } from '../../shared/sessionChoice.ts'
import { FIRE_CHANNELS, isFireId } from '../../shared/trigger.ts'
import type { SessionAgent } from '../../shared/types.ts'
import type {
  FireOutcome,
  FireRecord,
  FireSettled,
  TriggerActivitySlot,
} from '../../shared/wire/trigger.ts'
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

/**
 * 表的样子。`seq` 是记下的先后（同一时刻的按它排）；`info_file` 是背景信息全文另存过文件；
 * `agent` 是新建了会话时设的预设、模型和没用上的那几项（JSON；第 5 版加的，从第 3、4 版升上来只改这一列，记录不丢）。
 */
const FIRES_PART: DatabasePart = {
  name: 'trigger_fires',
  version: 5,
  migrate(db, from) {
    if (from === 3 || from === 4) {
      db.exec('ALTER TABLE trigger_fires ADD COLUMN agent TEXT')
      // 第 4 版的开发中试过一列说明文字，换成了 `agent`。
      if (from === 4) db.exec('ALTER TABLE trigger_fires DROP COLUMN fallback')
      return
    }
    db.exec(`
      DROP TABLE IF EXISTS trigger_fires;
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
        agent TEXT,
        session TEXT,
        instance TEXT,
        joined INTEGER NOT NULL DEFAULT 0,
        declined TEXT,
        note TEXT,
        condition TEXT,
        info TEXT,
        merged INTEGER,
        info_file INTEGER NOT NULL DEFAULT 0,
        sent_at INTEGER
      );
      CREATE INDEX trigger_fires_card ON trigger_fires (workflow, node, at);
      CREATE INDEX trigger_fires_queued ON trigger_fires (workflow, node, at, seq) WHERE outcome = 'queued';
      CREATE INDEX trigger_fires_session ON trigger_fires (session, at);
      CREATE INDEX trigger_fires_instance ON trigger_fires (instance, at);
    `)
  },
}

/** 记录本身那几列（列记录时只读这些，不带原文）。 */
/** 一条记录写进去的那几列。 */
const COLUMNS =
  'id, workflow, node, name, channel, at, outcome, reason, agent, session, instance, joined, declined, sent_at'
/** 排着的在列表里露出背景信息的开头几个字（看得出排着的是哪一件事）。 */
const PREVIEW_CHARS = 160
/** 读一条记录：写进去的那几列，排着的再带上背景信息的开头。 */
const RECORD = `${COLUMNS}, CASE WHEN outcome = 'queued' THEN substr(info, 1, ${String(PREVIEW_CHARS)}) END AS preview`
const NEWEST = 'ORDER BY at DESC, seq DESC'
/** 发进会话的时刻：排过队的是轮到的时刻，没排过的就是触发时刻（认领实例按它算）。 */
const SENT_AT = 'COALESCE(sent_at, at)'

const OUTCOMES: readonly FireOutcome[] = ['sent', 'skipped', 'failed', 'queued']
const SETTLED: readonly FireSettled[] = ['sent', 'skipped', 'failed']

/** 一张卡片有几个排着的。 */
export interface QueuedCount {
  workflow: string
  node: string
  count: number
}

type Row = Record<string, SQLOutputValue>

const text = (value: SQLOutputValue | undefined): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined

const count = (value: SQLOutputValue | undefined): number =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : 0

/** `agent` 列：JSON，读不出来当没有。 */
function readAgent(value: SQLOutputValue | undefined): SessionAgent | undefined {
  const raw = text(value)
  if (raw === undefined) return undefined
  try {
    return readSessionAgent(JSON.parse(raw))
  } catch {
    return undefined
  }
}

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
  const agent = readAgent(row.agent)
  const session = text(row.session)
  const instance = text(row.instance)
  const declined = text(row.declined)
  const sentAt = count(row.sent_at)
  const preview = text(row.preview)
    ?.split('\n')
    .find((line) => line.trim() !== '')
    ?.trim()
  return {
    id,
    workflow,
    node,
    name,
    channel,
    at: count(row.at),
    outcome,
    ...(reason === undefined ? {} : { reason }),
    ...(agent === undefined ? {} : { agent }),
    ...(session === undefined ? {} : { session }),
    ...(instance === undefined ? {} : { instance }),
    ...(instance !== undefined && count(row.joined) === 1 ? { joined: true as const } : {}),
    ...(declined === undefined ? {} : { declined }),
    ...(sentAt > 0 ? { sentAt } : {}),
    ...(preview === undefined ? {} : { preview }),
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
        `INSERT INTO trigger_fires (${COLUMNS}, note, condition, info, merged, info_file)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        record.agent === undefined ? null : JSON.stringify(record.agent),
        record.session ?? null,
        record.instance ?? null,
        record.joined === true ? 1 : 0,
        record.declined ?? null,
        record.sentAt ?? null,
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

  /** 一张卡片最近一次失败的时刻（画布、工作流中心拿它和本机看到哪儿了比，亮不亮红点）。 */
  lastFailure(workflow: string, node: string): number | undefined {
    const row = this.db
      .prepare(
        `SELECT at FROM trigger_fires WHERE workflow = ? AND node = ? AND outcome = 'failed' ${NEWEST} LIMIT 1`,
      )
      .get(workflow, node) as { at?: unknown } | undefined
    return typeof row?.at === 'number' ? row.at : undefined
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

  /** `since` 之后（不含）这张卡片收下了几次：发出去的、排着的都算（排着的轮到时不再算一遍）。 */
  sentSince(workflow: string, node: string, since: number): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM trigger_fires
         WHERE workflow = ? AND node = ? AND at > ? AND outcome IN ('sent', 'queued')`,
      )
      .get(workflow, node, since)
    return count(row?.n)
  }

  // ── 排队 ───────────────────────────────────────────────────

  /** 有排着的那些卡片、各几个（只碰排着的那几行）。 */
  queuedCounts(): QueuedCount[] {
    return this.db
      .prepare(
        `SELECT workflow, node, COUNT(*) AS n FROM trigger_fires
         WHERE outcome = 'queued' GROUP BY workflow, node`,
      )
      .all()
      .map((row) => ({
        workflow: String(row.workflow),
        node: String(row.node),
        count: count(row.n),
      }))
  }

  /** 这张卡片排着几个。 */
  queuedCount(workflow: string, node: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM trigger_fires
         WHERE workflow = ? AND node = ? AND outcome = 'queued'`,
      )
      .get(workflow, node)
    return count(row?.n)
  }

  /** 这张卡片排着的，先来的在前。 */
  queued(workflow: string, node: string): FireRecord[] {
    return toRecords(
      this.db
        .prepare(
          `SELECT ${RECORD} FROM trigger_fires
           WHERE workflow = ? AND node = ? AND outcome = 'queued' ORDER BY at, seq`,
        )
        .all(workflow, node),
    )
  }

  /** 排着的这一次轮到了：原地改成发出去或没发出去，记下轮到的时刻；已经不是排着的（刚被取消）回 `false`。 */
  release(
    id: string,
    outcome: FireSettled,
    extra: { reason?: string; session?: string; agent?: SessionAgent },
    sentAt: number,
  ): boolean {
    const agent = extra.agent === undefined ? null : JSON.stringify(extra.agent)
    const result = this.db
      .prepare(
        `UPDATE trigger_fires SET outcome = ?, reason = ?, session = ?, agent = ?, sent_at = ?
         WHERE id = ? AND outcome = 'queued'`,
      )
      .run(outcome, extra.reason ?? null, extra.session ?? null, agent, sentAt, id)
    return Number(result.changes) > 0
  }

  /** 排着的这一次不再执行（取消了）：改成跳过；已经不是排着的回 `false`。 */
  cancel(id: string, reason: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE trigger_fires SET outcome = 'skipped', reason = ? WHERE id = ? AND outcome = 'queued'`,
      )
      .run(reason, id)
    return Number(result.changes) > 0
  }

  /** 这张卡片排着的都不再执行（关掉了、清空了、删掉了）：都改成跳过，回改了几个。 */
  drop(workflow: string, node: string, reason: string): number {
    const result = this.db
      .prepare(
        `UPDATE trigger_fires SET outcome = 'skipped', reason = ?
         WHERE workflow = ? AND node = ? AND outcome = 'queued'`,
      )
      .run(reason, workflow, node)
    return Number(result.changes)
  }

  /** 这个会话里、`since` 以来发进去了还没对上实例的最早一次（实例认领来源用）。 */
  unclaimed(workflow: string, session: string, since: number): FireRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT ${RECORD} FROM trigger_fires
         WHERE session = ? AND ${SENT_AT} >= ? AND workflow = ? AND outcome = 'sent'
           AND instance IS NULL
         ORDER BY ${SENT_AT}, seq LIMIT 1`,
      )
      .get(session, since, workflow)
    return row === undefined ? undefined : (toRecord(row) ?? undefined)
  }

  /** 记到这个实例上的触发（建出它的、接着它做的），从早到晚。 */
  ofInstance(instance: string): FireRecord[] {
    return toRecords(
      this.db
        .prepare(`SELECT ${RECORD} FROM trigger_fires WHERE instance = ? ORDER BY at, seq`)
        .all(instance),
    )
  }

  /**
   * 模型在实例 `instance` 里接着做：这个会话里 `since` 以来发进去、还没对上实例（也没被模型判断为不需要）的
   * 同一个工作流的触发，都记成接进了这个实例。
   */
  join(workflow: string, session: string, since: number, instance: string): void {
    this.db
      .prepare(
        `UPDATE trigger_fires SET instance = ?, joined = 1
         WHERE session = ? AND ${SENT_AT} >= ? AND workflow = ? AND outcome = 'sent'
           AND instance IS NULL AND declined IS NULL`,
      )
      .run(instance, session, since, workflow)
  }

  /** 这张卡片 `[since, until]` 里每 {@link SLOT_MS} 一格、每种结果各几次（没有的格子不给；排着的不数）。 */
  activity(workflow: string, node: string, since: number, until: number): TriggerActivitySlot[] {
    const slots: TriggerActivitySlot[] = []
    for (const row of this.db
      .prepare(
        `SELECT (at / ${String(SLOT_MS)}) * ${String(SLOT_MS)} AS slot, outcome, COUNT(*) AS n
         FROM trigger_fires WHERE workflow = ? AND node = ? AND at >= ? AND at <= ?
           AND outcome != 'queued'
         GROUP BY slot, outcome ORDER BY slot`,
      )
      .all(workflow, node, since, until)) {
      const outcome = SETTLED.find((candidate) => candidate === row.outcome)
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

  /** 这次触发建出了哪个实例（先前记成接进别的实例的，改记到新建的这个上）。 */
  bind(id: string, instance: string): void {
    this.db
      .prepare('UPDATE trigger_fires SET instance = ?, joined = 0 WHERE id = ?')
      .run(instance, id)
  }

  /** 模型按触发条件判断这次不需要执行：记下它给的原因。 */
  decline(id: string, reason: string): void {
    this.db.prepare('UPDATE trigger_fires SET declined = ? WHERE id = ?').run(reason, id)
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
