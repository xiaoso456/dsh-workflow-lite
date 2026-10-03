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

  it('save_as_template 不给 node → invalid_args（整图模板已去掉）', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'a', content: 'A' })
    const saved = record(await run({ action: 'save_as_template', workflow: 'wf', to: 'starter' }))
    expect(errorCode(saved)).toBe('invalid_args')
    const list = record(await run({ action: 'list' }))
    expect(Object.keys(record(list.templates as JsonValue))).toEqual(['nodes'])
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

  it('output 建资源节点；read 索引里步骤带 reads / writes，另有 resources 清单', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'a', content: 'A', output: 'a.md' })
    await run({ action: 'write_node', workflow: 'wf', node: 'b', content: 'B' })
    await run({ action: 'connect', workflow: 'wf', source: 'res-a', target: 'b' })
    const index = record(await run({ action: 'read', workflow: 'wf' }))
    expect(index.nodes).toEqual([
      { id: 'a', predecessors: [], writes: [{ id: 'res-a' }] },
      { id: 'b', predecessors: [], reads: ['res-a'] },
    ])
    const item = { kind: 'file', value: 'a.md' }
    expect(index.resources).toEqual([
      { id: 'res-a', items: [item], writers: [{ id: 'a' }], readers: ['b'] },
    ])
    // no_output：断开写入线，没人连的资源一并删掉——这里 b 还在读它，所以留着。
    await run({ action: 'write_node', workflow: 'wf', node: 'a', no_output: true })
    const after = record(await run({ action: 'read', workflow: 'wf' }))
    expect(after.resources).toEqual([{ id: 'res-a', items: [item], writers: [], readers: ['b'] }])
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
      action: 'write_resource',
      workflow: 'h',
      node: 'res-issues',
      resource: { items: [{ kind: 'file', value: 'issues.md', note: '问题清单，修好打钩' }] },
    })
    await run({
      action: 'connect',
      workflow: 'h',
      source: 'fix',
      target: 'res-issues',
      update: true,
    })
    await run({ action: 'connect', workflow: 'h', source: 'res-issues', target: 'report' })
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
    // 没配产出根目录：默认落在实例自己的 out 下（这里没装实例服务，实例 id 处留着 {instance}）。
    expect(plan).toContain(
      `- 资源 \`res-issues\`：\`review\` 产出；\`fix\` 在原文件上更新；\`report\` 读取。\n  - 文件：\`.workflow-lite/runs/{instance}/out/issues.md\`。说明：问题清单，修好打钩`,
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

  it('连着资源的线不能带 when / 交接；资源不能连资源；write_resource 内容不合法 → invalid_args / blocked', async () => {
    await run({ action: 'create', workflow: 'h2' })
    await run({ action: 'write_node', workflow: 'h2', node: 'a', content: 'A', output: 'a.md' })
    const made = record(
      await run({
        action: 'write_resource',
        workflow: 'h2',
        resource: { label: '参考', items: [{ kind: 'url', value: 'https://x.dev' }] },
      }),
    )
    expect(JSON.stringify(made.changed)).toContain('res-参考')
    expect(
      errorCode(
        await run({
          action: 'connect',
          workflow: 'h2',
          source: 'res-a',
          target: 'a',
          when: 'fail',
        }),
      ),
    ).toBe('invalid_args')
    expect(
      errorCode(
        await run({ action: 'connect', workflow: 'h2', source: 'res-a', target: 'res-参考' }),
      ),
    ).toBe('invalid_args')
    expect(
      errorCode(
        await run({
          action: 'write_resource',
          workflow: 'h2',
          resource: { items: [{ kind: 'skill', value: 'Bad Name' }] },
        }),
      ),
    ).toBe('blocked')
    expect(
      errorCode(
        await run({
          action: 'write_resource',
          workflow: 'h2',
          resource: { items: [{ kind: 'nope', value: 'x' }] },
        }),
      ),
    ).toBe('invalid_args')
    expect(errorCode(await run({ action: 'write_resource', workflow: 'h2' }))).toBe('invalid_args')
    expect(
      errorCode(await run({ action: 'write_resource', workflow: 'h2', node: 'a', resource: {} })),
    ).toBe('blocked')
    // 改名字与内容；read 索引里有资源（不含描述）。
    await run({
      action: 'write_resource',
      workflow: 'h2',
      node: 'res-参考',
      resource: { description: '只给人看', items: [{ kind: 'folder', value: 'D:/docs' }] },
    })
    const index = record(await run({ action: 'read', workflow: 'h2' }))
    const resources = (index.resources as JsonValue[]).map(record)
    expect(resources.find((entry) => entry.id === 'res-参考')).toEqual({
      id: 'res-参考',
      label: '参考',
      items: [{ kind: 'folder', value: 'D:/docs' }],
      writers: [],
      readers: [],
    })
  })
})

describe('资源节点的校验', () => {
  const base = (extra: { nodes?: unknown[]; edges?: unknown[] }) => ({
    nodes: [
      { id: 'a', type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: 'A' } },
      { id: 'b', type: 'wfNode', position: { x: 0, y: 0 }, data: { prompt: 'B' } },
      {
        id: 'f',
        type: 'wfResource',
        position: { x: 0, y: 0 },
        data: { items: [{ kind: 'file', value: 'f.md' }] },
      },
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

  it('资源连资源、连着资源的线带条件：保存级 resource_edge_invalid；绝对路径与 .. 都允许', () => {
    const linked = check(
      base({
        nodes: [
          {
            id: 'g',
            type: 'wfResource',
            position: { x: 0, y: 0 },
            data: {
              items: [
                { kind: 'file', value: '../g.md' },
                { kind: 'folder', value: '/abs' },
              ],
            },
          },
        ],
        edges: [line('f', 'g'), line('a', 'f', { when: 'fail' })],
      }),
    )
    expect(linked.save.map((problem) => problem.code)).toEqual([
      'resource_edge_invalid',
      'resource_edge_invalid',
    ])
  })

  it('两个步骤都整份写同一个资源：警告 resource_overwritten；改成更新就没有', () => {
    const both = check(base({ edges: [line('a', 'b'), line('a', 'f'), line('b', 'f')] }))
    expect(both.warning.map((problem) => problem.code)).toContain('resource_overwritten')
    const updated = check(
      base({ edges: [line('a', 'b'), line('a', 'f'), line('b', 'f', { update: true })] }),
    )
    expect(updated.warning.map((problem) => problem.code)).not.toContain('resource_overwritten')
  })

  it('提示：写出来没人读 resource_unread；写它的步骤是终点（成品）就不提示', () => {
    const unread = check(base({ edges: [line('a', 'b'), line('a', 'f')] }))
    expect(unread.hint.find((problem) => problem.code === 'resource_unread')?.node).toBe('f')
    const read = check(base({ edges: [line('a', 'b'), line('a', 'f'), line('f', 'b')] }))
    expect(read.hint.map((problem) => problem.code)).not.toContain('resource_unread')
    const final = check(base({ edges: [line('a', 'b'), line('b', 'f')] }))
    expect(final.hint.map((problem) => problem.code)).not.toContain('resource_unread')
  })

  it('提示：读者不在写者下游 resource_order；只读、没连的资源都不提示', () => {
    const order = check(base({ edges: [line('a', 'f'), line('f', 'b')] }))
    expect(order.hint.find((problem) => problem.code === 'resource_order')?.node).toBe('b')
    const fine = check(base({ edges: [line('a', 'b'), line('a', 'f'), line('f', 'b')] }))
    expect(fine.hint.map((problem) => problem.code)).not.toContain('resource_order')
    const readOnly = check(base({ edges: [line('a', 'b'), line('f', 'a')] }))
    expect(readOnly.hint).toEqual([])
    const lonely = check(base({ edges: [line('a', 'b')] }))
    expect(lonely.hint.map((problem) => problem.node)).not.toContain('f')
  })
})

describe('workflow_lite —— 输入节点', () => {
  async function build(): Promise<void> {
    await run({ action: 'create', workflow: 'g' })
    await run({ action: 'write_node', workflow: 'g', node: 'scan', content: '扫一遍' })
    await run({
      action: 'write_node',
      workflow: 'g',
      node: 'dir',
      input: { question: '扫哪个目录？', required: true, hint: '只写一个', placeholder: 'src/' },
    })
    await run({
      action: 'write_node',
      workflow: 'g',
      node: 'lang',
      input: {
        question: '用什么语言？',
        kind: 'choice',
        options: ['中文', 'English'],
        default: '中文',
      },
    })
    await run({ action: 'connect', workflow: 'g', source: 'dir', target: 'scan' })
  }

  it('write_node 带 input 建输入节点；read 索引列出问题与交给谁（不含占位与说明）', async () => {
    await build()
    const index = record(await run({ action: 'read', workflow: 'g' }))
    const inputs = index.inputs as JsonValue[]
    expect(inputs).toHaveLength(2)
    expect(record(inputs[0] as JsonValue)).toEqual({
      id: 'dir',
      question: '扫哪个目录？',
      kind: 'text',
      required: true,
      readers: ['scan'],
    })
    expect(record(inputs[1] as JsonValue)).toMatchObject({
      id: 'lang',
      kind: 'choice',
      readers: [],
    })
    const scan = record((index.nodes as JsonValue[])[0] as JsonValue)
    expect(scan.inputs).toEqual(['dir'])
    // 新步骤带上了样子。
    const node = record(record(await run({ action: 'read', workflow: 'g', node: 'scan' })).node)
    expect(record(node.data).icon).toBe('scan')
  })

  it('输入节点没有显示名、不能存成模板、不能被连进去；新建时必须给问题', async () => {
    await build()
    expect(
      errorCode(await run({ action: 'set_label', workflow: 'g', node: 'dir', label: 'x' })),
    ).toBe('invalid_args')
    expect(errorCode(await run({ action: 'save_as_template', workflow: 'g', node: 'dir' }))).toBe(
      'invalid_args',
    )
    expect(
      errorCode(await run({ action: 'connect', workflow: 'g', source: 'scan', target: 'dir' })),
    ).toBe('invalid_args')
    expect(
      errorCode(await run({ action: 'write_node', workflow: 'g', node: 'q2', input: {} })),
    ).toBe('invalid_args')
    expect(
      errorCode(
        await run({ action: 'write_node', workflow: 'g', node: 'dir', input: { kind: 'slider' } }),
      ),
    ).toBe('invalid_args')
  })

  it('compile：带 answers 写进计划；必填没回答回 problems；answers 形状不对 invalid_args', async () => {
    await build()
    const answered = record(
      await run(
        { action: 'compile', workflow: 'g', answers: [{ id: 'dir', value: 'src/' }] },
        EXEC,
      ),
    )
    expect(answered.plan).toContain('- 问：扫哪个目录？（交给 `scan`）\n  答：src/')
    expect(answered.plan).toContain('- 问：用什么语言？（交给所有步骤）\n  答：中文')
    expect(answered.plan).not.toContain('只写一个')

    const preview = record(await run({ action: 'compile', workflow: 'g' }, EXEC))
    expect(preview.plan).toContain('（执行时由用户填写）')

    const missing = record(await run({ action: 'compile', workflow: 'g', answers: [] }, EXEC))
    expect(missing.plan).toBe('')
    expect((missing.problems as JsonValue[]).map((p) => record(p).code)).toEqual(['input_missing'])

    expect(
      errorCode(await run({ action: 'compile', workflow: 'g', answers: [{ id: 'dir' }] }, EXEC)),
    ).toBe('invalid_args')
  })

  it('参数 schema 带上 input 与 answers，仍能编成合法的 JSON Schema', () => {
    const schema = parameterSchemaSpecToJsonSchema(PARAMETERS)
    expect(schema.properties?.input).toBeDefined()
    expect(schema.properties?.answers).toBeDefined()
  })
})
