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

  it('no_output 表达第三态（写 output: false）', async () => {
    await run({ action: 'create', workflow: 'wf' })
    await run({ action: 'write_node', workflow: 'wf', node: 'a', content: 'A', no_output: true })
    const one = record(await run({ action: 'read', workflow: 'wf', node: 'a' }))
    expect(JSON.stringify(one)).toContain('"output":false')
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
