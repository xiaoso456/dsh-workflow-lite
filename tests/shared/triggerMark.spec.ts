/**
 * 事件行：只有 `::trigger::` 开头的行会触发；检查命令有事件行时只拿它们当背景信息。
 */

import { describe, expect, it } from 'vitest'
import {
  brokenEvents,
  checkInfo,
  eventOf,
  eventsOf,
  markParts,
  TRIGGER_MARK,
} from '../../src/shared/triggerMark.ts'

describe('事件行', () => {
  it('::trigger:: 开头（前面可以有空白）才是事件，后面去掉首尾空白是背景信息', () => {
    expect(eventOf('::trigger:: {"id":7}')).toBe('{"id":7}')
    expect(eventOf('  ::trigger::new file  ')).toBe('new file')
    expect(eventOf('::trigger::')).toBe('')
    expect(eventOf('[watch] 首次运行，已记录 20 条现状')).toBeNull()
    expect(eventOf('{"level":30,"msg":"started"}')).toBeNull()
    expect(eventOf('log: ::trigger:: 不在开头')).toBeNull()
    expect(eventOf('::TRIGGER:: 大小写不同')).toBeNull()
  })

  it('界面把标记单独画出来：标记和后面的原文（不去空白）', () => {
    expect(markParts('  ::trigger:: a b')).toEqual({ mark: TRIGGER_MARK, rest: ' a b' })
    expect(markParts('a')).toBeNull()
  })

  it('一段输出里的事件按先后取出', () => {
    expect(eventsOf('ready\r\n::trigger:: a\nnoise\n::trigger:: b\n')).toEqual(['a', 'b'])
    expect(eventsOf('')).toEqual([])
  })

  it('检查命令：有事件行只用它们，没有用整段', () => {
    expect(checkInfo('checked at 10:00\n::trigger:: {"id":7}\n::trigger:: {"id":8}\n')).toBe(
      '{"id":7}\n{"id":8}',
    )
    expect(checkInfo('  abc123 refs/heads/main\n')).toBe('abc123 refs/heads/main')
  })
})

describe('被换行断开的事件', () => {
  it('事件后面紧跟着缩进、堆栈、收尾括号的行，或事件里括号没配平：算一处，记下第一截', () => {
    expect(
      brokenEvents([
        '::trigger:: Error: timeout',
        '    at pay (a.js:1:1)',
        '    at main (a.js:9:1)',
      ]),
    ).toEqual({ count: 1, sample: 'at pay (a.js:1:1)', cut: [1, 2] })
    expect(
      brokenEvents(['::trigger:: {', '"id": 7', '}', '::trigger:: Caused by', 'Caused by: x']),
    ).toEqual({
      count: 2,
      sample: '"id": 7',
      cut: [1, 2, 4],
    })
  })

  it('事件后面跟着普通日志、日志后面才有缩进的行：不算', () => {
    expect(
      brokenEvents([
        '::trigger:: {"id":7}',
        '[watch] 已处理 7',
        '    缩进的日志',
        '::trigger:: 新文件 a.csv',
        '',
        '[watch] 下一轮',
      ]),
    ).toBeNull()
  })
})
