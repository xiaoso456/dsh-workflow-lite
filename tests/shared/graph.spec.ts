import { describe, expect, it } from 'vitest'
import {
  analyzeGraph,
  byId,
  classifyShape,
  compareByCodepoint,
  cycleHasNoExit,
  edgeWhen,
} from '../../src/shared/graph.ts'
import type { WorkflowDocument, WorkflowEdge, WorkflowNode } from '../../src/shared/types.ts'

function node(id: string): WorkflowNode {
  return { id, type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: `prompt of ${id}` } }
}

function edge(source: string, target: string, when?: string): WorkflowEdge {
  return {
    id: when === undefined ? `${source}->${target}` : `${source}->${target}#${when}`,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(when === undefined ? {} : { data: { when } }),
  }
}

function doc(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowDocument {
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }
}

/**
 * 样张里的示例图：`workflows/code-review.json`。
 *   scan ──▶ auth-review ──(fail)──▶ fix-auth
 *                ▲                    │
 *                └────────────────────┘   （回边，无条件）
 *                │
 *                └──(pass)──▶ report
 */
const golden = doc(
  [node('scan'), node('auth-review'), node('fix-auth'), node('report')],
  [
    edge('scan', 'auth-review'),
    edge('auth-review', 'fix-auth', 'fail'),
    edge('auth-review', 'report', 'pass'),
    edge('fix-auth', 'auth-review'),
  ],
)

describe('compareByCodepoint / byId', () => {
  it('按码位序而不是 localeCompare', () => {
    expect(['b', 'a', 'c'].sort(byId)).toEqual(['a', 'b', 'c'])
    // 大写在小写之前（码位序）——localeCompare 在多数 locale 下会给出相反结果
    expect(compareByCodepoint('Z', 'a')).toBeLessThan(0)
    expect(compareByCodepoint('a', 'a')).toBe(0)
    expect(compareByCodepoint('a', 'ab')).toBeLessThan(0)
  })
})

describe('classifyShape —— 出边四种形态', () => {
  it('单条出边 = 顺序', () => {
    expect(classifyShape([edge('a', 'b')])).toBe('sequence')
    expect(classifyShape([])).toBe('sequence')
  })
  it('多条全无条件 = 并行扇出（全部都会走）', () => {
    expect(classifyShape([edge('a', 'b'), edge('a', 'c')])).toBe('fanout')
  })
  it('多条全有条件 = 状态分支', () => {
    expect(classifyShape([edge('a', 'b', 'pass'), edge('a', 'c', 'fail')])).toBe('branch')
  })
  it('混用 = 歧义（警告）', () => {
    expect(classifyShape([edge('a', 'b'), edge('a', 'c', 'pass')])).toBe('mixed')
  })
})

describe('edgeWhen', () => {
  it('缺省与空串都当"无条件"', () => {
    expect(edgeWhen(edge('a', 'b'))).toBeUndefined()
    expect(
      edgeWhen({
        id: 'e',
        source: 'a',
        target: 'b',
        sourceHandle: null,
        targetHandle: null,
        data: { when: '' },
      }),
    ).toBeUndefined()
    expect(edgeWhen(edge('a', 'b', 'pass'))).toBe('pass')
  })
})

describe('analyzeGraph —— 黄金示例图', () => {
  const analysis = analyzeGraph(golden)

  it('节点按 id 码位序', () => {
    expect(analysis.nodeIds).toEqual(['auth-review', 'fix-auth', 'report', 'scan'])
  })

  it('出边形态：auth-review 是状态分支，其余是顺序', () => {
    expect(analysis.shapes.get('auth-review')).toBe('branch')
    expect(analysis.shapes.get('scan')).toBe('sequence')
    expect(analysis.shapes.get('fix-auth')).toBe('sequence')
    expect(analysis.shapes.get('report')).toBe('sequence')
  })

  it('执行批次忽略回边：1 scan / 2 auth-review / 3 fix-auth + report', () => {
    expect(analysis.batches).toEqual([
      { nodes: ['scan'] },
      { nodes: ['auth-review'] },
      { nodes: ['fix-auth', 'report'] },
    ])
  })

  it('前置含回边（fix-auth 计入 auth-review 的前置）', () => {
    expect(analysis.predecessors.get('auth-review')).toEqual(['fix-auth', 'scan'])
    expect(analysis.predecessors.get('scan')).toEqual([])
  })

  it('回边只有 fix-auth→auth-review 一条，且它不参与批次推导', () => {
    expect([...analysis.backEdges]).toEqual(['fix-auth->auth-review'])
    // 若回边误入批次推导，auth-review 会落到批次 3 而不是 2
    expect(analysis.batches[1]?.nodes).toEqual(['auth-review'])
  })

  it('一个循环体：{auth-review, fix-auth}，入口是 scan 指向的那个，且有出口', () => {
    expect(analysis.cycles).toHaveLength(1)
    const cycle = analysis.cycles[0]
    expect(cycle?.nodes).toEqual(['auth-review', 'fix-auth'])
    expect(cycle?.entry).toBe('auth-review')
    expect(cycle?.backEdges).toEqual(['fix-auth->auth-review'])
    // 出口 = 从环内指向环外**且带条件**的边。`auth-review→fix-auth#fail` 的目标在 SCC 内，
    // 它只是“再转一圈”，不是出口——这与样张的循环句一致。
    expect(cycle?.exits).toEqual(['auth-review->report#pass'])
    expect(cycle === undefined ? true : cycleHasNoExit(cycle)).toBe(false)
  })

  it('没有悬空边', () => {
    expect(analysis.danglingEdges).toEqual([])
  })
})

describe('analyzeGraph —— 形态与环的边界', () => {
  it('自环是长度 1 的循环体，唯一回边就是它自己', () => {
    const analysis = analyzeGraph(doc([node('a')], [edge('a', 'a')]))
    expect(analysis.cycles).toHaveLength(1)
    expect(analysis.cycles[0]?.nodes).toEqual(['a'])
    expect(analysis.cycles[0]?.backEdges).toEqual(['a->a'])
    expect(analysis.shapes.get('a')).toBe('sequence')
  })

  it('三节点环：SCC 内一条回边，入口取被环外入边指向者', () => {
    const analysis = analyzeGraph(
      doc(
        [node('start'), node('a'), node('b'), node('c')],
        [edge('start', 'a'), edge('a', 'b'), edge('b', 'c'), edge('c', 'a')],
      ),
    )
    expect(analysis.cycles).toHaveLength(1)
    const cycle = analysis.cycles[0]
    expect(cycle?.nodes).toEqual(['a', 'b', 'c'])
    expect(cycle?.entry).toBe('a')
    expect(cycle?.backEdges).toEqual(['c->a'])
    expect(cycle?.exits).toEqual([])
    expect(cycle === undefined ? false : cycleHasNoExit(cycle)).toBe(true)
  })

  it('没有环外入边、也看不出谁是起点时，入口取 id 最小者', () => {
    const analysis = analyzeGraph(doc([node('b'), node('a')], [edge('a', 'b'), edge('b', 'a')]))
    expect(analysis.cycles[0]?.entry).toBe('a')
  })

  it('整张图就是一个环：起点挑第一轮就跑得起来、被条件线跳回来的那个，而不是 id 最小的', () => {
    // 侦察 → 设计 → 裁决；裁决 pass → 上线，fail → 回侦察；上线 → 回侦察。
    // 「challenge」的 id 最小，但它读裁决产出的 judge.md（第一轮还不存在），不能当起点。
    const steps = ['recon', 'design', 'judge', 'challenge'].map(node)
    const judgeMd = {
      id: 'res-judge',
      type: 'wfResource' as const,
      position: { x: 0, y: 0 },
      data: { items: [{ kind: 'file' as const, value: 'judge.md' }] },
    }
    const analysis = analyzeGraph(
      doc(
        [...steps, judgeMd],
        [
          edge('recon', 'design'),
          edge('design', 'judge'),
          edge('judge', 'challenge', 'pass'),
          edge('judge', 'recon', 'fail'),
          edge('challenge', 'recon', 'fail'),
          edge('judge', 'res-judge'),
          edge('res-judge', 'challenge'),
        ],
      ),
    )
    expect(analysis.cycles[0]?.entry).toBe('recon')
    expect(analysis.batches.map((batch) => batch.nodes)).toEqual([
      ['recon'],
      ['design'],
      ['judge'],
      ['challenge'],
    ])
    expect([...analysis.backEdges].sort()).toEqual(['challenge->recon#fail', 'judge->recon#fail'])
  })

  it('读不读产出分不出来时，挑环里只被条件线指向的那个', () => {
    // a → B 无条件，B → a 带条件：a 是被跳回来的起点（按码位序 `B` 的 id 更小）。
    const analysis = analyzeGraph(
      doc([node('a'), node('B')], [edge('a', 'B'), edge('B', 'a', 'fail')]),
    )
    expect(analysis.cycles[0]?.entry).toBe('a')
  })

  it('悬空 edge 被单列出来，不参与拓扑计算，也不抛错', () => {
    const analysis = analyzeGraph(doc([node('a')], [edge('a', 'ghost')]))
    expect(analysis.danglingEdges.map((e) => e.id)).toEqual(['a->ghost'])
    expect(analysis.batches).toEqual([{ nodes: ['a'] }])
    expect(analysis.successors.get('a')).toEqual([])
  })

  it('并行扇出：多条无条件出边 ⇒ 下游落在同一批次、全部都会走', () => {
    const analysis = analyzeGraph(
      doc([node('root'), node('x'), node('y')], [edge('root', 'x'), edge('root', 'y')]),
    )
    expect(analysis.shapes.get('root')).toBe('fanout')
    expect(analysis.batches).toEqual([{ nodes: ['root'] }, { nodes: ['x', 'y'] }])
  })

  it('纯 DAG 的分层按最长路径（不是最短路径）', () => {
    // a → b → c，且 a → c：c 必须是批次 2 而不是批次 1
    const analysis = analyzeGraph(
      doc([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')]),
    )
    expect(analysis.batches).toEqual([{ nodes: ['a'] }, { nodes: ['b'] }, { nodes: ['c'] }])
  })

  it('零节点图不崩', () => {
    const analysis = analyzeGraph(doc([], []))
    expect(analysis.nodeIds).toEqual([])
    expect(analysis.batches).toEqual([])
    expect(analysis.cycles).toEqual([])
  })

  it('大小写不敏感地解析端点（Scan 与 scan 是同一个身份）', () => {
    const analysis = analyzeGraph(doc([node('Scan'), node('fix')], [edge('fix', 'scan')]))
    expect(analysis.danglingEdges).toEqual([])
    expect(analysis.successors.get('fix')).toEqual(['Scan'])
  })

  it('多环交叠的 SCC 会有多条回边', () => {
    // a→b→a 与 a→c→a 共用一个 SCC
    const analysis = analyzeGraph(
      doc(
        [node('a'), node('b'), node('c')],
        [edge('a', 'b'), edge('b', 'a'), edge('a', 'c'), edge('c', 'a')],
      ),
    )
    expect(analysis.cycles).toHaveLength(1)
    expect(analysis.cycles[0]?.nodes).toEqual(['a', 'b', 'c'])
    expect(analysis.cycles[0]?.backEdges.length).toBeGreaterThanOrEqual(1)
  })
})
