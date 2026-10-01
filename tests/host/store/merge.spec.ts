import { describe, expect, it } from 'vitest'

import { mergeDocuments } from '../../../src/host/store/merge.ts'
import {
  type EdgeData,
  NODE_TYPE,
  type NodeData,
  type Point,
  type Viewport,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../../src/shared/types.ts'

function node(id: string, data: NodeData = {}, position: Point = { x: 0, y: 0 }): WorkflowNode {
  return { id, type: NODE_TYPE, position, data }
}

function edge(
  id: string,
  source: string,
  target: string,
  when?: string,
  label?: string,
): WorkflowEdge {
  const data: EdgeData = {}
  if (when !== undefined) data.when = when
  if (label !== undefined) data.label = label
  return {
    id,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(Object.keys(data).length > 0 ? { data } : {}),
  }
}

function doc(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[] = [],
  viewport: Viewport = { x: 0, y: 0, zoom: 1 },
): WorkflowDocument {
  return { nodes, edges, viewport }
}

function nodeIds(document: WorkflowDocument): string[] {
  return document.nodes.map((item) => item.id).sort()
}

function promptOf(document: WorkflowDocument, id: string): string | undefined {
  const found = findNode(document, id)
  return found !== undefined && found.type === 'wfNode' ? found.data.prompt : undefined
}

function findNode(document: WorkflowDocument, id: string): WorkflowNode | undefined {
  return document.nodes.find((item) => item.id === id)
}

describe('mergeDocuments —— 不同 id 各自被改 ⇒ 自动合并、不报冲突', () => {
  it('两个节点各改一个：两边都在', () => {
    const base = doc([node('a', { prompt: 'A' }), node('b', { prompt: 'B' })])
    const mine = doc([node('a', { prompt: 'A2' }), node('b', { prompt: 'B' })])
    const theirs = doc([node('a', { prompt: 'A' }), node('b', { prompt: 'B2' })])

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual([])
    expect(promptOf(result.document, 'a')).toBe('A2')
    expect(promptOf(result.document, 'b')).toBe('B2')
  })

  it('只有对方改了 ⇒ 采纳对方的', () => {
    const base = doc([node('a', { prompt: 'A' })])
    const mine = doc([node('a', { prompt: 'A' })])
    const theirs = doc([node('a', { prompt: 'A2' })])

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual([])
    expect(promptOf(result.document, 'a')).toBe('A2')
  })

  it('两边各自新增不同节点 ⇒ 都留下', () => {
    const base = doc([node('root')])
    const mine = doc([node('root'), node('mine')])
    const theirs = doc([node('root'), node('theirs')])

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual([])
    expect(nodeIds(result.document)).toEqual(['mine', 'root', 'theirs'])
  })

  it('对方新增的节点被采纳', () => {
    const base = doc([])
    const mine = doc([node('a')])
    const theirs = doc([node('b')])

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual([])
    expect(nodeIds(result.document)).toEqual(['a', 'b'])
  })

  it('不同边各自被改 ⇒ 自动合并', () => {
    const base = doc([node('a'), node('b')], [edge('a->b', 'a', 'b'), edge('b->a', 'b', 'a')])
    const mine = doc(
      [node('a'), node('b')],
      [edge('a->b', 'a', 'b', 'pass'), edge('b->a', 'b', 'a')],
    )
    const theirs = doc(
      [node('a'), node('b')],
      [edge('a->b', 'a', 'b'), edge('b->a', 'b', 'a', 'fail')],
    )

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual([])
    const byId = new Map(result.document.edges.map((item) => [item.id, item]))
    expect(byId.get('a->b')?.data?.when).toBe('pass')
    expect(byId.get('b->a')?.data?.when).toBe('fail')
  })
})

describe('mergeDocuments —— 冲突的两种情形', () => {
  it('同一个 node 的 data 双方都改过（各改成不一样）⇒ 冲突，输出保留本地', () => {
    const base = doc([node('a', { prompt: 'A' })])
    const mine = doc([node('a', { prompt: 'mine' })])
    const theirs = doc([node('a', { prompt: 'theirs' })])

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual(['a'])
    expect(promptOf(result.document, 'a')).toBe('mine')
  })

  it('同一个 id 一方删、一方改 ⇒ 冲突', () => {
    const base = doc([node('a', { prompt: 'A' }), node('b')])
    const mine = doc([node('b')])
    const theirs = doc([node('a', { prompt: 'theirs' }), node('b')])

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual(['a'])
  })

  it('一方删、另一方没动 ⇒ 采纳删除，不报冲突', () => {
    const base = doc([node('a', { prompt: 'A' }), node('b')])
    const mine = doc([node('a', { prompt: 'A' }), node('b')])
    const theirs = doc([node('b')])

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual([])
    expect(nodeIds(result.document)).toEqual(['b'])
  })

  it('双方各自新增同一个 id 且内容不同 ⇒ 冲突', () => {
    const base = doc([])
    const mine = doc([node('a', { prompt: 'mine' })])
    const theirs = doc([node('a', { prompt: 'theirs' })])

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual(['a'])
  })

  it('同一条边双方都改过 ⇒ 冲突', () => {
    const base = doc([node('a'), node('b')], [edge('a->b', 'a', 'b', 'pass')])
    const mine = doc([node('a'), node('b')], [edge('a->b', 'a', 'b', 'fail')])
    const theirs = doc([node('a'), node('b')], [edge('a->b', 'a', 'b', 'other')])

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual(['a->b'])
  })
})

describe('mergeDocuments —— 视图态与坐标永不冲突', () => {
  it('viewport 本地优先', () => {
    const base = doc([], [], { x: 0, y: 0, zoom: 1 })
    const mine = doc([], [], { x: 10, y: 10, zoom: 1.5 })
    const theirs = doc([], [], { x: -5, y: -5, zoom: 2 })

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual([])
    expect(result.document.viewport).toEqual({ x: 10, y: 10, zoom: 1.5 })
  })

  it('坐标：本地没动就用对方的，两边都动则本地优先且不报冲突', () => {
    const base = doc([node('a', { prompt: 'A' }, { x: 0, y: 0 })])

    const onlyTheirs = mergeDocuments(
      base,
      doc([node('a', { prompt: 'A' }, { x: 0, y: 0 })]),
      doc([node('a', { prompt: 'A' }, { x: 100, y: 40 })]),
    )
    expect(onlyTheirs.conflictIds).toEqual([])
    expect(findNode(onlyTheirs.document, 'a')?.position).toEqual({ x: 100, y: 40 })

    const both = mergeDocuments(
      base,
      doc([node('a', { prompt: 'A' }, { x: 5, y: 5 })]),
      doc([node('a', { prompt: 'A' }, { x: 100, y: 40 })]),
    )
    expect(both.conflictIds).toEqual([])
    expect(findNode(both.document, 'a')?.position).toEqual({ x: 5, y: 5 })
  })

  it('data 与坐标各改一边 ⇒ 两者都保住（字段级合并）', () => {
    const base = doc([node('a', { prompt: 'A' }, { x: 0, y: 0 })])
    const mine = doc([node('a', { prompt: 'A2' }, { x: 0, y: 0 })])
    const theirs = doc([node('a', { prompt: 'A' }, { x: 8, y: 9 })])

    const result = mergeDocuments(base, mine, theirs)
    expect(result.conflictIds).toEqual([])
    expect(promptOf(result.document, 'a')).toBe('A2')
    expect(findNode(result.document, 'a')?.position).toEqual({ x: 8, y: 9 })
  })
})

describe('mergeDocuments —— 工作流设置按字段合并', () => {
  const base = { ...doc([node('a')]), settings: { outputRoot: 'out' } }

  it('一边改根目录、一边改执行方式：两边都留下，不报冲突', () => {
    const mine = { ...base, settings: { outputRoot: 'build/out' } }
    const theirs = { ...base, settings: { outputRoot: 'out', mode: 'team' as const } }
    const merged = mergeDocuments(base, mine, theirs)
    expect(merged.document.settings).toEqual({ outputRoot: 'build/out', mode: 'team' })
    expect(merged.conflictIds).toEqual([])
  })

  it('同一字段两边改成不一样：报 settings 冲突，本地优先', () => {
    const mine = { ...base, settings: { outputRoot: 'mine' } }
    const theirs = { ...base, settings: { outputRoot: 'theirs' } }
    const merged = mergeDocuments(base, mine, theirs)
    expect(merged.document.settings).toEqual({ outputRoot: 'mine' })
    expect(merged.conflictIds).toEqual(['settings'])
  })

  it('对方清掉了设置、本地没动：采纳清除', () => {
    const merged = mergeDocuments(base, base, doc([node('a')]))
    expect(merged.document.settings).toBeUndefined()
  })
})

describe('mergeDocuments —— 交接与写入方式算边的内容，文件节点按内容合并', () => {
  const plain = edge('a->b', 'a', 'b')
  const base = doc([node('a'), node('b')], [plain])
  const withData = (data: EdgeData): WorkflowDocument =>
    doc([node('a'), node('b')], [{ ...plain, data }])

  it('只有对方改了交接：采纳对方的', () => {
    const merged = mergeDocuments(base, base, withData({ handoff: { note: 'n' } }))
    expect(merged.document.edges[0]?.data?.handoff).toEqual({ note: 'n' })
    expect(merged.conflictIds).toEqual([])
  })

  it('两边改成不一样（交接 / 写入方式）：报这条边冲突，本地优先', () => {
    const merged = mergeDocuments(base, withData({ handoff: false }), withData({ update: true }))
    expect(merged.conflictIds).toEqual(['a->b'])
    expect(merged.document.edges[0]?.data?.handoff).toBe(false)
  })

  it('文件节点：一边改路径、一边没动 ⇒ 采纳改动；两边都改成不一样 ⇒ 冲突', () => {
    const fileNode = (path: string): WorkflowNode => ({
      id: 'f',
      type: 'wfFile',
      position: { x: 0, y: 0 },
      data: { path },
    })
    const origin = doc([fileNode('a.md')])
    expect(mergeDocuments(origin, origin, doc([fileNode('b.md')])).document.nodes[0]?.data).toEqual(
      { path: 'b.md' },
    )
    const clash = mergeDocuments(origin, doc([fileNode('c.md')]), doc([fileNode('b.md')]))
    expect(clash.conflictIds).toEqual(['f'])
  })
})
