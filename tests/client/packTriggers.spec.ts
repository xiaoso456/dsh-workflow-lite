/**
 * 导出页上触发卡片、会话设置两块的算账：缺省勾选、多出的字节、交给宿主的几项。
 */

import { describe, expect, it } from 'vitest'
import {
  choicePlaces,
  defaultTriggerPick,
  packsAnySecrets,
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
  it('缺省不带触发器，打开后才带选中的卡片和触发脚本', () => {
    const pick = defaultTriggerPick(scan)
    expect(pick.enabled).toBe(false)
    expect(triggerBytes(scan, pick)).toBe(0)
    expect(triggerRequest(scan, pick)).toEqual({
      triggers: [],
      secrets: [],
      triggerData: [],
      triggerChoices: [],
    })
    expect(triggerBytes(scan, { ...pick, enabled: true })).toBe(300)
    expect(triggerRequest(scan, { ...pick, enabled: true })).toEqual({
      triggers: ['tick', 'hook'],
      secrets: [],
      triggerData: [],
      triggerChoices: [],
    })
  })

  it('去掉卡片时，它的密钥、数据和会话设置跟着去掉', () => {
    const choice = { model: true, preset: false, permission: false }
    let pick = { ...defaultTriggerPick(scan), enabled: true }
    pick = toggleTrigger(pick, 'secrets', 'tick', true)
    pick = toggleTrigger(pick, 'data', 'tick', true)
    pick = toggleTrigger(pick, 'secrets', 'hook', true)
    pick.choices = new Map([
      ['tick', choice],
      ['hook', choice],
    ])
    expect(triggerBytes(scan, pick)).toBe(300 + 10 + 20 + 5)
    expect(packsAnySecrets(scan, pick)).toBe(true)
    expect(packsAnySecrets(scan, { ...pick, enabled: false })).toBe(false)
    expect(triggerRequest(scan, { ...pick, enabled: false })).toEqual({
      triggers: [],
      secrets: [],
      triggerData: [],
      triggerChoices: [],
    })
    pick = toggleTrigger(pick, 'keep', 'tick', false)
    expect(triggerBytes(scan, pick)).toBe(5)
    expect(triggerRequest(scan, pick)).toEqual({
      triggers: ['hook'],
      secrets: ['hook'],
      triggerData: [],
      triggerChoices: [{ node: 'hook', choice }],
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
