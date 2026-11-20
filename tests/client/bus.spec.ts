import { describe, expect, it } from 'vitest'
import { BUS_ROOM, busPoints, findBuses } from '../../src/client/model/bus.ts'
import type { Rect } from '../../src/client/model/route.ts'
import { nodeIndex } from '../../src/shared/resources.ts'
import type { WorkflowDocument } from '../../src/shared/types.ts'

/** 一份规范被 a、b 读，c 写它（更新）；x 是跟它不相干的一步。 */
const doc: WorkflowDocument = {
  nodes: [
    ...['a', 'b', 'c', 'x'].map((id) => ({
      id,
      type: 'wfNode' as const,
      position: { x: 0, y: 0 },
      data: { prompt: id },
    })),
    {
      id: 'spec',
      type: 'wfResource',
      position: { x: 0, y: 0 },
      data: { items: [{ kind: 'file', value: 'spec.md' }] },
    },
  ],
  viewport: { x: 0, y: 0, zoom: 1 },
  edges: [
    { id: 'r1', source: 'spec', target: 'a', sourceHandle: null, targetHandle: null },
    { id: 'r2', source: 'spec', target: 'b', sourceHandle: null, targetHandle: null },
    {
      id: 'w1',
      source: 'c',
      target: 'spec',
      sourceHandle: null,
      targetHandle: null,
      data: { update: true },
    },
  ],
}

const step = (x: number, y = 300): Rect => ({ x, y, w: 216, h: 96 })

describe('总线', () => {
  it('卡片底边比它连着的每个步骤都高出一截才走总线，干线在两头正中', () => {
    const rects = new Map<string, Rect>([
      ['spec', { x: 0, y: 100, w: 200, h: 56 }],
      ['a', step(0)],
      ['b', step(300)],
      ['c', step(600)],
    ])
    const bus = findBuses(doc, nodeIndex(doc), rects).get('spec')
    expect(bus?.trunk).toBe((156 + 300) / 2)
    expect([...(bus?.reads ?? [])].sort()).toEqual(['a', 'b'])
    expect([...(bus?.writes ?? [])]).toEqual(['c'])
    // 干线横跨的那一段里卡片下面还有别的卡：干线在它上面。
    rects.set('x', { x: 450, y: 220, w: 200, h: 56 })
    expect(findBuses(doc, nodeIndex(doc), rects).get('spec')?.trunk).toBe((156 + 220) / 2)
    rects.delete('x')
    // 有一个步骤挨得太近（或在它上面）：整张卡回到平常的走法。
    rects.set('b', step(300, 156 + BUS_ROOM - 1))
    expect(findBuses(doc, nodeIndex(doc), rects).has('spec')).toBe(false)
  })

  it('竖线落进步骤的那一截压着别的卡时，这一条线不走总线', () => {
    const rects = new Map<string, Rect>([
      ['spec', { x: 0, y: 0, w: 200, h: 56 }],
      ['a', step(0)],
      ['b', step(300)],
      ['c', step(600)],
      ['x', step(300, 150)],
    ])
    const bus = findBuses(doc, nodeIndex(doc), rects).get('spec')
    expect([...(bus?.reads ?? [])]).toEqual(['a'])
    // 只压着步骤的一角、没压着落点：照样走总线。
    rects.set('x', { x: 600 + 216 * 0.9, y: 150, w: 216, h: 96 })
    expect([...(findBuses(doc, nodeIndex(doc), rects).get('spec')?.writes ?? [])]).toEqual(['c'])
  })

  it('竖着出去、沿干线横着走、竖着进去；两头对齐时是一根竖线', () => {
    const from = { x: 40, y: 156, side: 'bottom' as const }
    expect(busPoints(from, { x: 400, y: 300, side: 'top' }, 220)).toEqual([
      [40, 156],
      [40, 220],
      [400, 220],
      [400, 300],
    ])
    expect(busPoints(from, { x: 40, y: 300, side: 'top' }, 220)).toHaveLength(2)
  })
})
