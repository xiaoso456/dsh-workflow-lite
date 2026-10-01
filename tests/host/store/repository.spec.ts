import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { hashOf, readFileText } from '../../../src/host/store/atomic.ts'
import {
  dispatchDir,
  pathKind,
  templateFile,
  templatesDir,
  workflowFile,
  workflowNamesOnDisk,
  workflowsDir,
} from '../../../src/host/store/paths.ts'
import {
  createRepository,
  diffDocuments,
  type Outcome,
  type Repository,
  reportProblems,
} from '../../../src/host/store/repository.ts'
import { readDocument, writeDocument } from '../../../src/shared/model.ts'
import {
  NODE_TYPE,
  type NodeData,
  type Point,
  type ToolError,
  type Viewport,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
} from '../../../src/shared/types.ts'
import { validateDocument } from '../../../src/shared/validate.ts'

let root = ''
let repo: Repository

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-repo-'))
  repo = createRepository({ dataDir: root })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

// ── 夹具 ──────────────────────────────────────────────────────

function n(id: string, data: NodeData = {}, position: Point = { x: 0, y: 0 }): WorkflowNode {
  return { id, type: NODE_TYPE, position, data }
}

function e(id: string, source: string, target: string, when?: string): WorkflowEdge {
  return {
    id,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(when === undefined ? {} : { data: { when } }),
  }
}

function d(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[] = [],
  viewport: Viewport = { x: 0, y: 0, zoom: 1 },
): WorkflowDocument {
  return { nodes, edges, viewport }
}

function expectOk<T>(outcome: Outcome<T>): T {
  if (!outcome.ok)
    throw new Error(`期望成功，却失败：${outcome.error.code} ${outcome.error.message}`)
  return outcome.result
}

function expectError<T>(outcome: Outcome<T>): ToolError['error'] {
  if (outcome.ok) throw new Error('期望失败，却成功了')
  return outcome.error
}

async function seedGraph(name: string, document: WorkflowDocument): Promise<void> {
  await mkdir(workflowsDir(root), { recursive: true })
  await writeFile(workflowFile(root, name), writeDocument(document))
}

async function readGraph(name: string): Promise<WorkflowDocument | null> {
  const text = await readFileText(workflowFile(root, name))
  return text === null ? null : readDocument(text).document
}

/** 步骤的 `data`（文件节点给空对象）。 */
function dataOf(node: WorkflowNode | undefined): NodeData {
  return node !== undefined && node.type === 'wfNode' ? node.data : {}
}

function nodeIds(document: WorkflowDocument | null): string[] {
  return (document?.nodes ?? []).map((node) => node.id).sort()
}

async function seedDispatch(name: string): Promise<void> {
  const dir = dispatchDir(root, name)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'scan.md'), 'x')
}

// ── create / load ─────────────────────────────────────────────

describe('create', () => {
  it('空白图：viewport 归零、文件落盘、load 得回', async () => {
    const created = expectOk(await repo.create('code-review'))
    expect(created.changed[0]).toMatchObject({ kind: 'workflow', op: 'add', id: 'code-review' })

    const loaded = await repo.load('code-review')
    expect(loaded.loadable).toBe(true)
    expect(loaded.exists).toBe(true)
    expect(loaded.document).toEqual({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } })
    const text = await readFileText(workflowFile(root, 'code-review'))
    expect(loaded.hash).toBe(await hashOf(text ?? ''))
  })

  it('从图模板单文件复制：position 带过去、viewport 重置', async () => {
    await mkdir(templatesDir(root, 'workflows'), { recursive: true })
    await writeFile(
      templateFile(root, 'workflows', 'feature-dev'),
      writeDocument(
        d([n('scan', { prompt: 'S' }, { x: 320, y: 180 })], [], { x: 5, y: 6, zoom: 2 }),
      ),
    )

    expectOk(await repo.create('copy', { from: 'feature-dev' }))
    const loaded = await repo.load('copy')
    expect(loaded.document?.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(loaded.document?.nodes[0]).toMatchObject({
      id: 'scan',
      position: { x: 320, y: 180 },
      data: { prompt: 'S' },
    })
  })

  it('撞名加序号并在 warnings 里说明占了位的是谁', async () => {
    expectOk(await repo.create('a'))
    const again = expectOk(await repo.create('a'))
    expect(again.changed[0]?.id).toBe('a-2')
    expect(again.warnings.some((w) => w.code === 'workflow_dir_collision')).toBe(true)
  })

  it('撞同名目录也加序号（同名目录算被占用）', async () => {
    await mkdir(join(workflowsDir(root), 'a'), { recursive: true })
    const created = expectOk(await repo.create('a'))
    expect(created.changed[0]?.id).toBe('a-2')
    expect(created.warnings.some((w) => w.message.includes('同名目录'))).toBe(true)
  })

  it('from 不存在 ⇒ not_found；from 是空图模板 ⇒ blocked', async () => {
    expect(expectError(await repo.create('x', { from: 'nope' })).code).toBe('not_found')

    await mkdir(templatesDir(root, 'workflows'), { recursive: true })
    await writeFile(templateFile(root, 'workflows', 'empty'), writeDocument(d([])))
    expect(expectError(await repo.create('y', { from: 'empty' })).code).toBe('blocked')
  })

  it('非法图名 ⇒ blocked（不落盘）', async () => {
    expect(expectError(await repo.create('../escape')).code).toBe('blocked')
    expect(expectError(await repo.create('a/b')).code).toBe('blocked')
    expect(await workflowNamesOnDisk(root)).toEqual([])
  })
})

describe('load', () => {
  it('不存在：exists=false、loadable=false、无问题（调用方按 not_found 处理）', async () => {
    const loaded = await repo.load('nope')
    expect(loaded.exists).toBe(false)
    expect(loaded.loadable).toBe(false)
    expect(loaded.document).toBeNull()
    expect(loaded.problems).toEqual([])
  })

  it('JSON 解析失败 ⇒ 拒绝加载整图，原文照留', async () => {
    await mkdir(workflowsDir(root), { recursive: true })
    await writeFile(workflowFile(root, 'broken'), '{ "nodes": [')
    const loaded = await repo.load('broken')
    expect(loaded.exists).toBe(true)
    expect(loaded.loadable).toBe(false)
    expect(loaded.document).toBeNull()
    expect(loaded.text).toBe('{ "nodes": [')
    expect(loaded.problems.some((p) => p.code === 'json_parse_failed' && p.level === 'save')).toBe(
      true,
    )
  })

  it('同名 .json 与同名目录并存 ⇒ 保存级 workflow_dir_collision', async () => {
    await seedGraph('dup', d([]))
    await mkdir(join(workflowsDir(root), 'dup'), { recursive: true })
    const loaded = await repo.load('dup')
    expect(loaded.loadable).toBe(false)
    expect(loaded.problems.some((p) => p.code === 'workflow_dir_collision')).toBe(true)
  })

  it('注入的 validate 能拦下保存级破损（仓储自身不内联规则）', async () => {
    const strict = createRepository({
      dataDir: root,
      validate: (document) =>
        document.nodes.some((node) => node.id.startsWith('_'))
          ? [{ level: 'save', code: 'node_id_case_collision', message: '下划线开头的 id 被拦下' }]
          : [],
    })
    await seedGraph('strict', d([n('_bad', { prompt: 'P' })]))
    const loaded = await strict.load('strict')
    expect(loaded.loadable).toBe(false)
    expect(loaded.document).toBeNull()
    expect(loaded.problems.some((p) => p.code === 'node_id_case_collision')).toBe(true)
  })

  it('接上真实的 shared/validate.ts：保存级拒绝加载、编译级只标红', async () => {
    const wired = createRepository({
      dataDir: root,
      validate: (document, workflow) =>
        reportProblems(validateDocument(document, { workflowName: workflow, maxNodes: 200 })),
    })

    await seedGraph(
      'broken-graph',
      d([n('a', { prompt: 'A' }), n('a', { prompt: 'A2' })], [e('a->ghost', 'a', 'ghost')]),
    )
    const broken = await wired.load('broken-graph')
    expect(broken.loadable).toBe(false)
    expect(broken.document).toBeNull()
    expect(broken.problems.map((problem) => problem.code)).toContain('node_id_duplicate')
    expect(broken.problems.map((problem) => problem.code)).toContain('edge_dangling')

    await seedGraph('no-prompt', d([n('a')]))
    const redButLoadable = await wired.load('no-prompt')
    expect(redButLoadable.loadable).toBe(true)
    expect(
      redButLoadable.problems.some(
        (problem) => problem.code === 'prompt_empty' && problem.level === 'compile',
      ),
    ).toBe(true)
  })
})

// ── save ──────────────────────────────────────────────────────

describe('save', () => {
  it('基线一致 ⇒ 直接写回、回报 changed、给出新基线', async () => {
    expectOk(await repo.create('w'))
    const loaded = await repo.load('w')
    const next = d([n('a', { prompt: 'P' }, { x: 1, y: 2 })])
    const saved = expectOk(await repo.save('w', next, { baseHash: loaded.hash }))

    expect(saved.changed).toEqual([{ kind: 'node', op: 'add', id: 'a' }])
    expect(saved.hash).not.toBe(loaded.hash)
    expect(dataOf((await readGraph('w'))?.nodes[0]).prompt).toBe('P')
  })

  it('写前哈希不一致但改的是不同节点 ⇒ 自动合并、不报冲突', async () => {
    const base = d([n('a', { prompt: 'A' }), n('b', { prompt: 'B' })])
    await seedGraph('m', base)
    const loaded = await repo.load('m')

    const mine = d([n('a', { prompt: 'A2' }), n('b', { prompt: 'B' })])
    await writeFile(
      workflowFile(root, 'm'),
      writeDocument(d([n('a', { prompt: 'A' }), n('b', { prompt: 'B2' })])),
    )

    const saved = expectOk(await repo.save('m', mine, { baseHash: loaded.hash }))
    expect(saved.warnings.some((w) => w.code === 'workflow_dir_collision')).toBe(false)
    const final = await readGraph('m')
    expect(dataOf(final?.nodes.find((node) => node.id === 'a')).prompt).toBe('A2')
    expect(dataOf(final?.nodes.find((node) => node.id === 'b')).prompt).toBe('B2')
    expect(saved.changed.map((entry) => entry.id).sort()).toEqual(['a'])
  })

  it('同一个 id 双方都改过 ⇒ conflict，磁盘内容原封不动', async () => {
    const base = d([n('a', { prompt: 'A' }), n('b', { prompt: 'B' })])
    await seedGraph('c', base)
    const loaded = await repo.load('c')

    const mine = d([n('a', { prompt: 'mine' }), n('b', { prompt: 'B' })])
    const disk = d([n('a', { prompt: 'theirs' }), n('b', { prompt: 'B' })])
    await writeFile(workflowFile(root, 'c'), writeDocument(disk))

    const error = expectError(await repo.save('c', mine, { baseHash: loaded.hash }))
    expect(error.code).toBe('conflict')
    expect(error.detail?.ids).toEqual(['a'])
    expect(dataOf((await readGraph('c'))?.nodes[0]).prompt).toBe('theirs')
  })

  it('force=true（画布「保留我的」）⇒ 冲突也写，本地优先', async () => {
    const base = d([n('a', { prompt: 'A' })])
    await seedGraph('f', base)
    const loaded = await repo.load('f')
    await writeFile(workflowFile(root, 'f'), writeDocument(d([n('a', { prompt: 'theirs' })])))

    expectOk(
      await repo.save('f', d([n('a', { prompt: 'mine' })]), {
        baseHash: loaded.hash,
        force: true,
      }),
    )
    expect(dataOf((await readGraph('f'))?.nodes[0]).prompt).toBe('mine')
  })

  it('目标不存在 ⇒ not_found（绝不隐式创建）', async () => {
    expect(expectError(await repo.save('ghost', d([]), { baseHash: null })).code).toBe('not_found')
    expect(await workflowNamesOnDisk(root)).toEqual([])
  })

  it('保存级破损拒绝写入（注入的 validate）', async () => {
    const strict = createRepository({
      dataDir: root,
      validate: (document) =>
        document.nodes.some((node) => node.id.startsWith('_'))
          ? [{ level: 'save', code: 'node_id_duplicate', message: '被拦下' }]
          : [],
    })
    expectOk(await strict.create('w'))
    const loaded = await strict.load('w')
    const error = expectError(
      await strict.save('w', d([n('_bad', { prompt: 'P' })]), { baseHash: loaded.hash }),
    )
    expect(error.code).toBe('blocked')
    expect((await readGraph('w'))?.nodes).toEqual([])
  })

  it('合并出悬空 edge ⇒ 终稿自检拦下，不写出破损文件', async () => {
    const base = d([n('a', { prompt: 'A' }), n('b', { prompt: 'B' })])
    await seedGraph('dangling', base)
    const loaded = await repo.load('dangling')

    // 本地删掉 a；期间外部加了一条 a->b。合并结果会缺 a 而有 a->b（悬空）。
    const mine = d([n('b', { prompt: 'B' })])
    await writeFile(
      workflowFile(root, 'dangling'),
      writeDocument(d([n('a', { prompt: 'A' }), n('b', { prompt: 'B' })], [e('a->b', 'a', 'b')])),
    )

    const error = expectError(await repo.save('dangling', mine, { baseHash: loaded.hash }))
    expect(error.code).toBe('blocked')
    expect((await readGraph('dangling'))?.nodes.map((node) => node.id)).toEqual(['a', 'b'])
  })

  it('保存过程不留 .tmp- 残留', async () => {
    expectOk(await repo.create('t'))
    const loaded = await repo.load('t')
    expectOk(await repo.save('t', d([n('a', { prompt: 'P' })]), { baseHash: loaded.hash }))
    const entries = await readdir(workflowsDir(root))
    expect(entries.filter((name) => name.startsWith('.tmp-'))).toEqual([])
  })

  it('并发保存被锁串行化：两边改动都在', async () => {
    const base = d([n('a', { prompt: 'A' }), n('b', { prompt: 'B' })])
    await seedGraph('p', base)
    const loaded = await repo.load('p')

    const first = repo.save('p', d([n('a', { prompt: 'A2' }), n('b', { prompt: 'B' })]), {
      baseHash: loaded.hash,
    })
    const second = repo.save('p', d([n('a', { prompt: 'A' }), n('b', { prompt: 'B2' })]), {
      baseHash: loaded.hash,
    })
    expectOk(await first)
    expectOk(await second)

    const final = await readGraph('p')
    expect(dataOf(final?.nodes.find((node) => node.id === 'a')).prompt).toBe('A2')
    expect(dataOf(final?.nodes.find((node) => node.id === 'b')).prompt).toBe('B2')
  })
})

// ── rename / remove ───────────────────────────────────────────

describe('rename / remove', () => {
  it('改名：连带删 .dispatch/<旧图名>', async () => {
    expectOk(await repo.create('old'))
    await seedDispatch('old')

    const renamed = expectOk(await repo.rename('old', 'new'))
    expect(renamed.changed[0]).toMatchObject({ kind: 'workflow', op: 'rename', id: 'new' })
    expect(await pathKind(workflowFile(root, 'old'))).toBe('missing')
    expect(await pathKind(workflowFile(root, 'new'))).toBe('file')
    expect(await pathKind(dispatchDir(root, 'old'))).toBe('missing')
  })

  it('目标名已存在 ⇒ invalid_args，绝不加序号、绝不覆盖', async () => {
    expectOk(await repo.create('from'))
    expectOk(await repo.create('to'))
    const error = expectError(await repo.rename('from', 'to'))
    expect(error.code).toBe('invalid_args')
    expect(await pathKind(workflowFile(root, 'from'))).toBe('file')
  })

  it('目标名被同名目录占位 ⇒ invalid_args', async () => {
    expectOk(await repo.create('from'))
    await mkdir(join(workflowsDir(root), 'taken'))
    expect(expectError(await repo.rename('from', 'taken')).code).toBe('invalid_args')
  })

  it('只改大小写 ⇒ 走两步 rename，名字真的变了', async () => {
    expectOk(await repo.create('Case'))
    expectOk(await repo.rename('Case', 'case'))
    expect(await workflowNamesOnDisk(root)).toEqual(['case'])
    expect((await repo.load('case')).loadable).toBe(true)
  })

  it('源不存在 ⇒ not_found', async () => {
    expect(expectError(await repo.rename('nope', 'x')).code).toBe('not_found')
  })

  it('删除：连带删 .dispatch/<图名>；再删 ⇒ not_found', async () => {
    expectOk(await repo.create('gone'))
    await seedDispatch('gone')

    const removed = expectOk(await repo.remove('gone'))
    expect(removed.changed[0]).toMatchObject({ kind: 'workflow', op: 'delete', id: 'gone' })
    expect(await pathKind(workflowFile(root, 'gone'))).toBe('missing')
    expect(await pathKind(dispatchDir(root, 'gone'))).toBe('missing')
    expect(expectError(await repo.remove('gone')).code).toBe('not_found')
  })
})

// ── 节点与边 ──────────────────────────────────────────────────

describe('writeNode / setLabel / deleteNode', () => {
  it('write_node 按 id upsert：新建 → 覆盖', async () => {
    expectOk(await repo.create('w'))

    const added = expectOk(
      await repo.writeNode('w', {
        id: 'scan',
        content: 'P',
        label: '扫描',
        position: { x: 3, y: 4 },
      }),
    )
    expect(added.changed[0]).toMatchObject({ kind: 'node', op: 'add', id: 'scan' })
    expect(added.warnings).toEqual([])

    const updated = expectOk(await repo.writeNode('w', { id: 'scan', content: 'P2' }))
    expect(updated.changed[0]).toMatchObject({ kind: 'node', op: 'update', id: 'scan' })
    const node = (await readGraph('w'))?.nodes[0]
    expect(node?.data).toEqual({ prompt: 'P2', label: '扫描' })
    expect(node?.position).toEqual({ x: 3, y: 4 })
  })

  it('from_template 取 data 本体，不复制模板的 id 与 position；缺坐标报提示', async () => {
    expectOk(await repo.create('w'))
    await mkdir(templatesDir(root, 'nodes'), { recursive: true })
    await writeFile(
      templateFile(root, 'nodes', 'reviewer'),
      `${JSON.stringify({ label: '审查', prompt: 'R', output: 'r.md' }, null, 2)}\n`,
    )

    const written = expectOk(await repo.writeNode('w', { id: 'rev', fromTemplate: 'reviewer' }))
    expect(written.warnings.some((w) => w.code === 'position_filled')).toBe(true)
    const graph = await readGraph('w')
    const node = graph?.nodes[0]
    expect(node?.id).toBe('rev')
    expect(node?.position).toEqual({ x: 0, y: 0 })
    // 模板里的产出展开成文件节点 + 写入线，步骤自己的 data 里不留 output。
    expect(node?.data).toEqual({ label: '审查', prompt: 'R' })
    expect(graph?.nodes[1]).toMatchObject({
      id: 'file-r.md',
      type: 'wfFile',
      data: { path: 'r.md' },
    })
    expect(graph?.edges.map((edge) => edge.id)).toEqual(['rev->file-r.md'])
  })

  it('outputs 建好文件节点并连上；再写一遍只留清单里的；no_output 断开并删掉没人连的文件节点', async () => {
    expectOk(await repo.create('w'))
    expectOk(
      await repo.writeNode('w', {
        id: 'a',
        content: 'P',
        outputs: [{ path: 'x.md', rule: 'r' }, { path: 'y.md' }],
      }),
    )
    let graph = await readGraph('w')
    expect(graph?.nodes.map((node) => node.id)).toEqual(['a', 'file-x.md', 'file-y.md'])
    expect(graph?.nodes[1]?.data).toEqual({ path: 'x.md', rule: 'r' })
    expectOk(await repo.writeNode('w', { id: 'b', content: 'Q', output: 'x.md' }))
    graph = await readGraph('w')
    // 别人已经在写 x.md：接着写默认是在原文件上更新。
    expect(graph?.edges.find((edge) => edge.id === 'b->file-x.md')?.data).toEqual({ update: true })
    expectOk(await repo.writeNode('w', { id: 'a', noOutput: true }))
    graph = await readGraph('w')
    expect(graph?.nodes.map((node) => node.id)).toEqual(['a', 'file-x.md', 'b'])
    expect(graph?.edges.map((edge) => edge.id)).toEqual(['b->file-x.md'])
  })

  it('writeFile 新建 / 改路径与规则；connect 连读写线，update 只用在步骤 → 文件', async () => {
    expectOk(await repo.create('w'))
    expectOk(await repo.writeNode('w', { id: 'a', content: 'P' }))
    expectOk(await repo.writeFile('w', { path: 'notes.md', rule: '要点' }))
    expectOk(await repo.writeFile('w', { id: 'file-notes.md', path: 'docs/notes.md', rule: '' }))
    expectOk(await repo.connect('w', 'a', 'file-notes.md', undefined, undefined, true))
    const graph = await readGraph('w')
    expect(graph?.nodes[1]?.data).toEqual({ path: 'docs/notes.md' })
    expect(graph?.edges[0]?.data).toEqual({ update: true })
    expect(expectError(await repo.connect('w', 'file-notes.md', 'a', 'fail')).code).toBe(
      'invalid_args',
    )
    expect(expectError(await repo.writeFile('w', { id: 'a', rule: 'x' })).code).toBe('blocked')
    expect(expectError(await repo.writeFile('w', { path: '../x.md' })).code).toBe('blocked')
  })

  it('图不存在 ⇒ not_found；节点 id 非法 ⇒ blocked；模板不存在 ⇒ not_found', async () => {
    expect(expectError(await repo.writeNode('ghost', { id: 'a', content: 'P' })).code).toBe(
      'not_found',
    )
    expectOk(await repo.create('w'))
    expect(expectError(await repo.writeNode('w', { id: 'a/b', content: 'P' })).code).toBe('blocked')
    expect(expectError(await repo.writeNode('w', { id: 'a', fromTemplate: 'nope' })).code).toBe(
      'not_found',
    )
  })

  it('set_label 是纯 data 变更；空串 = 清除', async () => {
    expectOk(await repo.create('w'))
    expectOk(await repo.writeNode('w', { id: 'a', content: 'P', label: '旧' }))
    expectOk(await repo.setLabel('w', 'a', '新'))
    expect(dataOf((await readGraph('w'))?.nodes[0]).label).toBe('新')
    expectOk(await repo.setLabel('w', 'a', ''))
    expect(dataOf((await readGraph('w'))?.nodes[0]).label).toBeUndefined()
    expect(expectError(await repo.setLabel('w', 'ghost', 'x')).code).toBe('not_found')
    expect(expectError(await repo.setLabel('w', 'a', '含|竖线')).code).toBe('blocked')
  })

  it('delete_node 连带删边，一条 changed 带 detail.edges', async () => {
    expectOk(await repo.create('w'))
    expectOk(await repo.writeNode('w', { id: 'a', content: 'A' }))
    expectOk(await repo.writeNode('w', { id: 'b', content: 'B' }))
    expectOk(await repo.connect('w', 'a', 'b'))
    expectOk(await repo.connect('w', 'b', 'a'))

    const deleted = expectOk(await repo.deleteNode('w', 'a'))
    expect(deleted.changed).toEqual([
      { kind: 'node', op: 'delete', id: 'a', detail: { edges: ['a->b', 'b->a'] } },
    ])
    const final = await readGraph('w')
    expect(nodeIds(final)).toEqual(['b'])
    expect(final?.edges).toEqual([])
  })
})

describe('connect / disconnect', () => {
  async function seedTwo(): Promise<void> {
    expectOk(await repo.create('w'))
    expectOk(await repo.writeNode('w', { id: 'a', content: 'A' }))
    expectOk(await repo.writeNode('w', { id: 'b', content: 'B' }))
  }

  it('edge.id 由构造式生成；重复连接幂等', async () => {
    await seedTwo()
    const first = expectOk(await repo.connect('w', 'a', 'b'))
    expect(first.changed).toEqual([{ kind: 'edge', op: 'add', id: 'a->b' }])
    const again = expectOk(await repo.connect('w', 'a', 'b'))
    expect(again.changed).toEqual([])

    const conditional = expectOk(await repo.connect('w', 'a', 'b', 'pass'))
    expect(conditional.changed).toEqual([{ kind: 'edge', op: 'add', id: 'a->b#pass' }])
    expect((await readGraph('w'))?.edges.length).toBe(2)
  })

  it('端点不存在 ⇒ not_found；when 非法 ⇒ blocked', async () => {
    await seedTwo()
    expect(expectError(await repo.connect('w', 'a', 'ghost')).code).toBe('not_found')
    expect(expectError(await repo.connect('w', 'a', 'b', 'line\nbreak')).code).toBe('blocked')
    expect(expectError(await repo.connect('w', 'a', 'b', '')).code).toBe('blocked')
  })

  it('只有一条边时 when 可省；多条边时缺 when ⇒ invalid_args', async () => {
    await seedTwo()
    expectOk(await repo.connect('w', 'a', 'b'))
    const one = expectOk(await repo.disconnect('w', 'a', 'b'))
    expect(one.changed).toEqual([{ kind: 'edge', op: 'delete', id: 'a->b' }])

    expectOk(await repo.connect('w', 'a', 'b'))
    expectOk(await repo.connect('w', 'a', 'b', 'pass'))
    expect(expectError(await repo.disconnect('w', 'a', 'b')).code).toBe('invalid_args')

    const withWhen = expectOk(await repo.disconnect('w', 'a', 'b', 'pass'))
    expect(withWhen.changed).toEqual([{ kind: 'edge', op: 'delete', id: 'a->b#pass' }])
    expect((await readGraph('w'))?.edges.map((edge) => edge.id)).toEqual(['a->b'])
  })

  it('边不存在 ⇒ not_found', async () => {
    await seedTwo()
    expect(expectError(await repo.disconnect('w', 'a', 'b')).code).toBe('not_found')
  })
})

// ── 模板与列举 ────────────────────────────────────────────────

describe('saveAsTemplate', () => {
  it('viewport 重置、position 带过去；撞名加序号', async () => {
    await seedGraph(
      'graph',
      d([n('a', { prompt: 'A' }, { x: 7, y: 8 })], [], { x: 9, y: 9, zoom: 3 }),
    )

    const saved = expectOk(await repo.saveAsTemplate('graph'))
    expect(saved.changed[0]?.id).toBe('graph')
    const templateText = await readFileText(templateFile(root, 'workflows', 'graph'))
    const template = templateText === null ? null : readDocument(templateText).document
    expect(template?.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(template?.nodes[0]?.position).toEqual({ x: 7, y: 8 })

    const again = expectOk(await repo.saveAsTemplate('graph'))
    expect(again.changed[0]?.id).toBe('graph-2')
    expect((await repo.list()).templates.workflows.map((entry) => entry.name)).toEqual([
      'graph',
      'graph-2',
    ])
  })

  it('图不存在 ⇒ not_found；空图（编译级）⇒ blocked', async () => {
    expect(expectError(await repo.saveAsTemplate('nope')).code).toBe('not_found')
    expectOk(await repo.create('empty'))
    expect(expectError(await repo.saveAsTemplate('empty')).code).toBe('blocked')
  })
})

describe('createNodeTemplate', () => {
  it('文件顶层就是 data 本体（不套壳），并且当场出现在 list 里、读得回来', async () => {
    const written = expectOk(
      await repo.createNodeTemplate('my-check', { label: '我的检查', prompt: '检查一遍。' }),
    )
    expect(written.changed[0]?.id).toBe('my-check')

    const raw = await readFileText(templateFile(root, 'nodes', 'my-check'))
    expect(raw).not.toBeNull()
    // 顶层直接是三个字段：套一层 `{data: …}` 的话 `readTemplate('nodes')` 会读成空模板。
    expect(Object.keys(JSON.parse(raw ?? '{}')).sort()).toEqual(['label', 'prompt'])
    expect(raw?.endsWith('\n')).toBe(true)

    expect((await repo.list()).templates.nodes.map((entry) => entry.name)).toEqual(['my-check'])
    expect(expectOk(await repo.readTemplate('nodes', 'my-check'))).toEqual({
      label: '我的检查',
      prompt: '检查一遍。',
    })
  })

  it('output 三态：字符串写出来、缺省不写这个键', async () => {
    expectOk(await repo.createNodeTemplate('with-out', { prompt: 'P', output: 'x.md' }))
    expectOk(await repo.createNodeTemplate('no-out', { prompt: 'P' }))
    expect(
      JSON.parse((await readFileText(templateFile(root, 'nodes', 'with-out'))) ?? '{}'),
    ).toEqual({ prompt: 'P', output: 'x.md' })
    expect(JSON.parse((await readFileText(templateFile(root, 'nodes', 'no-out'))) ?? '{}')).toEqual(
      {
        prompt: 'P',
      },
    )
  })

  it('撞名 ⇒ conflict，**不覆盖也不加序号**，原文件一字未动', async () => {
    expectOk(await repo.createNodeTemplate('twin', { prompt: '原来的' }))
    const failure = expectError(await repo.createNodeTemplate('twin', { prompt: '新的' }))
    expect(failure.code).toBe('conflict')
    expect(failure.detail?.occupant).toBe('file')

    // 没有 `twin-2`，也没有把 `twin` 改写成新的。
    expect((await repo.list()).templates.nodes.map((entry) => entry.name)).toEqual(['twin'])
    expect(expectOk(await repo.readTemplate('nodes', 'twin'))).toEqual({ prompt: '原来的' })
  })

  it('被同名目录占位也算冲突（同名目录算被占用）', async () => {
    await mkdir(join(templatesDir(root, 'nodes'), 'dirish'), { recursive: true })
    expect(expectError(await repo.createNodeTemplate('dirish', { prompt: 'P' })).code).toBe(
      'conflict',
    )
  })

  it('非法名 ⇒ blocked，且什么都没落盘', async () => {
    expect(expectError(await repo.createNodeTemplate('../escape', { prompt: 'P' })).code).toBe(
      'blocked',
    )
    expect((await repo.list()).templates.nodes).toEqual([])
  })
})

describe('节点模板的编辑：draft / save / delete', () => {
  it('半成品（提示词空着）拿去用会被挡，但能打开来编辑', async () => {
    expectOk(await repo.createNodeTemplate('draft', { label: '草稿', prompt: '' }))
    expect(expectError(await repo.readTemplate('nodes', 'draft')).code).toBe('blocked')
    expect(expectOk(await repo.readNodeTemplateDraft('draft'))).toEqual({
      label: '草稿',
      prompt: '',
    })
    expect(expectError(await repo.readNodeTemplateDraft('nope')).code).toBe('not_found')
  })

  it('覆盖保存只改已存在的；不存在 ⇒ not_found，不会顺手新建', async () => {
    expectOk(await repo.createNodeTemplate('edit-me', { prompt: '旧' }))
    expectOk(await repo.saveNodeTemplate('edit-me', { prompt: '新', output: false }))
    expect(expectOk(await repo.readTemplate('nodes', 'edit-me'))).toEqual({
      prompt: '新',
      output: false,
    })
    expect(expectError(await repo.saveNodeTemplate('ghost', { prompt: 'x' })).code).toBe(
      'not_found',
    )
    expect((await repo.list()).templates.nodes.map((entry) => entry.name)).toEqual(['edit-me'])
  })

  it('改名并保存：新文件在、旧文件没了；新名字被占用 ⇒ conflict，两边都不动', async () => {
    expectOk(await repo.createNodeTemplate('old-name', { prompt: 'A' }))
    expectOk(await repo.createNodeTemplate('taken', { prompt: 'B' }))
    const clash = expectError(await repo.saveNodeTemplate('taken', { prompt: 'A2' }, 'old-name'))
    expect(clash.code).toBe('conflict')
    expect(expectOk(await repo.readTemplate('nodes', 'taken'))).toEqual({ prompt: 'B' })

    expectOk(await repo.saveNodeTemplate('new-name', { prompt: 'A2' }, 'old-name'))
    expect((await repo.list()).templates.nodes.map((entry) => entry.name).sort()).toEqual([
      'new-name',
      'taken',
    ])
    expect(expectOk(await repo.readTemplate('nodes', 'new-name'))).toEqual({ prompt: 'A2' })
  })

  it('描述与多个产出（带规则）原样存下、读回', async () => {
    const data = {
      label: '检查',
      description: '跑一遍检查',
      prompt: 'P',
      output: [{ path: 'a.md', rule: '列出问题' }, { path: 'b.json' }],
    }
    expectOk(await repo.createNodeTemplate('rich', data))
    const raw = JSON.parse((await readFileText(templateFile(root, 'nodes', 'rich'))) ?? '{}')
    expect(Object.keys(raw)).toEqual(['label', 'description', 'prompt', 'output'])
    expect(expectOk(await repo.readNodeTemplateDraft('rich'))).toEqual(data)
  })

  it('只改大小写的改名不会把文件弄丢', async () => {
    expectOk(await repo.createNodeTemplate('case', { prompt: 'A' }))
    expectOk(await repo.saveNodeTemplate('Case', { prompt: 'A' }, 'case'))
    expect(expectOk(await repo.readTemplate('nodes', 'Case'))).toEqual({ prompt: 'A' })
  })

  it('删除：删掉就不在列表里；再删一次 ⇒ not_found', async () => {
    expectOk(await repo.createNodeTemplate('bye', { prompt: 'x' }))
    expectOk(await repo.deleteNodeTemplate('bye'))
    expect((await repo.list()).templates.nodes).toEqual([])
    expect(expectError(await repo.deleteNodeTemplate('bye')).code).toBe('not_found')
  })
})

describe('list', () => {
  it('列出图与模板，坏的标 invalid + reason，杂项条目各报一条提示', async () => {
    expectOk(await repo.create('good'))
    expectOk(await repo.writeNode('good', { id: 'a', content: 'P' }))
    await mkdir(workflowsDir(root), { recursive: true })
    await writeFile(workflowFile(root, 'broken'), '{ oops')
    await writeFile(join(workflowsDir(root), 'notes.txt'), 'hi')
    await mkdir(join(workflowsDir(root), 'legacy-dir'), { recursive: true })
    await mkdir(join(root, 'nodes'), { recursive: true })
    await mkdir(templatesDir(root, 'nodes'), { recursive: true })
    await writeFile(templateFile(root, 'nodes', 'ok'), '{"prompt":"R"}\n')
    await writeFile(templateFile(root, 'nodes', 'bad'), '{}\n')

    const listed = await repo.list()
    expect(listed.workflows.map((entry) => entry.name).sort()).toEqual(['broken', 'good'])

    const good = listed.workflows.find((entry) => entry.name === 'good')
    expect(good?.invalid).toBeUndefined()
    expect(good?.nodeCount).toBe(1)
    expect(good?.updatedAt).toBeGreaterThan(0)

    const broken = listed.workflows.find((entry) => entry.name === 'broken')
    expect(broken?.invalid).toBe(true)
    expect(broken?.reason).toContain('JSON')

    expect(listed.templates.nodes.map((entry) => entry.name)).toEqual(['bad', 'ok'])
    expect(listed.templates.nodes.find((entry) => entry.name === 'bad')?.invalid).toBe(true)
    expect(listed.templates.nodes.find((entry) => entry.name === 'ok')?.invalid).toBeUndefined()
    expect(listed.templates.workflows).toEqual([])

    const codes = listed.warnings.map((warning) => warning.code)
    expect(codes).toContain('legacy_structure')
    expect(codes).toContain('stray_entry')
    expect(listed.warnings.some((warning) => warning.message.includes('notes.txt'))).toBe(true)
  })

  it('空目录 ⇒ 空清单，不抛错', async () => {
    const listed = await repo.list()
    expect(listed).toEqual({
      workflows: [],
      templates: { workflows: [], nodes: [] },
      warnings: [],
    })
  })
})

// ── 失败姿态 ──────────────────────────────────────────────────

describe('dataDir 不可写', () => {
  it('写类 action 返回 invalid_args（含说明），不崩', async () => {
    const blocker = join(root, 'blocker')
    await writeFile(blocker, 'x')
    const broken = createRepository({ dataDir: join(blocker, 'sub') })

    const error = expectError(await broken.create('a'))
    expect(error.code).toBe('invalid_args')
    expect(error.message.length).toBeGreaterThan(0)

    const listed = await broken.list()
    expect(listed.workflows).toEqual([])
  })
})

describe('diffDocuments', () => {
  it('覆盖 add / update / delete 三类', () => {
    const before = d([n('keep', { prompt: 'K' }), n('drop')], [e('a->b', 'a', 'b')])
    const after = d([n('keep', { prompt: 'K2' }), n('fresh')], [e('c->d', 'c', 'd')])
    expect(diffDocuments(before, after)).toEqual([
      { kind: 'node', op: 'update', id: 'keep' },
      { kind: 'node', op: 'add', id: 'fresh' },
      { kind: 'node', op: 'delete', id: 'drop' },
      { kind: 'edge', op: 'add', id: 'c->d' },
      { kind: 'edge', op: 'delete', id: 'a->b' },
    ])
  })
})
