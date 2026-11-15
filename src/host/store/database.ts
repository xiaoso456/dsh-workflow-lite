/**
 * dsh-workflow-lite — 插件共用的 SQLite 数据库：`<数据目录>/workflow-lite.db`。
 *
 * 用 Node 自带的 `node:sqlite`（同步接口，不加依赖；第一次用到时才加载）。表和索引由用它的功能自己声明
 * （{@link DatabasePart}），第一次 {@link PluginDatabase.use} 时按版本号建好、升好，各部分的版本记在 `schema_parts` 里。
 *
 * 同一个数据目录可能有几个 DSH 进程同时在用：开 WAL，别的进程正在写时等一会儿（`busy_timeout`）；
 * 要连着改几处的用 {@link PluginDatabase.transaction}（`BEGIN IMMEDIATE`，一开始就拿写锁）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/store/database
 */

import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

/** 数据库文件名（在数据目录下）。 */
export const DATABASE_FILE = 'workflow-lite.db'

/** 别的进程正在写时最多等多久（毫秒）。 */
const BUSY_MS = 5_000

/** 一个功能在数据库里的那部分：它的表、索引，以及怎么从旧版本升上来。 */
export interface DatabasePart {
  /** 在 `schema_parts` 里记版本用的名字；各部分不重。 */
  name: string
  version: number
  /** 从 `from`（0 = 还没建过）升到 {@link version}；在一个事务里跑，抛错就整个退回。 */
  migrate(db: DatabaseSync, from: number): void
}

export class PluginDatabase {
  private readonly file: () => string
  private db: DatabaseSync | null = null
  private closed = false
  private readonly ready = new Set<string>()

  /** @param file - 数据库文件的完整路径（第一次用到时才读）。 */
  constructor(file: () => string) {
    this.file = file
  }

  /** 拿到建好了 `part` 那些表的连接。 */
  use(part: DatabasePart): DatabaseSync {
    const db = this.open()
    if (!this.ready.has(part.name)) {
      this.transaction(() => {
        const row = db.prepare('SELECT version FROM schema_parts WHERE name = ?').get(part.name)
        const from = typeof row?.version === 'number' ? row.version : 0
        if (from === part.version) return
        part.migrate(db, from)
        db.prepare(
          'INSERT INTO schema_parts (name, version) VALUES (?, ?) ON CONFLICT (name) DO UPDATE SET version = excluded.version',
        ).run(part.name, part.version)
      })
      this.ready.add(part.name)
    }
    return db
  }

  /** 在一个写事务里做完 `work`；抛错就退回。不能嵌套。 */
  transaction<T>(work: () => T): T {
    const db = this.open()
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  /** 关掉连接；之后再用会报错（插件停下时调用）。 */
  close(): void {
    this.closed = true
    this.db?.close()
    this.db = null
    this.ready.clear()
  }

  private open(): DatabaseSync {
    if (this.closed) throw new Error('数据库已经关掉了')
    if (this.db !== null) return this.db
    const sqlite = process.getBuiltinModule('node:sqlite')
    if (sqlite === undefined) throw new Error('这个 Node 没有内置 SQLite（要 24.9 或更新）')
    const file = this.file()
    mkdirSync(dirname(file), { recursive: true })
    const db = new sqlite.DatabaseSync(file)
    try {
      db.exec(`PRAGMA busy_timeout = ${String(BUSY_MS)}`)
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA synchronous = NORMAL')
      db.exec(
        'CREATE TABLE IF NOT EXISTS schema_parts (name TEXT PRIMARY KEY, version INTEGER NOT NULL)',
      )
    } catch (error) {
      db.close()
      throw error
    }
    this.db = db
    return db
  }
}
