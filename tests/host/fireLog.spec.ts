/**
 * 触发记录存在插件数据库里：每张卡片各记各的；列记录不带原文、详情才带；工作流改名跟着走、删掉一起删；
 * 几个连接同时写不丢。
 */

import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DATABASE_FILE, PluginDatabase } from '../../src/host/store/database.ts'
import { SLOT_MS } from '../../src/host/triggers/fireLog.ts'
import {
  type FireDetail,
  fireInfoFile,
  INFO_INLINE_CHARS,
  newFireId,
  TriggerStore,
} from '../../src/host/triggers/store.ts'
import type { FireOutcome } from '../../src/shared/wire/trigger.ts'

const MINUTE = 60_000

let dataDir: string
let clock: number
const opened: PluginDatabase[] = []

/** 一个进程那样：自己的连接、自己的 store。 */
function open(): TriggerStore {
  const database = new PluginDatabase(() => join(dataDir, DATABASE_FILE))
  opened.push(database)
  return new TriggerStore(() => dataDir, database)
}

let serial = 0
/** 一次触发，时刻是现在的 `clock`；编号按序号保证不重。 */
function fire(
  node: string,
  outcome: FireOutcome = 'sent',
  extra: Partial<Omit<FireDetail, 'record'>> = {},
): FireDetail {
  serial += 1
  const id = `${newFireId(new Date(clock)).slice(0, -4)}${serial.toString(16).padStart(4, '0')}`
  return {
    record: { id, workflow: 'wf', node, name: node, channel: 'schedule', at: clock, outcome },
    note: '看一眼',
    ...extra,
  }
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'workflow-lite-firelog-'))
  clock = new Date(2026, 10, 12, 9, 0).getTime()
})

afterEach(async () => {
  for (const database of opened.splice(0)) database.close()
  await rm(dataDir, { recursive: true, force: true })
})

describe('触发记录', () => {
  it('每张卡片各记各的：勤的卡片不挤掉别的，近况数得全', async () => {
    const store = open()
    await store.record(fire('weekly'))
    for (let n = 0; n < 250; n += 1) {
      clock += MINUTE
      await store.record(fire('chatty', n % 5 === 0 ? 'skipped' : 'sent'))
    }

    expect((await store.last('wf', 'weekly'))?.node).toBe('weekly')
    expect(await store.history('wf', 'weekly', 200)).toHaveLength(1)
    expect(await store.history('wf', 'chatty', 200)).toHaveLength(200)
    expect((await store.last('wf', 'chatty'))?.at).toBe(clock)

    const slots = await store.activity('wf', 'chatty', 0, clock)
    const total = (outcome: FireOutcome): number =>
      slots.filter((slot) => slot.outcome === outcome).reduce((sum, slot) => sum + slot.count, 0)
    expect(total('sent')).toBe(200)
    expect(total('skipped')).toBe(50)
    expect(slots.every((slot) => slot.at % SLOT_MS === 0)).toBe(true)
    expect(await store.sentSince('wf', 'chatty', clock - 10 * MINUTE)).toBe(8)
  })

  it('列记录只给记录本身，原文在详情里；工作流改名跟着走，删掉连同另存的全文一起删', async () => {
    const store = open()
    const long = fire('tick', 'sent', { info: 'x'.repeat(INFO_INLINE_CHARS + 1) })
    await store.record(long)
    expect(existsSync(fireInfoFile(dataDir, long.record.id))).toBe(true)
    expect(await store.history('wf', 'tick', 10)).toEqual([long.record])
    expect((await store.detail(long.record.id))?.info).toBe(long.info)

    await store.rename('wf', 'renamed')
    expect(await store.history('wf', 'tick', 10)).toEqual([])
    expect((await store.last('renamed', 'tick'))?.workflow).toBe('renamed')

    await store.forget('renamed')
    expect(await store.detail(long.record.id)).toBeNull()
    expect(existsSync(fireInfoFile(dataDir, long.record.id))).toBe(false)
  })

  it('补上后来才知道的事：实例、模型判断不需要；没对上实例的按会话找最早的那次', async () => {
    const store = open()
    const first = fire('tick', 'sent')
    first.record.session = 's1'
    await store.record(first)
    clock += MINUTE
    const second = fire('tick', 'sent')
    second.record.session = 's1'
    await store.record(second)

    expect((await store.unclaimed('wf', 's1', 0))?.id).toBe(first.record.id)
    await store.bind(first.record.id, 'run-1')
    expect((await store.unclaimed('wf', 's1', 0))?.id).toBe(second.record.id)
    await store.decline(second.record.id, '没变化')
    const [latest, earlier] = await store.history('wf', 'tick', 10)
    expect(latest?.declined).toBe('没变化')
    expect(earlier?.instance).toBe('run-1')
  })

  it('接着实例做：会话里还没对上实例的记成接进去，后来另建了实例就改记过去；按实例查从早到晚', async () => {
    const store = open()
    const sent = (session: string, outcome: FireOutcome = 'sent'): FireDetail => {
      const detail = fire('tick', outcome)
      detail.record.session = session
      clock += MINUTE
      return detail
    }
    const origin = sent('s1')
    const before = sent('s1')
    const during = sent('s1')
    const declined = sent('s1')
    const skipped = sent('s1', 'skipped')
    const elsewhere = sent('s2')
    for (const detail of [origin, before, during, declined, skipped, elsewhere]) {
      await store.record(detail)
    }
    await store.bind(origin.record.id, 'run-1')
    await store.decline(declined.record.id, '没变化')

    // 实例在 `during` 那一刻之后才算：之前那次不接进来；没发出去的、判断为不需要的、别的会话的也不接。
    await store.join('wf', 's1', during.record.at, 'run-1')
    expect((await store.ofInstance('run-1')).map((record) => [record.id, record.joined])).toEqual([
      [origin.record.id, undefined],
      [during.record.id, true],
    ])
    expect((await store.unclaimed('wf', 's1', 0))?.id).toBe(before.record.id)

    // 模型后来为它另建了实例：改记到新实例上，不再算接进去的。
    await store.bind(during.record.id, 'run-2')
    expect((await store.ofInstance('run-2')).map((record) => [record.id, record.joined])).toEqual([
      [during.record.id, undefined],
    ])
    expect((await store.ofInstance('run-1')).map((record) => record.id)).toEqual([origin.record.id])
  })

  it('两个进程同时写同一个库：一条不丢', async () => {
    const a = open()
    const b = open()
    await Promise.all(
      Array.from({ length: 40 }, (_, n) => (n % 2 === 0 ? a : b).record(fire('tick'))),
    )
    expect(await a.history('wf', 'tick', 100)).toHaveLength(40)
    expect(await b.history('wf', 'tick', 100)).toHaveLength(40)
  })
})
