import { describe, expect, it } from 'vitest'
import {
  cloneDocument,
  displayName,
  findNode,
  idKey,
  incomingEdges,
  isResource,
  isStep,
  makeEdgeId,
  normalizeCoord,
  normalizeDocument,
  outgoingEdges,
  outputSpecs,
  readDocument,
  readNodeData,
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

  it('资源节点：读名字、描述与内容，认不出的项丢掉；旧的文件节点（wfFile）当未知类型', () => {
    const out = normalizeDocument({
      nodes: [
        {
          id: 'r',
          type: 'wfResource',
          position: { x: 1, y: 2 },
          data: {
            label: '资料',
            items: [
              { kind: 'folder', value: 'src' },
              { kind: 'x', value: 'y' },
            ],
          },
        },
        { id: 'g', type: 'wfResource', position: { x: 1, y: 2 }, data: {} },
        { id: 'old', type: 'wfFile', position: { x: 1, y: 2 }, data: { path: 'a.md' } },
      ],
      edges: [],
      viewport: {},
    })
    expect(out.document?.nodes.filter(isResource).map((node) => node.data)).toEqual([
      { label: '资料', items: [{ kind: 'folder', value: 'src' }] },
      { items: [] },
    ])
    expect(out.problems.some((problem) => problem.code === 'unknown_node_type')).toBe(true)
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
          data: { label: '认证审查', prompt: '你是审查者。' },
        },
        {
          id: 'fix-auth',
          type: 'wfNode',
          position: { x: 320, y: 320 },
          data: { prompt: '修' },
        },
        {
          id: 'file-findings',
          type: 'wfResource',
          position: { x: 400, y: 260 },
          data: {
            label: '问题清单',
            items: [{ kind: 'file', value: 'auth-findings.md', note: '问题清单' }],
          },
        },
      ],
      edges: [
        {
          id: 'auth-review->fix-auth#fail',
          source: 'auth-review',
          target: 'fix-auth',
          sourceHandle: null,
          targetHandle: null,
          data: { when: 'fail', handoff: { note: '逐条修' } },
        },
        {
          id: 'auth-review->file-findings',
          source: 'auth-review',
          target: 'file-findings',
          sourceHandle: null,
          targetHandle: null,
        },
        {
          id: 'fix-auth->file-findings',
          source: 'fix-auth',
          target: 'file-findings',
          sourceHandle: null,
          targetHandle: null,
          data: { update: true },
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
    if (copiedNode !== undefined && isStep(copiedNode)) {
      copiedNode.position.x = 99
      copiedNode.data.prompt = 'CHANGED'
    }
    if (copiedEdge?.data !== undefined) {
      copiedEdge.data.when = 'fail'
    }
    expect(d.nodes[0]?.position.x).toBe(1)
    const original = d.nodes[0]
    expect(original !== undefined && isStep(original) ? original.data.prompt : null).toBe('P')
    expect(d.edges[0]?.data?.when).toBe('pass')
  })
})

describe('产出清单与描述', () => {
  it('节点模板的 data 里产出照旧走规范写法：一个且没规则写成字符串；描述照写', () => {
    expect(readNodeData({ output: [{ path: 'a.md' }] }).output).toBe('a.md')
    expect(readNodeData({ output: [{ path: 'a.md', rule: '  ' }] }).output).toBe('a.md')
    expect(
      readNodeData({ output: [{ path: 'a.md', rule: 'r' }, { path: 'b.md' }] }).output,
    ).toEqual([{ path: 'a.md', rule: 'r' }, { path: 'b.md' }])
    expect(readNodeData({ output: [] }).output).toBeUndefined()
    expect(readNodeData({ output: [{ nope: 1 }, { path: 'b.md' }] }).output).toBe('b.md')
    expect(readNodeData({ output: 'x.md', description: '做什么' }).description).toBe('做什么')
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

describe('工作流设置', () => {
  it('全缺省时不写 settings 键（老文件逐字节不变）', () => {
    const text = writeDocument(doc())
    expect(text).not.toContain('settings')
    expect(writeDocument(doc({ settings: { mode: 'auto' as never } }))).not.toContain('settings')
  })

  it('读入时根目录标准化、认不出的执行方式当缺省；写出排在 viewport 之后', () => {
    const parsed = normalizeDocument({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      settings: { outputRoot: ' out//run/ ', mode: 'team', extra: 1 },
    })
    expect(parsed.document?.settings).toEqual({ outputRoot: 'out/run', mode: 'team' })
    const text = writeDocument(parsed.document ?? doc())
    expect(text.indexOf('"viewport"')).toBeLessThan(text.indexOf('"settings"'))
    expect(
      normalizeDocument({ nodes: [], edges: [], settings: { mode: 'warp' } }).document?.settings,
    ).toBeUndefined()
  })

  it('往返稳定，cloneDocument 不和原件共用设置对象', () => {
    const original = doc({ settings: { outputRoot: 'D:/out', mode: 'subagent' } })
    const again = readDocument(writeDocument(original)).document
    expect(again?.settings).toEqual(original.settings)
    const copy = cloneDocument(original)
    expect(copy.settings).toEqual(original.settings)
    expect(copy.settings).not.toBe(original.settings)
  })

  it('复用执行者与设定目标：只存非缺省值（reuse 非 auto、setGoal 只存 false），按固定键序写出', () => {
    const read = (settings: unknown) =>
      normalizeDocument({ nodes: [], edges: [], settings }).document?.settings
    expect(read({ reuse: 'auto', setGoal: true })).toBeUndefined()
    expect(read({ reuse: 'later', setGoal: 'no' })).toBeUndefined()
    expect(read({ reuse: 'fresh', setGoal: false })).toEqual({ reuse: 'fresh', setGoal: false })
    const text = writeDocument(
      doc({ settings: { runState: true, setGoal: false, reuse: 'reuse', mode: 'team' } }),
    )
    const keys = ['"mode"', '"reuse"', '"setGoal"', '"runState"'].map((key) => text.indexOf(key))
    expect(keys.every((at, i) => at > 0 && (i === 0 || at > (keys[i - 1] ?? 0)))).toBe(true)
  })
})
