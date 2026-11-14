/**
 * 「触发方式」对话框背后的纯计算：顶上那句话、接下来 7 天、调用示例、命令模板、间隔滑条、常用规则。
 */

import { describe, expect, it } from 'vitest'
import { en as enText, type LocaleKey, zh } from '../../src/client/i18n.ts'
import { LISTEN_TEMPLATES, POLL_TEMPLATES } from '../../src/client/model/commandTemplates.ts'
import { SAMPLE_BODY, SNIPPET_LANGS, snippetOf } from '../../src/client/model/httpSnippets.ts'
import { fillSay, programName, sourceSay, spanText } from '../../src/client/model/triggerSay.ts'
import { DAY_DOTS_MAX, WEEK_DAYS, weekOf } from '../../src/client/model/triggerWeek.ts'
import { INTERVAL_STOPS, stopOf } from '../../src/client/ui/trigger/source/IntervalField.tsx'
import { SCHEDULE_PRESETS } from '../../src/client/ui/trigger/source/ScheduleStage.tsx'
import { scheduleIssue } from '../../src/shared/schedule.ts'
import { POLL_MAX_SECONDS, POLL_MIN_SECONDS } from '../../src/shared/trigger.ts'

const t = (key: LocaleKey): string => zh[key]
const en = (key: LocaleKey): string => enText[key]
const said = (segments: { text: string }[]): string => segments.map((s) => s.text).join('')

describe('顶上那句话', () => {
  it('占位换成上色的一段，没给值的原样留着', () => {
    expect(fillSay('每{every}跑一次，{when}时执行{x}', { every: '5 分钟', when: '变了' })).toEqual([
      { text: '每' },
      { text: '5 分钟', token: true },
      { text: '跑一次，' },
      { text: '变了', token: true },
      { text: '时执行' },
      { text: '{x}' },
    ])
  })

  it('间隔按整小时、整分钟、秒写', () => {
    expect(spanText(t, 7200)).toBe('2 小时')
    expect(spanText(t, 300)).toBe('5 分钟')
    expect(spanText(t, 45)).toBe('45 秒')
    expect(spanText(en, 90)).toBe('90 s')
  })

  it('程序名取脚本文件，没有就取命令本身', () => {
    expect(programName('node "{workflow}/watch.mjs" --once')).toBe('watch.mjs')
    expect(programName('python C:\\tools\\tail.py app.log')).toBe('tail.py')
    expect(programName('/usr/bin/git ls-remote origin')).toBe('git')
    expect(programName('   ')).toBe('')
  })

  it('五种触发方式各说一句，关键处上色', () => {
    const poll = sourceSay(t, { kind: 'poll', command: 'git status', seconds: 300, when: 'change' })
    expect(said(poll)).toBe('每5 分钟跑一次命令，输出和上一次不一样时执行')
    expect(poll.filter((s) => s.token).map((s) => s.text)).toEqual(['5 分钟', '输出和上一次不一样'])

    const listen = sourceSay(en, { kind: 'listen', command: 'node watch.mjs' })
    expect(said(listen)).toBe('Keeps watch.mjs running and fires on every line it prints')
    expect(said(sourceSay(t, { kind: 'listen', command: '' }))).toBe(t('trigger.say.listenNone'))

    expect(said(sourceSay(t, { kind: 'http' }))).toContain('POST')

    const after = sourceSay(t, { kind: 'after', workflow: '构建', when: 'failed' })
    expect(after.filter((s) => s.token).map((s) => s.text)).toEqual(['构建', '失败'])
    expect(said(sourceSay(t, { kind: 'after', workflow: '' }))).toBe(t('trigger.say.afterNone'))

    const daily = sourceSay(t, { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } })
    expect(daily.some((s) => s.token === true && s.text.includes('09:00'))).toBe(true)
  })
})

describe('接下来 7 天', () => {
  // 2026-11-11 是周三；现在是当天 12:00（本地时间）。
  const now = new Date(2026, 10, 11, 12, 0).getTime()

  it('每天一行，从今天起排 7 天，星期按 ISO 写', () => {
    const week = weekOf({ kind: 'daily', time: '09:00' }, now)
    expect(week.days).toHaveLength(WEEK_DAYS)
    expect(week.days.map((day) => day.weekday)).toEqual([3, 4, 5, 6, 7, 1, 2])
    expect(week.now).toBeCloseTo(0.5)
  })

  it('今天已经过去的那次画成空心，下一次在明天', () => {
    const week = weekOf({ kind: 'daily', time: '09:00' }, now)
    const [today, tomorrow] = week.days
    expect(today?.past).toHaveLength(1)
    expect(today?.past[0]).toBeCloseTo(9 / 24)
    expect(today?.fires).toEqual([])
    expect(tomorrow?.fires).toHaveLength(1)
    expect(week.next?.ahead).toBe(1)
    expect(week.next?.at).toBe(new Date(2026, 10, 12, 9, 0).getTime())
  })

  it('只在工作日的规则，周末两天是空的', () => {
    const week = weekOf({ kind: 'daily', time: '09:00', weekdays: [1, 2, 3, 4, 5] }, now)
    const weekend = week.days.filter((day) => day.weekday >= 6)
    expect(weekend.map((day) => day.count)).toEqual([0, 0])
  })

  it('一天里次数太多画成一条，次数照数', () => {
    const week = weekOf({ kind: 'every', minutes: 5 }, now)
    const tomorrow = week.days[1]
    expect(tomorrow?.dense).toBe(true)
    expect(tomorrow?.fires).toEqual([])
    expect(tomorrow?.count).toBeGreaterThan(DAY_DOTS_MAX)
  })

  it('「每隔多久」开着时从宿主排好的那次往后排', () => {
    const live = now + 20 * 60_000
    const week = weekOf({ kind: 'every', minutes: 60 }, now, live)
    expect(week.next?.at).toBe(live)
    // 今天早些时候的说不准，不画。
    expect(week.days[0]?.past).toEqual([])
  })

  it('规则写错时什么都不排', () => {
    const week = weekOf({ kind: 'cron', expression: 'not a cron' }, now)
    expect(week.next).toBeUndefined()
    expect(week.days.every((day) => day.count === 0)).toBe(true)
  })
})

describe('调用示例与命令模板', () => {
  it('四种写法都带上地址、令牌和示例请求体', () => {
    for (const lang of SNIPPET_LANGS) {
      const code = snippetOf(lang, { url: 'http://127.0.0.1:3791/trigger/abc', token: 'tok' })
      expect(code).toContain('http://127.0.0.1:3791/trigger/abc')
      expect(code).toContain('Bearer tok')
      expect(code).toContain('"event":"deploy"')
    }
    expect(JSON.parse(SAMPLE_BODY)).toEqual({ event: 'deploy', ref: 'main' })
  })

  it('模板的 id 不重复，说明两种语言都有', () => {
    for (const list of [POLL_TEMPLATES, LISTEN_TEMPLATES]) {
      const ids = list.map((item) => item.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const item of list) {
        expect(item.command.trim()).not.toBe('')
        expect(zh[item.label] && enText[item.label]).toBeTruthy()
        expect(zh[item.desc] && enText[item.desc]).toBeTruthy()
      }
    }
  })
})

describe('间隔滑条与常用规则', () => {
  it('滑块停在不超过间隔的最大一档', () => {
    expect(stopOf(5)).toBe(0)
    expect(stopOf(10)).toBe(0)
    expect(stopOf(59)).toBe(1)
    expect(stopOf(300)).toBe(INTERVAL_STOPS.indexOf(300))
    expect(stopOf(10 ** 9)).toBe(INTERVAL_STOPS.length - 1)
  })

  it('滑条的每一档都在允许的间隔里', () => {
    for (const stop of INTERVAL_STOPS) {
      expect(stop).toBeGreaterThanOrEqual(POLL_MIN_SECONDS)
      expect(stop).toBeLessThanOrEqual(POLL_MAX_SECONDS)
    }
  })

  it('常用规则都写得对，id 不重复', () => {
    for (const preset of SCHEDULE_PRESETS) expect(scheduleIssue(preset.schedule)).toBeNull()
    const ids = SCHEDULE_PRESETS.map((preset) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
