/**
 * 「等待上次执行结束」后面那半句：上次执行现在怎样（还没开始 / 执行中 / 等待回复 / 没有运行状态）。
 */
import { describe, expect, it } from 'vitest'
import { type LocaleKey, zh } from '../../src/client/i18n.ts'
import { prevRunText, shortInstance } from '../../src/client/model/prevRun.ts'

const t = (key: LocaleKey): string => zh[key]
const NOW = 1_000_000_000
const ID = '20261117-100109-c967'

describe('prevRunText', () => {
  it('实例编号只取认得出它的那一段', () => {
    expect(shortInstance(ID)).toBe('c967')
  })

  it('还没对上实例：发出去多久了、还没开始执行', () => {
    expect(prevRunText(t, { fire: 'f', at: NOW, since: NOW - 12 * 60_000 }, NOW)).toEqual({
      text: '尚未开始执行 · 12 分前触发',
      phase: 'unstarted',
      tone: 'plain',
    })
  })

  it('执行中（含刚建出来还是 pending 的）：多久前更新过；等回复用提醒色；没有状态文件照实说', () => {
    expect(
      prevRunText(
        t,
        { fire: 'f', at: NOW, instance: ID, status: 'running', since: NOW - 3 * 60_000 },
        NOW,
      ),
    ).toEqual({ text: '实例 c967 执行中 · 3 分前更新', phase: 'running', tone: 'plain' })
    expect(
      prevRunText(t, { fire: 'f', at: NOW, instance: ID, status: 'pending', since: NOW }, NOW).text,
    ).toBe('实例 c967 执行中 · 0 秒前更新')
    expect(
      prevRunText(t, { fire: 'f', at: NOW, instance: ID, status: 'waiting', since: NOW }, NOW),
    ).toEqual({
      text: '实例 c967 等待回复',
      phase: 'waiting',
      tone: 'warn',
    })
    expect(prevRunText(t, { fire: 'f', at: NOW, instance: ID, since: NOW }, NOW).text).toBe(
      '实例 c967 没有运行状态',
    )
  })
})
