/**
 * dsh-workflow-lite — 谁负责触发：同一个数据目录下，到点触发只由一个 DSH 进程做。
 *
 * 靠一个标记文件 `triggers/owner.json`（进程号、这个进程自己的随机令牌、开始负责的时刻、最近一次报到的时刻）：
 * 负责的进程每隔几秒报到一次。别的进程看到标记不在（对方正常退出时删掉）、对方进程已经不在（崩了）、
 * 或者标记太久没更新（卡死了）就接手。原来负责的那个发现标记不是自己的了，就让出来。
 *
 * 接手分两拍：这一拍写下自己的标记，下一拍读回来还是自己的才算数。两个进程同时抢时，
 * 后写的那个赢，先写的那个下一拍读到别人的标记就退出，不会两边一起触发。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/owner
 */

import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { ensureDir, readFileText, unlinkFile, writeFileAtomic } from '../store/atomic.ts'

/** 标记多久没更新就当对方卡死了。 */
export const OWNER_STALE_MS = 60_000

/** 标记文件的内容。 */
interface OwnerMark {
  pid: number
  token: string
  /** 开始负责的时刻。 */
  since: number
  /** 最近一次报到的时刻。 */
  beat: number
}

/** 现在负责触发的进程。 */
export interface OwnerInfo {
  /** 是不是本进程。 */
  mine: boolean
  pid: number
  since: number
}

function readMark(source: string | null): OwnerMark | null {
  if (source === null) return null
  try {
    const raw: unknown = JSON.parse(source)
    if (typeof raw !== 'object' || raw === null) return null
    const { pid, token, since, beat } = raw as Record<string, unknown>
    if (
      typeof pid !== 'number' ||
      typeof token !== 'string' ||
      typeof since !== 'number' ||
      typeof beat !== 'number'
    ) {
      return null
    }
    return { pid, token, since, beat }
  } catch {
    return null
  }
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
  /** 标记文件的位置。 */
  file: () => string
  now?: () => number
  pid?: number
  alive?: (pid: number) => boolean
}

export class OwnerLock {
  private readonly token = randomBytes(8).toString('hex')
  private readonly file: () => string
  private readonly now: () => number
  private readonly pid: number
  private readonly alive: (pid: number) => boolean

  constructor(options: OwnerLockOptions) {
    this.file = options.file
    this.now = options.now ?? Date.now
    this.pid = options.pid ?? process.pid
    this.alive = options.alive ?? processAlive
  }

  /** 标记还作不作数：对方进程在，而且最近报到过。 */
  private live(mark: OwnerMark): boolean {
    return this.alive(mark.pid) && this.now() - mark.beat <= OWNER_STALE_MS
  }

  /**
   * 报到一次。已经是自己的就更新时刻、回 `true`；没人负责（或对方不作数了）就写下自己的标记，
   * 这一拍先回 `false`，下一拍确认；别人在负责回 `false`。
   */
  async beat(): Promise<boolean> {
    const file = this.file()
    const mark = readMark(await readFileText(file))
    const now = this.now()
    if (mark !== null && mark.token === this.token) {
      await writeFileAtomic(file, `${JSON.stringify({ ...mark, beat: now })}\n`)
      return true
    }
    if (mark !== null && this.live(mark)) return false
    await ensureDir(dirname(file))
    const claim: OwnerMark = { pid: this.pid, token: this.token, since: now, beat: now }
    await writeFileAtomic(file, `${JSON.stringify(claim)}\n`)
    return false
  }

  /** 现在是谁在负责；没有作数的标记是 `undefined`。 */
  async current(): Promise<OwnerInfo | undefined> {
    const mark = readMark(await readFileText(this.file()))
    if (mark === null || !this.live(mark)) return undefined
    return { mine: mark.token === this.token, pid: mark.pid, since: mark.since }
  }

  /** 退出时让出来：标记还是自己的就删掉，别的进程下一拍就能接手。 */
  async release(): Promise<void> {
    const mark = readMark(await readFileText(this.file()))
    if (mark !== null && mark.token === this.token) await unlinkFile(this.file())
  }
}
