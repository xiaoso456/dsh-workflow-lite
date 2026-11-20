/**
 * 「运行实例」页概览的「进程」：每一步的几段从流水算，还开着的段拉到现在或停在最后一次记录；横轴的刻度。
 * 「画布」页签的小图：只画步骤、等比缩进框里、连线标出判定和走没走过。
 * 「时间线」：流水和记到实例上的触发并在一起、按天分组。
 */

import { describe, expect, it } from 'vitest'
import { runSpans, spanTicks } from '../../src/client/model/runSpans.ts'
import { runTimeline } from '../../src/client/model/runTimeline.ts'
import { MAP_CARD, runMap } from '../../src/client/ui/hub/runs/runMap.ts'
import type { RunLogEntry, RunState } from '../../src/shared/runState.ts'
import type { WorkflowDocument } from '../../src/shared/types.ts'
import type { FireRecord } from '../../src/shared/wire/trigger.ts'

const T0 = new Date(2026, 10, 16, 9, 30).getTime()
const MIN = 60_000
const at = (minutes: number): string => new Date(T0 + minutes * MIN).toISOString()

function state(status: RunState['status'], log: RunLogEntry[], updated = 0): RunState {
  return {
    version: 1,
    instance: 'i',
    workflow: 'w',
    plan: 'p',
    graph: 'g',
    mode: 'serial',
    status,
    updatedAt: at(updated),
    nodes: {},
    log,
  } as unknown as RunState
}

describe('进程：每一步的几段', () => {
  it('开始到完成一段；停下等用户另起一段；还在跑的拉到现在', () => {
    const spans = runSpans(
      state('waiting', [
        { at: at(0), event: 'start' },
        { at: at(0), node: 'pull', event: 'start', round: 1 },
        { at: at(2), node: 'pull', event: 'done', round: 1 },
        { at: at(2), node: 'ask', event: 'start', round: 1 },
        { at: at(5), node: 'ask', event: 'waiting', round: 1 },
      ]),
      T0,
      T0 + 30 * MIN,
    )
    expect(spans).toMatchObject({ start: T0, end: T0 + 30 * MIN, live: true })
    expect(spans.steps.get('pull')).toEqual([
      { from: T0, to: T0 + 2 * MIN, status: 'done', round: 1 },
    ])
    expect(spans.steps.get('ask')).toEqual([
      { from: T0 + 2 * MIN, to: T0 + 5 * MIN, status: 'running', round: 1 },
      { from: T0 + 5 * MIN, to: T0 + 30 * MIN, status: 'waiting', round: 1, open: true },
    ])
  })

  it('失败后重跑是两段；跳过、改回待执行收掉开着的段；结束了还开着的停在最后一次记录', () => {
    const spans = runSpans(
      state(
        'failed',
        [
          { at: at(1), node: 'test', event: 'start', round: 1 },
          { at: at(3), node: 'test', event: 'failed', round: 1 },
          { at: at(4), node: 'test', event: 'start', round: 2 },
          { at: at(8), node: 'test', event: 'failed', round: 2 },
          { at: at(8), node: 'pack', event: 'start' },
          { at: at(9), node: 'pack', event: 'skipped' },
          { at: at(9), node: 'notes', event: 'start' },
          { at: 'not a time', node: 'notes', event: 'done' },
          { at: at(10), event: 'failed' },
        ],
        6,
      ),
      T0,
      T0 + 99 * MIN,
    )
    expect(spans.live).toBe(false)
    expect(spans.end).toBe(T0 + 10 * MIN)
    expect(spans.steps.get('test')?.map((span) => [span.status, span.round])).toEqual([
      ['failed', 1],
      ['failed', 2],
    ])
    expect(spans.steps.get('pack')?.[0]?.status).toBe('stopped')
    expect(spans.steps.get('notes')).toEqual([
      { from: T0 + 9 * MIN, to: T0 + 10 * MIN, status: 'stopped' },
    ])
  })

  it('一条流水都没有：横轴从建立到现在，没有段', () => {
    const spans = runSpans(state('running', []), T0, T0 + 5 * MIN)
    expect(spans.end).toBe(T0 + 5 * MIN)
    expect(spans.steps.size).toBe(0)
  })
})

describe('进程的刻度', () => {
  it('取让刻度不太多的整分间隔，离两端太近的不要', () => {
    expect(spanTicks(T0, T0 + 12 * MIN).map((tick) => (tick - T0) / MIN)).toEqual([5, 10])
    const hour = spanTicks(T0 - 15 * MIN, T0 + 72 * MIN)
    for (const tick of hour) expect(new Date(tick).getMinutes() % 15).toBe(0)
    expect(hour.length).toBeLessThanOrEqual(5)
    expect(spanTicks(T0, T0)).toEqual([])
  })
})

describe('画布页签的小图', () => {
  const step = (id: string, x: number, y: number) => ({
    id,
    type: 'wfNode',
    position: { x, y },
    data: { label: id.toUpperCase(), prompt: '' },
  })
  const doc = {
    nodes: [
      step('a', 0, 0),
      step('b', 400, 0),
      step('c', 800, 0),
      {
        id: 'f',
        type: 'wfResource',
        position: { x: 0, y: 300 },
        data: { kind: 'file', items: [] },
      },
    ],
    edges: [
      { id: 'ab', source: 'a', target: 'b' },
      { id: 'bc', source: 'b', target: 'c', data: { when: 'pass' } },
      { id: 'ba', source: 'b', target: 'a', data: { when: 'fail' } },
      { id: 'af', source: 'a', target: 'f' },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  } as unknown as WorkflowDocument

  it('只画步骤和流程线，按执行先后从左到右排；循环绕回去的线也画，判定写在线上，走过的标出来', async () => {
    const map = await runMap(doc, new Set(['ab']))
    expect(map.cards.map((card) => card.id)).toEqual(['a', 'b', 'c'])
    const x = Object.fromEntries(map.cards.map((card) => [card.id, card.x]))
    expect(x.a).toBeLessThan(x.b as number)
    expect(x.b).toBeLessThan(x.c as number)
    for (const card of map.cards) {
      expect(card.x).toBeGreaterThanOrEqual(0)
      expect(card.x + MAP_CARD.w).toBeLessThanOrEqual(map.width)
      expect(card.y).toBeGreaterThanOrEqual(0)
      expect(card.y + MAP_CARD.h).toBeLessThanOrEqual(map.height)
    }
    // 走过的线排在最后画（同一对卡片之间的几条是同一条路径，走过的要盖在上面）。
    expect(map.lines.map((line) => [line.id, line.when, line.taken])).toEqual([
      ['bc', 'pass', false],
      ['ba', 'fail', false],
      ['ab', undefined, true],
    ])
    // 往回走的那条是绕到走廊上的折线，牌子在走廊上、卡片下面。
    const back = map.lines.find((line) => line.id === 'ba')
    expect(back?.path).toMatch(/ L /)
    expect(back?.mid.y).toBeGreaterThan(Math.max(...map.cards.map((card) => card.y + MAP_CARD.h)))
    expect(back?.mid.y).toBeLessThanOrEqual(map.height)
  })

  it('一张步骤卡片都没有时是空的', async () => {
    const map = await runMap({ nodes: [], edges: [] } as unknown as WorkflowDocument, new Set())
    expect(map.cards).toEqual([])
    expect(map.lines).toEqual([])
  })
})

describe('runTimeline', () => {
  const fire = (id: string, minutes: number, joined?: true): FireRecord => ({
    id,
    workflow: 'w',
    node: 't',
    name: '每天',
    channel: 'schedule',
    at: T0 + minutes * MIN,
    outcome: 'sent',
    instance: 'i',
    ...(joined === undefined ? {} : { joined }),
  })

  it('流水和触发并在一起从晚到早；同一刻触发排在开始之后（倒过来看在下面）', () => {
    const days = runTimeline(
      [
        { at: at(0), event: 'start', node: 'a' },
        { at: at(5), event: 'done', node: 'a' },
        { at: at(9), event: 'start', node: 'a' },
      ] as RunLogEntry[],
      [fire('f1', 0), fire('f2', 9, true)],
    )
    expect(days).toHaveLength(1)
    expect(days[0]?.items.map((item) => item.key)).toEqual([
      'log-2',
      'fire-f2',
      'log-1',
      'log-0',
      'fire-f1',
    ])
  })

  it('跨天分组；认不出时刻的流水跟着前一条', () => {
    const days = runTimeline(
      [
        { at: at(0), event: 'start', node: 'a' },
        { at: 'bad', event: 'note' },
        { at: at(24 * 60), event: 'done', node: 'a' },
      ] as RunLogEntry[],
      [],
    )
    expect(days.map((day) => day.items.map((item) => item.key))).toEqual([
      ['log-2'],
      ['log-1', 'log-0'],
    ])
  })
})

describe('runSpans 的左端', () => {
  it('流水里有比建立更早的时刻：横轴从最早那条起', () => {
    const spans = runSpans(
      state('done', [
        { at: at(-10), event: 'start', node: 'a' },
        { at: at(-5), event: 'done', node: 'a' },
      ] as RunLogEntry[]),
      T0,
      T0 + 60 * MIN,
    )
    expect(spans.start).toBe(T0 - 10 * MIN)
  })
})
