/**
 * 触发卡片状态后面那枚问题图标说什么：画布面板和「触发」页共用的 problemOf。
 */
import { describe, expect, it } from 'vitest'
import { type LocaleKey, zh } from '../../src/client/i18n.ts'
import { problemOf } from '../../src/client/model/triggerProblem.ts'
import type { TriggerData } from '../../src/shared/types.ts'
import type { TriggerView } from '../../src/shared/wire/trigger.ts'

const t = (key: LocaleKey): string => zh[key]
const listen: TriggerData = { source: { kind: 'listen', command: 'node watch.js' } }
const http: TriggerData = { source: { kind: 'http' } }
// 缺省开着「记录运行状态」（跳过、排队判断得了）。
const view = (patch: Partial<TriggerView>): TriggerView => ({
  node: 'n',
  enabled: true,
  state: 'waiting',
  runState: true,
  ...patch,
})
const NOW = 1_000_000_000

describe('problemOf', () => {
  it('没事的状态不亮图标', () => {
    expect(problemOf(t, view({ state: 'waiting' }), listen, undefined)).toBeNull()
    expect(problemOf(t, view({ state: 'listening' }), listen, undefined)).toBeNull()
    expect(problemOf(t, view({ state: 'off', enabled: false }), http, undefined)).toBeNull()
    expect(problemOf(t, view({ state: 'off', enabled: false }), listen, undefined)).toBeNull()
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

  it('别的进程在负责：知道是谁才说', () => {
    expect(problemOf(t, view({ state: 'elsewhere' }), listen, undefined)).toBeNull()
    expect(problemOf(t, view({ state: 'elsewhere' }), listen, 4242)?.text).toContain('4242')
  })

  it('跳过、排队却没开「记录运行状态」：关着、设置有误时都提醒，带「去打开」；同时运行不提醒', () => {
    const off = problemOf(
      t,
      view({ state: 'off', enabled: false, runState: undefined }),
      http,
      undefined,
    )
    expect(off).toEqual({
      text: t('trigger.needsRunState'),
      tone: 'warn',
      action: { label: 'trigger.afterEnable', run: 'runState' },
    })
    const invalid = view({ state: 'invalid', runState: undefined, problem: '宿主的原因' })
    expect(problemOf(t, invalid, http, undefined)?.action?.run).toBe('runState')
    const parallel: TriggerData = { ...http, launch: { overlap: 'parallel' } }
    expect(
      problemOf(
        t,
        view({ state: 'off', enabled: false, runState: undefined }),
        parallel,
        undefined,
      ),
    ).toBeNull()
  })

  it('跳过的上次执行一直没结束：说上次执行现在怎样，带「视为已结束」；有排着的不在这里说', () => {
    const waiting = {
      fire: 'f',
      at: NOW,
      session: 's',
      instance: '20261117-100109-c967',
      status: 'waiting' as const,
      since: NOW,
    }
    const stuck = problemOf(t, view({ state: 'listening', waiting }), listen, undefined, NOW)
    expect(stuck?.tone).toBe('warn')
    expect(stuck?.text).toBe('上次执行未结束，最近的触发已跳过（实例 c967 等待回复）。')
    expect(stuck?.action?.run).toBe('waive')
    expect(
      problemOf(t, view({ state: 'listening', waiting, queued: 2 }), listen, undefined, NOW),
    ).toBeNull()
  })
})
