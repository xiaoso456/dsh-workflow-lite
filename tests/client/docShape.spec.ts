/**
 * `src/client/model/docShape.ts`：判成「一样」的两份文档，对应的计算必须算出一样的结果
 * （`sameStructure` → `analyzeGraph`、`graphFacts`；`sameRouting` → `buildRoutes`）；动了相关输入的必须判成不同。
 */

import { describe, expect, it } from 'vitest'
import { sameRouting, sameStructure } from '../../src/client/model/docShape.ts'
import { tidy } from '../../src/client/model/layout.ts'
import { buildRoutes } from '../../src/client/ui/canvas/flow/buildRoutes.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import { graphFacts } from '../../src/shared/runState.ts'
import type { WorkflowDocument, WorkflowNode } from '../../src/shared/types.ts'
import { bigGraph } from '../perf/bigGraph.ts'

async function laidOut(): Promise<WorkflowDocument> {
  const doc = bigGraph(2) as WorkflowDocument
  const positions = await tidy(doc, analyzeGraph(doc))
  return {
    ...doc,
    nodes: doc.nodes.map((node) => ({ ...node, position: positions[node.id] ?? node.position })),
  }
}

/** 走线结果转成能比的普通对象。 */
function routesOf(doc: WorkflowDocument): unknown {
  const routes = buildRoutes({
    doc,
    dragging: {},
    sized: 0,
    sizes: new Map(),
    routeBase: { current: null },
  })
  return Object.fromEntries(Object.entries(routes).map(([key, map]) => [key, [...map]]))
}

function mapNode(
  doc: WorkflowDocument,
  pick: (node: WorkflowNode) => boolean,
  change: (node: WorkflowNode) => WorkflowNode,
): WorkflowDocument {
  let done = false
  return {
    ...doc,
    nodes: doc.nodes.map((node) => {
      if (done || !pick(node)) return node
      done = true
      return change(node)
    }),
  }
}

/** 改第一张步骤卡的文字（提示词、标题、描述）。 */
function retext(doc: WorkflowDocument): WorkflowDocument {
  return mapNode(
    doc,
    (node) => node.type === 'wfNode',
    (node) =>
      node.type === 'wfNode'
        ? {
            ...node,
            data: {
              ...node.data,
              prompt: `${node.data.prompt}改`,
              label: '新标题',
              description: '说明',
            },
          }
        : node,
  )
}

/** 图分析、步骤事实转成能比的普通对象。 */
function structureOf(doc: WorkflowDocument): unknown {
  const analysis = analyzeGraph(doc)
  return JSON.parse(
    JSON.stringify({ analysis, facts: graphFacts(doc) }, (_key, value: unknown) =>
      value instanceof Map ? [...value] : value instanceof Set ? [...value] : value,
    ),
  )
}

describe('sameStructure', () => {
  it('只改文字、挪卡片：判成相同，图分析和步骤事实也确实一样', async () => {
    const doc = await laidOut()
    const edited = retext(doc)
    expect(sameStructure(doc, edited)).toBe(true)
    expect(structureOf(edited)).toEqual(structureOf(doc))
    const moved = mapNode(
      doc,
      (node) => node.type === 'wfNode',
      (node) => ({ ...node, position: { x: node.position.x + 40, y: node.position.y } }),
    )
    expect(sameStructure(doc, moved)).toBe(true)
  })

  it('连线换了对象、增删节点、换了种类：不同', async () => {
    const doc = await laidOut()
    const [first] = doc.edges
    if (first === undefined) throw new Error('图里没有线')
    expect(sameStructure(doc, { ...doc, edges: [{ ...first }, ...doc.edges.slice(1)] })).toBe(false)
    expect(sameStructure(doc, { ...doc, nodes: doc.nodes.slice(1) })).toBe(false)
    const [node] = doc.nodes
    if (node === undefined) throw new Error('图里没有卡片')
    expect(
      sameStructure(doc, { ...doc, nodes: [{ ...node, id: 'other' }, ...doc.nodes.slice(1)] }),
    ).toBe(false)
  })
})

describe('sameRouting', () => {
  it('只改文字（提示词、标题、描述）：判成相同，走线也确实一样', async () => {
    const doc = await laidOut()
    const edited = retext(doc)
    expect(sameRouting(doc, edited)).toBe(true)
    expect(routesOf(edited)).toEqual(routesOf(doc))
  })

  it('挪了卡片：不同', async () => {
    const doc = await laidOut()
    const moved = mapNode(
      doc,
      (node) => node.type === 'wfNode',
      (node) => ({ ...node, position: { x: node.position.x + 1, y: node.position.y } }),
    )
    expect(sameRouting(doc, moved)).toBe(false)
  })

  it('资源卡换了尺寸（多了一项）：不同', async () => {
    const doc = await laidOut()
    const grown = mapNode(
      doc,
      (node) => node.type === 'wfResource',
      (node) =>
        node.type === 'wfResource' && 'items' in node.data
          ? {
              ...node,
              data: {
                ...node.data,
                items: [...node.data.items, { kind: 'text' as const, value: '多一项' }],
              },
            }
          : node,
    )
    expect(grown.nodes).not.toEqual(doc.nodes)
    expect(sameRouting(doc, grown)).toBe(false)
  })

  it('连线：改条件、换终点、多一条都不同', async () => {
    const doc = await laidOut()
    const [first] = doc.edges
    if (first === undefined) throw new Error('图里没有线')
    const withEdge = (edge: typeof first): WorkflowDocument => ({
      ...doc,
      edges: [edge, ...doc.edges.slice(1)],
    })
    expect(sameRouting(doc, withEdge({ ...first, data: { ...first.data, when: '通过了' } }))).toBe(
      false,
    )
    expect(sameRouting(doc, withEdge({ ...first, target: 'nowhere' }))).toBe(false)
    expect(sameRouting(doc, { ...doc, edges: [...doc.edges, { ...first, id: 'extra' }] })).toBe(
      false,
    )
    expect(sameRouting(doc, withEdge({ ...first }))).toBe(true)
  })
})
