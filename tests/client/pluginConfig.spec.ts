/**
 * 「设置」页的草稿换算：文字框 ↔ 值，读取上限按 KB 给人看、按字节存。
 *
 * @module tests/client/pluginConfig.spec
 */

import { describe, expect, it } from 'vitest'
import { fromDraft, stepNumber, toDraft } from '../../src/client/app/usePluginConfig.ts'
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
  triggerShell: '',
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
      triggerShell: '',
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
        triggerShell: '',
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
  it('一步按各项的步长走，Shift 走十步', () => {
    expect(stepNumber('triggerPort', 3791, 1, false)).toBe(3792)
    expect(stepNumber('saveDebounceMs', 400, 1, false)).toBe(450)
    expect(stepNumber('saveDebounceMs', 1200, 1, true)).toBe(1500)
    expect(stepNumber('maxResultBytes', 256, 1, false)).toBe(320)
  })

  it('不在整步上的先落到最近的整步', () => {
    expect(stepNumber('maxNodes', 405, 1, false)).toBe(410)
    expect(stepNumber('maxNodes', 405, -1, false)).toBe(400)
    expect(stepNumber('saveDebounceMs', 420, -1, false)).toBe(400)
  })
})
