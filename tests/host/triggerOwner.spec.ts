/**
 * 谁负责触发（`host/triggers/owner.ts`）：插件数据库里的一行。
 * 前半用假的时钟、假的进程存活判断，逐条看报到、接手、让出；后半起真的子进程，
 * 看几个进程同时抢只有一个拿到、持有的进程被杀掉之后别的进程不等超时就接手。
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATABASE_FILE, PluginDatabase } from '../../src/host/store/database.ts'
import {
  OWNER_BEAT_MS,
  OWNER_STALE_MS,
  OwnerLock,
  processAlive,
} from '../../src/host/triggers/owner.ts'

let dir: string
let databases: PluginDatabase[]
let clock: number

/** 一个「进程」：各自一个数据库连接，同一个文件。 */
function lock(pid: number, alive: (pid: number) => boolean = () => true): OwnerLock {
  const database = new PluginDatabase(() => join(dir, DATABASE_FILE))
  databases.push(database)
  return new OwnerLock({ database, now: () => clock, pid, alive })
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'workflow-lite-owner-'))
  databases = []
  clock = 1_000_000
})

afterEach(async () => {
  for (const database of databases) database.close()
  await rm(dir, { recursive: true, force: true })
})

describe('报到、接手、让出', () => {
  it('第一次报到就拿到；已经有人负责时别的进程拿不到，看得到是谁', async () => {
    const first = lock(1)
    const second = lock(2)
    expect(await first.beat()).toBe(true)
    expect(await second.beat()).toBe(false)
    expect(await second.current()).toEqual({ mine: false, pid: 1, since: clock })
    expect(await first.current()).toEqual({ mine: true, pid: 1, since: clock })
  })

  it('报到 15 秒一次：中间几轮用上一次的结论，到点才去看对方还在不在', async () => {
    let firstAlive = true
    const first = lock(1)
    const second = lock(2, (pid) => pid !== 1 || firstAlive)
    expect(await first.beat()).toBe(true)
    expect(await second.beat()).toBe(false)
    // 持有的进程崩了：没到报到的时候还不知道。
    firstAlive = false
    clock += OWNER_BEAT_MS - 1
    expect(await second.beat()).toBe(false)
    // 到了报到的时候：对方进程不在，不用等超时就接手。
    clock += 1
    expect(await second.beat()).toBe(true)
    expect((await second.current())?.pid).toBe(2)
  })

  it('卡死：进程还在、但超过 60 秒没报到，别的进程接手；醒过来的那个让出来，也不认为自己还在负责', async () => {
    const first = lock(1)
    const second = lock(2)
    expect(await first.beat()).toBe(true)
    clock += OWNER_STALE_MS
    expect(await second.beat()).toBe(false)
    clock += OWNER_BEAT_MS
    expect(await second.beat()).toBe(true)
    expect(await first.holds()).toBe(false)
    expect(await first.beat()).toBe(false)
    expect(await second.holds()).toBe(true)
  })

  it('报到过期了、还没人接手：自己真要触发前看一眼也不算数；再报到就续上', async () => {
    const first = lock(1)
    expect(await first.beat()).toBe(true)
    expect(await first.holds()).toBe(true)
    clock += OWNER_STALE_MS + 1
    expect(await first.holds()).toBe(false)
    expect(await first.beat()).toBe(true)
    expect(await first.holds()).toBe(true)
  })

  it('正常退出时让出来，别的进程下一次报到就接手；不是自己的不删', async () => {
    const first = lock(1)
    const second = lock(2)
    const third = lock(3)
    expect(await first.beat()).toBe(true)
    expect(await second.beat()).toBe(false)
    await third.release()
    expect((await second.current())?.pid).toBe(1)
    await first.release()
    expect(await second.current()).toBeUndefined()
    clock += OWNER_BEAT_MS
    expect(await second.beat()).toBe(true)
    // 让出之后再报到：已经是别人的了。
    expect(await first.beat()).toBe(false)
  })

  it('进程存活的判断：自己在，一个不存在的进程号不在', () => {
    expect(processAlive(process.pid)).toBe(true)
    expect(processAlive(2 ** 30)).toBe(false)
  })
})

describe('真的几个进程', () => {
  const child = fileURLToPath(new URL('./support/owner-child.ts', import.meta.url))
  let children: ChildProcess[]

  beforeEach(() => {
    children = []
  })

  afterEach(async () => {
    await Promise.all(
      children.map(
        (one) =>
          new Promise<void>((done) => {
            if (one.exitCode !== null || one.signalCode !== null) return done()
            one.once('exit', () => done())
            one.stdin?.end()
            setTimeout(() => one.kill(), 2_000)
          }),
      ),
    )
  })

  /** 起一个子进程，到 `startAt` 报到一次，回它打出的结论。 */
  function start(startAt: number): Promise<{ child: ChildProcess; pid: number; mine: boolean }> {
    const one = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        '--no-warnings',
        child,
        join(dir, DATABASE_FILE),
        String(startAt),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    children.push(one)
    return new Promise((done, failed) => {
      let out = ''
      let err = ''
      one.stdout?.on('data', (chunk: Buffer) => {
        out += chunk.toString()
        const line = out.split('\n')[0]
        if (out.includes('\n') && line !== undefined) {
          const parsed = JSON.parse(line) as { pid: number; mine: boolean }
          done({ child: one, ...parsed })
        }
      })
      one.stderr?.on('data', (chunk: Buffer) => {
        err += chunk.toString()
      })
      one.once('exit', (code) => failed(new Error(`子进程退出了（${String(code)}）：${err}`)))
    })
  }

  it('几个进程同时抢：只有一个拿到', async () => {
    // 先把表建好，子进程只比抢锁。
    await lock(0).current()
    const at = Date.now() + 1_500
    const results = await Promise.all(Array.from({ length: 6 }, () => start(at)))
    expect(results.filter((one) => one.mine)).toHaveLength(1)
    const holder = results.find((one) => one.mine)
    const here = lock(process.pid, processAlive)
    expect((await here.current())?.pid).toBe(holder?.pid)
  }, 30_000)

  it('持有的进程被杀掉：别的进程下一次报到就接手，不用等 60 秒超时', async () => {
    await lock(0).current()
    clock = Date.now()
    const held = await start(Date.now())
    expect(held.mine).toBe(true)
    const here = lock(process.pid, processAlive)
    expect(await here.beat()).toBe(false)
    expect((await here.current())?.pid).toBe(held.pid)

    await new Promise<void>((done) => {
      held.child.once('exit', () => done())
      held.child.kill('SIGKILL')
    })
    // 只往后走一个报到间隔，远不到超时。
    clock += OWNER_BEAT_MS
    expect(await here.beat()).toBe(true)
    expect(await here.current()).toMatchObject({ mine: true, pid: process.pid })
  }, 30_000)
})
