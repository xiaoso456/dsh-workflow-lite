/**
 * dsh-workflow-lite — 检查命令、监听程序最近的输出：插件数据库里的 `trigger_output*` 几张表。
 *
 * 一条（`trigger_output`）是检查的一次检查或监听程序的一次运行（启动到退出），输出按行另存（`trigger_output_lines`）：
 * - 检查：连着几次结果和输出都一模一样（触发了的除外）就合成一条，记下次数和最近那次的时刻；
 * - 运行：负责触发的进程攒一会儿成批写（{@link OutputLog.append}），连着一模一样的行只记一次加次数；
 * - 一行超过 {@link OUTPUT_LINE_MAX_CHARS} 字截断，记下原来多大；终端颜色去掉。
 *
 * 每张卡片最多留「最近的输出保留」那么多行（插件设置）：超了从最早的一条丢起，只剩最新一条时丢它最早的行；
 * 丢过就在 `trigger_output_cards` 里记一笔，界面据此说「更早的已丢弃」。没有输出的一条按一行算。
 * 列表只读摘要（{@link OutputLog.list}），点开一条才读它的行（{@link OutputLog.lines}）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/outputLog
 */

import { createHash } from 'node:crypto'
import type { DatabaseSync, SQLOutputValue } from 'node:sqlite'
import {
  OUTPUT_LINE_MAX_CHARS,
  type OutputEntry,
  type OutputFilter,
  type OutputLine,
  type OutputVerdict,
} from '../../shared/wire/trigger.ts'
import type { DatabasePart, PluginDatabase } from '../store/database.ts'

const OUTPUT_PART: DatabasePart = {
  name: 'trigger_output',
  version: 1,
  migrate(db) {
    db.exec(`
      CREATE TABLE trigger_output (
        seq INTEGER PRIMARY KEY,
        workflow TEXT NOT NULL,
        node TEXT NOT NULL,
        kind TEXT NOT NULL,
        at INTEGER NOT NULL,
        last_at INTEGER,
        end_at INTEGER,
        verdict TEXT NOT NULL,
        code INTEGER,
        note TEXT,
        ms INTEGER,
        lines INTEGER NOT NULL DEFAULT 0,
        count INTEGER NOT NULL DEFAULT 1,
        digest TEXT,
        preview TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX trigger_output_card ON trigger_output (workflow, node, seq);
      CREATE TABLE trigger_output_lines (
        seq INTEGER PRIMARY KEY,
        entry INTEGER NOT NULL,
        at INTEGER NOT NULL,
        stream TEXT NOT NULL,
        text TEXT NOT NULL,
        repeat INTEGER NOT NULL DEFAULT 1,
        size INTEGER
      );
      CREATE INDEX trigger_output_lines_entry ON trigger_output_lines (entry, seq);
      CREATE TABLE trigger_output_cards (
        workflow TEXT NOT NULL,
        node TEXT NOT NULL,
        dropped INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (workflow, node)
      );
    `)
  },
}

/** 一次检查交进来的样子。 */
export interface CheckInput {
  at: number
  verdict: 'met' | 'unmet' | 'fail'
  code: number | null
  note?: string
  ms: number
  /** 标准输出、错误输出（整段，这里切行）。 */
  out: string
  err: string
}

/** 监听程序打出的一行。 */
export interface LineInput {
  at: number
  stream: 'out' | 'err'
  text: string
}

/** 一次运行怎么结束的。 */
export interface RunEnd {
  at: number
  verdict: 'exited' | 'stopped' | 'fail'
  code: number | null
  note?: string
}

const VERDICTS: readonly OutputVerdict[] = ['met', 'unmet', 'fail', 'running', 'exited', 'stopped']
const SUMMARY = 'seq, kind, at, last_at, end_at, verdict, code, note, ms, lines, count, preview'

type Row = Record<string, SQLOutputValue>

const num = (value: SQLOutputValue | undefined): number | undefined =>
  typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : undefined

const count = (value: SQLOutputValue | undefined): number => num(value) ?? 0

/** 终端颜色、光标控制这类转义序列：CSI（`ESC [ … 终止字节`）、OSC（`ESC ] … BEL / ESC \`）和其余两字节的 `ESC x`。 */
const ANSI =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: 要去掉的正是这几个控制字符
  /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/gu

/** 去掉终端颜色、光标控制的转义序列。 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/** 一行存进去的样子：去掉终端颜色和行尾的 `\r`，太长截断（记下原来多少字节）。 */
export function storedLine(raw: string): { text: string; size?: number } {
  const plain = stripAnsi(raw).replace(/\r$/u, '')
  if (plain.length <= OUTPUT_LINE_MAX_CHARS) return { text: plain }
  return { text: plain.slice(0, OUTPUT_LINE_MAX_CHARS), size: Buffer.byteLength(raw) }
}

/** 一段输出切成行：尾部的空行不要，中间的留着。 */
function splitLines(text: string): string[] {
  const trimmed = text.replace(/\s+$/u, '')
  return trimmed === '' ? [] : trimmed.split(/\r?\n/u)
}

function toEntry(row: Row): OutputEntry | null {
  const verdict = VERDICTS.find((candidate) => candidate === row.verdict)
  const kind = row.kind === 'check' || row.kind === 'run' ? row.kind : undefined
  const id = num(row.seq)
  if (verdict === undefined || kind === undefined || id === undefined) return null
  const last = num(row.last_at)
  const end = num(row.end_at)
  const ms = num(row.ms)
  const merged = count(row.count)
  const note = typeof row.note === 'string' && row.note !== '' ? row.note : undefined
  return {
    id,
    kind,
    at: count(row.at),
    ...(last === undefined ? {} : { last }),
    ...(end === undefined ? {} : { end }),
    verdict,
    code: num(row.code) ?? null,
    ...(note === undefined ? {} : { note }),
    ...(ms === undefined ? {} : { ms }),
    lines: count(row.lines),
    ...(merged > 1 ? { count: merged } : {}),
    preview: typeof row.preview === 'string' ? row.preview : '',
  }
}

function toLine(row: Row): OutputLine {
  const repeat = count(row.repeat)
  const size = num(row.size)
  return {
    at: count(row.at),
    stream: row.stream === 'err' ? 'err' : 'out',
    text: typeof row.text === 'string' ? row.text : '',
    ...(repeat > 1 ? { repeat } : {}),
    ...(size === undefined ? {} : { size }),
  }
}

export class OutputLog {
  private readonly database: PluginDatabase

  constructor(database: PluginDatabase) {
    this.database = database
  }

  private get db(): DatabaseSync {
    return this.database.use(OUTPUT_PART)
  }

  /** 记一次检查：和这张卡片上一条一模一样（又不是触发）就并进去；然后按 `keep` 行丢旧的。 */
  check(workflow: string, node: string, input: CheckInput, keep: number): void {
    const db = this.db
    const out = splitLines(input.out).map((text) => ({
      stream: 'out' as const,
      ...storedLine(text),
    }))
    const err = splitLines(input.err).map((text) => ({
      stream: 'err' as const,
      ...storedLine(text),
    }))
    const lines = [...out, ...err].slice(-Math.max(1, keep))
    const digest = createHash('sha256')
      .update(JSON.stringify([input.verdict, input.code, input.note ?? '', lines]))
      .digest('hex')
    this.database.transaction(() => {
      const newest = db
        .prepare(
          'SELECT seq, kind, digest FROM trigger_output WHERE workflow = ? AND node = ? ORDER BY seq DESC LIMIT 1',
        )
        .get(workflow, node)
      if (input.verdict !== 'met' && newest?.kind === 'check' && newest.digest === digest) {
        db.prepare(
          'UPDATE trigger_output SET count = count + 1, last_at = ?, ms = ? WHERE seq = ?',
        ).run(input.at, input.ms, count(newest.seq))
        return
      }
      const preview = lines.find((line) => line.text.trim() !== '')?.text ?? ''
      const inserted = db
        .prepare(
          `INSERT INTO trigger_output (workflow, node, kind, at, verdict, code, note, ms, lines, digest, preview)
           VALUES (?, ?, 'check', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          workflow,
          node,
          input.at,
          input.verdict,
          input.code,
          input.note ?? null,
          input.ms,
          lines.length,
          digest,
          preview,
        )
      const entry = Number(inserted.lastInsertRowid)
      const insert = db.prepare(
        'INSERT INTO trigger_output_lines (entry, at, stream, text, size) VALUES (?, ?, ?, ?, ?)',
      )
      for (const line of lines)
        insert.run(entry, input.at, line.stream, line.text, line.size ?? null)
      this.trim(db, workflow, node, keep)
    })
  }

  /**
   * 程序起来了：开一条新的运行，回它的编号。
   * 这张卡片还有标着「在跑」的旧运行（上一个负责的进程没来得及收尾）就当作被停下，停在它最后一行的时刻。
   */
  runStart(workflow: string, node: string, at: number): number {
    const db = this.db
    return this.database.transaction(() => {
      db.prepare(
        `UPDATE trigger_output SET verdict = 'stopped',
           end_at = COALESCE((SELECT MAX(l.at) FROM trigger_output_lines l WHERE l.entry = trigger_output.seq), at)
         WHERE workflow = ? AND node = ? AND verdict = 'running'`,
      ).run(workflow, node)
      const inserted = db
        .prepare(
          `INSERT INTO trigger_output (workflow, node, kind, at, verdict) VALUES (?, ?, 'run', ?, 'running')`,
        )
        .run(workflow, node, at)
      return Number(inserted.lastInsertRowid)
    })
  }

  /** 给一次运行添上一批行：连着一模一样的只加次数；然后按 `keep` 行丢旧的。这条已经被清掉了就不记。 */
  append(entry: number, batch: readonly LineInput[], keep: number): void {
    if (batch.length === 0) return
    const db = this.db
    this.database.transaction(() => {
      const owner = db.prepare('SELECT workflow, node FROM trigger_output WHERE seq = ?').get(entry)
      if (owner === undefined) return
      let last = db
        .prepare(
          'SELECT seq, stream, text FROM trigger_output_lines WHERE entry = ? ORDER BY seq DESC LIMIT 1',
        )
        .get(entry)
      const insert = db.prepare(
        'INSERT INTO trigger_output_lines (entry, at, stream, text, size) VALUES (?, ?, ?, ?, ?)',
      )
      const bump = db.prepare('UPDATE trigger_output_lines SET repeat = repeat + 1 WHERE seq = ?')
      let added = 0
      let preview: string | undefined
      for (const line of batch) {
        const stored = storedLine(line.text)
        if (stored.text.trim() !== '') preview = stored.text
        if (last !== undefined && last.stream === line.stream && last.text === stored.text) {
          bump.run(count(last.seq))
          continue
        }
        const inserted = insert.run(entry, line.at, line.stream, stored.text, stored.size ?? null)
        last = { seq: Number(inserted.lastInsertRowid), stream: line.stream, text: stored.text }
        added += 1
      }
      db.prepare(
        'UPDATE trigger_output SET lines = lines + ?, preview = COALESCE(?, preview) WHERE seq = ?',
      ).run(added, preview ?? null, entry)
      this.trim(db, String(owner.workflow), String(owner.node), keep)
    })
  }

  /** 一次运行结束了（自己退出、被停下、没跑起来）。 */
  runEnd(entry: number, end: RunEnd): void {
    this.db
      .prepare(
        `UPDATE trigger_output SET verdict = ?, end_at = ?, code = ?, note = ?
         WHERE seq = ? AND verdict = 'running'`,
      )
      .run(end.verdict, end.at, end.code, end.note ?? null, entry)
  }

  /** 一张卡片的摘要：按筛选最多 `limit` 条，新的在前。 */
  list(
    workflow: string,
    node: string,
    filter: OutputFilter,
    limit: number,
  ): {
    entries: OutputEntry[]
    counts: Record<OutputFilter, number>
    more: boolean
    dropped: boolean
  } {
    const db = this.db
    const where = filter === 'all' ? '' : 'AND verdict = ?'
    const args: (string | number)[] = [
      workflow,
      node,
      ...(filter === 'all' ? [] : [filter]),
      limit + 1,
    ]
    const rows = db
      .prepare(
        `SELECT ${SUMMARY} FROM trigger_output WHERE workflow = ? AND node = ? ${where} ORDER BY seq DESC LIMIT ?`,
      )
      .all(...args)
    const entries = rows
      .slice(0, limit)
      .map(toEntry)
      .filter((entry): entry is OutputEntry => entry !== null)
    const counts: Record<OutputFilter, number> = { all: 0, met: 0, fail: 0 }
    for (const row of db
      .prepare(
        'SELECT verdict, SUM(count) AS n FROM trigger_output WHERE workflow = ? AND node = ? GROUP BY verdict',
      )
      .all(workflow, node)) {
      const n = count(row.n)
      counts.all += n
      if (row.verdict === 'met') counts.met += n
      if (row.verdict === 'fail') counts.fail += n
    }
    const card = db
      .prepare('SELECT dropped FROM trigger_output_cards WHERE workflow = ? AND node = ?')
      .get(workflow, node)
    return { entries, counts, more: rows.length > limit, dropped: count(card?.dropped) === 1 }
  }

  /** 几条的输出（只给这张卡片的）；`tail` 给了就每条只要最后几行。 */
  lines(
    workflow: string,
    node: string,
    ids: readonly number[],
    tail?: number,
  ): { id: number; total: number; lines: OutputLine[] }[] {
    const db = this.db
    const head = db.prepare(
      'SELECT lines FROM trigger_output WHERE seq = ? AND workflow = ? AND node = ?',
    )
    const all = db.prepare(
      'SELECT at, stream, text, repeat, size FROM trigger_output_lines WHERE entry = ? ORDER BY seq',
    )
    const last = db.prepare(
      'SELECT at, stream, text, repeat, size FROM trigger_output_lines WHERE entry = ? ORDER BY seq DESC LIMIT ?',
    )
    const result: { id: number; total: number; lines: OutputLine[] }[] = []
    for (const id of ids) {
      const row = head.get(id, workflow, node)
      if (row === undefined) continue
      const rows = tail === undefined ? all.all(id) : last.all(id, tail).reverse()
      result.push({ id, total: count(row.lines), lines: rows.map(toLine) })
    }
    return result
  }

  /** 清空一张卡片的输出；正在跑的那次留着（只清掉它已有的行），接着往里记。 */
  clear(workflow: string, node: string): void {
    const db = this.db
    this.database.transaction(() => {
      db.prepare(
        `DELETE FROM trigger_output_lines WHERE entry IN
           (SELECT seq FROM trigger_output WHERE workflow = ? AND node = ?)`,
      ).run(workflow, node)
      db.prepare(
        `DELETE FROM trigger_output WHERE workflow = ? AND node = ? AND verdict <> 'running'`,
      ).run(workflow, node)
      db.prepare(
        `UPDATE trigger_output SET lines = 0, preview = '' WHERE workflow = ? AND node = ?`,
      ).run(workflow, node)
      db.prepare('DELETE FROM trigger_output_cards WHERE workflow = ? AND node = ?').run(
        workflow,
        node,
      )
    })
  }

  /** 工作流删掉了：它的输出一起删。 */
  forget(workflow: string): void {
    const db = this.db
    this.database.transaction(() => {
      db.prepare(
        'DELETE FROM trigger_output_lines WHERE entry IN (SELECT seq FROM trigger_output WHERE workflow = ?)',
      ).run(workflow)
      db.prepare('DELETE FROM trigger_output WHERE workflow = ?').run(workflow)
      db.prepare('DELETE FROM trigger_output_cards WHERE workflow = ?').run(workflow)
    })
  }

  /** 超过 `keep` 行（没有输出的一条按一行算）：从最早的一条丢起；只剩最新一条时丢它最早的行。在事务里调用。 */
  private trim(db: DatabaseSync, workflow: string, node: string, keep: number): void {
    const weight = db
      .prepare(
        'SELECT SUM(MAX(lines, 1)) AS n, MAX(seq) AS newest FROM trigger_output WHERE workflow = ? AND node = ?',
      )
      .get(workflow, node)
    let total = count(weight?.n)
    if (total <= keep) return
    const newest = count(weight?.newest)
    const dropLines = db.prepare('DELETE FROM trigger_output_lines WHERE entry = ?')
    const dropEntry = db.prepare('DELETE FROM trigger_output WHERE seq = ?')
    for (const row of db
      .prepare('SELECT seq, lines FROM trigger_output WHERE workflow = ? AND node = ? ORDER BY seq')
      .all(workflow, node)) {
      if (total <= keep) break
      const seq = count(row.seq)
      const lines = count(row.lines)
      if (seq === newest) {
        const over = Math.min(total - keep, lines)
        db.prepare(
          `DELETE FROM trigger_output_lines WHERE seq IN
             (SELECT seq FROM trigger_output_lines WHERE entry = ? ORDER BY seq LIMIT ?)`,
        ).run(seq, over)
        db.prepare('UPDATE trigger_output SET lines = lines - ? WHERE seq = ?').run(over, seq)
        break
      }
      dropLines.run(seq)
      dropEntry.run(seq)
      total -= Math.max(lines, 1)
    }
    db.prepare(
      `INSERT INTO trigger_output_cards (workflow, node, dropped) VALUES (?, ?, 1)
       ON CONFLICT (workflow, node) DO UPDATE SET dropped = 1`,
    ).run(workflow, node)
  }
}
