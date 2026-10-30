/**
 * 产出的各版：写它的步骤一轮做完存一版、更新前先存原样、判定记在最近一版上；读某一版、上限与清理。
 */

import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  historyDir,
  historyPlan,
  trimToBudget,
  verdictLoopsBack,
} from '../../src/host/runs/history.ts'
import { RunService } from '../../src/host/runs/service.ts'
import { storageAction } from '../../src/host/runs/storage.ts'
import { createRepository, type Repository } from '../../src/host/store/repository.ts'
import {
  createWorkflowLiteHandler,
  type ToolExecView,
  type WorkflowLiteArgs,
} from '../../src/host/tool/tool.ts'
import { RUN_HISTORY_VERSIONS_MAX } from '../../src/shared/wire.ts'

let dataDir: string
let workspace: string
let repository: Repository
let runs: RunService
let run: (args: WorkflowLiteArgs, exec?: ToolExecView) => Promise<JsonValue>

const exec = (): ToolExecView => ({ agent: { session: { header: { id: 's1', cwd: workspace } } } })

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'workflow-lite-history-'))
  workspace = join(dataDir, 'ws')
  await mkdir(workspace)
  repository = createRepository({ dataDir })
  await repository.ensureLayout()
  runs = new RunService({ dataDir: () => dataDir })
  run = createWorkflowLiteHandler({
    repository,
    dataDir: () => dataDir,
    maxResultBytes: () => 262_144,
    runs,
  })
  // draft 写 notes.md → review 读它：pass 去 report、fail 去 fix，fix 在原文件上改完回 review。
  await run({ action: 'create', workflow: 'loop' })
  for (const id of ['draft', 'review', 'fix', 'report']) {
    await run({
      action: 'write_node',
      workflow: 'loop',
      node: id,
      content: `做 ${id}`,
      no_output: true,
    })
  }
  await run({
    action: 'write_resource',
    workflow: 'loop',
    node: 'notes',
    resource: { items: [{ kind: 'file', value: 'notes.md' }] },
  })
  await run({ action: 'connect', workflow: 'loop', source: 'draft', target: 'review' })
  await run({
    action: 'connect',
    workflow: 'loop',
    source: 'review',
    target: 'report',
    when: 'pass',
  })
  await run({ action: 'connect', workflow: 'loop', source: 'review', target: 'fix', when: 'fail' })
  await run({ action: 'connect', workflow: 'loop', source: 'fix', target: 'review' })
  await run({ action: 'connect', workflow: 'loop', source: 'draft', target: 'notes' })
  await run({ action: 'connect', workflow: 'loop', source: 'fix', target: 'notes', update: true })
  await run({ action: 'connect', workflow: 'loop', source: 'notes', target: 'review' })
  await run({ action: 'configure', workflow: 'loop', run_state: true })
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

async function compile(): Promise<{ id: string; out: string }> {
  const result = record(await run({ action: 'compile', workflow: 'loop', goal: '写' }, exec()))
  const id = String(result.instance)
  const out = join(workspace, '.workflow-lite', 'runs', id, 'out')
  await mkdir(out, { recursive: true })
  return { id, out }
}

async function step(id: string, node: string, status: string, verdict?: string): Promise<void> {
  const result = record(
    await run(
      {
        action: 'state',
        instance: id,
        nodes: [{ id: node, status, ...(verdict === undefined ? {} : { verdict }) }],
      },
      exec(),
    ),
  )
  if (result.error !== undefined) throw new Error(JSON.stringify(result.error))
}

async function versions(id: string) {
  const listed = await runs.versions(id, 'notes', 0)
  if (!listed.ok) throw new Error(listed.error.message)
  return listed.result
}

async function text(id: string, version?: number): Promise<string | undefined> {
  const read = await runs.file(id, {
    node: 'notes',
    item: 0,
    ...(version === undefined ? {} : { version }),
  })
  if (!read.ok) throw new Error(read.error.message)
  return read.result.text
}

describe('存下每一轮的产出', () => {
  it('一轮做完存一版，判定记在它上面；在原文件上改之前已经有版本就不另存原样；读得出每一版', async () => {
    const { id, out } = await compile()
    await step(id, 'draft', 'running')
    expect((await versions(id)).versions).toEqual([])
    await writeFile(join(out, 'notes.md'), '第一稿')
    await step(id, 'draft', 'done')
    await step(id, 'review', 'running')
    await step(id, 'review', 'done', 'fail')

    await step(id, 'fix', 'running')
    await writeFile(join(out, 'notes.md'), '第二稿')
    await step(id, 'fix', 'done')
    await step(id, 'review', 'running')
    await step(id, 'review', 'done', 'pass')

    const { versions: list, dropped } = await versions(id)
    expect(dropped).toBe(0)
    expect(list.map(({ v, step: by, round, phase }) => [v, by, round, phase])).toEqual([
      [1, 'draft', 1, 'done'],
      [2, 'fix', 1, 'done'],
    ])
    // 未通过把流程领回 fix → review，算「重做」；通过往下走，不算。
    expect(list[0]?.verdicts).toEqual([{ step: 'review', value: 'fail', again: true }])
    expect(list[1]?.verdicts).toEqual([{ step: 'review', value: 'pass', again: false }])
    expect(list[0]?.size).toBe(Buffer.byteLength('第一稿'))

    expect(await text(id, 1)).toBe('第一稿')
    expect(await text(id, 2)).toBe('第二稿')
    expect(await text(id)).toBe('第二稿')
    const old = await runs.file(id, { node: 'notes', item: 0, version: 1 })
    // 旧版的路径、显示名还是原文件的（复制路径、标题都按原文件）。
    expect(old.ok && old.result.display).toBe(`.workflow-lite/runs/${id}/out/notes.md`)
    expect(old.ok && old.result.mtime).toBe(list[0]?.mtime)
    expect((await runs.file(id, { node: 'notes', item: 0, version: 9 })).ok).toBe(false)

    const stat = await runs.stat(id, [{ node: 'notes', item: 0 }])
    expect(stat.ok && stat.result.stats[0]?.versions).toBe(2)
    // 两版 + 两条判定：变了四次。
    expect(stat.ok && stat.result.stats[0]?.revision).toBe(4)
    // 现在的文件就是第 2 版：修改时间、大小对得上。
    expect(stat.ok && stat.result.stats[0]?.mtime).toBe(list[1]?.mtime)
  })

  it('一轮没改文件不另存；文件开始前就在、还没存过：先存一份原样', async () => {
    const { id, out } = await compile()
    await writeFile(join(out, 'notes.md'), '上回留下的')
    await step(id, 'draft', 'running')
    await writeFile(join(out, 'notes.md'), '新写的')
    await step(id, 'draft', 'done')
    await step(id, 'fix', 'running')
    await step(id, 'fix', 'done')
    const { versions: list } = await versions(id)
    expect(list.map(({ step: by, phase }) => [by, phase])).toEqual([
      ['draft', 'before'],
      ['draft', 'done'],
    ])
    expect(await text(id, 1)).toBe('上回留下的')
  })

  it('失败的一轮也存；用户在画布上标完成也存', async () => {
    const { id, out } = await compile()
    await step(id, 'draft', 'running')
    await writeFile(join(out, 'notes.md'), '写了一半')
    await step(id, 'draft', 'failed')
    await step(id, 'draft', 'running')
    await writeFile(join(out, 'notes.md'), '写完了')
    // 画布上改状态：带上插件补的那几个字段（和 `model/runDraft.ts` 一样）。
    const edits = [
      { path: ['nodes', 'draft', 'status'], from: 'running', to: 'done' },
      { path: ['nodes', 'draft', 'finishedAt'], from: null, to: new Date().toISOString() },
    ]
    const saved = await runs.save(id, 's1', edits, undefined, undefined, { notify: false })
    if (!saved.ok) throw new Error(saved.error.message)
    const { versions: list } = await versions(id)
    expect(list.map(({ round, phase }) => [round, phase])).toEqual([
      [1, 'failed'],
      [2, 'done'],
    ])
  })

  it('超了版数删中间的，第一版留着；删实例连各版一起删；存储页能清', async () => {
    const { id, out } = await compile()
    const total = RUN_HISTORY_VERSIONS_MAX + 3
    for (let n = 1; n <= total; n += 1) {
      await step(id, 'draft', 'running')
      await writeFile(join(out, 'notes.md'), `第 ${n} 稿`)
      await step(id, 'draft', 'done')
    }
    const { versions: list, dropped } = await versions(id)
    expect(list).toHaveLength(RUN_HISTORY_VERSIONS_MAX)
    expect(dropped).toBe(3)
    expect(list[0]?.v).toBe(1)
    expect(list.at(-1)?.v).toBe(total)
    // 删掉的版本，内容也删了（一版一份，加一个索引）。
    expect(await readdir(historyDir(dataDir, id))).toHaveLength(RUN_HISTORY_VERSIONS_MAX + 1)

    const stats = await storageAction(runs, dataDir, 'stats')
    expect(stats.historyBytes).toBeGreaterThan(0)
    const cleared = await storageAction(runs, dataDir, 'clearHistory')
    expect(cleared.cleared).toBe(RUN_HISTORY_VERSIONS_MAX + 1)
    expect(cleared.historyBytes).toBe(0)
    expect((await versions(id)).versions).toEqual([])
    expect(await text(id)).toBe(`第 ${total} 稿`)

    await step(id, 'draft', 'running')
    await step(id, 'draft', 'done')
    expect((await versions(id)).versions).toHaveLength(1)
    await runs.remove(id, false)
    await expect(readdir(historyDir(dataDir, id))).rejects.toThrow()
  })
})

describe('要存什么（只看图和状态）', () => {
  it('开始：写它的步骤的文件（还没存过才存）；做完：存，并把判定记给读的文件', async () => {
    const { id } = await compile()
    const loaded = await runs.view(id, 's1')
    if (!loaded.ok || 'unchanged' in loaded.result) throw new Error('view failed')
    const doc = loaded.result.document
    expect(
      historyPlan(doc, { fix: { status: 'pending' } }, { fix: { status: 'running', round: 2 } }),
    ).toEqual({
      captures: [{ node: 'notes', item: 0, step: 'fix', round: 2, phase: 'before', ifEmpty: true }],
      verdicts: [],
    })
    expect(
      historyPlan(
        doc,
        { review: { status: 'running', round: 1 } },
        { review: { status: 'done', round: 1, verdict: 'fail' } },
      ),
    ).toEqual({
      captures: [],
      verdicts: [{ node: 'notes', item: 0, step: 'review', value: 'fail', again: true }],
    })
    // 状态没变：什么也不做。
    expect(historyPlan(doc, { draft: { status: 'done' } }, { draft: { status: 'done' } })).toEqual({
      captures: [],
      verdicts: [],
    })
    expect(verdictLoopsBack(doc, 'review', 'pass')).toBe(false)
    expect(verdictLoopsBack(doc, 'review', 'fail')).toBe(true)
    expect(verdictLoopsBack(doc, 'review', 'other')).toBe(false)
  })

  it('整个实例超了上限：从版数最多的那份删中间的，每份的第一版和最近一版都留着', () => {
    const entry = (v: number, hash: string) => ({
      v,
      step: 's',
      round: v,
      phase: 'done' as const,
      at: 0,
      size: 10,
      mtime: 0,
      hash,
      ext: '',
    })
    const index = {
      files: {
        a: { next: 5, rev: 4, dropped: 0, entries: [1, 2, 3, 4].map((v) => entry(v, `a${v}`)) },
        b: { next: 3, rev: 2, dropped: 0, entries: [1, 2].map((v) => entry(v, `b${v}`)) },
      },
    }
    trimToBudget(index, 40)
    expect(index.files.a.entries.map((e) => e.v)).toEqual([1, 4])
    expect(index.files.a.dropped).toBe(2)
    expect(index.files.b.entries).toHaveLength(2)
  })
})
