import { describe, expect, it } from 'vitest'
import { en, type LocaleKey, zh } from '../../src/client/i18n.ts'
import {
  filterSummary,
  guardSummary,
  whenActionKey,
  whenDetail,
} from '../../src/client/model/triggerSummary.ts'

const t = (key: LocaleKey): string => zh[key]
const tEn = (key: LocaleKey): string => en[key]

describe('触发面板的摘要', () => {
  it('过滤：什么都不筛时一句「不过滤」', () => {
    expect(filterSummary(t, { merge: 0, dedupe: 0, include: [], exclude: [] })).toBe('不过滤')
  })

  it('过滤：只列开着的几项，按合并、去重、包含、排除的顺序', () => {
    expect(
      filterSummary(t, { merge: 5, dedupe: 10, include: ['ERROR', 'FATAL'], exclude: ['test'] }),
    ).toBe('合并 5 秒内的 · 10 分钟内去重 · 含「ERROR、FATAL」才触发 · 含「test」不触发')
    expect(filterSummary(tEn, { merge: 0, dedupe: 0, include: [], exclude: ['a', 'b'] })).toBe(
      'Skip with “a, b”',
    )
  })

  it('保护：缺省值也写出来（让人知道有这几样）；关了补触发才多一句', () => {
    const base = {
      session: 'new' as const,
      overlap: 'skip' as const,
      catchUp: true,
      maxPerHour: 12,
      maxFailures: 3,
    }
    expect(guardSummary(t, base)).toBe('没跑完时跳过 · 每小时最多 12 次 · 连续 3 次失败停用')
    expect(guardSummary(tEn, { ...base, overlap: 'parallel', catchUp: false })).toBe(
      'Run alongside · Max 12 per hour · Off after 3 failures · No catch-up',
    )
  })

  it('触发方式的第二行：定时写下一次；「每隔」开着时以宿主排的为准', () => {
    const now = new Date(2026, 10, 13, 10, 0)
    const daily = whenDetail(
      t,
      { kind: 'schedule', schedule: { kind: 'daily', time: '02:30' } },
      {},
      now,
    )
    expect(daily.tone).toBe('plain')
    expect(daily.text).toMatch(/^下一次：.*02:30$/u)
    const live = new Date(2026, 10, 13, 10, 42).getTime()
    const every = whenDetail(
      t,
      { kind: 'schedule', schedule: { kind: 'every', minutes: 60 } },
      { next: live },
      now,
    )
    expect(every.text).toMatch(/10:42/u)
  })

  it('触发方式的第二行：轮询写命令；监听在速览显示程序的行时才写命令', () => {
    const now = new Date()
    const poll = { kind: 'poll', command: 'git ls-remote', seconds: 300, when: 'change' } as const
    expect(whenDetail(t, poll, {}, now)).toEqual({ text: 'git ls-remote', tone: 'code' })
    const listen = { kind: 'listen', command: 'node tail.mjs' } as const
    expect(whenDetail(t, listen, {}, now)).toEqual({
      text: '程序每打出一行触发一次',
      tone: 'plain',
    })
    expect(whenDetail(t, listen, { line: 'ERROR x' }, now)).toEqual({
      text: 'node tail.mjs',
      tone: 'code',
    })
  })

  it('还差东西时：缺命令、缺工作流不重复速览的红字，规则写错用红字；按钮换成补上的那件事', () => {
    const now = new Date()
    const noCommand = { kind: 'listen', command: '' } as const
    expect(whenDetail(t, noCommand, {}, now)).toEqual({
      text: '写好命令才能打开开关',
      tone: 'plain',
    })
    expect(whenActionKey(noCommand)).toBe('trigger.fix.command')
    const noWorkflow = { kind: 'after', workflow: '' } as const
    expect(whenActionKey(noWorkflow)).toBe('trigger.fix.workflow')
    const badCron = { kind: 'schedule', schedule: { kind: 'cron', expression: '1 2' } } as const
    expect(whenDetail(t, badCron, {}, now).tone).toBe('problem')
    expect(whenActionKey(badCron)).toBe('trigger.fix.rule')
    expect(whenActionKey({ kind: 'http' })).toBe('trigger.edit')
  })
})
