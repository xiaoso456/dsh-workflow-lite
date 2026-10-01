import { describe, expect, it } from 'vitest'
import type { LocaleKey } from '../../src/client/i18n.ts'
import { en, zh } from '../../src/client/i18n.ts'
import {
  decodeStepSource,
  encodeStepSource,
  kindOf,
  PRESETS,
  presetData,
  starterGraph,
} from '../../src/client/model/library.ts'
import { checkLabel, checkName } from '../../src/shared/naming.ts'

const t = (key: LocaleKey): string => zh[key]

describe('拖放载荷', () => {
  it('编码后能原样解回来', () => {
    for (const source of [
      { kind: 'blank' },
      { kind: 'preset', id: 'scan' },
      { kind: 'template', name: 'my-check' },
    ] as const) {
      expect(decodeStepSource(encodeStepSource(source))).toEqual(source)
    }
  })

  it('别处拖进来的任意内容一律当作不认识，不抛异常', () => {
    for (const raw of [
      null,
      undefined,
      '',
      'hello',
      '42',
      '[]',
      'null',
      '{"kind":"preset"}',
      '{"kind":"preset","id":""}',
      '{"kind":"template","name":7}',
      '{"kind":"other"}',
      '{"__proto__":{"kind":"blank"}}',
    ]) {
      expect(decodeStepSource(raw)).toBeNull()
    }
  })
})

describe('内置步骤', () => {
  it('id 都是合法文件名，显示名都能进计划表格', () => {
    for (const preset of PRESETS) {
      expect(checkName(preset.id)).toBeNull()
      expect(checkLabel(t(preset.labelKey))).toBeNull()
      expect(checkLabel(en[preset.labelKey])).toBeNull()
      expect(presetData(preset, t).prompt).not.toBe('')
    }
  })

  it('从 id 认种类：带序号的副本也认得', () => {
    expect(kindOf('review')).toBe('review')
    expect(kindOf('Review-3')).toBe('review')
    expect(kindOf('something')).toBe('blank')
  })

  it('示例流程的每条线都连着真实存在的步骤', () => {
    const { nodes, edges } = starterGraph(t)
    const ids = new Set(nodes.map((node) => node.id))
    for (const edge of edges) {
      expect(ids.has(edge.source)).toBe(true)
      expect(ids.has(edge.target)).toBe(true)
    }
    expect(nodes.every((node) => node.position.x !== 0 || node.position.y !== 0)).toBe(true)
  })
})

describe('词典', () => {
  it('中英文键完全一致', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })
})
