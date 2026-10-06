/**
 * 「设置」页的草稿换算：文字框 ↔ 值，读取上限按 KB 给人看、按字节存。
 *
 * @module tests/client/pluginConfig.spec
 */

import { describe, expect, it } from 'vitest'
import { fromDraft, toDraft } from '../../src/client/app/usePluginConfig.ts'
import { type LocaleKey, zh } from '../../src/client/i18n.ts'
import type { PluginConfigValues } from '../../src/shared/wire.ts'

const t = (key: LocaleKey): string => zh[key]

const SAVED: PluginConfigValues = {
  dataDir: '/data/wl',
  maxNodes: 400,
  saveDebounceMs: 400,
  maxResultBytes: 262_144,
  installSkill: true,
}

describe('设置草稿', () => {
  it('值 → 草稿：数字变文字，读取上限换成 KB', () => {
    expect(toDraft(SAVED)).toEqual({
      dataDir: '/data/wl',
      maxNodes: '400',
      saveDebounceMs: '400',
      maxResultBytes: '256',
      installSkill: true,
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
    })
  })

  it('数据目录不能是空的', () => {
    expect(fromDraft({ ...toDraft(SAVED), dataDir: '   ' }, SAVED, t).errors.dataDir).toBe(
      zh['cfg.required'],
    )
  })
})
