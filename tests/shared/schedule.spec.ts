import { describe, expect, it } from 'vitest'
import {
  cronAsSimple,
  DAILY_TIMES_MAX,
  dailyTimes,
  nextFire,
  scheduleIssue,
  scheduleText,
  tidyTimes,
  upcomingFires,
  withDailyTimes,
} from '../../src/shared/schedule.ts'
import { readTriggerData } from '../../src/shared/trigger.ts'
import type { TriggerSchedule } from '../../src/shared/types.ts'

type Daily = Extract<TriggerSchedule, { kind: 'daily' }>
const at = (month: number, day: number, hour: number, minute = 0): Date =>
  new Date(2026, month - 1, day, hour, minute)

describe('每天几个时刻', () => {
  const twice: Daily = { kind: 'daily', time: '09:00', moreTimes: ['18:30'] }

  it('下一次取当天剩下的最近一个，过了最后一个就到明天的第一个', () => {
    expect(nextFire(twice, at(11, 16, 8))).toEqual(at(11, 16, 9))
    expect(nextFire(twice, at(11, 16, 9))).toEqual(at(11, 16, 18, 30))
    expect(nextFire(twice, at(11, 16, 19))).toEqual(at(11, 17, 9))
  })

  it('时刻没按先后写也一样；限定星期几时跳过不在的天', () => {
    const shuffled: Daily = { kind: 'daily', time: '18:30', moreTimes: ['09:00'], weekdays: [1] }
    // 2026-11-16 是周一
    expect(nextFire(shuffled, at(11, 16, 8))).toEqual(at(11, 16, 9))
    expect(nextFire(shuffled, at(11, 16, 19))).toEqual(at(11, 23, 9))
  })

  it('接下来几次：按先后一次列出来', () => {
    expect(upcomingFires(twice, at(11, 16, 8), 3)).toEqual([
      at(11, 16, 9),
      at(11, 16, 18, 30),
      at(11, 17, 9),
    ])
    expect(upcomingFires({ kind: 'cron', expression: 'x' }, at(11, 16, 8), 3)).toEqual([])
  })

  it('写得不对的那个时刻会被报出来；一句话说法列出全部时刻', () => {
    expect(scheduleIssue({ kind: 'daily', time: '09:00', moreTimes: ['25:00'] })).toEqual({
      code: 'time',
      time: '25:00',
    })
    expect(scheduleText(twice)).toBe('每天 09:00、18:30')
    expect(scheduleText({ ...twice, weekdays: [1, 3] })).toBe('每周一、三 09:00、18:30')
  })

  it('读入时补零、去重、排序；只剩一个就不写 moreTimes；七天全选不写 weekdays', () => {
    const read = (schedule: unknown): TriggerSchedule | undefined => {
      const data = readTriggerData({ source: { kind: 'schedule', schedule } })
      return data.source.kind === 'schedule' ? data.source.schedule : undefined
    }
    expect(read({ kind: 'daily', time: '18:30', moreTimes: ['9:00', '09:00', 7] })).toEqual({
      kind: 'daily',
      time: '09:00',
      moreTimes: ['18:30'],
    })
    expect(read({ kind: 'daily', time: '09:00', moreTimes: ['09:00'] })).toEqual({
      kind: 'daily',
      time: '09:00',
    })
  })

  it('tidyTimes 把写不对的留在最后；withDailyTimes 第一个进 time，超出上限的丢掉', () => {
    expect(tidyTimes(['18:00', 'x', '9:05'])).toEqual(['09:05', '18:00', 'x'])
    const many = Array.from(
      { length: DAILY_TIMES_MAX + 3 },
      (_, i) => `${String(i).padStart(2, '0')}:00`,
    )
    expect(dailyTimes(withDailyTimes({ kind: 'daily', time: '09:00' }, many))).toHaveLength(
      DAILY_TIMES_MAX,
    )
    expect(withDailyTimes({ kind: 'daily', time: '09:00', weekdays: [1] }, [])).toEqual({
      kind: 'daily',
      time: '09:00',
      weekdays: [1],
    })
  })
})

describe('cron 换成人话', () => {
  it('工作日几点、每天几点、几个整点', () => {
    expect(cronAsSimple('0 9 * * 1-5')).toEqual({
      kind: 'daily',
      time: '09:00',
      weekdays: [1, 2, 3, 4, 5],
    })
    expect(cronAsSimple('30 2 * * *')).toEqual({ kind: 'daily', time: '02:30' })
    expect(cronAsSimple('0 9,18 * * 0,6')).toEqual({
      kind: 'daily',
      time: '09:00',
      moreTimes: ['18:00'],
      weekdays: [6, 7],
    })
  })

  it('等间隔的说成每隔多久', () => {
    expect(cronAsSimple('*/15 * * * *')).toEqual({ kind: 'every', minutes: 15 })
    expect(cronAsSimple('0 */2 * * *')).toEqual({ kind: 'every', minutes: 120 })
    expect(cronAsSimple('* * * * *')).toEqual({ kind: 'every', minutes: 1 })
  })

  it('说不成一句话的、写得不对的是 null', () => {
    expect(cronAsSimple('0 9 1 * *')).toBeNull()
    expect(cronAsSimple('0 9 * 6 *')).toBeNull()
    expect(cronAsSimple('5,20 * * * *')).toBeNull()
    expect(cronAsSimple('0 9')).toBeNull()
  })
})
