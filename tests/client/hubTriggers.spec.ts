/**
 * 工作流中心「触发」页背后的纯计算：左栏怎么分组、排序、筛选，概览的数与节律，时间线的接下来，时长的说法，
 * 以及「设置」里改卡片用的合并规则。
 */

import { describe, expect, it } from 'vitest'
import { type LocaleKey, zh } from '../../src/client/i18n.ts'
import {
  durationText,
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
      { source: { kind: 'poll', command: 'git', seconds: 300 } },
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
      { source: { kind: 'poll', command: 'py', seconds: 900 } },
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
    const arranged = arrangeTriggers(list, DEFAULT_LIST_VIEW)
    expect(arranged.groups.map((group) => group.key)).toEqual(['deploy', 'nightly', 'warehouse'])
    expect(arranged.groups[0]?.entries.map((item) => item.name)).toEqual(['ci hook', 'main push'])
    expect(arranged.counts).toEqual({ all: 4, on: 2, act: 1 })
    expect(arranged.shown).toBe(4)
  })

  it('按状态分：要处理、开着、已关闭，空的组不列', () => {
    const arranged = arrangeTriggers(list, { ...DEFAULT_LIST_VIEW, group: 'state' })
    expect(arranged.groups.map((group) => group.key)).toEqual(['act', 'on', 'off'])
    expect(arranged.groups.map(groupId)).toEqual(['state:act', 'state:on', 'state:off'])
  })

  it('按触发方式分：按五种方式的固定顺序', () => {
    const arranged = arrangeTriggers(list, { ...DEFAULT_LIST_VIEW, group: 'kind' })
    expect(arranged.groups.map((group) => group.key)).toEqual(['schedule', 'poll', 'http'])
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
    expect(tally.cells[0]?.[14]).toEqual({ outcome: 'failed', count: 2 })
    const yesterday = new Date(now - 25 * hour).getHours()
    expect(tally.cells[1]?.[yesterday]).toEqual({ outcome: 'skipped', count: 1 })
    expect(tally.days).toHaveLength(7)
    expect(tally.cells.every((row) => row.length === 24)).toBe(true)
    // 一格里几次按次数加。
    expect(tallyActivity([slot(now - 60_000, 'sent', 40)], now).counts.sent).toBe(40)
    expect(rhythmSince(now)).toBe(tally.days[6])
  })

  it('定时今天还要触发的钟点；不是定时、太密的不画', () => {
    const source: TriggerSource = {
      kind: 'schedule',
      schedule: { kind: 'daily', time: '09:00', moreTimes: ['18:00', '21:30'] },
    }
    expect(plannedHours(source, now)).toEqual([18, 21])
    expect(
      plannedHours({ kind: 'schedule', schedule: { kind: 'every', minutes: 5 } }, now),
    ).toEqual([])
    expect(plannedHours({ kind: 'http' }, now)).toEqual([])
  })
})

describe('时间线', () => {
  it('按结果筛选：不需要的跟着已发出', () => {
    const declined = fire(now, 'sent', { declined: '不需要' })
    expect(matchesOutcome(declined, 'sent')).toBe(true)
    expect(matchesOutcome(declined, 'skipped')).toBe(false)
    expect(matchesOutcome(fire(now, 'failed'), 'all')).toBe(true)
  })

  it('接下来：定时从排好的下一次往后排，轮询是下一次检查，被动的、关着的没有', () => {
    const daily = { kind: 'schedule', schedule: { kind: 'daily', time: '09:00' } } as const
    const at = upcomingAt(daily, { state: 'waiting' }, now, 3)
    expect(at).toEqual([
      new Date(2026, 10, 12, 9, 0).getTime(),
      new Date(2026, 10, 13, 9, 0).getTime(),
      new Date(2026, 10, 14, 9, 0).getTime(),
    ])
    const every = { kind: 'schedule', schedule: { kind: 'every', minutes: 30 } } as const
    expect(upcomingAt(every, { state: 'waiting', next: now + 600_000 }, now, 2)).toEqual([
      now + 600_000,
      now + 600_000 + 1_800_000,
    ])
    const poll = { kind: 'poll', command: 'x', seconds: 60 } as const
    expect(upcomingAt(poll, { state: 'waiting', next: now + 5000 }, now, 3)).toEqual([now + 5000])
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
