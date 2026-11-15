/**
 * 触发卡片状态后面那枚问题图标说什么：画布面板和「触发」页共用的 problemOf。
 */
import { describe, expect, it } from 'vitest'
import { type LocaleKey, zh } from '../../src/client/i18n.ts'
import { problemOf } from '../../src/client/model/triggerProblem.ts'
import type { TriggerSource } from '../../src/shared/types.ts'
import type { TriggerView } from '../../src/shared/wire/trigger.ts'

const t = (key: LocaleKey): string => zh[key]
const listen: TriggerSource = { kind: 'listen', command: 'node watch.js' }
const http: TriggerSource = { kind: 'http' }
const view = (patch: Partial<TriggerView>): TriggerView => ({
  node: 'n',
  enabled: true,
  state: 'waiting',
  ...patch,
})

describe('problemOf', () => {
  it('没事的状态不亮图标', () => {
    expect(problemOf(t, view({ state: 'waiting' }), listen, undefined)).toBeNull()
    expect(problemOf(t, view({ state: 'listening' }), listen, undefined)).toBeNull()
    expect(problemOf(t, view({ state: 'off', enabled: false }), http, undefined)).toBeNull()
    expect(
      problemOf(t, view({ state: 'off', enabled: false, approved: true }), listen, undefined),
    ).toBeNull()
  })

  it('出错、重启中按宿主给的原因说，颜色分得开', () => {
    const problem = '监视程序运行 1 秒后退出了（退出码 1）'
    expect(problemOf(t, view({ state: 'error', problem }), listen, undefined)).toEqual({
      text: problem,
      tone: 'bad',
    })
    expect(problemOf(t, view({ state: 'restarting', problem }), listen, undefined)).toEqual({
      text: problem,
      tone: 'warn',
    })
  })

  it('自动停用了：原因后面接一句怎么办，带「重新打开」', () => {
    const got = problemOf(t, view({ state: 'stopped', problem: '连续失败' }), listen, undefined)
    expect(got?.tone).toBe('bad')
    expect(got?.text.startsWith('连续失败 ')).toBe(true)
    expect(got?.action?.run).toBe('reopen')
  })

  it('命令待确认、要跑命令还没确认过：带确认的按钮', () => {
    expect(problemOf(t, view({ state: 'confirm' }), listen, undefined)?.action?.run).toBe('approve')
    const off = problemOf(t, view({ state: 'off', enabled: false }), listen, undefined)
    expect(off?.tone).toBe('calm')
    expect(off?.action?.run).toBe('approve')
  })

  it('别的进程在负责：知道是谁才说', () => {
    expect(problemOf(t, view({ state: 'elsewhere' }), listen, undefined)).toBeNull()
    expect(problemOf(t, view({ state: 'elsewhere' }), listen, 4242)?.text).toContain('4242')
  })
})
