/**
 * 导出页上触发卡片、新建会话设置两块的算账：缺省勾选、多出的字节、交给宿主的几项、每个开关管着的几处。
 */

import { describe, expect, it } from 'vitest'
import {
  choicePlaces,
  defaultTriggerPick,
  toggleTrigger,
  triggerBytes,
  triggerRequest,
} from '../../src/client/model/packTriggers.ts'
import type { PackScanResponse, PackTrigger } from '../../src/shared/pack.ts'

function card(node: string, extra: Partial<PackTrigger> = {}): PackTrigger {
  return {
    node,
    label: node,
    source: { kind: 'http' },
    command: false,
    versions: [1],
    ...extra,
  }
}

const scan: PackScanResponse = {
  name: 'w',
  items: [],
  assets: null,
  roots: [],
  limit: 10_000,
  choices: [
    { choice: { preset: 'ptc', permission: 'read-only' } },
    { node: 'tick', label: '每天', choice: { permission: 'danger-full-access' } },
  ],
  triggers: [
    card('tick', {
      command: true,
      secrets: { names: ['key.txt'], bytes: 10 },
      data: { files: 2, bytes: 20 },
    }),
    card('hook', { secrets: { names: ['h.txt'], bytes: 5 } }),
  ],
  triggerScripts: { files: 3, bytes: 300 },
}

describe('触发卡片', () => {
  it('缺省全留、密钥和数据都不带：只算触发脚本（有要跑命令的卡片）', () => {
    const pick = defaultTriggerPick(scan)
    expect([...pick.keep]).toEqual(['tick', 'hook'])
    expect(triggerBytes(scan, pick)).toBe(300)
    expect(triggerRequest(scan, pick)).toEqual({
      triggers: ['tick', 'hook'],
      secrets: [],
      triggerData: [],
    })
  })

  it('勾了密钥、数据才算；卡片去掉后它的密钥、数据跟着不带，不跑命令的留下时脚本也不带', () => {
    let pick = defaultTriggerPick(scan)
    pick = toggleTrigger(pick, 'secrets', 'tick', true)
    pick = toggleTrigger(pick, 'data', 'tick', true)
    pick = toggleTrigger(pick, 'secrets', 'hook', true)
    expect(triggerBytes(scan, pick)).toBe(300 + 10 + 20 + 5)
    pick = toggleTrigger(pick, 'keep', 'tick', false)
    expect(triggerBytes(scan, pick)).toBe(5)
    expect(triggerRequest(scan, pick)).toEqual({
      triggers: ['hook'],
      secrets: ['hook'],
      triggerData: [],
    })
  })
})

describe('新建会话的设置', () => {
  it('每个开关管着的几处：只列设了这一项的，值只留这一项', () => {
    expect(choicePlaces(scan.choices, 'model')).toEqual([])
    expect(choicePlaces(scan.choices, 'preset').map((place) => place.choice)).toEqual([
      { preset: 'ptc' },
    ])
    expect(
      choicePlaces(scan.choices, 'permission').map((place) => [place.spot.node, place.choice]),
    ).toEqual([
      [undefined, { permission: 'read-only' }],
      ['tick', { permission: 'danger-full-access' }],
    ])
  })
})
