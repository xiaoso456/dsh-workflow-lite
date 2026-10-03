/**
 * 工作流实例（运行状态）：编译建实例、读、保存用户改动（含冲突）、归属转移、恢复、暂存通知。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { RunService } from '../../src/host/runs/service.ts'
import { instancesFile } from '../../src/host/runs/store.ts'
import {
  createRepository,
  type Repository,
  reportProblems,
} from '../../src/host/store/repository.ts'
import {
  createWorkflowLiteHandler,
  type ToolExecView,
  type WorkflowLiteArgs,
} from '../../src/host/tool/tool.ts'
import type { InstanceView, StateEdit } from '../../src/shared/runState.ts'
import { validateDocument } from '../../src/shared/validate.ts'

let dataDir: string
let workspace: string
let repository: Repository
let runs: RunService
let notified: { session: string; text: string; summary: string }[]
let deliver: boolean
let run: (args: WorkflowLiteArgs, exec?: ToolExecView) => Promise<JsonValue>

function exec(session: string): ToolExecView {
  return { agent: { session: { header: { id: session, cwd: workspace } } } }
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'workflow-lite-runs-'))
  workspace = join(dataDir, 'ws')
  await mkdir(workspace)
  repository = createRepository({
    dataDir,
    validate: (document, workflow) =>
      reportProblems(validateDocument(document, { workflowName: workflow, maxNodes: 200 })),
  })
  await repository.ensureLayout()
  notified = []
  deliver = true
  runs = new RunService({
    dataDir: () => dataDir,
    validate: (document, workflow) =>
      reportProblems(validateDocument(document, { workflowName: workflow, maxNodes: 200 })),
    notify: async (session, text, summary) => {
      if (!deliver) return false
      notified.push({ session, text, summary })
      return true
    },
  })
  run = createWorkflowLiteHandler({
    repository,
    dataDir: () => dataDir,
    maxResultBytes: () => 262_144,
    runs,
  })
  // scan → review；review 通过去 report、未通过去 fix，fix 回 review。
  await run({ action: 'create', workflow: 'cr' })
  for (const id of ['scan', 'review', 'fix', 'report']) {
    await run({
      action: 'write_node',
      workflow: 'cr',
      node: id,
      content: `做 ${id}`,
      no_output: true,
    })
  }
  await run({ action: 'connect', workflow: 'cr', source: 'scan', target: 'review' })
  await run({ action: 'connect', workflow: 'cr', source: 'review', target: 'report', when: 'pass' })
  await run({ action: 'connect', workflow: 'cr', source: 'review', target: 'fix', when: 'fail' })
  await run({ action: 'connect', workflow: 'cr', source: 'fix', target: 'review' })
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

/** 状态文件在哪（工具的返回值里刻意不给路径：模型只经 state 动作改它）。 */
async function statePathOf(id: string): Promise<string | undefined> {
  return (await runs.list(undefined, true)).find((item) => item.id === id)?.statePath
}

async function compileWithRuns(session = 's1'): Promise<Record<string, unknown>> {
  await run({ action: 'configure', workflow: 'cr', run_state: true })
  const result = record(
    await run({ action: 'compile', workflow: 'cr', goal: '审一遍' }, exec(session)),
  )
  return { ...result, statePath: await statePathOf(String(result.instance)) }
}

async function view(id: string, session = 's1'): Promise<InstanceView> {
  const outcome = await runs.view(id, session)
  if (!outcome.ok || 'unchanged' in outcome.result) throw new Error('view failed')
  return outcome.result
}

describe('编译建实例', () => {
  it('没开运行状态：也建实例（任务描述写进实例目录），但没有状态、计划里没有运行状态段', async () => {
    const result = record(await run({ action: 'compile', workflow: 'cr' }, exec('s1')))
    const id = String(result.instance)
    expect(String(result.plan)).not.toContain('## 运行状态')
    expect(String(result.plan)).toContain(`工作流实例：\`${id}\``)
    expect(record(result.progress).tracked).toBe(false)
    const list = await runs.list('s1', false)
    expect(list.map((item) => [item.id, item.statePath])).toEqual([[id, undefined]])
    const task = join(workspace, '.workflow-lite', 'runs', id, 'tasks', 'scan.md')
    expect(record(result.payloadPaths).scan).toBe(task)
    expect(await readFile(task, 'utf8')).toBe('做 scan')
  })

  it('开了：建快照与初始状态，计划带运行状态段（用 state 动作记），本会话当前实例就是它', async () => {
    const result = await compileWithRuns()
    const id = String(result.instance)
    const statePath = String(result.statePath)
    expect(statePath).toBe(join(workspace, '.workflow-lite', 'runs', id, 'state.yaml'))
    expect(String(result.plan)).toContain('## 运行状态')
    expect(String(result.plan)).toContain(`"instance":"${id}"`)
    expect(String(result.plan)).not.toContain(statePath)
    expect(String(result.plan)).toContain('目标：审一遍')
    const text = await readFile(statePath, 'utf8')
    expect(text.startsWith('# workflow-lite 运行状态')).toBe(true)
    const state = parse(text)
    expect(state.status).toBe('pending')
    expect(Object.keys(state.nodes)).toEqual(['scan', 'review', 'fix', 'report'])
    expect(await readFile(join(workspace, '.workflow-lite', '.gitignore'), 'utf8')).toBe('*\n')
    const list = await runs.list('s1', false)
    expect(list.map((item) => [item.id, item.current, item.status])).toEqual([
      [id, true, 'pending'],
    ])
    const loaded = await view(id)
    expect(loaded.issues).toEqual([])
    expect(loaded.state?.goal).toBe('审一遍')
  })

  it('重复编译、实例还没开始：复用同一个实例，不留一堆空实例', async () => {
    const first = await compileWithRuns()
    const second = record(await run({ action: 'compile', workflow: 'cr' }, exec('s1')))
    expect(second.instance).toBe(first.instance)
    expect(await runs.list('s1', false)).toHaveLength(1)
  })

  it('实例开始之后再编译：建新的', async () => {
    const first = await compileWithRuns()
    const statePath = String(first.statePath)
    const text = await readFile(statePath, 'utf8')
    await writeFile(statePath, text.replace('status: pending\n', 'status: running\n'))
    const second = record(await run({ action: 'compile', workflow: 'cr' }, exec('s1')))
    expect(second.instance).not.toBe(first.instance)
    const list = await runs.list('s1', false)
    expect(list).toHaveLength(2)
    expect(list.find((item) => item.current)?.id).toBe(second.instance)
  })
})

describe('画布上的执行', () => {
  async function start(session = 's1'): Promise<{ id: string; prompt: string; tracked: boolean }> {
    const load = await repository.load('cr')
    if (load.document === null) throw new Error('load failed')
    const outcome = await runs.start({
      workflow: 'cr',
      document: load.document,
      problems: load.problems,
      session: { id: session, cwd: workspace },
    })
    if (!outcome.ok) throw new Error(outcome.error.message)
    return {
      id: outcome.result.instance.id,
      prompt: outcome.result.prompt,
      tracked: outcome.result.instance.statePath !== undefined,
    }
  }

  it('没开运行状态也建实例：只有快照与归属、没有状态文件；resume 拿到不带运行状态段的计划', async () => {
    const started = await start()
    expect(started.tracked).toBe(false)
    expect(started.prompt).toContain(`instance=${started.id}`)
    expect(started.prompt).toContain('action=resume')
    const list = await runs.list('s1', false)
    expect(list.map((item) => [item.id, item.current, item.status, item.stateProblem])).toEqual([
      [started.id, true, undefined, undefined],
    ])
    const loaded = await view(started.id)
    expect(loaded.state).toBeNull()
    expect(loaded.issues).toEqual([])
    const resumed = record(await run({ action: 'resume', instance: started.id }, exec('s1')))
    expect(String(resumed.plan)).not.toContain('## 运行状态')
    expect(record(resumed.progress).tracked).toBe(false)
    const saved = await runs.save(
      started.id,
      's1',
      [{ path: ['status'], from: 'pending', to: 'waiting' }],
      undefined,
    )
    expect(saved.ok).toBe(false)
  })

  it('开了运行状态：建状态文件；每次执行都是新实例；第一次 resume 不记恢复流水', async () => {
    await run({ action: 'configure', workflow: 'cr', run_state: true })
    const first = await start()
    const second = await start()
    expect(first.tracked).toBe(true)
    expect(second.id).not.toBe(first.id)
    expect(started(await runs.list('s1', false))).toEqual([second.id, first.id])
    expect(first.prompt).toContain('运行状态')
    const resumed = record(await run({ action: 'resume', instance: second.id }, exec('s1')))
    expect(String(resumed.plan)).toContain('## 运行状态')
    expect((await view(second.id)).state?.log).toEqual([])
  })

  it('图有编译级问题：不建实例', async () => {
    await run({ action: 'write_node', workflow: 'cr', node: 'scan', content: '' })
    const load = await repository.load('cr')
    if (load.document === null) throw new Error('load failed')
    const outcome = await runs.start({
      workflow: 'cr',
      document: load.document,
      problems: load.problems,
      session: { id: 's1', cwd: workspace },
    })
    expect(outcome.ok).toBe(false)
    expect(await runs.list(undefined, true)).toEqual([])
  })
})

function started(list: readonly { id: string }[]): string[] {
  return list.map((item) => item.id)
}

describe('读实例', () => {
  it('状态文件写错：回校验结论、state 为 null；文件不在：标 missing', async () => {
    const result = await compileWithRuns()
    const id = String(result.instance)
    const statePath = String(result.statePath)
    const text = await readFile(statePath, 'utf8')
    await writeFile(statePath, text.replace('status: pending\n', 'status: complete\n'))
    const bad = await view(id)
    expect(bad.state).toBeNull()
    expect(bad.issues.map((issue) => issue.path)).toEqual(['status'])
    expect((await runs.list('s1', false))[0]?.stateProblem).toBe('invalid')
    await rm(statePath)
    expect((await runs.list('s1', false))[0]?.stateProblem).toBe('missing')
  })

  it('since 等于当前修改时间：只回没变', async () => {
    const id = String((await compileWithRuns()).instance)
    const first = await view(id)
    const again = await runs.view(id, 's1', first.mtime)
    expect(again.ok && 'unchanged' in again.result).toBe(true)
  })
})

describe('保存用户的改动', () => {
  async function started(): Promise<{ id: string; statePath: string }> {
    const result = await compileWithRuns()
    const statePath = String(result.statePath)
    const text = await readFile(statePath, 'utf8')
    // 模型写过一轮：带注释，scan 完成。
    await writeFile(
      statePath,
      text
        .replace('status: pending\n', 'status: running # 模型写的注释\n')
        .replace(
          '  scan:\n    status: pending\n',
          '  scan:\n    status: done\n    round: 1\n    finishedAt: 2026-10-02T14:30:00+08:00\n',
        ),
    )
    return { id: String(result.instance), statePath }
  }

  it('只改动过的字段、保留注释、追加 edit 流水，并通知模型', async () => {
    const { id, statePath } = await started()
    const edits: StateEdit[] = [
      { path: ['nodes', 'scan', 'status'], from: 'done', to: 'pending' },
      { path: ['nodes', 'scan', 'finishedAt'], from: '2026-10-02T14:30:00+08:00', to: null },
      { path: ['status'], from: 'running', to: 'waiting' },
      { path: ['note'], from: null, to: '先别修' },
    ]
    const outcome = await runs.save(id, 's1', edits, '方案要先确认')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.notified).toBe(true)
    const text = await readFile(statePath, 'utf8')
    expect(text).toContain('# 模型写的注释')
    const state = parse(text)
    expect(state.status).toBe('waiting')
    expect(state.note).toBe('先别修')
    expect(state.nodes.scan).toEqual({ status: 'pending', round: 1 })
    const last = state.log[state.log.length - 1]
    expect(last).toMatchObject({ event: 'edit', by: 'user' })
    expect(last.detail).toContain('方案要先确认')
    expect(notified).toHaveLength(1)
    expect(notified[0]?.session).toBe('s1')
    // 按对象算：scan 一处（状态 + 连带的结束时间）、整体一处（状态 + 说明）。
    expect(notified[0]?.summary).toBe('用户修改了 cr 的运行状态（2 处）')
    expect(notified[0]?.text).toContain(
      '- 步骤 scan：status 从 done 改成 pending（要重新执行这一步）；删掉了 finishedAt（原来是 2026-10-02T14:30:00+08:00）',
    )
    expect(notified[0]?.text).toContain(
      '- 整体：status 从 running 改成 waiting（先停下，等用户）；note 写成 先别修',
    )
    expect(notified[0]?.text).toContain('用户的说明：方案要先确认')
  })

  it('模型在用户开始改之后改了同一个字段：整次拒绝、回冲突清单、文件不动', async () => {
    const { id, statePath } = await started()
    const before = await readFile(statePath, 'utf8')
    const outcome = await runs.save(
      id,
      's1',
      [
        { path: ['nodes', 'review', 'status'], from: 'running', to: 'skipped' },
        { path: ['note'], from: null, to: 'x' },
      ],
      undefined,
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error.code).toBe('conflict')
    expect(outcome.error.detail?.conflicts).toEqual([
      { path: ['nodes', 'review', 'status'], from: 'running', disk: 'pending' },
    ])
    expect(await readFile(statePath, 'utf8')).toBe(before)
    expect(notified).toEqual([])
  })

  it('改完不合法就不写；不能改的字段直接拒', async () => {
    const { id } = await started()
    const invalid = await runs.save(
      id,
      's1',
      [{ path: ['nodes', 'review', 'status'], from: 'pending', to: 'done' }],
      undefined,
    )
    expect(!invalid.ok && invalid.error.code).toBe('blocked')
    const locked = await runs.save(id, 's1', [{ path: ['plan'], from: 'x', to: 'y' }], undefined)
    expect(!locked.ok && locked.error.code).toBe('invalid_args')
  })

  it('模型不在运行：通知暂存，模型下次调用工具时附在返回值里，只交一次', async () => {
    const { id } = await started()
    deliver = false
    const outcome = await runs.save(
      id,
      's1',
      [{ path: ['status'], from: 'running', to: 'cancelled' }],
      undefined,
    )
    expect(outcome.ok && outcome.result.notified).toBe(false)
    const index = JSON.parse(await readFile(instancesFile(dataDir), 'utf8'))
    expect(index.instances[0].pendingNotice).toContain('status 从 running 改成 cancelled')
    const next = record(await run({ action: 'list' }, exec('s1')))
    expect(String((next.userNotices as string[])[0])).toContain('用户叫停了这次执行')
    const after = record(await run({ action: 'list' }, exec('s1')))
    expect(after.userNotices).toBeUndefined()
  })
})

describe('看产出文件', () => {
  it('资源里的文件：小文本带正文、Markdown 认得出；还没生成标 missing；越出工作区的路径拒绝', async () => {
    await withNotes()
    const result = await compileWithRuns()
    const id = String(result.instance)
    const loaded = await view(id)
    const fileNode = loaded.document.nodes.find((node) => node.type === 'wfResource')
    if (fileNode === undefined) throw new Error('no resource node')

    const missing = await runs.file(id, { node: fileNode.id, item: 0 })
    expect(missing.ok && missing.result.kind).toBe('missing')

    // 没配产出根目录：落在这个实例自己的 out 下。
    const out = join(workspace, '.workflow-lite', 'runs', id, 'out')
    await mkdir(out, { recursive: true })
    await writeFile(join(out, 'notes.md'), '# 标题\n\n正文')
    const md = await runs.file(id, { node: fileNode.id, item: 0 })
    if (!md.ok) throw new Error(md.error.message)
    expect(md.result.kind).toBe('markdown')
    expect(md.result.text).toContain('# 标题')
    expect(md.result.display).toBe(`.workflow-lite/runs/${id}/out/notes.md`)

    await writeFile(join(workspace, 'big.txt'), 'x'.repeat(300 * 1024))
    const big = await runs.file(id, { path: 'big.txt' })
    expect(big.ok && big.result.kind).toBe('tooLarge')
    expect(big.ok && big.result.text).toBeUndefined()

    await writeFile(join(workspace, 'bin.dat'), Buffer.from([1, 0, 2]))
    const bin = await runs.file(id, { path: 'bin.dat' })
    expect(bin.ok && bin.result.kind).toBe('binary')

    expect((await runs.file(id, { path: '../outside.txt' })).ok).toBe(false)
    expect((await runs.file(id, { path: join(dataDir, 'instances.json') })).ok).toBe(false)
    expect((await runs.file(id, { node: 'nope', item: 0 })).ok).toBe(false)
    expect((await runs.file(id, { node: fileNode.id, item: 5 })).ok).toBe(false)
  })

  it('只被读的资源：相对路径按工作区，绝对路径原样；文件夹按目录查；网址不算路径', async () => {
    await run({
      action: 'write_resource',
      workflow: 'cr',
      node: 'ref',
      resource: {
        items: [
          { kind: 'file', value: 'docs/spec.md' },
          { kind: 'folder', value: join(workspace, 'src').replace(/\\/gu, '/') },
          { kind: 'url', value: 'https://x.dev' },
        ],
      },
    })
    await run({ action: 'connect', workflow: 'cr', source: 'ref', target: 'scan' })
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await mkdir(join(workspace, 'src'), { recursive: true })
    await writeFile(join(workspace, 'docs', 'spec.md'), '规格')
    const result = await compileWithRuns()
    expect(String(result.plan)).toContain('  - 文件：`docs/spec.md`')
    const id = String(result.instance)
    expect((await view(id)).files.ref).toEqual([true, true, null])
    const spec = await runs.file(id, { node: 'ref', item: 0 })
    expect(spec.ok && spec.result.text).toBe('规格')
    expect((await runs.file(id, { node: 'ref', item: 2 })).ok).toBe(false)
  })
})

async function withNotes(): Promise<void> {
  await run({
    action: 'write_resource',
    workflow: 'cr',
    node: 'notes',
    resource: { items: [{ kind: 'file', value: 'notes.md' }] },
  })
  await run({ action: 'connect', workflow: 'cr', source: 'scan', target: 'notes' })
}

describe('产出根目录', () => {
  it('没配：快照定死成 .workflow-lite/runs/<实例>/out，计划、resume、文件存在与否都按它', async () => {
    await withNotes()
    const result = await compileWithRuns()
    const id = String(result.instance)
    const root = `.workflow-lite/runs/${id}/out`
    expect(String(result.plan)).toContain(`\`${root}/notes.md\``)
    expect(String(result.plan)).not.toContain('{instance}')
    const loaded = await view(id)
    expect(loaded.document.settings?.outputRoot).toBe(root)
    expect(loaded.files.notes).toEqual([false])
    await mkdir(join(workspace, root), { recursive: true })
    await writeFile(join(workspace, root, 'notes.md'), 'x')
    expect((await view(id)).files.notes).toEqual([true])
    // 模型报告产出时只写了相对根目录的那段：工作区根下没有，就到根目录下找。
    const reported = await runs.file(id, { path: 'notes.md' })
    expect(reported.ok && reported.result.display).toBe(`${root}/notes.md`)
    expect((await runs.file(id, { path: '../notes.md' })).ok).toBe(false)
    const resumed = await runs.resume(id, { id: 's1', cwd: workspace })
    if (!resumed.ok) throw new Error(resumed.error.message)
    expect(resumed.result.plan).toContain(`\`${root}/notes.md\``)
    expect(resumed.result.planId).toBe(String(result.planId))
  })

  it('{instance} 可以写在自定义根目录里；. = 工作区根', async () => {
    await withNotes()
    await run({ action: 'configure', workflow: 'cr', output_root: 'out/{instance}' })
    const custom = await compileWithRuns()
    expect(String(custom.plan)).toContain(`\`out/${String(custom.instance)}/notes.md\``)
    await run({ action: 'configure', workflow: 'cr', output_root: '.' })
    const plain = await compileWithRuns('s2')
    expect(String(plain.plan)).toContain('`notes.md`')
    expect((await view(String(plain.instance), 's2')).document.settings?.outputRoot).toBe('.')
  })

  it('不记运行状态的编译也建实例：{instance} 换成实例 id；整卷版（给人看）原样留着记号', async () => {
    await withNotes()
    const compiled = record(await run({ action: 'compile', workflow: 'cr' }, exec('s1')))
    expect(String(compiled.plan)).toContain(
      `\`.workflow-lite/runs/${String(compiled.instance)}/out/notes.md\``,
    )
    const full = record(await run({ action: 'compile', workflow: 'cr', full: true }, exec('s1')))
    expect(String(full.plan)).toContain('.workflow-lite/runs/{instance}/out/notes.md')
  })

  it('早先建的实例（快照里没有根目录）照旧按工作区根', async () => {
    await withNotes()
    const result = await compileWithRuns()
    const id = String(result.instance)
    const graph = join(dataDir, 'runs', id, 'graph.json')
    const snapshot = JSON.parse(await readFile(graph, 'utf8'))
    delete snapshot.settings.outputRoot
    await writeFile(graph, JSON.stringify(snapshot))
    await writeFile(join(workspace, 'notes.md'), '旧的')
    const old = await runs.file(id, { node: 'notes', item: 0 })
    expect(old.ok && old.result.display).toBe('notes.md')
    expect(old.ok && old.result.exists).toBe(true)
  })
})

describe('模型用 state 记进度', () => {
  function errorOf(value: unknown): Record<string, unknown> | undefined {
    const error = record(value).error
    return error === undefined ? undefined : record(error)
  }

  it('不带改动 = 看；改步骤状态时插件补轮次、时间与流水，整体状态也记一条', async () => {
    const compiled = await compileWithRuns()
    const id = String(compiled.instance)
    const looked = record(await run({ action: 'state', instance: id }, exec('s1')))
    expect(looked.status).toBe('pending')
    expect(looked.applied).toBeUndefined()

    const started = record(
      await run(
        {
          action: 'state',
          status: 'running',
          nodes: [{ id: 'scan', status: 'running', by: 'subagent' }],
        },
        exec('s1'),
      ),
    )
    expect(errorOf(started)).toBeUndefined()
    expect(started.instance).toBe(id)
    const scan = record(record(started.nodes).scan)
    expect(scan.status).toBe('running')
    expect(scan.round).toBe(1)
    expect(typeof scan.startedAt).toBe('string')
    expect(scan.by).toBe('subagent')

    const state = parse(await readFile(String(compiled.statePath), 'utf8'))
    expect(state.status).toBe('running')
    expect(
      state.log.map((entry: { event: string; node?: string }) => [entry.event, entry.node]),
    ).toEqual([
      ['start', undefined],
      ['start', 'scan'],
    ])
    expect(
      (await readFile(String(compiled.statePath), 'utf8')).startsWith('# workflow-lite 运行状态'),
    ).toBe(true)
  })

  it('改完不合法就整次拒绝、文件不动：有条件出边的步骤 done 要带 verdict', async () => {
    const compiled = await compileWithRuns()
    const id = String(compiled.instance)
    await run(
      { action: 'state', instance: id, nodes: [{ id: 'review', status: 'running' }] },
      exec('s1'),
    )
    const before = await readFile(String(compiled.statePath), 'utf8')
    const rejected = errorOf(
      await run(
        {
          action: 'state',
          instance: id,
          nodes: [{ id: 'review', status: 'done', summary: '看完了' }],
        },
        exec('s1'),
      ),
    )
    expect(rejected?.code).toBe('invalid_args')
    expect(JSON.stringify(rejected?.detail)).toContain('nodes.review.verdict')
    expect(JSON.stringify(rejected?.detail)).toContain('pass')
    expect(await readFile(String(compiled.statePath), 'utf8')).toBe(before)

    const done = record(
      await run(
        {
          action: 'state',
          instance: id,
          nodes: [
            { id: 'review', status: 'done', verdict: 'fail', summary: '2 处问题' },
            { id: 'fix', status: 'running' },
          ],
        },
        exec('s1'),
      ),
    )
    expect(errorOf(done)).toBeUndefined()
    const state = parse(await readFile(String(compiled.statePath), 'utf8'))
    expect(state.nodes.review).toMatchObject({ status: 'done', verdict: 'fail', round: 1 })
    expect(typeof state.nodes.review.finishedAt).toBe('string')
    expect(state.log.at(-2)).toMatchObject({ node: 'review', event: 'done', verdict: 'fail' })
    expect(state.log.at(-1)).toMatchObject({ node: 'fix', event: 'start', round: 1 })
  })

  it('步骤 id 不对、状态值不认识：说清楚哪里不对', async () => {
    const compiled = await compileWithRuns()
    const id = String(compiled.instance)
    const wrongCase = errorOf(
      await run(
        { action: 'state', instance: id, nodes: [{ id: 'Scan', status: 'running' }] },
        exec('s1'),
      ),
    )
    expect(String(wrongCase?.message)).toContain('scan')
    const badStatus = errorOf(
      await run({ action: 'state', instance: id, status: 'finished' }, exec('s1')),
    )
    expect(String(badStatus?.message)).toContain('cancelled')
  })

  it('不记状态的实例：只看会说明；带上改动就新建状态再改', async () => {
    const compiled = record(await run({ action: 'compile', workflow: 'cr' }, exec('s1')))
    const id = String(compiled.instance)
    expect(errorOf(await run({ action: 'state', instance: id }, exec('s1')))?.code).toBe(
      'not_found',
    )
    const created = record(
      await run({ action: 'state', instance: id, status: 'running' }, exec('s1')),
    )
    expect(created.created).toBe(true)
    const statePath = await statePathOf(id)
    expect(statePath).toBe(join(workspace, '.workflow-lite', 'runs', id, 'state.yaml'))
    const state = parse(await readFile(String(statePath), 'utf8'))
    expect(state.status).toBe('running')
    expect(Object.keys(state.nodes)).toEqual(['scan', 'review', 'fix', 'report'])
  })

  it('同时来的几次改动排队写，一个都不丢', async () => {
    const compiled = await compileWithRuns()
    const id = String(compiled.instance)
    await Promise.all(
      ['scan', 'review', 'fix', 'report'].map((step) =>
        run(
          { action: 'state', instance: id, nodes: [{ id: step, status: 'running' }] },
          exec('s1'),
        ),
      ),
    )
    const state = parse(await readFile(String(compiled.statePath), 'utf8'))
    for (const step of ['scan', 'review', 'fix', 'report']) {
      expect(state.nodes[step].status).toBe('running')
    }
    expect(state.log).toHaveLength(4)
  })
})

describe('归属与恢复', () => {
  it('一个实例只属于一个会话：绑到别的会话 = 转过去，原会话的当前实例清掉，流水记 transfer', async () => {
    const result = await compileWithRuns('s1')
    const id = String(result.instance)
    const outcome = await runs.bind(id, 's2')
    expect(outcome.ok && outcome.result.transferred).toBe(true)
    expect(await runs.list('s1', false)).toEqual([])
    expect((await runs.list('s2', false))[0]).toMatchObject({ id, current: true, session: 's2' })
    expect(await runs.currentOf('s1')).toBeUndefined()
    const state = parse(await readFile(String(result.statePath), 'utf8'))
    expect(state.log.at(-1)).toMatchObject({ event: 'transfer' })
  })

  it('resume：缺省接本会话当前实例，重建同一个 planId 的计划，给出进度与被打断的步骤', async () => {
    const result = await compileWithRuns('s1')
    const statePath = String(result.statePath)
    const text = await readFile(statePath, 'utf8')
    await writeFile(
      statePath,
      text
        .replace('status: pending\n', 'status: running\n')
        .replace(
          '  scan:\n    status: pending\n',
          '  scan:\n    status: running\n    round: 1\n    startedAt: 2026-10-02T14:30:00+08:00\n',
        ),
    )
    // 改了模板也不影响实例：它用的是快照。
    await run({
      action: 'write_node',
      workflow: 'cr',
      node: 'extra',
      content: 'x',
      no_output: true,
    })
    const resumed = record(await run({ action: 'resume' }, exec('s1')))
    expect(resumed.instance).toBe(result.instance)
    expect(resumed.planId).toBe(result.planId)
    expect(String(resumed.plan)).toContain('## 运行状态')
    expect(String(resumed.plan)).not.toContain('extra')
    expect(resumed.progress).toMatchObject({
      status: 'running',
      done: 0,
      total: 4,
      interrupted: ['scan'],
      next: 'scan',
    })
    expect(parse(await readFile(statePath, 'utf8')).log.at(-1)).toMatchObject({ event: 'resume' })
  })

  it('没有当前实例时 resume 报 not_found；runs 列本会话的', async () => {
    expect(record(record(await run({ action: 'resume' }, exec('s9'))).error).code).toBe('not_found')
    await compileWithRuns('s1')
    const listed = record(await run({ action: 'runs' }, exec('s1')))
    expect((listed.instances as unknown[]).length).toBe(1)
    const other = record(await run({ action: 'runs' }, exec('s2')))
    expect((other.instances as unknown[]).length).toBe(0)
    const all = record(await run({ action: 'runs', all: true }, exec('s2')))
    expect((all.instances as unknown[]).length).toBe(1)
  })

  it('删除：记录与快照没了，状态文件按需删', async () => {
    const result = await compileWithRuns('s1')
    const id = String(result.instance)
    expect((await runs.remove(id, false)).ok).toBe(true)
    expect(await runs.list(undefined, true)).toEqual([])
    expect(await readFile(String(result.statePath), 'utf8')).toContain('instance')
    expect((await runs.view(id, 's1')).ok).toBe(false)
  })
})

describe('用户输入', () => {
  beforeEach(async () => {
    await run({
      action: 'write_node',
      workflow: 'cr',
      node: 'focus',
      input: { question: '重点看哪里？', required: true },
    })
    await run({
      action: 'write_node',
      workflow: 'cr',
      node: 'depth',
      input: { question: '审多细？', kind: 'choice', options: ['粗看', '细看'], default: '粗看' },
    })
    await run({ action: 'connect', workflow: 'cr', source: 'focus', target: 'review' })
  })

  async function startWith(
    answers: unknown,
  ): Promise<{ ok: boolean; id?: string; error?: string }> {
    const load = await repository.load('cr')
    if (load.document === null) throw new Error('load failed')
    const outcome = await runs.start({
      workflow: 'cr',
      document: load.document,
      problems: load.problems,
      session: { id: 's1', cwd: workspace },
      answers,
    })
    return outcome.ok
      ? { ok: true, id: outcome.result.instance.id }
      : { ok: false, error: outcome.error.code }
  }

  it('画布上执行：回答随实例存下，resume 拿到的计划里有问题与回答，画布读得到回答', async () => {
    const started = await startWith({ focus: '并发与锁' })
    expect(started.ok).toBe(true)
    const id = String(started.id)
    const saved = JSON.parse(await readFile(join(dataDir, 'runs', id, 'inputs.json'), 'utf8'))
    expect(saved).toEqual({ focus: '并发与锁', depth: '粗看' })
    const resumed = record(await run({ action: 'resume', instance: id }, exec('s1')))
    expect(String(resumed.plan)).toContain('- 问：重点看哪里？（交给 `review`）\n  答：并发与锁')
    expect(String(resumed.plan)).toContain('- 问：审多细？（交给所有步骤）\n  答：粗看')
    expect((await view(id)).answers).toEqual({ focus: '并发与锁', depth: '粗看' })
  })

  it('必填没填：不建实例；选了不在选项里的：invalid_args', async () => {
    expect(await startWith({})).toEqual({ ok: false, error: 'blocked' })
    expect(await startWith({ focus: 'x', depth: '随便' })).toEqual({
      ok: false,
      error: 'invalid_args',
    })
    expect(await runs.list(undefined, true)).toEqual([])
  })

  it('工具编译：没给回答回 problems（不建实例）；给了建实例；回答不同不复用', async () => {
    await run({ action: 'configure', workflow: 'cr', run_state: true })
    const blocked = record(await run({ action: 'compile', workflow: 'cr' }, exec('s1')))
    expect(blocked.plan).toBe('')
    expect((blocked.problems as JsonValue[]).map((p) => record(p).code)).toEqual(['input_missing'])
    expect(await runs.list(undefined, true)).toEqual([])

    const first = record(
      await run(
        { action: 'compile', workflow: 'cr', answers: [{ id: 'focus', value: 'A' }] },
        exec('s1'),
      ),
    )
    const again = record(
      await run(
        { action: 'compile', workflow: 'cr', answers: [{ id: 'focus', value: 'A' }] },
        exec('s1'),
      ),
    )
    const other = record(
      await run(
        { action: 'compile', workflow: 'cr', answers: [{ id: 'focus', value: 'B' }] },
        exec('s1'),
      ),
    )
    expect(again.instance).toBe(first.instance)
    expect(other.instance).not.toBe(first.instance)
    expect(String(other.plan)).toContain('答：B')
  })
})
