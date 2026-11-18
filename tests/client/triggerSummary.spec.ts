import { describe, expect, it } from 'vitest'
import { en, type LocaleKey, zh } from '../../src/client/i18n.ts'
import {
  filterSummary,
  guardBrief,
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
      queueMax: 10,
    }
    expect(guardSummary(t, base)).toBe(
      '上次执行未结束时跳过 · 每小时最多 12 次 · 连续 3 次失败停用',
    )
    expect(guardSummary(tEn, { ...base, overlap: 'parallel', catchUp: false })).toBe(
      'Overlapping runs allowed · Max 12 per hour · Off after 3 failures · Missed triggers not run',
    )
    expect(guardSummary(t, { ...base, overlap: 'queue' })).toBe(
      '上次执行未结束时排队，最多 10 个 · 每小时最多 12 次 · 连续 3 次失败停用',
    )
    expect(guardSummary(t, { ...base, overlap: 'queue', queueMax: 0 })).toMatch(
      /^上次执行未结束时排队 · /u,
    )
    expect(guardBrief(t, { ...base, overlap: 'queue' })).toBe(
      '运行中排队 · 12 次/时 · 3 次失败停用',
    )
    const open = { ...base, maxPerHour: 0, maxFailures: 0 }
    expect(guardSummary(t, open)).toBe('上次执行未结束时跳过 · 每小时不限次数 · 失败不自动停用')
    expect(guardBrief(t, open)).toBe('运行中跳过 · 不限次数 · 失败不停用')
    expect(guardBrief(t, base)).toBe('运行中跳过 · 12 次/时 · 3 次失败停用')
    expect(guardBrief(t, { ...base, overlap: 'parallel', catchUp: false })).toBe(
      '可同时运行 · 12 次/时 · 3 次失败停用 · 不补发',
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
      { kind: 'schedule', schedule: { kind: 'every', seconds: 3600 } },
      { next: live },
      now,
    )
    expect(every.text).toMatch(/10:42/u)
  })

  it('触发方式的第二行：轮询写命令；监听在速览显示程序的行时才写命令', () => {
    const now = new Date()
    const check = {
      kind: 'schedule',
      schedule: { kind: 'every', seconds: 300 },
      check: { command: 'git ls-remote', when: 'change' },
    } as const
    expect(whenDetail(t, check, {}, now)).toEqual({ text: 'git ls-remote', tone: 'code' })
    const listen = { kind: 'listen', command: 'node tail.mjs' } as const
    expect(whenDetail(t, listen, {}, now)).toEqual({
      text: '程序每打出一行 ::trigger:: 触发一次',
      tone: 'plain',
    })
    expect(whenDetail(t, listen, { line: 'ERROR x' }, now)).toEqual({
      text: 'node tail.mjs',
      tone: 'code',
    })
  })

  it('触发方式的第二行：HTTP 有了地址写谁能访问，没有地址、接续不写', () => {
    const now = new Date()
    const http = { kind: 'http' } as const
    expect(whenDetail(t, http, {}, now).text).toBe('')
    expect(whenDetail(t, http, { url: 'http://127.0.0.1:3791/trigger/ci' }, now).text).toBe(
      '只有这台电脑上的程序能访问',
    )
    expect(whenDetail(t, http, { url: 'http://192.168.1.5:3791/trigger/ci' }, now).text).toBe(
      '同一网络里的其他机器也能访问',
    )
    expect(whenDetail(t, { kind: 'after', workflow: '夜间巡检' }, {}, now).text).toBe('')
  })

  it('还差东西时：缺命令、缺工作流不重复速览的红字，规则写错用红字；按钮换成补上的那件事', () => {
    const now = new Date()
    const noCommand = { kind: 'listen', command: '' } as const
    expect(whenDetail(t, noCommand, {}, now)).toEqual({
      text: '写好命令才能启用',
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
