/**
 * 「触发方式」对话框背后的纯计算：顶上那句话、接下来 7 天、调用示例、命令模板、常用规则、定时分两步。
 */

import { describe, expect, it } from 'vitest'
import { en as enText, type LocaleKey, zh } from '../../src/client/i18n.ts'
import { CHECK_TEMPLATES, LISTEN_TEMPLATES } from '../../src/client/model/commandTemplates.ts'
import { SAMPLE_BODY, SNIPPET_LANGS, snippetOf } from '../../src/client/model/httpSnippets.ts'
import { sourceSay } from '../../src/client/model/triggerSay.ts'
import { fillSay, spanText } from '../../src/client/model/triggerText.ts'
import { DAY_DOTS_MAX, WEEK_DAYS, weekOf } from '../../src/client/model/triggerWeek.ts'
import {
  EVERY_PRESETS,
  SCHEDULE_PRESETS,
  sameSchedule,
} from '../../src/client/ui/trigger/source/SchedulePresets.tsx'
import { hasCommandPage, pageOf } from '../../src/client/ui/trigger/source/schedulePages.ts'
import { EVERY_MAX, scheduleIssue } from '../../src/shared/schedule.ts'
import { PLAIN_EVERY_MIN } from '../../src/shared/trigger.ts'

const t = (key: LocaleKey): string => zh[key]
const en = (key: LocaleKey): string => enText[key]

/** 带检查命令的定时。 */
const checked = (
  seconds: number,
  when: 'every' | 'success' | 'change' = 'every',
  command = 'git status',
) =>
  ({
    kind: 'schedule',
    schedule: { kind: 'every', seconds },
    check: { command, when },
  }) as const

describe('顶上那句话', () => {
  it('占位换成值，没给值的原样留着', () => {
    expect(fillSay('每{every}跑一次，{when}时执行{x}', { every: '5 分钟', when: '变了' })).toBe(
      '每 5 分钟跑一次，变了时执行{x}',
    )
  })

  it('换进去的值和汉字、字母、数字挨着时补空格', () => {
    expect(fillSay('发{method}请求', { method: 'POST' })).toBe('发 POST 请求')
    expect(fillSay('{rule}执行一次', { rule: '每天 18:00' })).toBe('每天 18:00 执行一次')
    expect(fillSay('{name}执行{result}之后', { name: '夜间巡检', result: '失败' })).toBe(
      '夜间巡检执行失败之后',
    )
    expect(fillSay('Runs {rule}', { rule: 'daily' })).toBe('Runs daily')
  })

  it('间隔按整小时、整分钟、秒写', () => {
    expect(spanText(t, 7200)).toBe('2 小时')
    expect(spanText(t, 300)).toBe('5 分钟')
    expect(spanText(t, 45)).toBe('45 秒')
    expect(spanText(en, 90)).toBe('90 s')
  })

  it('各种触发方式各说一句；定时带检查的说先跑命令', () => {
    expect(sourceSay(t, checked(300, 'change'))).toBe('每 5 分钟跑一次命令，输出和上一次不同时执行')
    expect(sourceSay(t, checked(60, 'success'))).toBe('每 1 分钟跑一次命令，由失败变为成功时执行')
    expect(sourceSay(t, checked(30))).toBe('每 30 秒跑一次命令，成功时执行')
    expect(
      sourceSay(t, {
        kind: 'schedule',
        schedule: { kind: 'daily', time: '09:00' },
        check: { command: 'x', when: 'every' },
      }),
    ).toBe('每天 09:00 跑一次命令，成功时执行')

    const listen = sourceSay(en, { kind: 'listen', command: 'node watch.mjs' })
    expect(listen).toBe('Keeps a program running and fires on every line it prints')
    expect(sourceSay(t, { kind: 'listen', command: '' })).toBe(t('trigger.say.listenNone'))

    expect(sourceSay(t, { kind: 'http' })).toContain('POST')

    expect(sourceSay(t, { kind: 'after', workflow: '构建', when: 'failed' })).toContain('构建')
    expect(sourceSay(t, { kind: 'after', workflow: '' })).toBe(t('trigger.say.afterNone'))

    const daily = sourceSay(t, { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } })
    expect(daily).toContain('09:00')
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
    const week = weekOf({ kind: 'every', seconds: 300 }, now)
    const tomorrow = week.days[1]
    expect(tomorrow?.dense).toBe(true)
    expect(tomorrow?.fires).toEqual([])
    expect(tomorrow?.count).toBeGreaterThan(DAY_DOTS_MAX)
  })

  it('按秒的间隔也排满 7 天，次数按间隔数', () => {
    const now = new Date(2026, 10, 16, 20, 0).getTime()
    const week = weekOf({ kind: 'every', seconds: 30 }, now)
    expect(week.days.every((day) => day.dense)).toBe(true)
    expect(week.days[6]?.count).toBe(2880)
    expect(week.days[0]?.count).toBe(4 * 120 - 1)
    expect(week.upcoming).toBe(week.days.reduce((sum, day) => sum + day.count, 0))
    expect(week.next?.at).toBe(now + 30_000)
  })

  it('「每隔多久」开着时从宿主排好的那次往后排', () => {
    const live = now + 20 * 60_000
    const week = weekOf({ kind: 'every', seconds: 3600 }, now, live)
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

  it('不要令牌时示例里不带 Authorization，其余照旧', () => {
    for (const lang of SNIPPET_LANGS) {
      const code = snippetOf(lang, { url: 'http://127.0.0.1:3791/trigger/abc', token: null })
      expect(code).not.toContain('Authorization')
      expect(code).toContain('http://127.0.0.1:3791/trigger/abc')
      expect(code).toContain('"event":"deploy"')
    }
  })

  it('模板的 id 不重复，说明两种语言都有', () => {
    for (const list of [CHECK_TEMPLATES, LISTEN_TEMPLATES]) {
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

describe('常用规则', () => {
  it('间隔的常用档到点就执行也能用（不短于 1 分钟），名字按秒数说', () => {
    for (const seconds of EVERY_PRESETS) {
      expect(seconds).toBeGreaterThanOrEqual(PLAIN_EVERY_MIN)
      expect(seconds).toBeLessThanOrEqual(EVERY_MAX)
    }
    expect(EVERY_PRESETS.map((seconds) => spanText(t, seconds))).toEqual([
      '1 分钟',
      '15 分钟',
      '1 小时',
      '1 天',
    ])
  })

  it('和上面的规则一样才亮：键的先后不算', () => {
    expect(
      sameSchedule(
        { kind: 'daily', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
        { weekdays: [1, 2, 3, 4, 5], time: '09:00', kind: 'daily' },
      ),
    ).toBe(true)
    expect(sameSchedule({ kind: 'every', seconds: 900 }, { kind: 'every', seconds: 901 })).toBe(
      false,
    )
  })

  it('常用规则都写得对、归在自己那种规则下，id 不重复', () => {
    const all = Object.entries(SCHEDULE_PRESETS).flatMap(([kind, list]) =>
      list.map((preset) => ({ kind, preset })),
    )
    for (const { kind, preset } of all) {
      expect(scheduleIssue(preset.schedule)).toBeNull()
      expect(preset.schedule.kind).toBe(kind)
    }
    const ids = all.map(({ preset }) => preset.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('定时分两步', () => {
  const plain = { kind: 'schedule', schedule: { kind: 'every', seconds: 3600 } } as const

  it('判定要跑命令才有第二步', () => {
    expect(hasCommandPage(checked(60))).toBe(true)
    expect(hasCommandPage(plain)).toBe(false)
    expect(hasCommandPage({ kind: 'http' })).toBe(false)
  })

  it('没有第二步时总停在第一步，换回带命令的判定回到想去的那一步', () => {
    expect(pageOf(checked(60), 'command')).toBe('command')
    expect(pageOf(checked(60), 'time')).toBe('time')
    expect(pageOf(plain, 'command')).toBe('time')
  })
})
