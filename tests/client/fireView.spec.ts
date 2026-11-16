import { describe, expect, it } from 'vitest'
import { type LocaleKey, type T, zh } from '../../src/client/i18n.ts'
import {
  countKinds,
  dayHead,
  fireKind,
  fireWhy,
  groupByDay,
} from '../../src/client/model/fireView.ts'
import { pastTime } from '../../src/client/model/time.ts'
import type { FireRecord } from '../../src/shared/wire/trigger.ts'

const t = ((key: string) =>
  key === 'trigger.fire.today'
    ? '今天'
    : key === 'trigger.fire.yesterday' || key === 'common.yesterday'
      ? '昨天'
      : key) as T

const at = (month: number, day: number, hour = 9, minute = 0, year = 2026): number =>
  new Date(year, month - 1, day, hour, minute).getTime()

function fire(when: number, extra: Partial<FireRecord> = {}): FireRecord {
  return {
    id: `f-${when}`,
    workflow: 'w',
    node: 'n',
    name: '夜巡',
    channel: 'schedule',
    at: when,
    outcome: 'sent',
    ...extra,
  }
}

describe('触发记录的显示', () => {
  it('发出去了但模型判断不需要的单独算一类，原因用模型给的', () => {
    const declined = fire(at(11, 14), { declined: '没有新提交', reason: '别的' })
    expect(fireKind(declined)).toBe('declined')
    expect(fireWhy(declined)).toBe('没有新提交')
    expect(fireKind(fire(at(11, 14), { outcome: 'failed', reason: '没选工作区' }))).toBe('failed')
    expect(fireWhy(fire(at(11, 14)))).toBeUndefined()
  })

  it('时刻：今天只写钟点，昨天带「昨天」，再早写月日', () => {
    const now = at(11, 14, 10, 0)
    expect(pastTime(t, at(11, 14, 9, 22), now)).toBe('09:22')
    // 按日历日算：昨天 23:50 离现在不到 24 小时，也是昨天。
    expect(pastTime(t, at(11, 13, 23, 50), now)).toBe('昨天 23:50')
    expect(pastTime(t, at(11, 12, 2, 30), now)).toBe('11-12 02:30')
  })

  it('一天的小标题：今天 / 昨天 / 明天、一周内叫周几、再远叫日期，不是今年的旁边带年份', () => {
    const zt = ((key: LocaleKey) => zh[key]) as T
    // 2026-11-14 是周六。
    const now = at(11, 14, 10, 0)
    expect(dayHead(zt, at(11, 14, 0, 0), now)).toEqual({ name: '今天', date: '11月14日 周六' })
    expect(dayHead(zt, at(11, 13, 0, 0), now)).toEqual({ name: '昨天', date: '11月13日 周五' })
    expect(dayHead(zt, at(11, 15, 0, 0), now)).toEqual({ name: '明天', date: '11月15日 周日' })
    expect(dayHead(zt, at(11, 11, 0, 0), now)).toEqual({ name: '周三', date: '11月11日' })
    expect(dayHead(zt, at(11, 17, 0, 0), now)).toEqual({ name: '周二', date: '11月17日' })
    expect(dayHead(zt, at(9, 3, 0, 0), now)).toEqual({ name: '9月3日', date: '周四' })
    expect(dayHead(zt, at(12, 31, 0, 0, 2025), now)).toEqual({
      name: '12月31日',
      date: '2025年 周三',
    })
  })

  it('各类结果几条：模型判断不需要的单算', () => {
    expect(
      countKinds([
        { outcome: 'sent' },
        { outcome: 'sent', declined: 'x' },
        { outcome: 'failed' },
        { outcome: 'sent' },
      ]),
    ).toEqual({ sent: 2, declined: 1, skipped: 0, failed: 1 })
  })

  it('按天分组，组内、组间都保持原来的先后', () => {
    const fires = [
      fire(at(11, 14, 9, 22)),
      fire(at(11, 14, 0, 55)),
      fire(at(11, 13, 2, 30)),
      fire(at(11, 11, 12, 0)),
      fire(at(11, 11, 2, 30)),
    ]
    const groups = groupByDay(fires)
    expect(groups.map((group) => group.fires.length)).toEqual([2, 1, 2])
    expect(groups.map((group) => group.day)).toEqual([at(11, 14, 0), at(11, 13, 0), at(11, 11, 0)])
    expect(groups.flatMap((group) => group.fires)).toEqual(fires)
    expect(groupByDay([])).toEqual([])
  })
})
