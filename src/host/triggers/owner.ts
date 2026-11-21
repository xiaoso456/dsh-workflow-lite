/**
 * dsh-workflow-lite — 谁负责触发：同一个数据目录下，到点触发、常驻的触发源只由一个 DSH 进程做。
 *
 * 负责权是插件数据库里的一行（进程号、这个进程自己的随机令牌、开始负责的时刻、最近一次报到的时刻）。
 * 抢、报到都是「比完再写」，在一个写事务里做完（`BEGIN IMMEDIATE`，几个进程的写互相排队），
 * 所以任何时刻最多一个进程认为是自己的：
 *
 * - 报到：每 {@link OWNER_BEAT_MS} 一次（对账一轮一轮跑得更勤，中间几轮用上一次的结论）。
 *   那一行还是自己的就更新报到时刻；不是了（被接手了）就回 `false`，调用方马上停下常驻的、不再触发。
 * - 接手：没有那一行、对方进程已经不在（崩了），或者对方超过 {@link OWNER_STALE_MS} 没报到（卡死了、进程号被别人复用了），
 *   就写上自己的。崩了的进程不用等超时，下一次报到就能接手。查进程在不在用 `process.kill(pid, 0)`，各系统都能用；
 *   数据目录在几台机器共用的网络盘上时进程号没意义，只能靠超时。
 * - 让出：正常退出时删掉自己那一行，别的进程下一次报到就接手。
 * - 真要触发前用 {@link OwnerLock.holds} 再看一眼：卡死后醒过来的进程，报到时刻已经过期，不会补发。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/owner
 */

import { randomBytes } from 'node:crypto'
import type { DatabasePart, PluginDatabase } from '../store/database.ts'

/** 多久报到一次（也是多久看一次负责的进程还在不在）。 */
export const OWNER_BEAT_MS = 15_000

/** 多久没报到就当对方卡死了。 */
export const OWNER_STALE_MS = 60_000

const OWNER_PART: DatabasePart = {
  name: 'trigger-owner',
  version: 1,
  migrate(db) {
    db.exec(`CREATE TABLE trigger_owner (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      pid INTEGER NOT NULL,
      token TEXT NOT NULL,
      since INTEGER NOT NULL,
      beat INTEGER NOT NULL
    )`)
  },
}

/** 负责权那一行。 */
interface OwnerRow {
  pid: number
  token: string
  since: number
  beat: number
}

/** 现在负责触发的进程。 */
export interface OwnerInfo {
  /** 是不是本进程。 */
  mine: boolean
  pid: number
  since: number
}

/** 进程还在不在（发 0 号信号探一下；没权限也说明它在）。 */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

export interface OwnerLockOptions {
  database: PluginDatabase
  now?: () => number
  pid?: number
  alive?: (pid: number) => boolean
}

export class OwnerLock {
  private readonly token = randomBytes(8).toString('hex')
  private readonly database: PluginDatabase
  private readonly now: () => number
  /** 本进程报到用的进程号。 */
  readonly pid: number
  private readonly alive: (pid: number) => boolean
  /** 上一次真去数据库报到的时刻和结论；没到 {@link OWNER_BEAT_MS} 就用它。 */
  private last: { at: number; mine: boolean } | undefined

  constructor(options: OwnerLockOptions) {
    this.database = options.database
    this.now = options.now ?? Date.now
    this.pid = options.pid ?? process.pid
    this.alive = options.alive ?? processAlive
  }

  /**
   * 报到：是自己的就更新报到时刻；没人负责（或对方不作数了）就接手。回 `true` 表示现在归本进程负责。
   * 离上一次真报到不到 {@link OWNER_BEAT_MS} 时直接回上一次的结论。
   */
  async beat(): Promise<boolean> {
    const now = this.now()
    if (this.last !== undefined && now - this.last.at < OWNER_BEAT_MS) return this.last.mine
    const mine = this.claim(now)
    this.last = { at: now, mine }
    return mine
  }

  /** 现在是不是本进程负责，而且报到没过期（真要触发前看一眼，现读数据库）。 */
  async holds(): Promise<boolean> {
    return (await this.current())?.mine === true
  }

  /** 现在是谁在负责；没有作数的那一行是 `undefined`。 */
  async current(): Promise<OwnerInfo | undefined> {
    const row = this.read()
    if (row === null || !this.live(row)) return undefined
    return { mine: row.token === this.token, pid: row.pid, since: row.since }
  }

  /** 退出时让出来：那一行还是自己的就删掉。 */
  async release(): Promise<void> {
    this.last = undefined
    this.database
      .use(OWNER_PART)
      .prepare('DELETE FROM trigger_owner WHERE id = 1 AND token = ?')
      .run(this.token)
  }

  /** 在一个写事务里比完再写：自己的就报到，没人作数就接手。 */
  private claim(now: number): boolean {
    const db = this.database.use(OWNER_PART)
    return this.database.transaction(() => {
      const row = this.read()
      if (row?.token === this.token) {
        db.prepare('UPDATE trigger_owner SET beat = ? WHERE id = 1').run(now)
        return true
      }
      if (row !== null && this.live(row)) return false
      db.prepare(
        `INSERT INTO trigger_owner (id, pid, token, since, beat) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET pid = excluded.pid, token = excluded.token,
           since = excluded.since, beat = excluded.beat`,
      ).run(this.pid, this.token, now, now)
      return true
    })
  }

  /** 那一行还作不作数：对方进程在，而且最近报到过。 */
  private live(row: OwnerRow): boolean {
    return this.alive(row.pid) && this.now() - row.beat <= OWNER_STALE_MS
  }

  private read(): OwnerRow | null {
    const row = this.database
      .use(OWNER_PART)
      .prepare('SELECT pid, token, since, beat FROM trigger_owner WHERE id = 1')
      .get()
    if (row === undefined) return null
    const { pid, token, since, beat } = row
    if (
      typeof pid !== 'number' ||
      typeof token !== 'string' ||
      typeof since !== 'number' ||
      typeof beat !== 'number'
    ) {
      return null
    }
    return { pid, token, since, beat }
  }
}
