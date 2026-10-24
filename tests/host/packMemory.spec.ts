/**
 * 记忆跟着导出导入走（`src/host/pack/*`）：工作流包带记忆的名称、描述和内容，导入时建、用本机的、另存一份；
 * 导出成 skill 时记忆放进 skill 的 `memory/<id>/`。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SkillViewer } from '../../src/host/hostFs.ts'
import { exportPack, type PackDeps, scanPack } from '../../src/host/pack/exporter.ts'
import { applyPack, inspectPack, openPack } from '../../src/host/pack/importer.ts'
import { exportSkill, previewSkill } from '../../src/host/pack/skillExporter.ts'
import { appendChunk, readChunk } from '../../src/host/pack/staging.ts'
import { compileWorkflow } from '../../src/host/plan.ts'
import { createMemory, readMemoryMeta, updateMemory } from '../../src/host/store/memories.ts'
import { memoriesDir, memoryFolder } from '../../src/host/store/paths.ts'
import { createRepository, type Outcome, type Repository } from '../../src/host/store/repository.ts'
import { PACK_CHUNK_BYTES } from '../../src/shared/pack.ts'
import { addGlobalMemory, addStepMemory, memoryRefs } from '../../src/shared/presets.ts'
import { NODE_TYPE, type WorkflowDocument } from '../../src/shared/types.ts'
import { validateDocument } from '../../src/shared/validate.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-packmem-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function ok<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`)
  return outcome.result
}

const slash = (path: string): string => path.replace(/\\/gu, '/')

const noSkills: SkillViewer = async () => ({
  skills: { list: async () => [], get: async () => undefined },
})

interface Side {
  dataDir: string
  repository: Repository
  deps: PackDeps
}

async function side(label: string): Promise<Side> {
  const dataDir = join(root, label, 'data')
  await mkdir(dataDir, { recursive: true })
  const repository = createRepository({ dataDir })
  return {
    dataDir,
    repository,
    deps: {
      dataDir,
      repository,
      skills: noSkills,
      skillsRoot: join(root, label, 'home', '.agents', 'skills'),
      plugin: '9.9.9',
      now: () => Date.UTC(2026, 9, 23),
      validate: (doc, workflow) => {
        const report = validateDocument(doc, { workflowName: workflow, maxNodes: 200 })
        return [...report.save, ...report.compile, ...report.warning, ...report.hint]
      },
    },
  }
}

/** `review` 一步开着步骤记忆 `review-write`，再加一张工作流记忆 `review`；存成 v1。 */
async function sourceSide(): Promise<Side> {
  const from = await side('from')
  const memory = { dataDir: from.dataDir, repository: from.repository }
  ok(await createMemory(memory, { type: 'step', id: 'review-write', name: '写报告的做法' }))
  ok(await createMemory(memory, { type: 'workflow', id: 'review', description: '项目约定' }))
  await mkdir(join(memoryFolder(from.dataDir, 'review-write'), 'scripts'), { recursive: true })
  await writeFile(join(memoryFolder(from.dataDir, 'review-write'), 'SKILL.md'), '# 写报告')
  await writeFile(join(memoryFolder(from.dataDir, 'review-write'), 'scripts', 'fmt.sh'), 'echo')
  await writeFile(join(memoryFolder(from.dataDir, 'review'), 'SKILL.md'), '# 约定')

  let document: WorkflowDocument = {
    nodes: [{ id: 'write', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: '写报告' } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  const added = addStepMemory(
    document,
    'write',
    { memory: 'review-write', type: 'step' },
    {
      x: 0,
      y: 100,
    },
  )
  if (added === null) throw new Error('没开成')
  document = addGlobalMemory(
    added.document,
    { memory: 'review', type: 'workflow' },
    { x: 0, y: 0 },
  ).document
  ok(await from.repository.create('review'))
  ok(await from.repository.save('review', document, { baseHash: null }))
  ok(await from.repository.saveVersion('review', 'v1'))
  return from
}

async function download(dataDir: string, token: string): Promise<Uint8Array> {
  const parts: Buffer[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const chunk: { data: string; next: number | null } = ok(await readChunk(dataDir, token, offset))
    parts.push(Buffer.from(chunk.data, 'base64'))
    offset = chunk.next
  }
  return new Uint8Array(Buffer.concat(parts))
}

async function upload(dataDir: string, zip: Uint8Array): Promise<string> {
  let token: string | undefined
  for (let offset = 0; offset < zip.length; offset += PACK_CHUNK_BYTES) {
    const part = Buffer.from(zip.subarray(offset, offset + PACK_CHUNK_BYTES)).toString('base64')
    token = ok(await appendChunk(dataDir, token, offset, part)).token
  }
  return token as string
}

/** 导出 `review` 的 v1：`pick` 决定带哪几条记忆的内容（缺省全带）。 */
async function exported(from: Side, pick?: (id: string) => boolean): Promise<Uint8Array> {
  const scan = ok(await scanPack(from.deps, { name: 'review', versions: [1] }))
  const pack = scan.items
    .filter((item) => item.state === 'memory' && (pick?.(item.memory?.id ?? '') ?? true))
    .map((item) => item.key)
  const out = ok(await exportPack(from.deps, { name: 'review', versions: [1], pack }))
  return download(from.dataDir, out.token)
}

describe('导出盘点', () => {
  it('记忆一项一条：库里那条的名称、类型、大小；库里没有的是 missing', async () => {
    const from = await sourceSide()
    const scan = ok(await scanPack(from.deps, { name: 'review', versions: [1] }))
    const memories = scan.items.filter((item) => item.memory !== undefined)
    expect(
      memories.map((item) => [item.state, item.memory?.id, item.memory?.type, item.files]),
    ).toEqual(
      expect.arrayContaining([
        ['memory', 'review-write', 'step', 2],
        ['memory', 'review', 'workflow', 1],
      ]),
    )
    await rm(join(memoriesDir(from.dataDir), 'review.json'))
    const again = ok(await scanPack(from.deps, { name: 'review', versions: [1] }))
    expect(again.items.find((item) => item.value === '{memory}/review')?.state).toBe('missing')
  })
})

describe('导出 → 导入', () => {
  it('本机没有：按包里的 id 建，名称、描述、内容都在；计划里是记忆库的绝对路径', async () => {
    const from = await sourceSide()
    const zip = await exported(from)
    const manifest = ok(openPack(zip)).manifest
    expect(manifest.memories.map((memory) => memory.id).sort()).toEqual(['review', 'review-write'])

    const to = await side('to')
    const token = await upload(to.dataDir, zip)
    const preview = ok(await inspectPack(to.deps, { token }))
    expect(preview.memories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'review-write', exists: false, files: 2 }),
        expect.objectContaining({ id: 'review', exists: false, files: 1 }),
      ]),
    )
    const applied = ok(await applyPack(to.deps, { token, mode: 'new', name: 'review' }))
    expect(applied.memories).toEqual(
      expect.arrayContaining([{ id: 'review-write', as: 'review-write', action: 'create' }]),
    )
    expect(await readMemoryMeta(to.dataDir, 'review')).toMatchObject({
      type: 'workflow',
      description: '项目约定',
    })
    expect(await readMemoryMeta(to.dataDir, 'review-write')).toMatchObject({
      type: 'step',
      name: '写报告的做法',
    })
    expect(
      await readFile(join(memoryFolder(to.dataDir, 'review-write'), 'scripts', 'fmt.sh'), 'utf8'),
    ).toBe('echo')

    const plan = ok(await compileWorkflow(to.repository, to.dataDir, 'review'))
    expect(plan.plan).toContain(slash(memoryFolder(to.dataDir, 'review-write')))
    expect(plan.plan).not.toContain('{memory}')
  })

  it('没勾内容：只带名称和描述，导入后是一条空记忆', async () => {
    const from = await sourceSide()
    const zip = await exported(from, (id) => id !== 'review-write')
    const to = await side('to')
    const token = await upload(to.dataDir, zip)
    const preview = ok(await inspectPack(to.deps, { token }))
    expect(preview.memories.find((memory) => memory.id === 'review-write')?.files).toBe(0)
    ok(await applyPack(to.deps, { token, mode: 'new', name: 'review' }))
    expect(await readMemoryMeta(to.dataDir, 'review-write')).toMatchObject({ name: '写报告的做法' })
  })

  it('本机已有同 id：缺省用本机的（内容不动）；选另存一份就换个 id，导入的工作流改用它', async () => {
    const from = await sourceSide()
    const zip = await exported(from)
    const to = await side('to')
    const local = { dataDir: to.dataDir, repository: to.repository }
    ok(await createMemory(local, { type: 'step', id: 'review-write' }))
    ok(await updateMemory(local, { id: 'review-write', name: '本机的' }))
    await writeFile(join(memoryFolder(to.dataDir, 'review-write'), 'SKILL.md'), '# 本机')

    const token = await upload(to.dataDir, zip)
    const preview = ok(await inspectPack(to.deps, { token }))
    expect(preview.memories.find((memory) => memory.id === 'review-write')).toMatchObject({
      exists: true,
      existingName: '本机的',
      rename: 'review-write-2',
    })
    ok(await applyPack(to.deps, { token, mode: 'new', name: 'review' }))
    expect(await readFile(join(memoryFolder(to.dataDir, 'review-write'), 'SKILL.md'), 'utf8')).toBe(
      '# 本机',
    )
    const used = await to.repository.load('review')
    expect(memoryRefs(used.document as WorkflowDocument)).toContain('review-write')

    const again = await upload(to.dataDir, zip)
    const applied = ok(
      await applyPack(to.deps, {
        token: again,
        mode: 'new',
        name: 'review-2',
        memories: { 'review-write': 'copy' },
      }),
    )
    expect(applied.memories).toEqual(
      expect.arrayContaining([{ id: 'review-write', as: 'review-write-2', action: 'copy' }]),
    )
    expect(
      await readFile(join(memoryFolder(to.dataDir, 'review-write-2'), 'SKILL.md'), 'utf8'),
    ).toBe('# 写报告')
    const copied = await to.repository.load('review-2')
    const refs = memoryRefs(copied.document as WorkflowDocument)
    expect(refs).toContain('review-write-2')
    expect(refs).not.toContain('review-write')
    const versions = ok(await to.repository.listVersions('review-2'))
    expect(versions[0]?.current).toBe(true)
  })
})

describe('导出成 skill', () => {
  it('勾上的记忆放进 memory/<id>/；计划里写 {skill}/memory/<id>，不留本机路径', async () => {
    const from = await sourceSide()
    const scan = ok(await scanPack(from.deps, { name: 'review', versions: [1] }))
    const pack = scan.items
      .filter((item) => item.memory?.id === 'review-write')
      .map((item) => item.key)
    const out = ok(
      await exportSkill(from.deps, {
        name: 'review',
        version: 1,
        pack,
        meta: { name: 'review-skill', description: '写报告' },
        target: 'zip',
      }),
    )
    const entries = unzipSync(await download(from.dataDir, out.token as string))
    const files = new Map(Object.entries(entries).map(([path, data]) => [path, strFromU8(data)]))
    expect([...files.keys()].filter((path) => path.includes('/memory/')).sort()).toEqual([
      'review-skill/memory/review-write/SKILL.md',
      'review-skill/memory/review-write/scripts/fmt.sh',
    ])
    const all = [...files.values()].join('\n')
    expect(all).toContain('{skill}/memory/review-write')
    // 没勾的那条也指向 skill 里的位置（用的时候从空的开始攒）。
    expect(all).toContain('{skill}/memory/review')
    expect(all).not.toContain(slash(memoriesDir(from.dataDir)))
    expect(all).not.toContain('{memory}')
  })

  it('库里已经没有的记忆：skill 里是空文件夹，不算「按绝对路径引用」', async () => {
    const from = await sourceSide()
    await rm(join(memoriesDir(from.dataDir), 'review.json'))
    const preview = ok(await previewSkill(from.deps, { name: 'review', version: 1, pack: [] }))
    expect(preview.absolute).toEqual([])
    expect(preview.body).toContain('{skill}/memory/review')
  })
})
