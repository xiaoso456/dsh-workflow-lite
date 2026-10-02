import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parameterSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createRepository,
  type Repository,
  reportProblems,
} from '../../src/host/store/repository.ts'
import {
  createWorkflowLiteHandler,
  PARAMETERS,
  type ToolExecView,
  type WorkflowLiteArgs,
} from '../../src/host/tool/tool.ts'
import { ACTIONS, TOOL_NAME } from '../../src/shared/types.ts'
import { validateDocument } from '../../src/shared/validate.ts'

let dataDir: string
let repository: Repository
let run: (args: WorkflowLiteArgs, exec?: ToolExecView) => Promise<JsonValue>

const EXEC: ToolExecView = { agent: { session: { header: { cwd: 'D:\\repo' } } } }

/** 把工具的规范 JSON 值当记录读（不做断言）。 */
function record(value: JsonValue): Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
}

/** 取错误码；不是错误返回 undefined。 */
function errorCode(value: JsonValue): string | undefined {
  const error = record(value).error
  if (error === undefined || error === null) return undefined
  const code = record(error).code
  return typeof code === 'string' ? code : undefined
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'workflow-lite-tool-'))
  repository = createRepository({
    dataDir,
    validate: (document, workflow) =>
      reportProblems(validateDocument(document, { workflowName: workflow, maxNodes: 200 })),
  })
  run = createWorkflowLiteHandler({
    repository,
    dataDir: () => dataDir,
    maxResultBytes: () => 262_144,
  })
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('workflow_lite —— 参数 schema 能编成合法的 JSON Schema（DSH 读的就是它）', () => {
  it('编译不抛错，且 action 枚举与 ACTIONS 一致、只有 action 必填', () => {
    const schema = parameterSchemaSpecToJsonSchema(PARAMETERS)
    const action = schema.properties?.action
    expect(action).toBeDefined()
    expect(action?.enum).toEqual([...ACTIONS])
    expect(schema.required).toEqual(['action'])
  })

  it('工具名不与 DSH 内置的 `workflow` 工具相撞', () => {
    expect(TOOL_NAME).toBe('workflow_lite')
    expect(TOOL_NAME).not.toBe('workflow')
  })
})

describe('workflow_lite —— 参数校验与错误码', () => {
  it('需要 workflow 的 action 缺 workflow → invalid_args', async () => {
    for (const action of ['read', 'compile', 'create', 'write_node', 'delete_workflow'] as const) {
      const result = await run({ action })
      expect(errorCode(result), action).toBe('invalid_args')
    }
  })

  it('write_node 缺 node → invalid_args', async () => {
    await run({ action: 'create', workflow: 'g' })
    expect(errorCode(await run({ action: 'write_node', workflow: 'g' }))).toBe('invalid_args')
  })

  it('set_label 缺 node / label → invalid_args', async () => {
    await run({ action: 'create', workflow: 'g' })
    await run({ action: 'write_node', workflow: 'g', node: 'a', content: 'x' })
    expect(errorCode(await run({ action: 'set_label', workflow: 'g', label: 'X' }))).toBe(
      'invalid_args',
    )
    expect(errorCode(await run({ action: 'set_label', workflow: 'g', node: 'a' }))).toBe(
      'invalid_args',
    )
  })

  it('connect / disconnect 缺端点 → invalid_args', async () => {
    await run({ action: 'create', workflow: 'g' })
    expect(errorCode(await run({ action: 'connect', workflow: 'g', source: 'a' }))).toBe(
      'invalid_args',
    )
    expect(errorCode(await run({ action: 'disconnect', workflow: 'g', target: 'a' }))).toBe(
      'invalid_args',
    )
  })

  it('rename_workflow 缺 to → invalid_args', async () => {
    await run({ action: 'create', workflow: 'g' })
    expect(errorCode(await run({ action: 'rename_workflow', workflow: 'g' }))).toBe('invalid_args')
  })

  it('指向不存在的图 → not_found（绝不隐式创建）', async () => {
    expect(errorCode(await run({ action: 'read', workflow: 'nope' }))).toBe('not_found')
    expect(errorCode(await run({ action: 'compile', workflow: 'nope' }))).toBe('not_found')
    expect(errorCode(await run({ action: 'delete_workflow', workflow: 'nope' }))).toBe('not_found')
    // 写类也不该把图"顺手建出来"
    expect(
      errorCode(await run({ action: 'write_node', workflow: 'nope', node: 'a', content: 'x' })),
    ).toBe('not_found')
    const listed = record(await run({ action: 'list' }))
    expect(listed.workflows).toEqual([])
  })

  it('超过 maxResultBytes → 报错而不截断', async () => {
    const small = createWorkflowLiteHandler({
      repository,
      dataDir: () => dataDir,
      maxResultBytes: () => 64,
    })
    await run({ action: 'create', workflow: 'big' })
    for (let n = 0; n < 8; n += 1) {
      await run({ action: 'write_node', workflow: 'big', node: `n${n}`, content: '长'.repeat(300) })
    }
    const result = await small({ action: 'read', workflow: 'big' })
    const error = record(result).error
    expect(error).toBeDefined()
  })
})

describe('workflow_lite —— 正常路径', () => {
  it('create → write_node → connect → read 闭环', async () => {
    expect(record(await run({ action: 'create', workflow: 'code-review' })).changed).toBeDefined()

    const write = record(
      await run({
        action: 'write_node',
        workflow: 'code-review',
        node: 'scan',
        content: '扫描仓库',
        label: '扫描',
        output: 'scan.json',
      }),
    )
    expect(write.changed).toBeDefined()

    await run({ action: 'write_node', workflow: 'code-review', node: 'report', content: '写报告' })
    expect(
      record(
        await run({ action: 'connect', workflow: 'code-review', source: 'scan', target: 'report' }),
      ).changed,
    ).toBeDefined()

    // 不给 node：只回索引，**绝不含正文**
    const index = record(await run({ action: 'read', workflow: 'code-review' }))
    const nodes = index.nodes
    expect(Array.isArray(nodes)).toBe(true)
    expect(JSON.stringify(index)).not.toContain('扫描仓库')

    // 给 node：才回正文
    const one = record(await run({ action: 'read', workflow: 'code-review', node: 'scan' }))
    expect(JSON.stringify(one)).toContain('扫描仓库')
  })

  it('compile：出计划、planId、problems 为空、⑤ 带上 exec 的 cwd 与 goal', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'a', content: '做事', output: 'a.md' })
    const result = record(await run({ action: 'compile', workflow: 'wf', goal: '跑完它' }, EXEC))
    expect(Array.isArray(result.problems)).toBe(true)
    expect(result.problems).toEqual([])
    expect(typeof result.plan).toBe('string')
    expect(String(result.plan)).toContain('## 交付契约')
    expect(String(result.plan)).toContain('目标：跑完它')
    expect(String(result.plan)).toContain('工作区路径：D:\\repo')
    expect(String(result.planId)).toMatch(/^[0-9a-f]{8}$/)
  })

  it('compile：空正文是编译级 ⇒ plan 空串、problems 非空（不是 error）', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'a', content: '' })
    const result = record(await run({ action: 'compile', workflow: 'wf' }))
    expect(errorCode(result)).toBeUndefined()
    expect(result.plan).toBe('')
    expect(Array.isArray(result.problems)).toBe(true)
    expect((result.problems as JsonValue[]).length).toBeGreaterThan(0)
  })

  it('delete_node 连带删边（否则会留下保存级的悬空 edge）', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'a', content: 'A' })
    await run({ action: 'write_node', workflow: 'wf', node: 'b', content: 'B' })
    await run({ action: 'connect', workflow: 'wf', source: 'a', target: 'b' })
    await run({ action: 'delete_node', workflow: 'wf', node: 'a' })

    const index = record(await run({ action: 'read', workflow: 'wf' }))
    expect((index.nodes as JsonValue[]).length).toBe(1)
    // 图仍可编译（没有悬空边的保存级拦截）
    const compiled = record(await run({ action: 'compile', workflow: 'wf' }))
    expect(errorCode(compiled)).toBeUndefined()
  })

  it('set_label 改显示名，但 id 不变（计划里渲染成 label（id））', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'auth-review', content: '审查' })
    await run({ action: 'set_label', workflow: 'wf', node: 'auth-review', label: '认证审查' })
    const compiled = record(await run({ action: 'compile', workflow: 'wf' }))
    expect(String(compiled.plan)).toContain('认证审查（auth-review）')
  })

  it('save_as_template 给了 node → 存成节点模板（不带 id / position）', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'r', content: '审查者', label: '审查' })
    const saved = record(
      await run({ action: 'save_as_template', workflow: 'wf', node: 'r', to: 'reviewer' }),
    )
    expect(errorCode(saved)).toBeUndefined()
    const list = record(await run({ action: 'list' }))
    const templates = record(list.templates as JsonValue)
    const nodes = templates.nodes
    expect(JSON.stringify(nodes)).toContain('reviewer')
  })

  it('save_as_template 不给 node → 存成图模板', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'a', content: 'A' })
    const saved = record(await run({ action: 'save_as_template', workflow: 'wf', to: 'starter' }))
    expect(errorCode(saved)).toBeUndefined()
    const list = record(await run({ action: 'list' }))
    expect(JSON.stringify(record(list.templates as JsonValue).workflows)).toContain('starter')
  })

  it('create from 模板 → 新建的图带上模板的节点', async () => {
    await run({ action: 'create', workflow: 'base' })
    await run({ action: 'write_node', workflow: 'base', node: 'a', content: 'A' })
    await run({ action: 'save_as_template', workflow: 'base', to: 'starter' })
    const created = record(await run({ action: 'create', workflow: 'copy', from: 'starter' }))
    expect(errorCode(created)).toBeUndefined()
    const index = record(await run({ action: 'read', workflow: 'copy' }))
    expect((index.nodes as JsonValue[]).length).toBe(1)
  })

  it('rename_workflow → delete_workflow 闭环', async () => {
    await run({ action: 'create', workflow: 'a' })
    const renamed = record(await run({ action: 'rename_workflow', workflow: 'a', to: 'b' }))
    expect(errorCode(renamed)).toBeUndefined()
    let list = record(await run({ action: 'list' }))
    expect(JSON.stringify(list.workflows)).toContain('b')
    expect(JSON.stringify(list.workflows)).not.toContain('"a"')

    const removed = record(await run({ action: 'delete_workflow', workflow: 'b' }))
    expect(errorCode(removed)).toBeUndefined()
    list = record(await run({ action: 'list' }))
    expect(JSON.stringify(list.workflows)).not.toContain('"b"')
  })

  it('disconnect 删边', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'a', content: 'A' })
    await run({ action: 'write_node', workflow: 'wf', node: 'b', content: 'B' })
    await run({ action: 'connect', workflow: 'wf', source: 'a', target: 'b' })
    expect(
      record(await run({ action: 'disconnect', workflow: 'wf', source: 'a', target: 'b' })).changed,
    ).toBeDefined()
    const index = record(await run({ action: 'read', workflow: 'wf' }))
    const edges = record(await run({ action: 'read', workflow: 'wf', node: 'a' })).edges
    expect(Array.isArray(edges) ? edges.length : -1).toBe(0)
    void index
  })

  it('output 建文件节点；read 索引里步骤带 reads / writes，另有 files 清单', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'a', content: 'A', output: 'a.md' })
    await run({ action: 'write_node', workflow: 'wf', node: 'b', content: 'B' })
    await run({ action: 'connect', workflow: 'wf', source: 'file-a.md', target: 'b' })
    const index = record(await run({ action: 'read', workflow: 'wf' }))
    expect(index.nodes).toEqual([
      { id: 'a', predecessors: [], writes: [{ path: 'a.md' }] },
      { id: 'b', predecessors: [], reads: ['a.md'] },
    ])
    expect(index.files).toEqual([
      { id: 'file-a.md', path: 'a.md', writers: [{ id: 'a' }], readers: ['b'] },
    ])
    // no_output：断开写入线，没人连的文件节点一并删掉——这里 b 还在读它，所以留着。
    await run({ action: 'write_node', workflow: 'wf', node: 'a', no_output: true })
    const after = record(await run({ action: 'read', workflow: 'wf' }))
    expect(after.files).toEqual([{ id: 'file-a.md', path: 'a.md', writers: [], readers: ['b'] }])
  })

  it('from_template 取模板的 data 本体（不复制 id 与 position）', async () => {
    await run({ action: 'create', workflow: 'src' })
    await run({
      action: 'write_node',
      workflow: 'src',
      node: 'orig',
      content: '模板正文',
      label: '模板',
    })
    await run({ action: 'save_as_template', workflow: 'src', node: 'orig', to: 'tpl' })

    await run({ action: 'create', workflow: 'dst' })
    await run({ action: 'write_node', workflow: 'dst', node: 'mine', from_template: 'tpl' })
    const one = record(await run({ action: 'read', workflow: 'dst', node: 'mine' }))
    expect(JSON.stringify(one)).toContain('模板正文')
    const node = record(one.node as JsonValue)
    expect(node.id).toBe('mine')
  })
})

describe('workflow_lite —— configure（工作流设置）', () => {
  it('改根目录与执行方式 → read 带回设置、compile 用上它们', async () => {
    await run({ action: 'create', workflow: 'cfg' })
    await run({ action: 'write_node', workflow: 'cfg', node: 'a', content: '做事', output: 'a.md' })
    const done = record(
      await run({
        action: 'configure',
        workflow: 'cfg',
        output_root: 'out//run/',
        mode: 'subagent',
      }),
    )
    expect(done.changed).toBeDefined()
    const index = record(await run({ action: 'read', workflow: 'cfg' }))
    expect(index.settings).toEqual({ outputRoot: 'out/run', mode: 'subagent' })
    const compiled = record(await run({ action: 'compile', workflow: 'cfg' }, EXEC))
    expect(String(compiled.plan)).toContain('out/run/a.md')
    expect(String(compiled.plan)).toContain('`subagent`')

    // 空串清根目录、auto 清执行方式：设置整键消失。
    await run({ action: 'configure', workflow: 'cfg', output_root: '', mode: 'auto' })
    expect(record(await run({ action: 'read', workflow: 'cfg' })).settings).toBeUndefined()
  })

  it('什么都不给、或根目录不合法：invalid_args', async () => {
    await run({ action: 'create', workflow: 'cfg2' })
    expect(errorCode(await run({ action: 'configure', workflow: 'cfg2' }))).toBe('invalid_args')
    expect(
      errorCode(await run({ action: 'configure', workflow: 'cfg2', output_root: '~/out' })),
    ).toBe('invalid_args')
  })
})

describe('工作流设置的校验', () => {
  it('根目录带控制字符是保存级 settings_invalid', () => {
    const report = validateDocument(
      {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        settings: { outputRoot: 'a\u0007b' },
      },
      { workflowName: 'g', maxNodes: 200 },
    )
    expect(report.save.map((problem) => problem.code)).toContain('settings_invalid')
    expect(report.canLoad).toBe(false)
  })
})

describe('workflow_lite —— 文件节点与交接', () => {
  it('write_file 建文件节点；connect 连写（update）与读；步骤间的线可附交接说明或只管先后', async () => {
    await run({ action: 'create', workflow: 'h' })
    await run({
      action: 'write_node',
      workflow: 'h',
      node: 'review',
      content: '审',
      output: 'issues.md',
    })
    await run({ action: 'write_node', workflow: 'h', node: 'fix', content: '修' })
    await run({ action: 'write_node', workflow: 'h', node: 'report', content: '汇' })
    await run({
      action: 'write_file',
      workflow: 'h',
      path: 'issues.md',
      rule: '问题清单，修好打钩',
    })
    await run({
      action: 'connect',
      workflow: 'h',
      source: 'fix',
      target: 'file-issues.md',
      update: true,
    })
    await run({ action: 'connect', workflow: 'h', source: 'file-issues.md', target: 'report' })
    const added = record(
      await run({
        action: 'connect',
        workflow: 'h',
        source: 'review',
        target: 'fix',
        handoff_note: '逐条修',
      }),
    )
    expect(JSON.stringify(added.changed)).toContain('"op":"add"')
    await run({
      action: 'connect',
      workflow: 'h',
      source: 'fix',
      target: 'report',
      handoff: 'none',
    })

    const compiled = record(await run({ action: 'compile', workflow: 'h' }, EXEC))
    const plan = String(compiled.plan)
    // 没配产出根目录、也不记运行状态：默认目录里的 {instance} 换成 planId。
    expect(plan).toContain(
      `- \`.workflow-lite/runs/${String(compiled.planId)}/out/issues.md\`：\`review\` 产出；\`fix\` 在原文件上更新；\`report\` 读取。要求：问题清单，修好打钩`,
    )
    expect(plan).toContain('- `review` → `fix`：说明：逐条修')
    expect(plan).toContain('- `fix` → `report`：只管先后，不交执行结果。')

    // 已存在的边：handoff=result 回到缺省（交执行结果、不附说明）。
    const reset = record(
      await run({
        action: 'connect',
        workflow: 'h',
        source: 'review',
        target: 'fix',
        handoff: 'result',
      }),
    )
    expect(JSON.stringify(reset.changed)).toContain('"op":"update"')
    const detail = record(await run({ action: 'read', workflow: 'h', node: 'review' }))
    const flow = (detail.edges as JsonValue[]).map(record).find((edge) => edge.target === 'fix')
    expect(flow?.data).toBeUndefined()
  })

  it('连着文件的线不能带 when / 交接；文件不能连文件；write_file 路径不合法 → blocked', async () => {
    await run({ action: 'create', workflow: 'h2' })
    await run({ action: 'write_node', workflow: 'h2', node: 'a', content: 'A', output: 'a.md' })
    await run({ action: 'write_file', workflow: 'h2', path: 'b.md' })
    expect(
      errorCode(
        await run({
          action: 'connect',
          workflow: 'h2',
          source: 'file-a.md',
          target: 'a',
          when: 'fail',
        }),
      ),
    ).toBe('invalid_args')
    expect(
      errorCode(
        await run({ action: 'connect', workflow: 'h2', source: 'file-a.md', target: 'file-b.md' }),
      ),
    ).toBe('invalid_args')
    expect(errorCode(await run({ action: 'write_file', workflow: 'h2', path: '/abs.md' }))).toBe(
      'blocked',
    )
    expect(errorCode(await run({ action: 'write_file', workflow: 'h2' }))).toBe('invalid_args')
  })
})

describe('文件节点的校验', () => {
  const base = (extra: { nodes?: unknown[]; edges?: unknown[] }) => ({
    nodes: [
      { id: 'a', type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: 'A' } },
      { id: 'b', type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: 'B' } },
      { id: 'f', type: 'wfFile', position: { x: 0, y: 0 }, data: { path: 'f.md' } },
      ...(extra.nodes ?? []),
    ],
    edges: extra.edges ?? [],
    viewport: { x: 0, y: 0, zoom: 1 },
  })
  const line = (source: string, target: string, data?: unknown) => ({
    id: `${source}->${target}`,
    source,
    target,
    sourceHandle: null,
    targetHandle: null,
    ...(data === undefined ? {} : { data }),
  })
  const check = (document: unknown) =>
    validateDocument(document as never, { workflowName: 'g', maxNodes: 200 })

  it('文件连文件、连着文件的线带条件：保存级 file_edge_invalid；路径不合法：保存级', () => {
    const files = check(
      base({
        nodes: [{ id: 'g', type: 'wfFile', position: { x: 0, y: 0 }, data: { path: 'g.md' } }],
        edges: [line('f', 'g'), line('a', 'f', { when: 'fail' })],
      }),
    )
    expect(files.save.filter((problem) => problem.code === 'file_edge_invalid')).toHaveLength(2)
    const bad = check(
      base({
        nodes: [{ id: 'h', type: 'wfFile', position: { x: 0, y: 0 }, data: { path: '../h' } }],
      }),
    )
    expect(bad.save.map((problem) => problem.code)).toContain('output_invalid')
  })

  it('两个步骤都整份写同一份文件：警告 file_overwritten；改成更新就没有', () => {
    const both = check(base({ edges: [line('a', 'b'), line('a', 'f'), line('b', 'f')] }))
    expect(both.warning.map((problem) => problem.code)).toContain('file_overwritten')
    const updated = check(
      base({ edges: [line('a', 'b'), line('a', 'f'), line('b', 'f', { update: true })] }),
    )
    expect(updated.warning.map((problem) => problem.code)).not.toContain('file_overwritten')
  })

  it('提示：没人写的文件 file_unwritten；读者不在写者下游 file_order；孤立文件 stray_entry', () => {
    const unwritten = check(base({ edges: [line('f', 'a')] }))
    expect(unwritten.hint.map((problem) => problem.code)).toContain('file_unwritten')
    const order = check(base({ edges: [line('a', 'f'), line('f', 'b')] }))
    expect(order.hint.find((problem) => problem.code === 'file_order')?.node).toBe('b')
    const fine = check(base({ edges: [line('a', 'b'), line('a', 'f'), line('f', 'b')] }))
    expect(fine.hint.map((problem) => problem.code)).not.toContain('file_order')
    const lonely = check(base({ edges: [line('a', 'b')] }))
    expect(lonely.hint.find((problem) => problem.code === 'stray_entry')?.node).toBe('f')
  })
})
