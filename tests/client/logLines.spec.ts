import { describe, expect, it } from 'vitest'
import {
  appendWindow,
  extendWindow,
  filterProblem,
  lineLevel,
  linesFrom,
  prependWindow,
  splitHits,
  windowOf,
} from '../../src/client/model/logLines.ts'
import { readView } from '../../src/shared/model.ts'
import type { RunLine, RunLinesResponse } from '../../src/shared/wire.ts'

const line = (at: number, text = `line ${at}`, extra: Partial<RunLine> = {}): RunLine => ({
  at,
  text,
  ...extra,
})
const response = (patch: Partial<RunLinesResponse>): RunLinesResponse => ({
  path: '/x/a.log',
  display: 'a.log',
  exists: true,
  size: 1000,
  mtime: 1,
  kind: 'lines',
  lines: [],
  start: 0,
  end: 0,
  tag: 't',
  trail: 0,
  matched: 0,
  more: false,
  ...patch,
})

describe('窗口拼接', () => {
  const first = windowOf(
    response({ lines: [line(10), line(20)], start: 10, end: 30, more: true, matched: 2 }),
    'tail',
  )

  it('续读接上：新行标成新的，超过上限从前面扔、前面变成「还有」', () => {
    const next = appendWindow(
      first,
      response({ lines: [line(30), line(40)], start: 30, end: 50, appended: true, matched: 2 }),
      3,
    )
    expect(next.lines.map((entry) => entry.at)).toEqual([20, 30, 40])
    expect(next.start).toBe(20)
    expect(next.end).toBe(50)
    expect(next.before).toBe(true)
    expect([...(next.fresh ?? [])]).toEqual([30, 40])
    expect(next.parity).toBe(1)
    expect(next.matched).toBe(4)
  })

  it('筛着看续读：上一回末尾筛掉的行数加到新的第一行的 skip 上', () => {
    const filtered = { ...first, trail: 3 }
    const next = appendWindow(
      filtered,
      response({ lines: [line(60, 'x', { skip: 2 })], end: 70, appended: true, trail: 1 }),
      10,
    )
    expect(next.lines.at(-1)?.skip).toBe(5)
    expect(next.trail).toBe(1)
    // 什么都没续上：筛掉的行数累加。
    const none = appendWindow(next, response({ lines: [], end: 90, appended: true, trail: 4 }), 10)
    expect(none.trail).toBe(5)
    expect(none.fresh).toBeNull()
  })

  it('接不上（文件被重写）整个换掉，不标新；中间断开的标后来的', () => {
    const reset = appendWindow(first, response({ lines: [line(0)], end: 5 }), 10)
    expect(reset.lines.map((entry) => entry.at)).toEqual([0])
    expect(reset.fresh).toBeNull()
    const gap = appendWindow(
      first,
      response({ lines: [line(900)], start: 900, end: 950, appended: true, gap: true }),
      10,
    )
    expect(gap.lines.map((entry) => entry.at)).toEqual([900])
    expect([...(gap.fresh ?? [])]).toEqual([900])
  })

  it('往上翻接在前面，超过上限从后面扔、后面变成「还有」', () => {
    const up = prependWindow(
      first,
      response({ lines: [line(0), line(5)], start: 0, end: 10, more: false, trail: 2 }),
      3,
    )
    expect(up.lines.map((entry) => entry.at)).toEqual([0, 5, 10])
    expect(up.lines[2]?.skip).toBe(2)
    expect(up.before).toBe(false)
    expect(up.after).toBe(true)
    expect(up.end).toBe(20)
  })

  it('往下翻接在后面', () => {
    const head = windowOf(response({ lines: [line(0)], start: 0, end: 10, more: true }), 'head')
    expect(head.after).toBe(true)
    const down = extendWindow(
      head,
      response({ lines: [line(10)], start: 10, end: 20, more: false }),
      5,
    )
    expect(down.lines.map((entry) => entry.at)).toEqual([0, 10])
    expect(down.after).toBe(false)
  })
})

describe('级别', () => {
  it('认常见写法；句子里随口说的不算', () => {
    expect(lineLevel('2026 ERROR worker failed')).toBe('error')
    expect(lineLevel('error: cannot find module')).toBe('error')
    expect(lineLevel('[Fatal] out of memory')).toBe('error')
    expect(lineLevel('ts=1 level=error msg=x')).toBe('error')
    expect(lineLevel('✗ 3 tests failed')).toBe('error')
    expect(lineLevel('WARN slow query')).toBe('warn')
    expect(lineLevel('warning: deprecated')).toBe('warn')
    expect(lineLevel('no error found, 0 errors')).toBeNull()
    expect(lineLevel('INFO ok')).toBeNull()
  })
})

describe('命中、筛选', () => {
  it('按命中切开', () => {
    expect(splitHits('a ERROR b ERROR', [2, 7, 10, 15])).toEqual([
      ['a ', false],
      ['ERROR', true],
      [' b ', false],
      ['ERROR', true],
    ])
    expect(splitHits('plain', undefined)).toEqual([['plain', false]])
  })

  it('正则写错说原因（去掉 V8 的前缀）；普通文字不检查', () => {
    expect(filterProblem({ pattern: '(', regex: true })).toBe('Unterminated group')
    expect(filterProblem({ pattern: '(' })).toBeNull()
    expect(filterProblem({ pattern: 'a|b', regex: true })).toBeNull()
  })

  it('自动的位置：日志、在写、很大的看末尾', () => {
    const auto = { log: false, writing: false, size: 10 }
    expect(linesFrom({}, auto)).toBe('start')
    expect(linesFrom({}, { ...auto, log: true })).toBe('end')
    expect(linesFrom({}, { ...auto, writing: true })).toBe('end')
    expect(linesFrom({}, { ...auto, size: 2 * 1024 * 1024 })).toBe('end')
    expect(linesFrom({ from: 'start' }, { ...auto, log: true })).toBe('start')
  })
})

describe('展示设置里的内容一组', () => {
  it('认得的留下、空的去掉、越界的夹回来', () => {
    const view = readView({
      width: 320,
      height: 200,
      lines: {
        from: 'end',
        filter: { pattern: 'ERROR', regex: true, context: 19, junk: 1 },
        levels: false,
      },
      table: { hide: [' a ', 'a', 3, ''], bars: true, sort: { column: 'p99', desc: true } },
      gallery: { layout: 'wall', grid: { columns: 20, rows: 0 }, order: 'name', hero: false },
    })
    expect(view?.lines).toEqual({
      from: 'end',
      filter: { pattern: 'ERROR', regex: true, context: 10 },
      levels: false,
    })
    expect(view?.table).toEqual({ hide: ['a'], bars: true, sort: { column: 'p99', desc: true } })
    expect(view?.gallery).toEqual({ grid: { columns: 8, rows: 1 }, order: 'name', hero: false })
    expect(
      readView({ width: 320, height: 200, lines: { filter: { pattern: '' } } })?.lines,
    ).toBeUndefined()
  })
})
