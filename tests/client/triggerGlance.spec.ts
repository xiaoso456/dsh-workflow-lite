import { describe, expect, it } from 'vitest'
import { en, type LocaleKey, zh } from '../../src/client/i18n.ts'
import {
  checkProgress,
  endpointPath,
  triggerGlance,
  triggerMode,
} from '../../src/client/model/triggerGlance.ts'
import { stateTone } from '../../src/client/model/triggerText.ts'
import type { TriggerSchedule } from '../../src/shared/types.ts'

const t = (key: LocaleKey): string => zh[key]
const tEn = (key: LocaleKey): string => en[key]

describe('触发卡片的速览', () => {
  it('定时每天 / 每周几：七格，选中的那几天亮；没写星期就是七天全亮', () => {
    const workdays = triggerGlance(t, {
      kind: 'schedule',
      schedule: { kind: 'daily', time: '02:30', weekdays: [1, 2, 3, 4, 5] },
    })
    expect(workdays).toEqual({
      shape: 'days',
      time: '02:30',
      days: ['一', '二', '三', '四', '五', '六', '日'].map((label, index) => ({
        label,
        on: index < 5,
      })),
    })
    const daily = triggerGlance(tEn, {
      kind: 'schedule',
      schedule: { kind: 'daily', time: '09:00' },
    })
    expect(daily.shape === 'days' && daily.days.map((day) => `${day.label}${day.on}`)).toEqual(
      ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((label) => `${label}true`),
    )
  })

  it('定时每隔多久、cron 各说各的', () => {
    expect(
      triggerGlance(t, { kind: 'schedule', schedule: { kind: 'every', seconds: 7200 } }),
    ).toEqual({ shape: 'every', text: '每 2 小时' })
    expect(
      triggerGlance(t, { kind: 'schedule', schedule: { kind: 'cron', expression: ' 0 9 * * 1 ' } }),
    ).toEqual({ shape: 'cron', expression: '0 9 * * 1' })
  })

  it('定时检查：规则 + 什么时候算满足；「每隔」的带上间隔给进度条，没写命令只说缺什么', () => {
    const checked = (
      schedule: TriggerSchedule,
      when: 'every' | 'success' | 'change' = 'every',
      command = 'x',
    ) => ({ kind: 'schedule', schedule, check: { command, when } }) as const
    expect(triggerGlance(t, checked({ kind: 'every', seconds: 300 }, 'change'))).toEqual({
      shape: 'check',
      rule: '每 5 分钟',
      when: '输出变化',
      seconds: 300,
    })
    expect(triggerGlance(t, checked({ kind: 'every', seconds: 45 }, 'success'))).toMatchObject({
      rule: '每 45 秒',
      when: '变为成功',
    })
    expect(triggerGlance(tEn, checked({ kind: 'every', seconds: 7200 }))).toMatchObject({
      rule: 'Every 2 h',
    })
    expect(triggerGlance(t, checked({ kind: 'daily', time: '09:00' }))).toEqual({
      shape: 'check',
      rule: '每天 09:00',
      when: '每次成功',
    })
    expect(triggerGlance(t, checked({ kind: 'every', seconds: 60 }, 'every', ' '))).toEqual({
      shape: 'empty',
      text: '还没写要运行的命令',
    })
  })

  it('监听、HTTP、接续；没填好的只说缺什么', () => {
    expect(triggerGlance(t, { kind: 'listen', command: ' tail -f app.log ' })).toEqual({
      shape: 'listen',
      command: 'tail -f app.log',
    })
    expect(triggerGlance(t, { kind: 'listen', command: '  ' })).toEqual({
      shape: 'empty',
      text: '还没写要运行的命令',
    })
    expect(triggerGlance(t, { kind: 'http' })).toEqual({
      shape: 'http',
      idle: '启用后给出地址',
    })
    expect(triggerGlance(t, { kind: 'after', workflow: '夜间巡检', when: 'failed' })).toEqual({
      shape: 'after',
      workflow: '夜间巡检',
      when: '失败时',
    })
    expect(triggerGlance(t, { kind: 'after', workflow: '' })).toEqual({
      shape: 'empty',
      text: '还没选工作流',
    })
  })

  it('主动：定时（带不带检查）；被动：监听、HTTP、接续', () => {
    expect(
      ['schedule', 'listen', 'http', 'after'].map((kind) => triggerMode(kind as never)),
    ).toEqual(['active', 'passive', 'passive', 'passive'])
  })

  it('地址只留端口和路径', () => {
    expect(endpointPath('http://127.0.0.1:3791/trigger/7f3a9c')).toBe(':3791/trigger/7f3a9c')
    expect(endpointPath('not a url')).toBe('not a url')
  })

  it('检查进度：从这一段的起点算起，越界夹住；没有下一次就没有进度', () => {
    expect(checkProgress(10_000 + 60_000, 120, 10_000)).toEqual({ from: 0.5, left: 60_000 })
    expect(checkProgress(5_000, 60, 10_000)).toEqual({ from: 1, left: 0 })
    expect(checkProgress(10_000 + 999_000, 60, 10_000)).toEqual({ from: 0, left: 999_000 })
    expect(checkProgress(undefined, 60, 10_000)).toBeNull()
    expect(checkProgress(20_000, 0, 10_000)).toBeNull()
  })
})

describe('触发状态的颜色分组', () => {
  it('等时间的等待中和盯着外面的接收中分开；定时检查开着算盯着外面', () => {
    expect(stateTone('waiting', 'schedule')).toBe('armed')
    expect(stateTone('waiting', 'after')).toBe('armed')
    expect(stateTone('waiting', 'check')).toBe('live')
    expect(stateTone('listening', 'listen')).toBe('live')
    expect(stateTone('listening', 'http')).toBe('live')
    expect(stateTone('off', 'check')).toBe('off')
    expect(stateTone('elsewhere', 'schedule')).toBe('other')
    expect(
      ['confirm', 'paused', 'restarting', 'unavailable'].map((s) =>
        stateTone(s as never, 'listen'),
      ),
    ).toEqual(['warn', 'warn', 'warn', 'warn'])
    expect(['error', 'invalid', 'stopped'].map((s) => stateTone(s as never, 'http'))).toEqual([
      'bad',
      'bad',
      'bad',
    ])
  })
})
