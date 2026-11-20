/**
 * skill `workflow-trigger` 随附的监视底子 `kit/watch.mjs`：插件把它放进工作流目录，监视脚本 import 它。
 * 这里按真的用法验：状态存取、按编号去重、状态变化（带确认次数）、ETag、等文件写完、轮询的快慢和退避，
 * 以及一个用它写的监视程序收到投进来的样本、打出事件行。
 */

import { execFileSync, spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const KIT = fileURLToPath(new URL('../../skills/workflow-trigger/kit/watch.mjs', import.meta.url))

/** 这里用到的几样（底子是给监视脚本 import 的 .mjs，没有类型声明）。 */
interface Kit {
  dataDir: string
  secretsDir: string
  secret(name: string, what?: string): string
  remember<T>(name: string, initial: T): { first: boolean; value: T; save(next?: T): void }
  seenIds(
    name?: string,
    limit?: number,
  ): { first: boolean; has(id: unknown): boolean; add(id: unknown): boolean; save(): void }
  edges(
    name?: string,
    options?: { confirm?: number },
  ): {
    update(key: string, value: string): { from: string; to: string } | null
    value(key: string): string | undefined
    save(): void
  }
  getJson(
    url: string,
    options?: { etag?: string | undefined },
  ): Promise<{ notModified: boolean; etag?: string; data?: unknown }>
  settle(path: string, options?: { quiet?: number; step?: number }): Promise<boolean>
}

let scratch: string
let kit: Kit

beforeAll(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'wl-watch-kit-'))
  process.env.TRIGGER_DATA_DIR = join(scratch, 'data')
  process.env.TRIGGER_SECRETS_DIR = join(scratch, 'secrets')
  kit = (await import(KIT)) as Kit
})

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
})

describe('kit/watch.mjs', () => {
  it('数据目录取 TRIGGER_DATA_DIR；remember 第一次是 first、存了之后再读回来', () => {
    expect(kit.dataDir).toBe(join(scratch, 'data'))
    const cursor = kit.remember('cursor.json', { since: 0 })
    expect(cursor.first).toBe(true)
    expect(cursor.value).toEqual({ since: 0 })
    cursor.save({ since: 42 })
    const again = kit.remember('cursor.json', { since: 0 })
    expect(again.first).toBe(false)
    expect(again.value).toEqual({ since: 42 })
  })

  it('密钥目录取 TRIGGER_SECRETS_DIR；secret 读出来去掉首尾空白', () => {
    expect(kit.secretsDir).toBe(join(scratch, 'secrets'))
    execFileSync(process.execPath, [
      '-e',
      `require('fs').mkdirSync(${JSON.stringify(kit.secretsDir)})`,
    ])
    writeFileSync(join(kit.secretsDir, 'token.txt'), '  t0k\n')
    expect(kit.secret('token.txt')).toBe('t0k')
  })

  it('seenIds：新的回 true、见过的回 false；超过上限丢最早的；存了再读回来', () => {
    const seen = kit.seenIds('ids.json', 3)
    expect([1, 2, 1, 3, 4].map((id) => seen.add(id))).toEqual([true, true, false, true, true])
    expect(seen.has(1)).toBe(false)
    expect(seen.has(4)).toBe(true)
    seen.save()
    const again = kit.seenIds('ids.json', 3)
    expect(again.first).toBe(false)
    expect(again.add(2)).toBe(false)
  })

  it('edges：第一次只记下；变了才算一件事；confirm 次连着一样才认，中间回去了就不算', () => {
    const health = kit.edges('health.json', { confirm: 2 })
    expect(health.update('api', 'up')).toBeNull()
    expect(health.update('api', 'down')).toBeNull()
    expect(health.update('api', 'up')).toBeNull()
    expect(health.update('api', 'down')).toBeNull()
    expect(health.update('api', 'down')).toEqual({ from: 'up', to: 'down' })
    expect(health.update('api', 'down')).toBeNull()
    health.save()
    const again = kit.edges('health.json')
    expect(again.value('api')).toBe('down')
    expect(again.value('db')).toBeUndefined()
    expect(again.update('api', 'up')).toEqual({ from: 'down', to: 'up' })
  })

  describe('getJson', () => {
    let server: Server
    let base: string
    beforeAll(async () => {
      server = createServer((request, response) => {
        if (request.url === '/broken') return response.writeHead(500).end('boom')
        if (request.headers['if-none-match'] === '"v1"') return response.writeHead(304).end()
        response.writeHead(200, { 'content-type': 'application/json', etag: '"v1"' })
        response.end(JSON.stringify({ items: [1] }))
      })
      await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    })
    afterAll(() => {
      server.close()
    })

    it('第一次拿到内容和 ETag；带上 ETag 再要，没变就是 notModified；出错带状态码', async () => {
      const first = await kit.getJson(`${base}/items`)
      expect(first).toEqual({ notModified: false, etag: '"v1"', data: { items: [1] } })
      expect(await kit.getJson(`${base}/items`, { etag: first.etag })).toEqual({
        notModified: true,
        etag: '"v1"',
      })
      await expect(kit.getJson(`${base}/broken`)).rejects.toThrow('返回 500：boom')
    })
  })

  it('settle：文件还在写就等，几秒不变才回 true；文件不在回 false', async () => {
    const file = join(scratch, 'big.bin')
    writeFileSync(file, 'a')
    const writer = setInterval(() => writeFileSync(file, 'ab'.repeat(Date.now() % 50)), 50)
    setTimeout(() => clearInterval(writer), 300)
    const started = Date.now()
    expect(await kit.settle(file, { quiet: 200, step: 20 })).toBe(true)
    expect(Date.now() - started).toBeGreaterThanOrEqual(400)
    expect(await kit.settle(join(scratch, 'nope.bin'), { quiet: 50, step: 10 })).toBe(false)
  })

  it('stream：断了按 min 起翻倍重连，第一次就等 min，最长 max', () => {
    const dir = join(scratch, 'stream')
    execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(dir)})`])
    copyFileSync(KIT, join(dir, 'watch.mjs'))
    writeFileSync(
      join(dir, 'probe.mjs'),
      [
        "import { stream } from './watch.mjs'",
        'const times = []',
        'await stream(async () => {',
        '  times.push(Date.now())',
        '  if (times.length === 5) {',
        '    console.log("gaps " + JSON.stringify(times.slice(1).map((t, i) => t - times[i])))',
        '    process.exit(0)',
        '  }',
        "  throw new Error('连不上')",
        '}, { min: 100, max: 300 })',
      ].join('\n'),
    )
    const out = execFileSync(process.execPath, [join(dir, 'probe.mjs')], {
      env: { ...process.env, TRIGGER_DATA_DIR: join(scratch, 'stream-data') },
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
    const gaps = JSON.parse(out.match(/gaps (.*)/)?.[1] ?? '[]') as number[]
    expect(gaps).toHaveLength(4)
    const [first, second, third, fourth] = gaps as [number, number, number, number]
    // 100、200、300（封顶）、300；各留一点调度的余量。
    expect(first).toBeGreaterThanOrEqual(95)
    expect(first).toBeLessThan(190)
    expect(second).toBeGreaterThanOrEqual(195)
    expect(third).toBeGreaterThanOrEqual(295)
    expect(fourth).toBeLessThan(450)
  }, 20_000)

  it('一个用它写的轮询程序：有事时查得勤、闲了放慢、出错退避；投进来的样本当真事件打出来', async () => {
    const dir = join(scratch, 'flow')
    const data = join(scratch, 'flow-data')
    execFileSync(process.execPath, ['-e', `require('fs').mkdirSync(${JSON.stringify(dir)})`])
    copyFileSync(KIT, join(dir, 'watch.mjs'))
    writeFileSync(
      join(dir, 'probe.mjs'),
      [
        "import { emit, injected, log, poll } from './watch.mjs'",
        'let round = 0',
        "const handle = (item) => emit('工单 ' + item.id + ' 新建：' + item.title, { id: item.id })",
        'injected(handle, { every: 50 })',
        'await poll(() => {',
        '  round += 1',
        "  log('round', round)",
        "  if (round === 4) throw new Error('接口超时')",
        '  return round === 1',
        '}, { every: 60, idle: 400, calm: 2, max: 120 })',
      ].join('\n'),
    )
    writeFileSync(join(dir, 'sample.json'), JSON.stringify([{ id: 7, title: '登录\n失败' }]))
    const child = spawn(process.execPath, [join(dir, 'probe.mjs')], {
      env: { ...process.env, TRIGGER_DATA_DIR: data },
    })
    let out = ''
    let err = ''
    child.stdout.on('data', (chunk) => {
      out += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      err += String(chunk)
    })
    await new Promise((done) => setTimeout(done, 300))
    execFileSync(process.execPath, [join(dir, 'watch.mjs'), 'inject', join(dir, 'sample.json')], {
      env: { ...process.env, TRIGGER_DATA_DIR: data },
    })
    await new Promise((done) => setTimeout(done, 900))
    child.kill('SIGTERM')
    await new Promise((done) => child.once('exit', done))
    // 投进来的样本：一件一行，换行换掉了。
    expect(out).toContain('::trigger:: 工单 7 新建：登录 ⏎ 失败 {"id":7}')
    // 第 4 轮出错打到错误输出、退避后恢复。
    expect(err).toContain('接口超时')
    expect(out).toContain('恢复正常')
    // 头两轮间隔 60ms，之后闲了放慢到 400ms：1.2 秒里远少于 1200 / 60 = 20 轮。
    const rounds = out.match(/round \d+/g)?.length ?? 0
    expect(rounds).toBeGreaterThanOrEqual(4)
    expect(rounds).toBeLessThan(10)
  }, 20_000)
})
