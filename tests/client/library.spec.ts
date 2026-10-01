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
import { isFile, isStep, makeEdgeId, outputSpecs } from '../../src/shared/model.ts'
import { checkLabel, checkName, checkText } from '../../src/shared/naming.ts'
import type { WorkflowDocument } from '../../src/shared/types.ts'
import { validateDocument } from '../../src/shared/validate.ts'

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

  it('写文件的内置步骤都带生成规则，规则能过保存校验', () => {
    for (const preset of PRESETS) {
      const { output } = presetData(preset, t)
      if (preset.output === false) {
        expect(output).toBe(false)
        continue
      }
      const specs = outputSpecs(output)
      expect(specs).toHaveLength(1)
      expect(specs[0]?.path).toBe(preset.output)
      expect(specs[0]?.rule ?? '').not.toBe('')
      expect(checkText(specs[0]?.rule ?? '', 'rule')).toBeNull()
      // 英文词典里也有对应的规则。
      if (preset.ruleKey !== undefined) expect(en[preset.ruleKey]).not.toBe('')
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

describe('示例流程的文件与交接', () => {
  it('每个写文件的内置步骤挂一张文件卡；审查报告被修复在原文件上更新、汇总读它；整张图过保存校验', () => {
    const { nodes, edges } = starterGraph(t)
    const files = nodes.filter(isFile)
    expect(files.map((node) => node.data.path)).toEqual([
      'scan-notes.md',
      'plan.md',
      'changes.md',
      'review.md',
      'fix-notes.md',
    ])
    expect(nodes.filter(isStep).every((node) => node.data.output === undefined)).toBe(true)
    const update = edges.find((edge) => edge.source === 'fix' && edge.target === 'file-review.md')
    expect(update?.update).toBe(true)
    expect(edges.some((edge) => edge.source === 'file-review.md' && edge.target === 'report')).toBe(
      true,
    )
    const fix = edges.find((edge) => edge.source === 'review' && edge.target === 'fix')
    expect(fix?.handoff).toEqual({ note: zh['starter.fixNote'] })

    const document: WorkflowDocument = {
      nodes,
      edges: edges.map((edge) => ({
        id: makeEdgeId(edge.source, edge.target, edge.when),
        source: edge.source,
        target: edge.target,
        sourceHandle: null,
        targetHandle: null,
        data: {
          ...(edge.when === undefined ? {} : { when: edge.when }),
          ...(edge.handoff === undefined ? {} : { handoff: edge.handoff }),
          ...(edge.update === true ? { update: true as const } : {}),
        },
      })),
      viewport: { x: 0, y: 0, zoom: 1 },
    }
    const report = validateDocument(document, { workflowName: 'starter', maxNodes: 200 })
    expect(report.save).toEqual([])
    expect(report.warning).toEqual([])
    expect(en['starter.fixNote']).not.toBe('')
  })
})
