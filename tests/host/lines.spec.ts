import { appendFile, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  type LineScanJob,
  LineScanner,
  readRunLines,
  SlowPatternError,
  scanLines,
} from '../../src/host/runs/lines.ts'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wl-lines-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

let count = 0
async function file(content: string | Buffer): Promise<string> {
  count += 1
  const path = join(dir, `f${count}.log`)
  await writeFile(path, content)
  return path
}

const job = (full: string, extra: Partial<LineScanJob>): LineScanJob => ({
  full,
  mode: 'tail',
  limit: 3,
  maxBytes: 64 * 1024 * 1024,
  maxMs: 10_000,
  ...extra,
})
const scan = (full: string, extra: Partial<LineScanJob>) => scanLines(job(full, extra), { open })
const numbered = (n: number, from = 1): string =>
  Array.from({ length: n }, (_, index) => `line ${index + from}\n`).join('')

describe('scanLines：不筛', () => {
  it('tail：末尾几行，start 是第一行的位置，还能往上翻；before 接着翻', async () => {
    const path = await file(numbered(10))
    const last = await scan(path, {})
    expect(last.lines.map((line) => line.text)).toEqual(['line 8', 'line 9', 'line 10'])
    const text = await readFile(path, 'utf8')
    expect(last.start).toBe(text.indexOf('line 8'))
    expect(last.end).toBe(text.length)
    expect(last.more).toBe(true)
    const earlier = await scan(path, { before: last.start })
    expect(earlier.lines.map((line) => line.text)).toEqual(['line 5', 'line 6', 'line 7'])
    expect(earlier.end).toBe(last.start)
    const top = await scan(path, { before: text.indexOf('line 3'), limit: 5 })
    expect(top.lines.map((line) => line.text)).toEqual(['line 1', 'line 2'])
    expect(top.more).toBe(false)
  })

  it('最后一行没写完：单放在 pending，不算进 end', async () => {
    const path = await file('a\nb\nhalf')
    const read = await scan(path, {})
    expect(read.lines.map((line) => line.text)).toEqual(['a', 'b'])
    expect(read.pending).toEqual({ at: 4, text: 'half' })
    expect(read.end).toBe(4)
    const only = await scan(await file('no newline'), {})
    expect(only.lines).toEqual([])
    expect(only.pending?.text).toBe('no newline')
  })

  it('head：从头往后要几行，end 停在下一行行首', async () => {
    const path = await file(numbered(10))
    const head = await scan(path, { mode: 'head', from: 0 })
    expect(head.lines.map((line) => line.text)).toEqual(['line 1', 'line 2', 'line 3'])
    const text = await readFile(path, 'utf8')
    expect(head.end).toBe(text.indexOf('line 4'))
    expect(head.more).toBe(true)
    const next = await scan(path, { mode: 'head', from: head.end, limit: 100 })
    expect(next.lines).toHaveLength(7)
    expect(next.more).toBe(false)
  })

  it('follow：只读追加的；写完了的半行这回才给；文件被重写就从末尾重读', async () => {
    const path = await file('one\ntwo\nhal')
    const first = await scan(path, {})
    await appendFile(path, 'f\nthree\n')
    const next = await scan(path, { mode: 'follow', from: first.end, tag: first.tag })
    expect(next.appended).toBe(true)
    expect(next.lines.map((line) => line.text)).toEqual(['half', 'three'])
    await writeFile(path, 'new\ncontent!\n')
    const reset = await scan(path, { mode: 'follow', from: next.end, tag: next.tag })
    expect(reset.appended).toBeUndefined()
    expect(reset.lines.map((line) => line.text)).toEqual(['new', 'content!'])
    // 截短到比游标还短：一样重读。
    await writeFile(path, 'x\n')
    const short = await scan(path, { mode: 'follow', from: reset.end, tag: reset.tag })
    expect(short.appended).toBeUndefined()
  })

  it('follow 一下子多出太多：只给最后 limit 行，标 gap', async () => {
    const path = await file('start\n')
    const first = await scan(path, {})
    await appendFile(path, numbered(50))
    const next = await scan(path, { mode: 'follow', from: first.end, tag: first.tag })
    expect(next.gap).toBe(true)
    expect(next.lines.map((line) => line.text)).toEqual(['line 48', 'line 49', 'line 50'])
  })

  it('跨块：每一行的位置都对得上原文（CRLF、终端颜色码去掉）', async () => {
    const lines = Array.from(
      { length: 6000 },
      (_, index) =>
        `\u001b[32m${String(index).padStart(5, '0')}\u001b[0m ${'x'.repeat(index % 70)}`,
    )
    const content = `${lines.join('\r\n')}\r\n`
    const path = await file(content)
    const read = await scan(path, { limit: 6000 })
    expect(read.lines).toHaveLength(6000)
    const bytes = Buffer.from(content)
    for (const [index, line] of read.lines.entries()) {
      expect(line.text.startsWith(String(index).padStart(5, '0'))).toBe(true)
      expect(bytes.subarray(line.at, line.at + 6).toString()).toBe('\u001b[32m0'.slice(0, 6))
    }
    const head = await scan(path, { mode: 'head', from: 0, limit: 6000 })
    expect(head.lines.map((line) => line.at)).toEqual(read.lines.map((line) => line.at))
  })

  it('GBK 写的日志也认；超长的一行截到 4096 字', async () => {
    const gbk = Buffer.from([0xd6, 0xd0, 0xce, 0xc4, 0x0a]) // 「中文」
    const read = await scan(await file(Buffer.concat([gbk, gbk])), {})
    expect(read.lines.map((line) => line.text)).toEqual(['中文', '中文'])
    const long = await scan(await file(`short\n${'y'.repeat(200_000)}\nend\n`), { limit: 3 })
    expect(long.lines.map((line) => line.text.length)).toEqual([5, 4096, 3])
    expect(long.lines[1]?.long).toBe(true)
  })
})

describe('scanLines：筛', () => {
  const log = [
    'info start', // 0
    'info a', // 1
    'ERROR boom', // 2
    'info b', // 3
    'info c', // 4
    'info d', // 5
    'warn x', // 6
    'error again', // 7
    'info e', // 8
  ]
  const content = `${log.join('\n')}\n`

  it('只要匹配的行，标出命中的位置；不分大小写；skip 是中间跳过的行数', async () => {
    const path = await file(content)
    const read = await scan(path, { filter: { pattern: 'error' }, limit: 10 })
    expect(read.lines.map((line) => line.text)).toEqual(['ERROR boom', 'error again'])
    expect(read.lines[0]?.hits).toEqual([0, 5])
    expect(read.lines.map((line) => line.skip)).toEqual([2, 4])
    expect(read.trail).toBe(1)
    expect(read.matched).toBe(2)
    const strict = await scan(path, {
      filter: { pattern: 'error', caseSensitive: true },
      limit: 10,
    })
    expect(strict.lines.map((line) => line.text)).toEqual(['error again'])
  })

  it('正则、反选；普通文字里的特殊字符按字面', async () => {
    const path = await file(content)
    const regex = await scan(path, { filter: { pattern: '^(warn|error)', regex: true }, limit: 10 })
    expect(regex.lines.map((line) => line.text)).toEqual(['ERROR boom', 'warn x', 'error again'])
    const invert = await scan(path, { filter: { pattern: 'info', invert: true }, limit: 10 })
    expect(invert.lines.map((line) => line.text)).toEqual(['ERROR boom', 'warn x', 'error again'])
    const literal = await scan(await file('a.b\naxb\n'), { filter: { pattern: 'a.b' }, limit: 10 })
    expect(literal.lines.map((line) => line.text)).toEqual(['a.b'])
  })

  it('上下文：前后各带几行，挨着的不重复；往前读、往后读结果一样', async () => {
    const path = await file(content)
    const filter = { pattern: 'error', context: 1 }
    const tail = await scan(path, { filter, limit: 10 })
    const shape = (lines: { text: string; ctx?: true; skip?: number }[]) =>
      lines.map((line) => `${line.ctx ? '·' : '!'}${line.text}${line.skip ? `/${line.skip}` : ''}`)
    expect(shape(tail.lines)).toEqual([
      '·info a/1',
      '!ERROR boom',
      '·info b',
      '·warn x/2',
      '!error again',
      '·info e',
    ])
    const head = await scan(path, { mode: 'head', from: 0, filter, limit: 10 })
    expect(shape(head.lines)).toEqual(shape(tail.lines))
  })

  it('只要最近几处：凑够了就停，start 之前还能接着往上找', async () => {
    const path = await file(content)
    const last = await scan(path, { filter: { pattern: 'error' }, limit: 1 })
    expect(last.lines.map((line) => line.text)).toEqual(['error again'])
    expect(last.more).toBe(true)
    const earlier = await scan(path, { filter: { pattern: 'error' }, limit: 1, before: last.start })
    expect(earlier.lines.map((line) => line.text)).toEqual(['ERROR boom'])
  })

  it('follow 带上下文：上一回欠的下文这回补上', async () => {
    const path = await file('x\nERROR one\n')
    const filter = { pattern: 'error', context: 2 }
    const first = await scan(path, { filter, limit: 10 })
    expect(first.owed).toBe(2)
    await appendFile(path, 'after 1\nafter 2\nafter 3\n')
    const next = await scan(path, {
      mode: 'follow',
      from: first.end,
      tag: first.tag,
      owed: first.owed ?? 0,
      filter,
    })
    expect(next.lines.map((line) => line.text)).toEqual(['after 1', 'after 2'])
    expect(next.lines.every((line) => line.ctx)).toBe(true)
  })

  it('扫到字节上限就停，说清楚停在哪', async () => {
    const path = await file(numbered(40_000))
    const read = await scan(path, { filter: { pattern: 'nothing' }, maxBytes: 128 * 1024 })
    expect(read.lines).toEqual([])
    expect(read.stopped).toBe('bytes')
    expect(read.more).toBe(true)
    expect(read.end - read.start).toBeGreaterThanOrEqual(128 * 1024)
  })
})

describe('LineScanner：工作线程', () => {
  it('扫得出来；正则太慢就终止线程、回错误，之后还能接着用', async () => {
    const scanner = new LineScanner(400)
    try {
      const path = await file(content())
      const ok = await scanner.scan(job(path, { filter: { pattern: 'b+', regex: true } }))
      expect(ok.lines.map((line) => line.text)).toEqual(['abbb'])
      const evil = await file(`${'a'.repeat(40)}!\n`)
      await expect(
        scanner.scan(job(evil, { filter: { pattern: '(a+)+$', regex: true } })),
      ).rejects.toBeInstanceOf(SlowPatternError)
      const again = await scanner.scan(job(path, { filter: { pattern: 'abbb' } }))
      expect(again.matched).toBe(1)
    } finally {
      scanner.dispose()
    }
  })

  function content(): string {
    return 'a\nabbb\nc\n'
  }
})

describe('readRunLines', () => {
  it('不在、二进制、UTF-16 只回元信息', async () => {
    const scanner = new LineScanner()
    try {
      const request = { mode: 'tail' as const, limit: 10 }
      expect((await readRunLines(join(dir, 'none.log'), 'none.log', request, scanner)).kind).toBe(
        'missing',
      )
      const binary = await file(Buffer.from([0x61, 0x00, 0x62]))
      expect((await readRunLines(binary, 'b', request, scanner)).kind).toBe('binary')
      const utf16 = await file(Buffer.from([0xff, 0xfe, 0x61, 0x00]))
      expect((await readRunLines(utf16, 'u', request, scanner)).kind).toBe('utf16')
      const plain = await readRunLines(await file('a\nb\n'), 'p', request, scanner)
      expect(plain.kind).toBe('lines')
      expect(plain.lines.map((line) => line.text)).toEqual(['a', 'b'])
      expect(plain.exists).toBe(true)
    } finally {
      scanner.dispose()
    }
  })
})
