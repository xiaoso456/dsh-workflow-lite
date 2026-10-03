/**
 * `src/shared/resources.ts`：线的种类、「谁写谁读」、交给整个工作流的资源、步骤的产出同步、交接的解释；
 * 以及资源节点的读入规范化、校验与编译进计划的样子。
 */

import { describe, expect, it } from 'vitest'
import { buildPlan } from '../../src/shared/compile.ts'
import { analyzeGraph } from '../../src/shared/graph.ts'
import {
  makeEdgeId,
  readDocument,
  readResourceData,
  resourceIdFor,
  writeDocument,
} from '../../src/shared/model.ts'
import { resolveItemPath } from '../../src/shared/outputPaths.ts'
import {
  edgeKind,
  flowEdges,
  isShared,
  nodeIndex,
  outputsOf,
  resolveHandoff,
  resourceByPath,
  resourceGraph,
  resourceTitle,
  roleOf,
  setStepOutputs,
  sharedResources,
  stepResources,
} from '../../src/shared/resources.ts'
import type {
  EdgeData,
  PlanFacts,
  ResourceItem,
  ResourceNode,
  StepNode,
  WorkflowDocument,
  WorkflowEdge,
} from '../../src/shared/types.ts'
import { itemProblem, resourceProblem, validateDocument } from '../../src/shared/validate.ts'

function step(id: string): StepNode {
  return { id, type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: id } }
}

function resource(id: string, items: ResourceItem[], label?: string): ResourceNode {
  return {
    id,
    type: 'wfResource',
    position: { x: 0, y: 0 },
    data: label === undefined ? { items } : { label, items },
  }
}

function file(id: string, path: string, note?: string): ResourceNode {
  return resource(id, [
    note === undefined ? { kind: 'file', value: path } : { kind: 'file', value: path, note },
  ])
}

function edge(source: string, target: string, data?: EdgeData): WorkflowEdge {
  return {
    id: makeEdgeId(source, target, data?.when),
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(data === undefined ? {} : { data }),
  }
}

function doc(nodes: (StepNode | ResourceNode)[], edges: WorkflowEdge[]): WorkflowDocument {
  return { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } }
}

const sample = doc(
  [step('review'), step('fix'), step('report'), file('f', 'issues.md', '问题清单')],
  [
    edge('review', 'fix', { when: 'fail' }),
    edge('review', 'f'),
    edge('fix', 'f', { update: true }),
    edge('f', 'fix'),
    edge('f', 'report'),
  ],
)

function facts(document: WorkflowDocument): PlanFacts {
  return { name: 'g', document, cwd: '/w', payloadPaths: new Map() }
}

describe('线的种类', () => {
  it('步骤 → 步骤 = flow；步骤 → 资源 = write；资源 → 步骤 = read；资源 → 资源 = invalid；端点不在 = dangling', () => {
    const nodes = nodeIndex(doc([step('a'), file('f', 'f.md'), file('g', 'g.md')], []))
    expect(edgeKind(nodes, edge('a', 'a'))).toBe('flow')
    expect(edgeKind(nodes, edge('a', 'f'))).toBe('write')
    expect(edgeKind(nodes, edge('f', 'a'))).toBe('read')
    expect(edgeKind(nodes, edge('f', 'g'))).toBe('invalid')
    expect(edgeKind(nodes, edge('a', 'ghost'))).toBe('dangling')
    expect(flowEdges(sample).map((item) => item.id)).toEqual(['review->fix#fail'])
  })
})

describe('谁写谁读', () => {
  it('写的记写入方式；既写又读的只记成写', () => {
    const info = resourceGraph(sample).get('f')
    expect(info?.writers).toEqual([
      { id: 'review', update: false },
      { id: 'fix', update: true },
    ])
    expect(info?.readers).toEqual(['report'])
    expect(roleOf(info, 'review')).toBe('producer')
    expect(roleOf(info, 'fix')).toBe('updater')
    expect(roleOf(info, 'report')).toBe('reader')
    expect(roleOf(info, 'nobody')).toBeNull()
  })

  it('一个步骤的资源：写的、读的；产出清单只摊文件项、带上说明（存成模板用）', () => {
    const linked = stepResources(sample, 'fix')
    expect(linked.writes.map((item) => [item.resource.id, item.update])).toEqual([['f', true]])
    expect(linked.reads.map((item) => item.resource.id)).toEqual(['f'])
    expect(outputsOf(sample, 'review')).toEqual([{ path: 'issues.md', rule: '问题清单' }])
  })

  it('一条线都没连的资源交给整个工作流', () => {
    const document = doc(
      [step('a'), resource('rules', [{ kind: 'text', value: '用中文回答' }]), file('f', 'x.md')],
      [edge('a', 'f')],
    )
    expect(sharedResources(document).map((node) => node.id)).toEqual(['rules'])
    expect(isShared(resourceGraph(document).get('f') ?? ({} as never))).toBe(false)
  })
})

describe('资源的称呼与起名', () => {
  it('有名字用名字，没有就用第一项的简称（网址取主机名），什么都没有就是 id', () => {
    expect(resourceTitle(resource('r', [], '需求'))).toBe('需求')
    expect(resourceTitle(file('r', 'docs/spec/api.md'))).toBe('api.md')
    expect(resourceTitle(resource('r', [{ kind: 'url', value: 'https://example.com/a?b' }]))).toBe(
      'example.com',
    )
    expect(resourceTitle(resource('r', []))).toBe('r')
    const taken = new Set(['res-api'])
    expect(
      resourceIdFor({ items: [{ kind: 'file', value: 'a/api.md' }] }, (id) => taken.has(id)),
    ).toBe('res-api-2')
    expect(resourceIdFor({ label: '需求 资料', items: [] }, () => false)).toBe('res-需求-资料')
  })

  it('按第一项起 id 时文件不带扩展名；隐藏文件去掉开头的点；自定义叫 custom', () => {
    const idOf = (item: ResourceItem, taken: string[] = []): string =>
      resourceIdFor({ items: [item] }, (id) => taken.includes(id))
    expect(idOf({ kind: 'file', value: 'D:/proj/docs/spec.md' })).toBe('res-spec')
    expect(idOf({ kind: 'file', value: 'out/archive.tar.gz' })).toBe('res-archive.tar')
    expect(idOf({ kind: 'file', value: '.env' })).toBe('res-env')
    expect(idOf({ kind: 'file', value: 'Makefile' })).toBe('res-Makefile')
    expect(idOf({ kind: 'folder', value: 'src/lib.v2/' })).toBe('res-lib.v2')
    expect(idOf({ kind: 'url', value: 'https://example.com/a' })).toBe('res-example.com')
    expect(idOf({ kind: 'skill', value: 'pdf' })).toBe('res-pdf')
    expect(idOf({ kind: 'text', value: '用中文回答' })).toBe('res-custom')
    // 同名不同扩展名的两份文件：第二个加序号。
    expect(idOf({ kind: 'file', value: 'x.txt' }, ['res-x'])).toBe('res-x-2')
    // 名字照写的不动（名字里的点是人自己写的）。
    expect(resourceIdFor({ label: 'v1.2 说明', items: [] }, () => false)).toBe('res-v1.2-说明')
  })
})

describe('读入与写出', () => {
  it('认不出的项略过；自定义不带说明；空白名字与描述当没写；键序固定', () => {
    expect(
      readResourceData({
        label: '',
        description: '  ',
        items: [
          { kind: 'file', value: 'a.md', note: ' 要求 ' },
          { kind: 'text', value: '原文', note: '丢掉' },
          { kind: 'nope', value: 'x' },
          { kind: 'url' },
          'junk',
          { kind: 'skill', value: 'pdf', note: '  ' },
        ],
      }),
    ).toEqual({
      items: [
        { kind: 'file', value: 'a.md', note: ' 要求 ' },
        { kind: 'text', value: '原文' },
        { kind: 'skill', value: 'pdf' },
      ],
    })
    const text = writeDocument(
      doc([resource('r', [{ note: 'n', value: 'v', kind: 'url' } as ResourceItem], '名')], []),
    )
    expect(text).toContain('"data": {\n        "label": "名",\n        "items": [')
    expect(text).toContain('"kind": "url",\n            "value": "v",\n            "note": "n"')
    expect(readDocument(text).document?.nodes[0]).toEqual(
      resource('r', [{ kind: 'url', value: 'v', note: 'n' }], '名'),
    )
  })
})

describe('路径落在哪', () => {
  it('绝对路径原样；相对路径有人写时在产出根目录下，只被读时相对工作区', () => {
    expect(resolveItemPath('out', 'D:\\data\\a.md', true)).toBe('D:/data/a.md')
    expect(resolveItemPath('out', '/etc/x', true)).toBe('/etc/x')
    expect(resolveItemPath('out', 'a.md', true)).toBe('out/a.md')
    expect(resolveItemPath('out', 'src/', false)).toBe('src/')
  })
})

describe('校验', () => {
  it('空资源、没填的项、写一个没有文件的资源都挡编译；skill 名不合法、项里有换行是保存级', () => {
    const document = doc(
      [
        step('a'),
        resource('empty', []),
        resource('blank', [{ kind: 'url', value: ' ' }]),
        resource('links', [{ kind: 'url', value: 'https://x.dev' }]),
      ],
      [edge('a', 'links'), edge('empty', 'a'), edge('blank', 'a')],
    )
    const report = validateDocument(document, { workflowName: 'g', maxNodes: 50 })
    expect(report.compile.map((problem) => [problem.code, problem.node])).toEqual([
      ['resource_empty', 'empty'],
      ['resource_item_empty', 'blank'],
      ['resource_unwritable', 'links'],
    ])
    const bad = validateDocument(
      doc(
        [
          step('a'),
          resource('s', [{ kind: 'skill', value: 'Bad Name' }]),
          resource('p', [{ kind: 'file', value: 'a\nb' }]),
        ],
        [],
      ),
      { workflowName: 'g', maxNodes: 50 },
    )
    expect(bad.save.map((problem) => [problem.code, problem.node])).toEqual([
      ['resource_invalid', 's'],
      ['resource_invalid', 'p'],
    ])
  })

  it('两个步骤都整份写同一个资源：警告；读它的步骤不在写它的下游：提示', () => {
    const document = doc(
      [step('a'), step('b'), step('c'), file('f', 'x.md')],
      [edge('a', 'f'), edge('b', 'f'), edge('f', 'c')],
    )
    const report = validateDocument(document, { workflowName: 'g', maxNodes: 50 })
    expect(report.warning.map((problem) => problem.code)).toContain('resource_overwritten')
    expect(report.hint.map((problem) => problem.code)).toContain('resource_order')
  })
})

describe('编译进计划', () => {
  it('表里写资源 id；资源一段逐项列出，路径按读写拼好；描述不进计划；没连的交给所有步骤', () => {
    const document = doc(
      [
        step('scan'),
        step('plan'),
        resource(
          'req',
          [
            { kind: 'file', value: '/abs/spec.md', note: '先看第 3 节' },
            { kind: 'folder', value: 'src/' },
            { kind: 'url', value: 'https://example.com/api' },
            { kind: 'skill', value: 'pdf', note: '读附件用' },
          ],
          '需求资料',
        ),
        file('notes', 'notes.md', '列出发现'),
        {
          ...resource('rules', [{ kind: 'text', value: '用中文回答\n不要改测试' }]),
          data: {
            description: '只给人看',
            items: [{ kind: 'text', value: '用中文回答\n不要改测试' }],
          },
        },
      ],
      [edge('scan', 'plan'), edge('req', 'scan'), edge('scan', 'notes'), edge('notes', 'plan')],
    )
    document.settings = { outputRoot: 'out' }
    const { plan, problems } = buildPlan(facts(document), analyzeGraph(document))
    expect(problems).toEqual([])
    expect(plan).toContain('| plan | scan | notes | — |')
    expect(plan).toContain('| scan | — | req | notes |')
    expect(plan).toContain(
      '- 资源 `notes`：`scan` 产出；`plan` 读取。\n  - 文件：`out/notes.md`。说明：列出发现',
    )
    expect(plan).toContain('- 资源 `req`（需求资料）：`scan` 读取。')
    expect(plan).toContain('  - 文件：`/abs/spec.md`。说明：先看第 3 节')
    expect(plan).toContain('  - 文件夹：`src/`')
    expect(plan).toContain('  - 网址：https://example.com/api')
    expect(plan).toContain('  - Skill：`pdf`（先用 skill 工具加载）。说明：读附件用')
    expect(plan).toContain(
      '- 资源 `rules`：交给所有步骤。\n  - 自定义：\n    > 用中文回答\n    > 不要改测试',
    )
    expect(plan).not.toContain('只给人看')
  })
})

describe('setStepOutputs', () => {
  it('没有的路径新建资源；已有的连上（别人在写就默认更新）；不在清单里的断开，没人连的删掉', () => {
    const document = doc(
      [step('a'), step('b'), file('res-old.md', 'old.md')],
      [edge('b', 'res-old.md')],
    )
    setStepOutputs(document, 'a', [{ path: 'new.md', rule: 'r' }, { path: 'old.md' }])
    expect(document.nodes.map((node) => node.id)).toEqual(['a', 'b', 'res-old.md', 'res-new'])
    expect(document.edges.find((item) => item.id === 'a->res-old.md')?.data).toEqual({
      update: true,
    })
    expect(document.nodes[3]?.data).toEqual({
      items: [{ kind: 'file', value: 'new.md', note: 'r' }],
    })
    expect(resourceByPath(document, './new.md')?.id).toBe('res-new')

    setStepOutputs(document, 'a', [])
    expect(document.nodes.map((node) => node.id)).toEqual(['a', 'b', 'res-old.md'])
    expect(document.edges.map((item) => item.id)).toEqual(['b->res-old.md'])
  })
})

describe('resolveHandoff', () => {
  it('缺省交执行结果；对象附说明（空白当没写）；false 只管先后', () => {
    expect(resolveHandoff(undefined)).toEqual({ result: true })
    expect(resolveHandoff({ note: ' 修 ' })).toEqual({ result: true, note: '修' })
    expect(resolveHandoff({ note: '  ' })).toEqual({ result: true })
    expect(resolveHandoff(false)).toEqual({ result: false })
  })
})

describe('一项的写法（保存级）', () => {
  it('单项的问题不带位置，整个资源报出时带上第几项', () => {
    expect(itemProblem({ kind: 'file', value: 'docs/a.md', note: '看第 3 节' })).toBeNull()
    expect(itemProblem({ kind: 'file', value: '~/a.md' })?.message).toContain('~')
    expect(itemProblem({ kind: 'skill', value: 'PDF Tool' })?.message).toContain('skill 名')
    expect(itemProblem({ kind: 'url', value: 'https://a\nb' })?.message).toContain('换行')
    expect(itemProblem({ kind: 'text', value: '第一行\n第二行' })).toBeNull()
    expect(itemProblem({ kind: 'text', value: 'x'.repeat(20001) })?.message).toContain('自定义内容')
    expect(
      resourceProblem({
        items: [
          { kind: 'file', value: 'a.md' },
          { kind: 'skill', value: 'Bad Name' },
        ],
      })?.message,
    ).toMatch(/^第 2 项：skill 名/u)
  })
})
