/**
 * 「设置」页的草稿换算：文字框 ↔ 值，读取上限按 KB 给人看、按字节存。
 *
 * @module tests/client/pluginConfig.spec
 */

import { describe, expect, it } from 'vitest'
import {
  digitsOnly,
  fromDraft,
  settleNumber,
  toDraft,
} from '../../src/client/app/usePluginConfig.ts'
import { type LocaleKey, zh } from '../../src/client/i18n.ts'
import type { PluginConfigValues } from '../../src/shared/wire/config.ts'

const t = (key: LocaleKey): string => zh[key]

const SAVED: PluginConfigValues = {
  dataDir: '/data/wl',
  maxNodes: 400,
  saveDebounceMs: 400,
  maxResultBytes: 262_144,
  installSkill: true,
  triggerPort: 3791,
  triggerHost: '127.0.0.1',
}

describe('设置草稿', () => {
  it('值 → 草稿：数字变文字，读取上限换成 KB', () => {
    expect(toDraft(SAVED)).toEqual({
      dataDir: '/data/wl',
      maxNodes: '400',
      saveDebounceMs: '400',
      maxResultBytes: '256',
      installSkill: true,
      triggerPort: '3791',
      triggerHost: '127.0.0.1',
    })
  })

  it('原样转回去：值一个不变', () => {
    expect(fromDraft(toDraft(SAVED), SAVED, t)).toEqual({ values: SAVED, errors: {} })
  })

  it('读取上限不是整 KB：没动就留原字节数，动了才按 KB 换算', () => {
    const odd = { ...SAVED, maxResultBytes: 300_000 }
    expect(fromDraft(toDraft(odd), odd, t).values.maxResultBytes).toBe(300_000)
    expect(
      fromDraft({ ...toDraft(odd), maxResultBytes: '512' }, odd, t).values.maxResultBytes,
    ).toBe(524_288)
  })

  it('路径去掉首尾空白；数字框空、带小数、低于下限都报出来', () => {
    const { values, errors } = fromDraft(
      {
        dataDir: '  D:/flows ',
        maxNodes: '',
        saveDebounceMs: '1.5',
        maxResultBytes: '0',
        installSkill: false,
        triggerPort: '80',
        triggerHost: '192.168.1',
      },
      SAVED,
      t,
    )
    expect(values.dataDir).toBe('D:/flows')
    expect(values.installSkill).toBe(false)
    expect(errors).toEqual({
      maxNodes: zh['cfg.required'],
      saveDebounceMs: zh['cfg.int'],
      maxResultBytes: zh['cfg.min'].replace('{n}', '1'),
      triggerPort: zh['cfg.min'].replace('{n}', '1024'),
      triggerHost: zh['cfg.host.invalid'],
    })
  })

  it('数据目录不能是空的', () => {
    expect(fromDraft({ ...toDraft(SAVED), dataDir: '   ' }, SAVED, t).errors.dataDir).toBe(
      zh['cfg.required'],
    )
  })
})

describe('数字框', () => {
  it('只打得进数字', () => {
    expect(digitsOnly('3a7-9.1 ')).toBe('3791')
  })

  it('离开时：空的回到已保存的值，超出范围拉回边上，别的原样', () => {
    expect(settleNumber('triggerPort', '', '3791')).toBe('3791')
    expect(settleNumber('triggerPort', '11', '3791')).toBe('1024')
    expect(settleNumber('triggerPort', '99999', '3791')).toBe('65535')
    expect(settleNumber('triggerPort', '08080', '3791')).toBe('8080')
    expect(settleNumber('maxNodes', '0', '400')).toBe('1')
    expect(settleNumber('saveDebounceMs', '1500', '400')).toBe('1500')
  })
})
