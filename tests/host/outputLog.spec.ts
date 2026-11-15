/**
 * 最近的输出存在插件数据库里：一次检查（或程序的一次运行）一条、按行另存；
 * 连着一样的检查合成一条，连着一样的行只加次数，超长的行截断；按保留行数丢旧的并记下丢过；
 * 清空留下正在跑的那次；工作流改名跟着走、删掉一起删；另一个连接读得到。
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATABASE_FILE, PluginDatabase } from '../../src/host/store/database.ts'
import { type CheckInput, OutputLog, storedLine } from '../../src/host/triggers/outputLog.ts'
import { OUTPUT_LINE_MAX_CHARS } from '../../src/shared/wire/trigger.ts'

let dataDir: string
const opened: PluginDatabase[] = []

/** 一个进程那样：自己的连接。 */
function open(): OutputLog {
  const database = new PluginDatabase(() => join(dataDir, DATABASE_FILE))
  opened.push(database)
  return new OutputLog(database)
}

const KEEP = 300
let clock = 0

function check(extra: Partial<CheckInput> = {}): CheckInput {
  clock += 60_000
  return { at: clock, verdict: 'unmet', code: 1, ms: 120, out: 'abc\n', err: '', ...extra }
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'workflow-lite-output-'))
  clock = new Date(2026, 10, 12, 9, 0).getTime()
})

afterEach(async () => {
  for (const database of opened.splice(0)) database.close()
  await rm(dataDir, { recursive: true, force: true })
})

describe('最近的输出：检查', () => {
  it('一次检查一条：标准输出在前、错误输出在后，第一行是一眼看的那一行', () => {
    const log = open()
    log.check(
      'wf',
      'p',
      check({ verdict: 'met', code: 0, out: '\nok\nsecond\n\n', err: 'warn\n' }),
      KEEP,
    )
    const { entries, counts, dropped } = log.list('wf', 'p', 'all', 50)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'check',
      verdict: 'met',
      code: 0,
      ms: 120,
      lines: 4,
      preview: 'ok',
    })
    expect(counts).toEqual({ all: 1, met: 1, fail: 0 })
    expect(dropped).toBe(false)
    const [read] = log.lines('wf', 'p', [entries[0]?.id ?? 0])
    expect(read?.lines.map((line) => [line.stream, line.text])).toEqual([
      ['out', ''],
      ['out', 'ok'],
      ['out', 'second'],
      ['err', 'warn'],
    ])
  })

  it('连着结果和输出都一样的合成一条（记次数和最近那次）；触发了的、输出变了的不合', () => {
    const log = open()
    log.check('wf', 'p', check(), KEEP)
    const first = clock
    log.check('wf', 'p', check(), KEEP)
    log.check('wf', 'p', check(), KEEP)
    log.check('wf', 'p', check({ out: 'changed' }), KEEP)
    log.check('wf', 'p', check({ verdict: 'met', code: 0, out: 'ok' }), KEEP)
    log.check('wf', 'p', check({ verdict: 'met', code: 0, out: 'ok' }), KEEP)
    const { entries, counts } = log.list('wf', 'p', 'all', 50)
    expect(entries.map((entry) => [entry.verdict, entry.count ?? 1, entry.preview])).toEqual([
      ['met', 1, 'ok'],
      ['met', 1, 'ok'],
      ['unmet', 1, 'changed'],
      ['unmet', 3, 'abc'],
    ])
    expect(entries[3]).toMatchObject({ at: first, last: first + 2 * 60_000 })
    expect(counts).toEqual({ all: 6, met: 2, fail: 0 })
    expect(log.list('wf', 'p', 'met', 50).entries).toHaveLength(2)
    expect(log.list('wf', 'p', 'fail', 50).entries).toHaveLength(0)
  })

  it('没跑成的记原因；按筛选给，多了说还有', () => {
    const log = open()
    for (let n = 0; n < 5; n += 1) log.check('wf', 'p', check({ out: String(n) }), KEEP)
    log.check(
      'wf',
      'p',
      check({ verdict: 'fail', code: null, note: '超过 60 秒没结束', out: '' }),
      KEEP,
    )
    const page = log.list('wf', 'p', 'all', 3)
    expect(page.entries).toHaveLength(3)
    expect(page.more).toBe(true)
    const failed = log.list('wf', 'p', 'fail', 3)
    expect(failed.entries[0]).toMatchObject({
      verdict: 'fail',
      code: null,
      note: '超过 60 秒没结束',
      lines: 0,
    })
    expect(failed.more).toBe(false)
  })
})

describe('最近的输出：监听程序的运行', () => {
  it('一次运行一条：成批记行，连着一样的只加次数，最后一行是一眼看的那一行', () => {
    const log = open()
    const run = log.runStart('wf', 'l', 1000)
    log.append(
      run,
      [
        { at: 1001, stream: 'out', text: 'GET / 200' },
        { at: 1002, stream: 'err', text: 'ECONNREFUSED' },
        { at: 1003, stream: 'err', text: 'ECONNREFUSED' },
        { at: 1004, stream: 'err', text: 'ECONNREFUSED' },
      ],
      KEEP,
    )
    log.append(
      run,
      [
        { at: 1005, stream: 'err', text: 'ECONNREFUSED' },
        { at: 1006, stream: 'out', text: '\u001b[32mdone\u001b[0m' },
      ],
      KEEP,
    )
    const [entry] = log.list('wf', 'l', 'all', 10).entries
    expect(entry).toMatchObject({
      kind: 'run',
      verdict: 'running',
      at: 1000,
      lines: 3,
      preview: 'done',
    })
    const [read] = log.lines('wf', 'l', [run])
    expect(read?.lines).toEqual([
      { at: 1001, stream: 'out', text: 'GET / 200' },
      { at: 1002, stream: 'err', text: 'ECONNREFUSED', repeat: 4 },
      { at: 1006, stream: 'out', text: 'done' },
    ])
    expect(log.lines('wf', 'l', [run], 1)[0]).toEqual({
      id: run,
      total: 3,
      lines: [{ at: 1006, stream: 'out', text: 'done' }],
    })

    log.runEnd(run, { at: 5000, verdict: 'exited', code: 1, note: '退出了' })
    expect(log.list('wf', 'l', 'all', 10).entries[0]).toMatchObject({
      verdict: 'exited',
      end: 5000,
      code: 1,
    })
  })

  it('换了负责的进程：还标着在跑的旧运行算被停下，停在它最后一行的时刻', () => {
    const log = open()
    const old = log.runStart('wf', 'l', 1000)
    log.append(old, [{ at: 1500, stream: 'out', text: 'x' }], KEEP)
    const fresh = open().runStart('wf', 'l', 9000)
    const entries = log.list('wf', 'l', 'all', 10).entries
    expect(entries.map((entry) => [entry.id, entry.verdict, entry.end])).toEqual([
      [fresh, 'running', undefined],
      [old, 'stopped', 1500],
    ])
  })

  it('超长的行截断，记下原来多少字节', () => {
    const long = 'é'.repeat(OUTPUT_LINE_MAX_CHARS + 10)
    expect(storedLine(long)).toEqual({
      text: 'é'.repeat(OUTPUT_LINE_MAX_CHARS),
      size: long.length * 2,
    })
    expect(storedLine('short\r')).toEqual({ text: 'short' })
  })
})

describe('最近的输出：保留行数', () => {
  it('超了从最早的一条丢起，记下丢过；没有输出的一条按一行算', () => {
    const log = open()
    for (let n = 0; n < 6; n += 1) log.check('wf', 'p', check({ out: `${n}\n${n}` }), 7)
    const { entries, dropped } = log.list('wf', 'p', 'all', 50)
    expect(entries.map((entry) => entry.preview)).toEqual(['5', '4', '3'])
    expect(dropped).toBe(true)
    log.check('wf', 'q', check({ out: '' }), 2)
    log.check('wf', 'q', check({ out: '', code: 2 }), 2)
    log.check('wf', 'q', check({ out: '', code: 3 }), 2)
    expect(log.list('wf', 'q', 'all', 50).entries.map((entry) => entry.code)).toEqual([3, 2])
  })

  it('只剩正在跑的那次也超了：丢它最早的行', () => {
    const log = open()
    log.check('wf', 'l', check(), 5)
    const run = log.runStart('wf', 'l', 1)
    log.append(
      run,
      Array.from({ length: 8 }, (_, n) => ({ at: n, stream: 'out' as const, text: `line ${n}` })),
      5,
    )
    const { entries, dropped } = log.list('wf', 'l', 'all', 10)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.lines).toBe(5)
    expect(dropped).toBe(true)
    expect(log.lines('wf', 'l', [run])[0]?.lines.map((line) => line.text)).toEqual([
      'line 3',
      'line 4',
      'line 5',
      'line 6',
      'line 7',
    ])
  })
})

describe('最近的输出：清空、别的卡片、改名与删除', () => {
  it('清空：正在跑的那次留着、接着记；丢过的记号一起清掉', () => {
    const log = open()
    log.check('wf', 'l', check(), 1)
    const run = log.runStart('wf', 'l', 1)
    log.append(
      run,
      [
        { at: 2, stream: 'out', text: 'a' },
        { at: 3, stream: 'out', text: 'b' },
      ],
      1,
    )
    expect(log.list('wf', 'l', 'all', 10).dropped).toBe(true)
    log.clear('wf', 'l')
    let listed = log.list('wf', 'l', 'all', 10)
    expect(listed.entries.map((entry) => [entry.id, entry.lines, entry.preview])).toEqual([
      [run, 0, ''],
    ])
    expect(listed.dropped).toBe(false)
    log.append(run, [{ at: 4, stream: 'out', text: 'c' }], KEEP)
    listed = log.list('wf', 'l', 'all', 10)
    expect(listed.entries[0]).toMatchObject({ lines: 1, preview: 'c' })
  })

  it('读行只给这张卡片的', () => {
    const log = open()
    log.check('wf', 'a', check(), KEEP)
    const id = log.list('wf', 'a', 'all', 1).entries[0]?.id ?? 0
    expect(log.lines('wf', 'b', [id])).toEqual([])
    expect(log.lines('other', 'a', [id])).toEqual([])
    expect(log.lines('wf', 'a', [id, 9999]).map((item) => item.id)).toEqual([id])
  })

  it('工作流改名跟着走，删掉一起删；另一个连接读得到', () => {
    const writer = open()
    const reader = open()
    writer.check('wf', 'p', check(), 1)
    writer.check('wf', 'p', check({ out: 'x' }), 1)
    writer.rename('wf', 'renamed')
    expect(reader.list('wf', 'p', 'all', 10).entries).toHaveLength(0)
    const moved = reader.list('renamed', 'p', 'all', 10)
    expect(moved.entries).toHaveLength(1)
    expect(moved.dropped).toBe(true)
    writer.forget('renamed')
    expect(reader.list('renamed', 'p', 'all', 10)).toMatchObject({ entries: [], dropped: false })
    expect(reader.lines('renamed', 'p', [moved.entries[0]?.id ?? 0])).toEqual([])
  })
})
