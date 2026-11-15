/**
 * 最近的输出里每一条怎么写：结果、退出码小标、一眼看的那一行、展开后的说明、运行时长、复制出去的文字。
 */

import { describe, expect, it } from 'vitest'
import { type LocaleKey, zh } from '../../src/client/i18n.ts'
import {
  codeChip,
  entriesText,
  entryMeta,
  entryTone,
  linesText,
  previewText,
  runSpan,
  verdictText,
} from '../../src/client/model/outputText.ts'
import type { OutputEntry, OutputLine } from '../../src/shared/wire/trigger.ts'

const t = (key: LocaleKey): string => zh[key]
const at = (h: number, m: number, s = 0): number => new Date(2026, 10, 12, h, m, s).getTime()

const checkEntry = (extra: Partial<OutputEntry> = {}): OutputEntry => ({
  id: 1,
  kind: 'check',
  at: at(10, 33, 8),
  verdict: 'unmet',
  code: 1,
  ms: 1200,
  lines: 2,
  preview: 'abc',
  ...extra,
})

const runEntry = (extra: Partial<OutputEntry> = {}): OutputEntry => ({
  id: 2,
  kind: 'run',
  at: at(9, 41, 30),
  verdict: 'running',
  code: null,
  lines: 72,
  preview: 'GET / 200',
  ...extra,
})

describe('最近的输出的说法', () => {
  it('结果与颜色', () => {
    expect(verdictText(t, checkEntry({ verdict: 'met' }))).toBe('触发')
    expect(verdictText(t, runEntry())).toBe('运行中')
    expect(verdictText(t, runEntry({ verdict: 'exited', code: 1 }))).toBe('退出 1')
    expect(verdictText(t, runEntry({ verdict: 'exited', code: null }))).toBe('退出')
    expect(entryTone(runEntry())).toBe('run')
    expect(entryTone(runEntry({ verdict: 'stopped' }))).toBe('exit')
    expect(entryTone(checkEntry({ verdict: 'fail' }))).toBe('fail')
  })

  it('退出码小标：0 平常、非零醒目、没退出另写', () => {
    expect(codeChip(t, 0)).toEqual({ text: '退出码 0', tone: 'ok' })
    expect(codeChip(t, 2)).toEqual({ text: '退出码 2', tone: 'bad' })
    expect(codeChip(t, null)).toEqual({ text: '没退出', tone: 'none' })
  })

  it('一眼看的那一行：没跑成的写原因，没有输出另写', () => {
    expect(previewText(t, checkEntry())).toBe('abc')
    expect(previewText(t, checkEntry({ verdict: 'fail', note: '超过 60 秒没结束' }))).toBe(
      '超过 60 秒没结束',
    )
    expect(previewText(t, checkEntry({ preview: '' }))).toBe('没有输出')
  })

  it('展开后的说明', () => {
    expect(entryMeta(t, checkEntry())).toBe('10:33:08 · 用时 1.2 秒')
    expect(entryMeta(t, checkEntry({ code: 0, note: '第一次检查，只记下输出' }))).toBe(
      '10:33:08 · 用时 1.2 秒 · 第一次检查，只记下输出',
    )
    expect(entryMeta(t, checkEntry({ note: '命令返回 1' }))).toBe('10:33:08 · 用时 1.2 秒')
    expect(entryMeta(t, checkEntry({ count: 12, last: at(10, 18) }))).toBe(
      '12 次的输出都一样，下面是 10:18:00 那一次',
    )
    expect(entryMeta(t, runEntry(), 50)).toBe('09:41:30 启动 · 只显示最近 50 行')
    expect(
      entryMeta(t, runEntry({ verdict: 'exited', code: 1, end: at(10, 2, 7), lines: 30 }), 50),
    ).toBe('09:41:30 启动 · 10:02:07 退出（退出码 1）')
    expect(entryMeta(t, runEntry({ verdict: 'stopped', end: at(10, 0), lines: 3 }))).toBe(
      '09:41:30 启动 · 10:00:00 停下',
    )
  })

  it('运行时长', () => {
    expect(runSpan(t, runEntry(), at(9, 52, 30))).toBe('已运行 11 分')
    expect(runSpan(t, runEntry({ verdict: 'exited', end: at(10, 2, 30) }), 0)).toBe('运行 21 分')
    expect(runSpan(t, checkEntry(), 0)).toBe('')
  })

  it('复制出去的文字：运行的每行带时刻，重复写次数，错误输出跟着开关', () => {
    const lines: OutputLine[] = [
      { at: at(10, 0, 1), stream: 'out', text: 'ok' },
      { at: at(10, 0, 2), stream: 'err', text: 'warn', repeat: 3 },
    ]
    expect(linesText({ kind: 'run' }, lines, true)).toBe('[10:00:01] ok\n[10:00:02] warn  ×3')
    expect(linesText({ kind: 'check' }, lines, false)).toBe('ok')
    expect(
      entriesText(
        t,
        [checkEntry({ count: 2, last: at(10, 38) }), checkEntry({ id: 3, preview: '' })],
        new Map([[1, lines]]),
        true,
      ),
    ).toBe(
      '[10:33:08] 条件不满足 ×2 · 到 10:38 退出码 1\nok\nwarn  ×3\n\n[10:33:08] 条件不满足 退出码 1',
    )
  })
})
