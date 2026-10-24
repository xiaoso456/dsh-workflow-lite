/**
 * 记忆库（`src/host/store/memories.ts`、`memoryVersions.ts`）：建、列、改、删，谁在用，看文件，版本。
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createMemory,
  deleteMemory,
  freeMemoryId,
  listMemories,
  type MemoryDeps,
  memoryDir,
  memoryFile,
  readMemoryMeta,
  updateMemory,
} from '../../../src/host/store/memories.ts'
import {
  deleteMemoryVersion,
  listMemoryVersions,
  noteMemoryVersion,
  restoreMemoryVersion,
  saveMemoryVersion,
} from '../../../src/host/store/memoryVersions.ts'
import { memoryFolder, memoryMetaFile, memoryVersionsDir } from '../../../src/host/store/paths.ts'
import { createRepository, type Outcome } from '../../../src/host/store/repository.ts'
import { addGlobalMemory, addStepMemory } from '../../../src/shared/presets.ts'
import { NODE_TYPE, type WorkflowDocument } from '../../../src/shared/types.ts'

let dataDir = ''
let deps: MemoryDeps

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'wf-mem-'))
  deps = { dataDir, repository: createRepository({ dataDir }), now: () => 1000 }
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

function ok<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`)
  return outcome.result
}

function failed<T>(outcome: Outcome<T>): { code: string; message: string } {
  if (outcome.ok) throw new Error('expected failure')
  return outcome.error
}

/** 一个开着步骤记忆 `step-id`、带工作流记忆 `flow-id` 的工作流。 */
async function workflowUsing(name: string, step: string, flow: string): Promise<void> {
  const repository = deps.repository as ReturnType<typeof createRepository>
  ok(await repository.create(name))
  let document: WorkflowDocument = {
    nodes: [{ id: 'a', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: 'p' } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  const added = addStepMemory(document, 'a', { memory: step, type: 'step' }, { x: 0, y: 0 })
  if (added === null) throw new Error('没开成')
  document = addGlobalMemory(
    added.document,
    { memory: flow, type: 'workflow' },
    { x: 0, y: 0 },
  ).document
  ok(await repository.save(name, document, { baseHash: null }))
}

async function put(id: string, path: string, text: string): Promise<void> {
  const full = join(memoryFolder(dataDir, id), path)
  await mkdir(join(full, '..'), { recursive: true })
  await writeFile(full, text)
}

describe('建、列、改、删', () => {
  it('建：元数据一个 json、旁边一个空文件夹；名称缺省是 id；id 撞了加序号', async () => {
    const first = ok(await createMemory(deps, { type: 'workflow', id: 'demo' }))
    expect(first).toMatchObject({
      id: 'demo',
      type: 'workflow',
      name: 'demo',
      description: '',
      createdAt: 1000,
      usedBy: [],
      files: 0,
      versions: 0,
    })
    expect(JSON.parse(await readFile(memoryMetaFile(dataDir, 'demo'), 'utf8'))).toMatchObject({
      format: 1,
      id: 'demo',
      type: 'workflow',
    })
    expect(await readdir(memoryFolder(dataDir, 'demo'))).toEqual([])
    const second = ok(await createMemory(deps, { type: 'step', id: 'Demo', name: '审查' }))
    expect(second).toMatchObject({ id: 'Demo-2', type: 'step', name: '审查' })
    expect(await freeMemoryId(dataDir, 'demo')).toBe('demo-3')
  })

  it('建：类型、id 不合规矩报 invalid_args', async () => {
    expect(failed(await createMemory(deps, { type: 'other' as 'step' })).code).toBe('invalid_args')
    expect(failed(await createMemory(deps, { type: 'step', id: '../x' })).code).toBe('invalid_args')
  })

  it('列：谁在用（按工作流现在存的那份）、几个文件多大；坏的元数据标出来', async () => {
    ok(await createMemory(deps, { type: 'step', id: 'w-a' }))
    ok(await createMemory(deps, { type: 'workflow', id: 'w' }))
    await put('w-a', 'SKILL.md', 'abcd')
    await put('w-a', 'scripts/run.sh', 'ok')
    await workflowUsing('w', 'w-a', 'w')
    await workflowUsing('v', 'w-a', 'other')
    await mkdir(memoryFolder(dataDir, 'broken'), { recursive: true })
    await writeFile(memoryMetaFile(dataDir, 'broken'), '{oops')
    const list = await listMemories(deps)
    const byId = new Map(list.map((entry) => [entry.id, entry]))
    expect(byId.get('w-a')).toMatchObject({ usedBy: ['v', 'w'], files: 2, bytes: 6 })
    expect(byId.get('w')).toMatchObject({ usedBy: ['w'], files: 0 })
    expect(byId.get('broken')?.invalid).toBe(true)
    expect(await readMemoryMeta(dataDir, 'broken')).toBe('invalid')
  })

  it('改名称、描述；太长的拒绝；不存在的 not_found', async () => {
    ok(await createMemory(deps, { type: 'step', id: 'm' }))
    expect(
      ok(await updateMemory(deps, { id: 'm', name: '审查', description: '只记坑' })),
    ).toMatchObject({ name: '审查', description: '只记坑' })
    expect(failed(await updateMemory(deps, { id: 'm', name: 'x'.repeat(81) })).code).toBe(
      'invalid_args',
    )
    expect(failed(await updateMemory(deps, { id: 'nope', name: 'x' })).code).toBe('not_found')
  })

  it('删：元数据、文件夹、版本一起删', async () => {
    ok(await createMemory(deps, { type: 'step', id: 'm' }))
    await put('m', 'SKILL.md', 'a')
    ok(await saveMemoryVersion(dataDir, 'm', ''))
    ok(await deleteMemory(deps, 'm'))
    expect(await readMemoryMeta(dataDir, 'm')).toBeNull()
    expect(await readdir(join(dataDir, 'memories'))).toEqual([])
    await expect(readdir(memoryVersionsDir(dataDir, 'm'))).rejects.toThrow()
    expect(failed(await deleteMemory(deps, 'm')).code).toBe('not_found')
  })
})

describe('看文件', () => {
  it('当前文件夹、某个版本的拷贝；出不了文件夹', async () => {
    ok(await createMemory(deps, { type: 'step', id: 'm' }))
    await put('m', 'SKILL.md', '第一版')
    ok(await saveMemoryVersion(dataDir, 'm', ''))
    await put('m', 'SKILL.md', '第二版')
    const dir = ok(await memoryDir(dataDir, { id: 'm' }))
    expect(dir.entries.map((entry) => entry.name)).toEqual(['SKILL.md'])
    const now = ok(await memoryFile(dataDir, { id: 'm', sub: 'SKILL.md' }))
    expect(now).toMatchObject({ kind: 'markdown', text: '第二版' })
    const old = ok(await memoryFile(dataDir, { id: 'm', version: 1, sub: 'SKILL.md' }))
    expect(old).toMatchObject({ kind: 'markdown', text: '第一版', display: 'm · v1/SKILL.md' })
    expect(failed(await memoryFile(dataDir, { id: 'm', sub: '../m.json' })).code).toBe(
      'invalid_args',
    )
    expect(failed(await memoryDir(dataDir, { id: 'nope' })).code).toBe('not_found')
  })
})

describe('版本', () => {
  it('存：整个文件夹拷一份；内容一样不再存（skipSame 回 null）；当前的那版标出来', async () => {
    ok(await createMemory(deps, { type: 'step', id: 'm' }))
    await put('m', 'SKILL.md', 'a')
    await put('m', 'scripts/x.sh', 'b')
    const v1 = ok(await saveMemoryVersion(dataDir, 'm', '第一版', { now: () => 5 }))
    expect(v1).toMatchObject({ n: 1, note: '第一版', files: 2, bytes: 2, current: true })
    const same = failed(await saveMemoryVersion(dataDir, 'm', ''))
    expect(same.code).toBe('invalid_args')
    expect(ok(await saveMemoryVersion(dataDir, 'm', '', { skipSame: true }))).toBeNull()
    expect(
      await readFile(join(memoryVersionsDir(dataDir, 'm'), '1', 'scripts', 'x.sh'), 'utf8'),
    ).toBe('b')
    await put('m', 'SKILL.md', 'changed')
    const list = ok(await listMemoryVersions(dataDir, 'm'))
    expect(list.map((entry) => [entry.n, entry.current])).toEqual([[1, false]])
  })

  it('切回：先把现在的自动存一份（内容一样就不存），整个文件夹换成那一版', async () => {
    ok(await createMemory(deps, { type: 'step', id: 'm' }))
    await put('m', 'SKILL.md', 'a')
    ok(await saveMemoryVersion(dataDir, 'm', ''))
    await put('m', 'SKILL.md', 'b')
    await put('m', 'extra.md', 'x')
    const restored = ok(await restoreMemoryVersion(dataDir, 'm', 1))
    expect(restored.saved).toMatchObject({ n: 2, autoBefore: 1 })
    expect(await readdir(memoryFolder(dataDir, 'm'))).toEqual(['SKILL.md'])
    expect(await readFile(join(memoryFolder(dataDir, 'm'), 'SKILL.md'), 'utf8')).toBe('a')
    // 现在就是 v1：再切一次不另存。
    expect(ok(await restoreMemoryVersion(dataDir, 'm', 2)).saved).toBeNull()
    expect(await readFile(join(memoryFolder(dataDir, 'm'), 'extra.md'), 'utf8')).toBe('x')
    // 记忆库目录里没留下换文件夹时的临时目录。
    expect((await readdir(join(dataDir, 'memories'))).sort()).toEqual(['m', 'm.json'])
    expect(failed(await restoreMemoryVersion(dataDir, 'm', 9)).code).toBe('not_found')
  })

  it('改说明、删一版', async () => {
    ok(await createMemory(deps, { type: 'step', id: 'm' }))
    await put('m', 'SKILL.md', 'a')
    ok(await saveMemoryVersion(dataDir, 'm', ''))
    expect(ok(await noteMemoryVersion(dataDir, 'm', 1, '好的那版')).note).toBe('好的那版')
    expect(failed(await noteMemoryVersion(dataDir, 'm', 1, 'x'.repeat(501))).code).toBe(
      'invalid_args',
    )
    ok(await deleteMemoryVersion(dataDir, 'm', 1))
    expect(ok(await listMemoryVersions(dataDir, 'm'))).toEqual([])
    expect(failed(await deleteMemoryVersion(dataDir, 'm', 1)).code).toBe('not_found')
  })
})
