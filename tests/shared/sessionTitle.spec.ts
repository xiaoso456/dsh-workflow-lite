/**
 * 插件新建的会话标题：「工作流名 · 怎么来的 · 时间」；卡片没起名时用触发方式的简述。
 */

import { describe, expect, it } from 'vitest'
import { sessionTitle, TITLE_PART_MAX } from '../../src/shared/sessionTitle.ts'
import { sourceBrief } from '../../src/shared/trigger.ts'

describe('新建会话的标题', () => {
  it('三段，时间写到分钟（本地时间）', () => {
    const at = new Date(2026, 10, 19, 2, 30)
    expect(sessionTitle('日报汇总', '工作日夜巡', at)).toBe('日报汇总 · 工作日夜巡 · 11-19 02:30')
    expect(sessionTitle('日报汇总', '手动', new Date(2026, 0, 5, 20, 7))).toBe(
      '日报汇总 · 手动 · 01-05 20:07',
    )
  })

  it('前两段太长截断加省略号，时间完整', () => {
    const long = '一'.repeat(TITLE_PART_MAX + 5)
    const title = sessionTitle(long, long, new Date(2026, 10, 19, 9, 0))
    const [workflow, via, time] = title.split(' · ')
    expect([...(workflow ?? '')]).toHaveLength(TITLE_PART_MAX)
    expect(workflow?.endsWith('…')).toBe(true)
    expect([...(via ?? '')]).toHaveLength(TITLE_PART_MAX)
    expect(time).toBe('11-19 09:00')
  })

  it('卡片没起名：用触发方式的简述', () => {
    expect(sourceBrief({ kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } })).toBe(
      '每天 09:00',
    )
    expect(
      sourceBrief({
        kind: 'schedule',
        schedule: { kind: 'daily', time: '09:00' },
        check: { command: 'x', when: 'every' },
      }),
    ).toBe('定时检查')
    expect(sourceBrief({ kind: 'listen', command: 'x' })).toBe('监视程序')
    expect(sourceBrief({ kind: 'http' })).toBe('收到 HTTP 请求')
    expect(sourceBrief({ kind: 'after', workflow: '夜间巡检', when: 'failed' })).toBe(
      '「夜间巡检」失败后',
    )
  })
})
