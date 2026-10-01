import { describe, expect, it } from 'vitest'
import {
  cloneDocument,
  displayName,
  findNode,
  idKey,
  incomingEdges,
  makeEdgeId,
  normalizeCoord,
  normalizeDocument,
  outgoingEdges,
  outputSpecs,
  readDocument,
  sameNodeData,
  writeDocument,
} from '../../src/shared/model.ts'
import type { WorkflowDocument } from '../../src/shared/types.ts'

function doc(partial: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, ...partial }
}

describe('normalizeCoord', () => {
  it('四舍五入到 2 位小数', () => {
    expect(normalizeCoord(320.123456)).toBe(320.12)
    expect(normalizeCoord(320.125)).toBe(320.13)
    expect(normalizeCoord(-0.004)).toBe(-0)
  })
})

describe('idKey', () => {
  it('大小写不敏感——Scan 与 scan 是同一个身份', () => {
    expect(idKey('Scan')).toBe(idKey('scan'))
  })
})

describe('makeEdgeId', () => {
  it('无 when 时是 source->target', () => {
    expect(makeEdgeId('scan', 'auth-review')).toBe('scan->auth-review')
  })
  it('带 when 时追加 #when', () => {
    expect(makeEdgeId('auth-review', 'report', 'pass')).toBe('auth-review->report#pass')
  })
  it('空串 when 与缺省同义（都是无条件边）', () => {
    expect(makeEdgeId('a', 'b', '')).toBe(makeEdgeId('a', 'b'))
  })
})

describe('displayName', () => {
  it('label 存在时是 label（id）', () => {
    expect(displayName('auth-review', '认证审查')).toBe('认证审查（auth-review）')
  })
  it('label 缺省或空串时只写 id', () => {
    expect(displayName('auth-review')).toBe('auth-review')
    expect(displayName('auth-review', '')).toBe('auth-review')
  })
})

describe('normalizeDocument', () => {
  it('顶层不是对象 → 保存级 schema_invalid，文档为 null', () => {
    const out = normalizeDocument([1, 2, 3])
    expect(out.document).toBeNull()
    expect(out.problems).toEqual([
      expect.objectContaining({ level: 'save', code: 'schema_invalid' }),
    ])
  })

  it('缺 nodes / edges 数组 → 保存级', () => {
    expect(normalizeDocument({ edges: [], viewport: {} }).problems[0]?.code).toBe('schema_invalid')
    expect(normalizeDocument({ nodes: [], viewport: {} }).problems[0]?.code).toBe('schema_invalid')
    expect(normalizeDocument({ nodes: [], viewport: {} }).document).toBeNull()
  })

  it('节点缺 id → 保存级 node_id_missing 且跳过该节点', () => {
    const out = normalizeDocument({ nodes: [{ type: 'wfNode' }], edges: [], viewport: {} })
    expect(out.document?.nodes).toEqual([])
    expect(out.problems[0]).toMatchObject({ level: 'save', code: 'node_id_missing' })
  })

  it('边缺 source / target → 保存级 edge_field_missing', () => {
    const out = normalizeDocument({ nodes: [], edges: [{ id: 'e1', source: 'a' }], viewport: {} })
    expect(out.document?.edges).toEqual([])
    expect(out.problems[0]).toMatchObject({ level: 'save', code: 'edge_field_missing' })
  })

  it('未知 type → 警告，并归一成 wfNode', () => {
    const out = normalizeDocument({
      nodes: [{ id: 'a', type: 'mystery', position: { x: 1, y: 2 }, data: { prompt: 'x' } }],
      edges: [],
      viewport: {},
    })
    expect(out.document?.nodes[0]?.type).toBe('wfNode')
    expect(out.problems).toContainEqual(
      expect.objectContaining({ level: 'warning', code: 'unknown_node_type', node: 'a' }),
    )
  })

  it('position 缺失 → 提示级 position_filled，坐标落 (0,0) 占位等布局补位', () => {
    const out = normalizeDocument({
      nodes: [{ id: 'a', type: 'wfNode', data: {} }],
      edges: [],
      viewport: {},
    })
    expect(out.document?.nodes[0]?.position).toEqual({ x: 0, y: 0 })
    expect(out.problems).toContainEqual(
      expect.objectContaining({ level: 'hint', code: 'position_filled' }),
    )
  })

  it('viewport 缺失或非法 → 回落默认值并报提示，不算保存级', () => {
    for (const bad of [undefined, { x: 0, y: 0, zoom: 0 }, { x: 'a', y: 0, zoom: 1 }]) {
      const out = normalizeDocument({ nodes: [], edges: [], viewport: bad })
      expect(out.document?.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
      expect(out.problems.some((p) => p.level === 'hint')).toBe(true)
      expect(out.problems.some((p) => p.level === 'save')).toBe(false)
    }
  })

  it('output 三态：字符串 / false / 缺省', () => {
    const out = normalizeDocument({
      nodes: [
        { id: 'a', type: 'wfNode', position: { x: 0, y: 0 }, data: { output: 'x.md' } },
        { id: 'b', type: 'wfNode', position: { x: 0, y: 0 }, data: { output: false } },
        { id: 'c', type: 'wfNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'd', type: 'wfNode', position: { x: 0, y: 0 }, data: { output: 42 } },
      ],
      edges: [],
      viewport: {},
    })
    expect(out.document?.nodes.map((n) => n.data.output)).toEqual([
      'x.md',
      false,
      undefined,
      undefined,
    ])
  })

  it('边 data 全空时整键省略', () => {
    const out = normalizeDocument({
      nodes: [],
      edges: [{ id: 'e', source: 'a', target: 'b', data: {} }],
      viewport: {},
    })
    expect(out.document?.edges[0]?.data).toBeUndefined()
  })
})

describe('readDocument', () => {
  it('解析失败 → 保存级 json_parse_failed', () => {
    const out = readDocument('{ not json')
    expect(out.document).toBeNull()
    expect(out.problems[0]).toMatchObject({ level: 'save', code: 'json_parse_failed' })
  })
})

describe('writeDocument（canonical writer）', () => {
  it('2 空格缩进 + LF + 末尾恰好一个换行 + 固定键序', () => {
    const text = writeDocument(
      doc({
        nodes: [
          { id: 'a', type: 'wfNode', position: { x: 1, y: 2 }, data: { label: '甲', prompt: 'P' } },
        ],
        edges: [{ id: 'a->b', source: 'a', target: 'b', sourceHandle: null, targetHandle: null }],
        viewport: { x: 0, y: 0, zoom: 1 },
      }),
    )
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
    expect(text).not.toContain('\r')
    // 顶层键序
    expect(text.indexOf('"nodes"')).toBeLessThan(text.indexOf('"edges"'))
    expect(text.indexOf('"edges"')).toBeLessThan(text.indexOf('"viewport"'))
    // node 键序：id → type → position → data
    const nodeBlock = text.slice(text.indexOf('"id"'))
    expect(nodeBlock.indexOf('"id"')).toBeLessThan(nodeBlock.indexOf('"type"'))
    expect(nodeBlock.indexOf('"type"')).toBeLessThan(nodeBlock.indexOf('"position"'))
    expect(nodeBlock.indexOf('"position"')).toBeLessThan(nodeBlock.indexOf('"data"'))
    // 2 空格缩进
    expect(text).toContain('\n  "nodes"')
  })

  it('sourceHandle / targetHandle 一律写出 null（不在"缺省整键省略"之列）', () => {
    const text = writeDocument(
      doc({
        edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: null, targetHandle: null }],
      }),
    )
    expect(text).toContain('"sourceHandle": null')
    expect(text).toContain('"targetHandle": null')
  })

  it('边 data 全空时不写 data 键', () => {
    const text = writeDocument(
      doc({
        edges: [{ id: 'e', source: 'a', target: 'b', sourceHandle: null, targetHandle: null }],
      }),
    )
    expect(text).not.toContain('"data": {}')
  })

  it('丢弃 React Flow 运行时字段与一切未知字段（白名单写出）', () => {
    const dirty = {
      nodes: [
        {
          id: 'a',
          type: 'wfNode',
          position: { x: 1.23456, y: 2 },
          measured: { width: 100, height: 40 },
          selected: true,
          dragging: false,
          width: 100,
          height: 40,
          data: { prompt: 'P', role: 'reviewer' },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      revision: 7,
    }
    const out = normalizeDocument(dirty)
    const text = writeDocument(out.document ?? doc())
    expect(text).not.toContain('measured')
    expect(text).not.toContain('selected')
    expect(text).not.toContain('dragging')
    expect(text).not.toContain('revision')
    expect(text).not.toContain('reviewer')
    expect(text).toContain('"x": 1.23')
  })

  it('同一文档两次写出逐字节相同（canonical）', () => {
    const d = doc({
      nodes: [
        { id: 'b', type: 'wfNode', position: { x: 1, y: 2 }, data: { prompt: 'B' } },
        { id: 'a', type: 'wfNode', position: { x: 3, y: 4 }, data: { prompt: 'A' } },
      ],
    })
    expect(writeDocument(d)).toBe(writeDocument(d))
  })

  it('数组顺序不重排（文件内顺序即 diff 稳定性）', () => {
    const d = doc({
      nodes: [
        { id: 'z', type: 'wfNode', position: { x: 0, y: 0 }, data: {} },
        { id: 'a', type: 'wfNode', position: { x: 0, y: 0 }, data: {} },
      ],
    })
    const text = writeDocument(d)
    expect(text.indexOf('"z"')).toBeLessThan(text.indexOf('"a"'))
  })

  it('round-trip 无损：写→读→写 逐字节相同', () => {
    const d = doc({
      nodes: [
        {
          id: 'auth-review',
          type: 'wfNode',
          position: { x: 320, y: 180 },
          data: { label: '认证审查', prompt: '你是审查者。', output: 'auth-findings.md' },
        },
        {
          id: 'fix-auth',
          type: 'wfNode',
          position: { x: 320, y: 320 },
          data: { prompt: '修', output: false },
        },
      ],
      edges: [
        {
          id: 'auth-review->fix-auth#fail',
          source: 'auth-review',
          target: 'fix-auth',
          sourceHandle: null,
          targetHandle: null,
          data: { when: 'fail' },
        },
      ],
      viewport: { x: 12, y: -8, zoom: 1 },
    })
    const once = writeDocument(d)
    const back = readDocument(once)
    expect(back.problems.filter((p) => p.level === 'save')).toEqual([])
    expect(writeDocument(back.document ?? doc())).toBe(once)
  })
})

describe('查询助手', () => {
  const d = doc({
    nodes: [
      { id: 'Scan', type: 'wfNode', position: { x: 0, y: 0 }, data: {} },
      { id: 'fix', type: 'wfNode', position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [
      { id: 'e1', source: 'fix', target: 'Scan', sourceHandle: null, targetHandle: null },
      { id: 'e2', source: 'Scan', target: 'fix', sourceHandle: null, targetHandle: null },
    ],
  })

  it('findNode 大小写不敏感', () => {
    expect(findNode(d, 'scan')?.id).toBe('Scan')
  })
  it('incomingEdges / outgoingEdges 大小写不敏感', () => {
    expect(incomingEdges(d, 'scan').map((e) => e.id)).toEqual(['e1'])
    expect(outgoingEdges(d, 'SCAN').map((e) => e.id)).toEqual(['e2'])
  })
})

describe('cloneDocument', () => {
  it('深拷贝——改副本不污染原件', () => {
    const d = doc({
      nodes: [{ id: 'a', type: 'wfNode', position: { x: 1, y: 1 }, data: { prompt: 'P' } }],
      edges: [
        {
          id: 'e',
          source: 'a',
          target: 'a',
          sourceHandle: null,
          targetHandle: null,
          data: { when: 'pass' },
        },
      ],
    })
    const copy = cloneDocument(d)
    const copiedNode = copy.nodes[0]
    const copiedEdge = copy.edges[0]
    if (copiedNode !== undefined) {
      copiedNode.position.x = 99
      copiedNode.data.prompt = 'CHANGED'
    }
    if (copiedEdge?.data !== undefined) {
      copiedEdge.data.when = 'fail'
    }
    expect(d.nodes[0]?.position.x).toBe(1)
    expect(d.nodes[0]?.data.prompt).toBe('P')
    expect(d.edges[0]?.data?.when).toBe('pass')
  })
})

describe('产出清单与描述', () => {
  it('一个产出且没有规则写成字符串；多个或带规则写成数组；描述照写', () => {
    const base = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    const node = (output: unknown, description?: string) => ({
      id: 'a',
      type: 'wfNode',
      position: { x: 1, y: 2 },
      data: { prompt: 'p', output, ...(description === undefined ? {} : { description }) },
    })
    const read = (output: unknown, description?: string) =>
      readDocument(JSON.stringify({ ...base, nodes: [node(output, description)] })).document
        ?.nodes[0]?.data

    expect(read([{ path: 'a.md' }])?.output).toBe('a.md')
    expect(read([{ path: 'a.md', rule: '  ' }])?.output).toBe('a.md')
    expect(read([{ path: 'a.md', rule: 'r' }, { path: 'b.md' }])?.output).toEqual([
      { path: 'a.md', rule: 'r' },
      { path: 'b.md' },
    ])
    expect(read([])?.output).toBeUndefined()
    expect(read([{ nope: 1 }, { path: 'b.md' }])?.output).toBe('b.md')
    expect(read('x.md', '做什么')?.description).toBe('做什么')
  })

  it('写出时产出也走规范写法，键序 label / description / prompt / output', () => {
    const text = writeDocument({
      nodes: [
        {
          id: 'a',
          type: 'wfNode',
          position: { x: 0, y: 0 },
          data: { output: [{ path: 'a.md' }], prompt: 'p', description: 'd', label: 'L' },
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    })
    const data = JSON.parse(text).nodes[0].data
    expect(Object.keys(data)).toEqual(['label', 'description', 'prompt', 'output'])
    expect(data.output).toBe('a.md')
  })

  it('outputSpecs / sameNodeData', () => {
    expect(outputSpecs(false)).toEqual([])
    expect(outputSpecs('a.md')).toEqual([{ path: 'a.md' }])
    expect(sameNodeData({ output: 'a.md' }, { output: [{ path: 'a.md' }] })).toBe(true)
    expect(sameNodeData({ output: [{ path: 'a.md', rule: 'x' }] }, { output: 'a.md' })).toBe(false)
  })
})
