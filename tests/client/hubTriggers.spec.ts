/**
 * 工作流中心「触发」页背后的纯计算：左栏怎么分组、排序、筛选，概览的数与节律，时间线的接下来，时长的说法，
 * 以及「设置」里改卡片用的合并规则。
 */

import { describe, expect, it } from 'vitest'
import { type LocaleKey, zh } from '../../src/client/i18n.ts'
import { durationText } from '../../src/client/model/time.ts'
import {
  matchesOutcome,
  plannedHours,
  rhythmSince,
  tallyActivity,
  upcomingAt,
} from '../../src/client/model/triggerActivity.ts'
import {
  arrangeTriggers,
  DEFAULT_LIST_VIEW,
  groupId,
  needsAction,
} from '../../src/client/model/triggerList.ts'
import { sortWhen } from '../../src/client/model/triggerNow.ts'
import {
  EMPTY_RHYTHM,
  type RhythmDot,
  reconcileRhythm,
  rhythmLeaving,
  settleRhythm,
} from '../../src/client/ui/hub/triggers/rhythmMotion.ts'
import { EMPTY_ROLL, reconcileRoll, settleRoll } from '../../src/client/ui/motion/rollState.ts'
import { patchTriggerData } from '../../src/shared/trigger.ts'
import type { TriggerData, TriggerSource } from '../../src/shared/types.ts'
import type {
  FireRecord,
  TriggerActivitySlot,
  TriggerEntry,
  TriggerView,
} from '../../src/shared/wire/trigger.ts'

const t = (key: LocaleKey): string => zh[key]

function entry(
  workflow: string,
  name: string,
  data: Partial<TriggerData>,
  view: Partial<TriggerView>,
): TriggerEntry {
  return {
    workflow,
    name,
    data: { source: { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } }, ...data },
    view: { node: name, enabled: false, state: 'off', ...view },
  }
}

const fire = (at: number, outcome: FireRecord['outcome'], extra: Partial<FireRecord> = {}) =>
  ({
    id: `f${at}`,
    workflow: 'w',
    node: 'n',
    name: 'n',
    channel: 'schedule',
    at,
    outcome,
    ...extra,
  }) satisfies FireRecord

// 2026-11-11 是周三；现在是当天 14:30（本地时间）。
const now = new Date(2026, 10, 11, 14, 30).getTime()
const hour = 3_600_000

describe('左栏：分组、排序、只看哪些', () => {
  const list = [
    entry(
      'deploy',
      'main push',
      {
        source: {
          kind: 'schedule',
          schedule: { kind: 'every', seconds: 300 },
          check: { command: 'git', when: 'every' },
        },
      },
      {
        enabled: true,
        state: 'waiting',
        next: now + 2 * 60_000,
        last: fire(now - hour, 'sent'),
      },
    ),
    entry(
      'nightly',
      'morning check',
      {},
      { enabled: true, state: 'waiting', next: now + 3 * hour },
    ),
    entry(
      'warehouse',
      'stock sync',
      {
        source: {
          kind: 'schedule',
          schedule: { kind: 'every', seconds: 900 },
          check: { command: 'py', when: 'every' },
        },
      },
      {
        enabled: false,
        state: 'stopped',
        last: fire(now - 20 * hour, 'failed'),
      },
    ),
    entry('deploy', 'ci hook', { source: { kind: 'http' } }, { enabled: false, state: 'off' }),
  ]

  it('要处理的是停着等人的几种状态，全部暂停不算', () => {
    expect(needsAction(list[2] as TriggerEntry)).toBe(true)
    expect(needsAction(entry('w', 'a', {}, { enabled: true, state: 'paused' }))).toBe(false)
    expect(needsAction(entry('w', 'b', {}, { enabled: true, state: 'confirm' }))).toBe(true)
  })

  it('按工作流分组：组按名称排，组里按名称排；三种只看各有几张', () => {
    const arranged = arrangeTriggers(list, { ...DEFAULT_LIST_VIEW, group: 'workflow' })
    expect(arranged.groups.map((group) => group.key)).toEqual(['deploy', 'nightly', 'warehouse'])
    expect(arranged.groups[0]?.entries.map((item) => item.name)).toEqual(['ci hook', 'main push'])
    expect(arranged.counts).toEqual({ all: 4, on: 2, act: 1 })
    expect(arranged.shown).toBe(4)
  })

  it('默认按状态分：待处理、已启用、已停用，组内按名称排，全部显示', () => {
    const arranged = arrangeTriggers(list, DEFAULT_LIST_VIEW)
    expect(arranged.groups.map((group) => group.key)).toEqual(['act', 'on', 'off'])
    expect(arranged.groups.map(groupId)).toEqual(['state:act', 'state:on', 'state:off'])
    expect(arranged.groups[1]?.entries.map((item) => item.name)).toEqual([
      'main push',
      'morning check',
    ])
    expect(arranged.shown).toBe(list.length)
  })

  it('按触发方式分：按四种方式的固定顺序（带检查的定时也归定时）', () => {
    const arranged = arrangeTriggers(list, { ...DEFAULT_LIST_VIEW, group: 'kind' })
    expect(arranged.groups.map((group) => group.key)).toEqual(['schedule', 'http'])
  })

  it('最近触发的在前、下一次早的在前，没有的排最后', () => {
    const recent = arrangeTriggers(list, { ...DEFAULT_LIST_VIEW, group: 'none', sort: 'recent' })
    expect(recent.groups[0]?.entries.map((item) => item.name)).toEqual([
      'main push',
      'stock sync',
      'ci hook',
      'morning check',
    ])
    const next = arrangeTriggers(list, { ...DEFAULT_LIST_VIEW, group: 'none', sort: 'next' })
    expect(next.groups[0]?.entries.map((item) => item.name).slice(0, 2)).toEqual([
      'main push',
      'morning check',
    ])
  })

  it('按时间排时紧凑行尾写那个时刻：上一次（没有就说没触发过）、下一次（没有就照常写状态），按名称排不写', () => {
    const [push, morning, stock, hook] = list as [
      TriggerEntry,
      TriggerEntry,
      TriggerEntry,
      TriggerEntry,
    ]
    expect(sortWhen(t, push, 'recent', now)).toBe('13:30')
    expect(sortWhen(t, stock, 'recent', now)).toBe('昨天 18:30')
    expect(sortWhen(t, hook, 'recent', now)).toBe('没触发过')
    expect(sortWhen(t, morning, 'next', now)).toBe('今天 17:30')
    expect(sortWhen(t, stock, 'next', now)).toBeUndefined()
    expect(sortWhen(t, push, 'name', now)).toBeUndefined()
  })

  it('只看开着的、只看要处理的', () => {
    const on = arrangeTriggers(list, { ...DEFAULT_LIST_VIEW, show: 'on' })
    expect(on.shown).toBe(2)
    const act = arrangeTriggers(list, { ...DEFAULT_LIST_VIEW, show: 'act', group: 'none' })
    expect(act.groups[0]?.entries.map((item) => item.name)).toEqual(['stock sync'])
    expect(arrangeTriggers([], { ...DEFAULT_LIST_VIEW, group: 'none' }).groups).toEqual([])
  })
})

describe('概览：近 7 天的数与节律', () => {
  it('数和格子从宿主数好的同一份近况算；一格里失败压过别的；更早的、还没到的不算', () => {
    const slot = (at: number, outcome: TriggerActivitySlot['outcome'], count = 1) => ({
      at,
      outcome,
      count,
    })
    const slots = [
      slot(now - 10 * 60_000, 'sent'),
      slot(now - 20 * 60_000, 'failed'),
      slot(now - 25 * hour, 'skipped'),
      slot(now - 9 * 24 * hour, 'sent'),
      slot(now + hour, 'sent'),
    ]
    const tally = tallyActivity(slots, now)
    expect(tally.total).toBe(3)
    expect(tally.counts).toEqual({ sent: 1, skipped: 1, failed: 1 })
    // 从早到晚：最后一行是今天，倒数第二行是昨天。
    expect(tally.cells[6]?.[14]).toEqual({ outcome: 'failed', count: 2 })
    const yesterday = new Date(now - 25 * hour).getHours()
    expect(tally.cells[5]?.[yesterday]).toEqual({ outcome: 'skipped', count: 1 })
    expect(tally.days).toHaveLength(7)
    expect(tally.cells.every((row) => row.length === 24)).toBe(true)
    // 一格里几次按次数加。
    expect(tallyActivity([slot(now - 60_000, 'sent', 40)], now).counts.sent).toBe(40)
    expect(rhythmSince(now)).toBe(tally.days[0])
  })

  it('定时今天还要触发的钟点；不是定时、太密的不画', () => {
    const source: TriggerSource = {
      kind: 'schedule',
      schedule: { kind: 'daily', time: '09:00', moreTimes: ['18:00', '21:30'] },
    }
    expect(plannedHours(source, now)).toEqual([18, 21])
    expect(
      plannedHours({ kind: 'schedule', schedule: { kind: 'every', seconds: 300 } }, now),
    ).toEqual([])
    expect(plannedHours({ kind: 'http' }, now)).toEqual([])
  })
})

describe('统计数字滚动', () => {
  it('只滚变化的位，大幅增减也只显示起点和终点', () => {
    const initial = reconcileRoll(EMPTY_ROLL, 128)
    const raised = reconcileRoll(initial, 129)
    expect(raised.direction).toBe(1)
    expect(raised.places[1]).toBe(initial.places[1])
    expect(raised.places[2]).toBe(initial.places[2])
    expect(raised.places[0]?.glyphs).toEqual([
      { digit: '8', exit: 1 },
      { digit: '9', exit: null },
    ])
    const lowered = reconcileRoll(settleRoll(raised), 2)
    expect(lowered.direction).toBe(-1)
    expect(lowered.places[0]?.glyphs).toEqual([
      { digit: '9', exit: -1 },
      { digit: '2', exit: null },
    ])
  })

  it('进退位时复用未变的个位，高位退场后再移除', () => {
    const initial = reconcileRoll(EMPTY_ROLL, 8)
    const raised = reconcileRoll(initial, 18)
    expect(raised.places[0]).toBe(initial.places[0])
    expect(raised.places.map(({ power, digit }) => [power, digit])).toEqual([
      [0, '8'],
      [1, '1'],
    ])
    const lowered = reconcileRoll(raised, 8)
    expect(lowered.places[0]).toBe(initial.places[0])
    expect(lowered.places[1]).toMatchObject({ power: 1, digit: null })
    expect(settleRoll(lowered).places).toHaveLength(1)
  })

  it('快切回之前的读数时，沿用还在退场的字形', () => {
    const initial = reconcileRoll(EMPTY_ROLL, 99)
    const raised = reconcileRoll(initial, 100)
    const lowered = reconcileRoll(raised, 99)
    expect(lowered.places[0]?.glyphs).toEqual([
      { digit: '9', exit: null },
      { digit: '0', exit: -1 },
    ])
  })

  it('加载时保持最后一次读数，只在收到真实的零后才滚到零', () => {
    const initial = reconcileRoll(EMPTY_ROLL, 37)
    expect(reconcileRoll(initial, null)).toBe(initial)
    expect(reconcileRoll(initial, 37)).toBe(initial)
    expect(reconcileRoll(initial, 0).value).toBe(0)
  })

  it('列表换项时整个数一起换：记下旧数和方向，各位不逐位滚', () => {
    const initial = reconcileRoll(EMPTY_ROLL, 12)
    const swapped = reconcileRoll(initial, 3, 'down')
    expect(swapped.direction).toBe(0)
    expect(swapped.swap).toEqual({ was: '12', n: 1, dir: 'down' })
    expect(swapped.places.map((place) => place.glyphs.length)).toEqual([1])
    const again = reconcileRoll(swapped, 40, 'up')
    expect(again.swap).toEqual({ was: '3', n: 2, dir: 'up' })
    // 之后同一项里变了照旧逐位滚，整数换的记号留着不动。
    const live = reconcileRoll(again, 41)
    expect(live.direction).toBe(1)
    expect(live.swap).toBe(again.swap)
    expect(reconcileRoll(EMPTY_ROLL, 5, 'up').swap).toBeNull()
  })
})

describe('节律点的切换', () => {
  const dot = (hour: number, outcome: RhythmDot['outcome'] = 'sent', day = 1): RhythmDot => ({
    day,
    hour,
    outcome,
    many: false,
  })

  it('换卡片：两边都有的点留在不动的那层，只有上一张有的整层退，只有这一张有的整层进', () => {
    const before = reconcileRhythm(EMPTY_RHYTHM, 'old', [dot(8), dot(9)])
    expect(before.marks.map(({ layer }) => layer)).toEqual(['fresh', 'fresh'])
    const after = reconcileRhythm(before, 'new', [dot(9), dot(10)])
    expect(after.generation).toBe(before.generation + 1)
    expect(after.marks.map(({ id, hour, layer, enter }) => [id, hour, layer, enter])).toEqual([
      [before.marks[1]?.id, 9, 'still', false],
      [expect.any(Number), 10, 'fresh', false],
    ])
    expect(after.outgoing.map(({ hour }) => hour)).toEqual([8])
    // 退场的那层不用收拾，下次换卡片时换掉。
    expect(rhythmLeaving(after)).toBe(false)
    const back = reconcileRhythm(after, 'old', [dot(8), dot(9)])
    expect(back.outgoing.map(({ hour }) => hour)).toEqual([10])
    expect(back.marks.map(({ hour, layer }) => [hour, layer])).toEqual([
      [8, 'fresh'],
      [9, 'still'],
    ])
  })

  it('同一张卡片更新：原地的点留着，新的各自进场，没了的各自退场', () => {
    const before = reconcileRhythm(EMPTY_RHYTHM, 'old', [dot(8), dot(12)])
    const refreshed = reconcileRhythm(before, 'old', [dot(12), dot(18, 'failed')])
    expect(refreshed.generation).toBe(before.generation)
    expect(
      refreshed.marks.map(({ id, hour, enter, leaving }) => [id, hour, enter, leaving]),
    ).toEqual([
      [before.marks[0]?.id, 8, false, true],
      [before.marks[1]?.id, 12, false, false],
      [expect.any(Number), 18, true, false],
    ])
    expect(rhythmLeaving(refreshed)).toBe(true)
    expect(settleRhythm(refreshed).marks.map(({ hour }) => hour)).toEqual([12, 18])
  })

  it('未读到时留住上一张，数据没变时不换', () => {
    const before = reconcileRhythm(EMPTY_RHYTHM, 'old', [dot(10)])
    expect(reconcileRhythm(before, 'new', null)).toBe(before)
    expect(reconcileRhythm(before, 'old', [dot(10)])).toBe(before)
  })
})

describe('时间线', () => {
  it('按结果筛选：不需要的跟着已发出', () => {
    const declined = fire(now, 'sent', { declined: '不需要' })
    expect(matchesOutcome(declined, 'sent')).toBe(true)
    expect(matchesOutcome(declined, 'skipped')).toBe(false)
    expect(matchesOutcome(fire(now, 'failed'), 'all')).toBe(true)
    // 排队中的还没有结果：筛哪一类（含「全部」）都不算。
    expect(matchesOutcome({ outcome: 'queued' }, 'all')).toBe(false)
  })

  it('接下来：定时从排好的下一次往后排，轮询是下一次检查，被动的、关着的没有', () => {
    const daily = { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } } as const
    const at = upcomingAt(daily, { state: 'waiting' }, now, 3)
    expect(at).toEqual([
      new Date(2026, 10, 12, 9, 0).getTime(),
      new Date(2026, 10, 13, 9, 0).getTime(),
      new Date(2026, 10, 14, 9, 0).getTime(),
    ])
    const every = { kind: 'schedule', schedule: { kind: 'every', seconds: 1800 } } as const
    expect(upcomingAt(every, { state: 'waiting', next: now + 600_000 }, now, 2)).toEqual([
      now + 600_000,
      now + 600_000 + 1_800_000,
    ])
    const check = { ...every, check: { command: 'x', when: 'every' } } as const
    expect(upcomingAt(check, { state: 'waiting', next: now + 5000 }, now, 3)).toEqual([now + 5000])
    expect(upcomingAt({ kind: 'http' }, { state: 'listening' }, now, 3)).toEqual([])
    expect(upcomingAt(daily, { state: 'off' }, now, 3)).toEqual([])
  })
})

describe('时长', () => {
  it('只写最大的两个单位，第二个是 0 不写', () => {
    expect(durationText(t, 3 * hour + 12 * 60_000 + 30_000)).toBe('3 小时 12 分')
    expect(durationText(t, 2 * hour)).toBe('2 小时')
    expect(durationText(t, 130_000)).toBe('2 分 10 秒')
    expect(durationText(t, 45_000)).toBe('45 秒')
    expect(durationText(t, 26 * hour)).toBe('1 天 2 小时')
    expect(durationText(t, -5)).toBe('0 秒')
  })
})

describe('改触发卡片', () => {
  const data: TriggerData = {
    label: '夜巡',
    source: { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } },
    note: '看日志',
  }

  it('给了的键换掉，undefined 的键清掉', () => {
    expect(patchTriggerData(data, { note: undefined, condition: '只在工作日' })).toEqual({
      label: '夜巡',
      source: data.source,
      condition: '只在工作日',
    })
  })

  it('改完一样回 null', () => {
    expect(patchTriggerData(data, { label: '夜巡' })).toBeNull()
  })
})
