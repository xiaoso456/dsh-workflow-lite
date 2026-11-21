import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SkillViewer } from '../../src/host/hostFs.ts'
import { exportPack, type PackDeps, scanPack } from '../../src/host/pack/exporter.ts'
import { applyPack, inspectPack, openPack, renameSkillDoc } from '../../src/host/pack/importer.ts'
import { appendChunk, readChunk } from '../../src/host/pack/staging.ts'
import { compileWorkflow } from '../../src/host/plan.ts'
import { assetsDir, pathKind, versionFile, workflowFile } from '../../src/host/store/paths.ts'
import type { Outcome } from '../../src/host/store/repoResult.ts'
import { createRepository, type Repository } from '../../src/host/store/repository.ts'
import { pluginVersion } from '../../src/host/version.ts'
import { isTrigger, readDocument } from '../../src/shared/model.ts'
import { PACK_CHUNK_BYTES, PACK_FORMAT, PACK_KIND, PACK_PATHS } from '../../src/shared/pack.ts'
import type { ChoiceKeep } from '../../src/shared/sessionChoice.ts'
import {
  NODE_TYPE,
  RESOURCE_TYPE,
  type ResourceItem,
  TRIGGER_TYPE,
  type TriggerData,
  type WorkflowDocument,
} from '../../src/shared/types.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-pack-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function expectOk<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`)
  return outcome.result
}

function expectError<T>(outcome: Outcome<T>): { code: string; message: string } {
  if (outcome.ok) throw new Error('expected failure')
  return outcome.error
}

const slash = (path: string): string => path.replace(/\\/gu, '/')

/** 假的 skill 服务：名字 → SKILL.md 路径（没有路径 = 内置）。 */
function viewer(entries: { name: string; path?: string }[]): SkillViewer {
  return async () => ({
    skills: {
      list: async () =>
        entries.map((entry) => ({
          name: entry.name,
          description: '',
          source: entry.path === undefined ? 'builtin' : 'user',
          ...(entry.path === undefined ? {} : { path: entry.path }),
          invocation: { modelInvocable: true },
        })),
      get: async () => undefined,
    },
  })
}

interface Side {
  dataDir: string
  skillsRoot: string
  repository: Repository
  deps: PackDeps
}

async function side(label: string, skills: { name: string; path?: string }[] = []): Promise<Side> {
  const dataDir = join(root, label, 'data')
  const skillsRoot = join(root, label, 'home', '.agents', 'skills')
  await mkdir(dataDir, { recursive: true })
  const repository = createRepository({ dataDir })
  return {
    dataDir,
    skillsRoot,
    repository,
    deps: {
      dataDir,
      repository,
      skills: viewer(skills),
      skillsRoot,
      plugin: '9.9.9',
      now: () => Date.UTC(2026, 9, 15),
    },
  }
}

function graph(items: ResourceItem[], prompt = '读资料，写报告'): WorkflowDocument {
  return {
    nodes: [
      { id: 'write', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt } },
      { id: 'spec', type: RESOURCE_TYPE, position: { x: 0, y: 100 }, data: { items } },
      {
        id: 'out',
        type: RESOURCE_TYPE,
        position: { x: 0, y: 200 },
        data: { items: [{ kind: 'file', value: 'report.md' }] },
      },
    ],
    edges: [
      {
        id: 'spec->write',
        source: 'spec',
        target: 'write',
        sourceHandle: null,
        targetHandle: null,
      },
      { id: 'write->out', source: 'write', target: 'out', sourceHandle: null, targetHandle: null },
    ],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

async function makeWorkflow(
  repository: Repository,
  name: string,
  documents: WorkflowDocument[],
): Promise<void> {
  expectOk(await repository.create(name))
  for (const [index, document] of documents.entries()) {
    expectOk(await repository.save(name, document, { baseHash: null }))
    expectOk(await repository.saveVersion(name, `第 ${index + 1} 版`))
  }
}

/** 把导出的包一块块取回来。 */
async function download(dataDir: string, token: string): Promise<Uint8Array> {
  const parts: Buffer[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const chunk: { data: string; next: number | null } = expectOk(
      await readChunk(dataDir, token, offset),
    )
    parts.push(Buffer.from(chunk.data, 'base64'))
    offset = chunk.next
  }
  return new Uint8Array(Buffer.concat(parts))
}

/** 一块块传上去，回暂存编号。 */
async function upload(dataDir: string, zip: Uint8Array): Promise<string> {
  let token: string | undefined
  for (let offset = 0; offset < zip.length; offset += PACK_CHUNK_BYTES) {
    const part = Buffer.from(zip.subarray(offset, offset + PACK_CHUNK_BYTES)).toString('base64')
    token = expectOk(await appendChunk(dataDir, token, offset, part)).token
  }
  return token as string
}

/** 源这一边：一个读资料（绝对路径的文件、文件夹、相对路径、skill、资料目录）、写报告的工作流。 */
async function sourceSide(): Promise<{ from: Side; ext: string; items: ResourceItem[] }> {
  const ext = join(root, 'ext')
  await mkdir(join(ext, 'docs', '.git'), { recursive: true })
  await writeFile(join(ext, 'spec.md'), '# 需求')
  await writeFile(join(ext, 'docs', 'a.md'), 'A')
  await writeFile(join(ext, 'docs', '.git', 'HEAD'), 'ref')
  const skillDir = join(root, 'src-skills', 'my-skill')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: my-skill\ndescription: x\n---\n正文')
  await writeFile(join(skillDir, 'run.sh'), 'echo hi')
  const from = await side('from', [
    { name: 'my-skill', path: join(skillDir, 'SKILL.md') },
    { name: 'web' },
  ])
  await mkdir(assetsDir(from.dataDir, 'review'), { recursive: true })
  await writeFile(join(assetsDir(from.dataDir, 'review'), 'notes.md'), '笔记')
  const items: ResourceItem[] = [
    { kind: 'file', value: slash(join(ext, 'spec.md')) },
    { kind: 'folder', value: slash(join(ext, 'docs')) },
    { kind: 'file', value: 'README.md' },
    { kind: 'skill', value: 'my-skill' },
    { kind: 'skill', value: 'web' },
    { kind: 'file', value: '{workflow}/notes.md' },
    { kind: 'url', value: 'https://example.com' },
  ]
  await makeWorkflow(from.repository, 'review', [graph(items, '第一版'), graph(items, '第二版')])
  return { from, ext, items }
}

describe('导出盘点', () => {
  it('按种类分好：绝对路径与有目录的 skill 能打包，其余原样引用', async () => {
    const { from } = await sourceSide()
    const scan = expectOk(await scanPack(from.deps, { name: 'review', versions: [1, 2] }))
    const by = (value: string) => scan.items.find((item) => item.value.endsWith(value))
    expect(by('spec.md')).toMatchObject({
      state: 'pack',
      as: '{workflow}/spec.md',
      versions: [1, 2],
    })
    expect(by('docs')).toMatchObject({ state: 'pack', as: '{workflow}/docs', files: 1, skipped: 1 })
    expect(by('README.md')?.state).toBe('relative')
    expect(by('report.md')?.state).toBe('output')
    expect(by('my-skill')).toMatchObject({ state: 'pack', files: 2, source: 'user' })
    expect(by('web')?.state).toBe('builtin')
    expect(by('{workflow}/notes.md')?.state).toBe('assets')
    expect(scan.assets).toMatchObject({ files: 1 })
    // 网址、自定义文本不是外部资源，不进清单
    expect(scan.items.some((item) => item.kind === 'url')).toBe(false)
  })

  it('资料目录里已有同名的：打包进去的换个名字', async () => {
    const { from } = await sourceSide()
    await writeFile(join(assetsDir(from.dataDir, 'review'), 'spec.md'), '已有')
    const scan = expectOk(await scanPack(from.deps, { name: 'review', versions: [2] }))
    expect(scan.items.find((item) => item.value.endsWith('ext/spec.md'))?.as).toBe(
      '{workflow}/spec-2.md',
    )
  })

  it('找不到的文件、不存在的版本', async () => {
    const from = await side('from')
    await makeWorkflow(from.repository, 'w', [
      graph([{ kind: 'file', value: slash(join(root, 'nope.md')) }]),
    ])
    const scan = expectOk(await scanPack(from.deps, { name: 'w', versions: [1] }))
    expect(scan.items[0]?.state).toBe('missing')
    expect(expectError(await scanPack(from.deps, { name: 'w', versions: [7] })).code).toBe(
      'not_found',
    )
    expect(expectError(await scanPack(from.deps, { name: 'w', versions: [] })).code).toBe(
      'invalid_args',
    )
  })
})

describe('导出 → 导入（新工作流）', () => {
  it('来回一趟：版本号、资料、skill 都在，图里改成 {workflow}，计划里是绝对路径', async () => {
    const { from } = await sourceSide()
    expectOk(await from.repository.setTags('review', ['周报', '写作']))
    expectOk(await from.repository.setTagColor('写作', 'teal'))
    const scan = expectOk(await scanPack(from.deps, { name: 'review', versions: [1, 2] }))
    const pack = scan.items.filter((item) => item.state === 'pack').map((item) => item.key)
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1, 2], pack }),
    )
    expect(exported.fileName).toBe('review.wflite.zip')
    const zip = await download(from.dataDir, exported.token)

    // 本机的工作流没被改写。
    const original = readDocument(
      (await readFile(workflowFile(from.dataDir, 'review'), 'utf8')) ?? '',
    )
    expect(JSON.stringify(original.document)).not.toContain('{workflow}/spec.md')

    const opened = expectOk(openPack(zip))
    expect(opened.manifest).toMatchObject({
      format: PACK_FORMAT,
      plugin: '9.9.9',
      current: 2,
      workflow: { name: 'review' },
      tags: ['周报', '写作'],
      // 只带挑过的颜色（没挑过的按名字算，两边一样）。
      tagColors: { 写作: 'teal' },
    })
    expect(opened.manifest.versions.map((version) => version.note)).toEqual(['第 1 版', '第 2 版'])
    expect(opened.manifest.assets.map((file) => file.path).sort()).toEqual([
      'docs/a.md',
      'notes.md',
      'spec.md',
    ])
    expect(opened.manifest.external).toEqual(
      expect.arrayContaining([
        { kind: 'file', value: 'README.md', why: 'relative' },
        { kind: 'skill', value: 'web', why: 'builtin' },
      ]),
    )
    // 清单里不记打包文件原来的绝对路径。
    expect(new TextDecoder().decode(opened.entries.get('manifest.json'))).not.toContain(
      slash(join(root, 'ext')),
    )

    const to = await side('to', [{ name: 'web' }])
    const token = await upload(to.dataDir, zip)
    const preview = expectOk(await inspectPack(to.deps, { token }))
    expect(preview).toMatchObject({ name: 'review', exists: false, current: 2, plugin: '9.9.9' })
    expect(preview.skills).toEqual([
      expect.objectContaining({
        name: 'my-skill',
        state: 'new',
        target: slash(join(to.skillsRoot, 'my-skill')),
      }),
    ])
    expect(preview.external.find((entry) => entry.value === 'web')?.found).toBe(true)
    expect(preview.external.find((entry) => entry.value === 'README.md')?.found).toBe(null)

    const applied = expectOk(await applyPack(to.deps, { token, mode: 'new', name: 'review' }))
    expect(applied).toMatchObject({ name: 'review', versions: [1, 2], duplicates: [], assets: 3 })
    expect(applied.skills).toEqual([{ name: 'my-skill', as: 'my-skill', action: 'install' }])
    expect(await to.repository.tagsOf('review')).toEqual(['周报', '写作'])
    expect(await to.repository.tagColors()).toEqual({ 写作: 'teal' })

    const versions = expectOk(await to.repository.listVersions('review'))
    expect(versions.map((version) => [version.n, version.note, version.current])).toEqual([
      [2, '第 2 版', true],
      [1, '第 1 版', false],
    ])
    const loaded = await to.repository.load('review')
    const values = JSON.stringify(loaded.document)
    expect(values).toContain('{workflow}/spec.md')
    expect(values).toContain('{workflow}/docs')
    expect(values).toContain('第二版')
    expect(await readFile(join(assetsDir(to.dataDir, 'review'), 'docs', 'a.md'), 'utf8')).toBe('A')
    expect(await pathKind(join(assetsDir(to.dataDir, 'review'), 'docs', '.git'))).toBe('missing')
    expect(await readFile(join(to.skillsRoot, 'my-skill', 'run.sh'), 'utf8')).toBe('echo hi')

    const plan = expectOk(await compileWorkflow(to.repository, to.dataDir, 'review'))
    expect(plan.plan).toContain(slash(join(assetsDir(to.dataDir, 'review'), 'spec.md')))
    expect(plan.plan).not.toContain('{workflow}')

    // 用完暂存就删了。
    expect(expectError(await inspectPack(to.deps, { token })).code).toBe('not_found')
  })

  it('同名工作流已在：另存为新名字；用原名新建报冲突', async () => {
    const { from } = await sourceSide()
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1], pack: [] }),
    )
    const zip = await download(from.dataDir, exported.token)
    const token = await upload(from.dataDir, zip)
    const preview = expectOk(await inspectPack(from.deps, { token }))
    expect(preview).toMatchObject({ exists: true, unsaved: false, suggested: 'review-2' })
    expect(
      expectError(await applyPack(from.deps, { token, mode: 'new', name: 'review' })).code,
    ).toBe('conflict')
    const applied = expectOk(await applyPack(from.deps, { token, mode: 'new', name: 'review-2' }))
    expect(applied.name).toBe('review-2')
    expect(expectOk(await from.repository.listVersions('review-2')).map((v) => v.n)).toEqual([1])
  })
})

describe('导出时新建会话的设置', () => {
  /** 一张设了新建会话用的预设、模型、权限的图，导出、再导入成 `name`，回导入后的第 1 版。 */
  async function roundTrip(choice: ChoiceKeep | undefined, name: string) {
    const from = await side(`choice-${name}`)
    const document: WorkflowDocument = {
      ...graph([]),
      settings: {
        runState: true,
        preset: 'ptc',
        model: { provider: 'deepseek', model: 'deepseek-v4', effort: 'high' },
        permission: 'read-only',
      },
    }
    await makeWorkflow(from.repository, 'review', [document])
    const scan = expectOk(await scanPack(from.deps, { name: 'review', versions: [1] }))
    expect(scan.choices).toEqual([
      {
        choice: {
          preset: 'ptc',
          model: { provider: 'deepseek', model: 'deepseek-v4', effort: 'high' },
          permission: 'read-only',
        },
      },
    ])
    const exported = expectOk(
      await exportPack(from.deps, {
        name: 'review',
        versions: [1],
        pack: [],
        ...(choice === undefined ? {} : { choice }),
      }),
    )
    const token = await upload(from.dataDir, await download(from.dataDir, exported.token))
    expectOk(await applyPack(from.deps, { token, mode: 'new', name }))
    return expectOk(await from.repository.readVersion(name, 1)).document
  }

  it('缺省不带模型和预设、带上权限，别的设置照旧', async () => {
    const imported = await roundTrip(undefined, 'plain')
    expect(imported.settings).toEqual({ runState: true, permission: 'read-only' })
  })

  it('按三个开关带：只有名字', async () => {
    const imported = await roundTrip({ model: true, preset: true, permission: false }, 'kept')
    expect(imported.settings).toEqual({
      runState: true,
      preset: 'ptc',
      model: { provider: 'deepseek', model: 'deepseek-v4', effort: 'high' },
    })
  })

  it('工作流和每张卡片分别勾选，选中的各版本保留自己的值', async () => {
    const from = await side('choice-per-card')
    const base = graph([])
    const model = { provider: 'deepseek', model: 'deepseek-v4', effort: 'high' }
    const trigger = (
      id: string,
      launch: TriggerData['launch'],
    ): WorkflowDocument['nodes'][number] => ({
      id,
      type: TRIGGER_TYPE,
      position: { x: 0, y: 0 },
      data: { source: { kind: 'http' }, launch, enabled: true },
    })
    const first: WorkflowDocument = {
      ...base,
      settings: { model, preset: 'ptc', permission: 'read-only' },
      nodes: [
        ...base.nodes,
        trigger('logs', { model, preset: 'ptc', permission: 'workspace-write', session: 'last' }),
        trigger('backup', { model, preset: 'ptc', permission: 'read-only' }),
      ],
    }
    const second: WorkflowDocument = {
      ...first,
      settings: { preset: 'ptc', permission: 'read-only' },
      nodes: [
        ...base.nodes,
        trigger('logs', {
          model: { ...model, effort: 'low' },
          permission: 'workspace-write',
          session: 'last',
        }),
        trigger('backup', { model, preset: 'ptc', permission: 'read-only' }),
      ],
    }
    await makeWorkflow(from.repository, 'review', [first, second])
    const scan = expectOk(await scanPack(from.deps, { name: 'review', versions: [1, 2] }))
    const exported = expectOk(
      await exportPack(from.deps, {
        name: 'review',
        versions: [1, 2],
        pack: [],
        choice: { model: true, preset: false, permission: false },
        triggerChoices: [
          { node: 'logs', choice: { model: true, preset: false, permission: false } },
          { node: 'backup', choice: { model: false, preset: true, permission: true } },
        ],
      }),
    )
    const token = await upload(from.dataDir, await download(from.dataDir, exported.token))
    expectOk(await applyPack(from.deps, { token, mode: 'new', name: 'picked' }))
    const [older, newer] = await Promise.all(
      [1, 2].map(async (n) => expectOk(await from.repository.readVersion('picked', n)).document),
    )
    expect(older.settings).toEqual({ model })
    expect(newer.settings).toBeUndefined()
    expect(
      [older, newer].map((doc) => doc.nodes.filter(isTrigger).map(({ data }) => data.launch)),
    ).toEqual([
      [
        { model, session: 'last' },
        { preset: 'ptc', permission: 'read-only' },
      ],
      [
        { model: { ...model, effort: 'low' }, session: 'last' },
        { preset: 'ptc', permission: 'read-only' },
      ],
    ])
    expect(scan.choices).toContainEqual({ version: 1, choice: first.settings })
    expect(scan.triggers.find((card) => card.node === 'logs')?.enabled).toBe(true)
  })
})

describe('触发卡片', () => {
  function card(id: string, data: TriggerData): WorkflowDocument['nodes'][number] {
    return { id, type: TRIGGER_TYPE, position: { x: 0, y: 0 }, data }
  }

  /** 两张卡片：定时检查（开着、选了不在的工作区、发进固定会话）和 HTTP；卡片目录里有脚本、密钥、数据。 */
  async function triggerSide(): Promise<Side> {
    const from = await side('triggers')
    const base = graph([])
    const document: WorkflowDocument = {
      ...base,
      nodes: [
        ...base.nodes,
        card('tick', {
          source: {
            kind: 'schedule',
            schedule: { kind: 'every', seconds: 300 },
            check: { command: 'node check.mjs', when: 'success' },
          },
          enabled: true,
          workspace: slash(join(root, 'nowhere')),
          launch: { session: 'fixed', sessionId: 'abc' },
        }),
        card('hook', {
          label: '收信',
          source: { kind: 'http', hook: 'review', token: 'secret-token' },
          enabled: true,
        }),
      ],
    }
    await makeWorkflow(from.repository, 'review', [document])
    const dir = join(assetsDir(from.dataDir, 'review'), 'triggers')
    const put = async (rel: string, text: string): Promise<void> => {
      await mkdir(join(dir, rel, '..'), { recursive: true })
      await writeFile(join(dir, rel), text)
    }
    await put('watch.mjs', 'export {}')
    await put('tick/check.mjs', 'process.exit(0)')
    await put('tick/samples/a.json', '{}')
    await put('tick/secrets/key.txt', 'k1')
    await put('tick/data/state.json', '{"n":1}')
    await put('tick/data-test/state.json', '{}')
    await put('hook/secrets/h.txt', 'h1')
    await writeFile(join(assetsDir(from.dataDir, 'review'), 'notes.md'), 'n')
    return from
  }

  async function packed(from: Side, request: Parameters<typeof exportPack>[1]) {
    const exported = expectOk(await exportPack(from.deps, request))
    return expectOk(openPack(await download(from.dataDir, exported.token)))
  }

  it('盘点：每张卡片、各自的密钥和数据，触发脚本单算，资料目录里不含触发器那一块', async () => {
    const from = await triggerSide()
    const scan = expectOk(await scanPack(from.deps, { name: 'review', versions: [1] }))
    expect(scan.assets?.files).toBe(1)
    expect(scan.triggerScripts?.files).toBe(3)
    expect(scan.triggers).toEqual([
      expect.objectContaining({
        node: 'tick',
        label: '',
        command: true,
        versions: [1],
        secrets: { names: ['key.txt'], bytes: 2 },
        data: { files: 1, bytes: 7 },
      }),
      expect.objectContaining({
        node: 'hook',
        label: '收信',
        command: false,
        secrets: { names: ['h.txt'], bytes: 2 },
      }),
    ])
    expect(scan.triggers[1]?.data).toBeUndefined()
  })

  it('缺省：卡片全带、开关照原样、令牌带上；脚本带上，密钥、数据、试运行数据不带', async () => {
    const from = await triggerSide()
    const opened = await packed(from, { name: 'review', versions: [1], pack: [] })
    expect(opened.manifest.assets.map((file) => file.path).sort()).toEqual([
      'notes.md',
      'triggers/tick/check.mjs',
      'triggers/tick/samples/a.json',
      'triggers/watch.mjs',
    ])
    const cards = opened.versions[0]?.document.nodes.filter(isTrigger) ?? []
    expect(cards.map((node) => node.id)).toEqual(['tick', 'hook'])
    expect(cards.map((node) => node.data.enabled)).toEqual([true, true])
    expect(cards[1]?.data.source).toMatchObject({ hook: 'review', token: 'secret-token' })
  })

  it('没勾的卡片从包里去掉；留下的都不跑命令时不带脚本；勾了才带密钥和数据', async () => {
    const from = await triggerSide()
    const opened = await packed(from, {
      name: 'review',
      versions: [1],
      pack: [],
      triggers: ['hook'],
      secrets: ['hook', 'tick'],
      triggerData: ['tick'],
    })
    expect(opened.manifest.assets.map((file) => file.path).sort()).toEqual([
      'notes.md',
      'triggers/hook/secrets/h.txt',
    ])
    const cards = opened.versions[0]?.document.nodes.filter(isTrigger) ?? []
    expect(cards.map((node) => node.id)).toEqual(['hook'])
    expect(opened.manifest.versions[0]?.nodeCount).toBe(opened.versions[0]?.document.nodes.length)
  })

  it('导入旧包：节点数以实际入包的图为准', async () => {
    const from = await triggerSide()
    const opened = await packed(from, { name: 'review', versions: [1], pack: [], triggers: [] })
    const stale = {
      ...opened.manifest,
      versions: opened.manifest.versions.map((version) => ({ ...version, nodeCount: 5 })),
    }
    const bytes = zipSync({
      ...Object.fromEntries(opened.entries),
      [PACK_PATHS.manifest]: strToU8(JSON.stringify(stale)),
    })
    const token = await upload(from.dataDir, bytes)
    const preview = expectOk(await inspectPack(from.deps, { token }))
    expect(preview.versions[0]?.nodeCount).toBe(3)
  })

  it('另存时避开本机已开启的 HTTP 地址，同名并入可以保留原地址', async () => {
    const from = await side('occupied-hook')
    const workspace = slash(from.dataDir)
    const base = graph([])
    const data: TriggerData = {
      source: { kind: 'http', hook: 'review', token: 'synthetic-test-token' },
      workspace,
    }
    await makeWorkflow(from.repository, 'review', [
      { ...base, nodes: [...base.nodes, card('hook', { ...data, enabled: true })] },
    ])
    await makeWorkflow(from.repository, 'off', [
      { ...base, nodes: [...base.nodes, card('hook', data)] },
    ])
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1], pack: [] }),
    )
    const zip = await download(from.dataDir, exported.token)
    const token = await upload(from.dataDir, zip)
    const preview = expectOk(await inspectPack(from.deps, { token }))
    expect(preview.triggers?.cards[0]?.gaps).toEqual([
      { kind: 'hook', hook: 'review', workflow: 'review' },
    ])
    const enabled = async (name: string) =>
      (await from.repository.load(name)).document?.nodes.find(isTrigger)?.data.enabled
    expectOk(await applyPack(from.deps, { token, mode: 'new', name: 'copy', enable: ['hook'] }))
    expect(await enabled('copy')).toBeUndefined()
    expect(await enabled('review')).toBe(true)

    const again = await upload(from.dataDir, zip)
    expectOk(await applyPack(from.deps, { token: again, mode: 'merge', name: 'review' }))
    expect(await enabled('review')).toBe(true)
  })

  it('确认导入时重新检查预览之后被占用的 HTTP 地址', async () => {
    const from = await side('hook-export')
    const to = await side('hook-import')
    const base = graph([])
    const data: TriggerData = {
      source: { kind: 'http', hook: 'review', token: 'synthetic-test-token' },
      workspace: slash(to.dataDir),
      enabled: true,
    }
    const document = { ...base, nodes: [...base.nodes, card('hook', data)] }
    await makeWorkflow(from.repository, 'review', [document])
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1], pack: [] }),
    )
    const token = await upload(to.dataDir, await download(from.dataDir, exported.token))
    const preview = expectOk(await inspectPack(to.deps, { token }))
    expect(preview.triggers?.cards[0]?.gaps).toEqual([])

    await makeWorkflow(to.repository, 'local', [document])
    expectOk(await applyPack(to.deps, { token, mode: 'new', name: 'review', enable: ['hook'] }))
    const imported = await to.repository.load('review')
    expect(imported.document?.nodes.find(isTrigger)?.data.enabled).toBeUndefined()
    const local = await to.repository.load('local')
    expect(local.document?.nodes.find(isTrigger)?.data.enabled).toBe(true)
  })

  it('导入预览：逐张列出卡片和这台机器上打不开的原因、带了几个密钥文件；密钥落进卡片目录', async () => {
    const from = await triggerSide()
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1], pack: [], secrets: ['tick'] }),
    )
    const zip = await download(from.dataDir, exported.token)
    const to = await side('triggers-to')
    const token = await upload(to.dataDir, zip)
    const preview = expectOk(await inspectPack(to.deps, { token }))
    expect(preview.triggers).toEqual({
      cards: [
        { node: 'tick', label: '', kind: 'schedule', enabled: true, gaps: [{ kind: 'session' }] },
        { node: 'hook', label: '收信', kind: 'http', enabled: true, gaps: [{ kind: 'workspace' }] },
      ],
      secrets: 1,
    })
    expectOk(await applyPack(to.deps, { token, mode: 'new', name: 'review' }))
    const secret = join(assetsDir(to.dataDir, 'review'), 'triggers', 'tick', 'secrets', 'key.txt')
    expect(await readFile(secret, 'utf8')).toBe('k1')
  })

  it('导入时的开关：不给照导出时的，给了照给的；只动当前版本和现在的内容，打不开的一律关', async () => {
    const from = await side('triggers-enable')
    const workspace = slash(join(from.dataDir, 'ws'))
    await mkdir(workspace, { recursive: true })
    const document = graph([])
    await makeWorkflow(from.repository, 'nightly', [
      {
        ...document,
        nodes: [
          ...document.nodes,
          card('a', { source: { kind: 'http', hook: 'a', token: 't' }, workspace, enabled: true }),
          card('b', { source: { kind: 'http', hook: 'b', token: 't' }, workspace, enabled: true }),
          // 开着导出，但没选工作区：这台机器上打不开。
          card('c', { source: { kind: 'http', hook: 'c', token: 't' }, enabled: true }),
        ],
      },
    ])
    const exported = expectOk(
      await exportPack(from.deps, { name: 'nightly', versions: [1], pack: [] }),
    )
    const zip = await download(from.dataDir, exported.token)
    const to = await side('switch-overrides')
    const token = await upload(to.dataDir, zip)
    const preview = expectOk(await inspectPack(to.deps, { token }))
    expect(preview.triggers?.cards.map((entry) => entry.gaps)).toEqual([
      [],
      [],
      [{ kind: 'workspace' }],
    ])
    expectOk(await applyPack(to.deps, { token, mode: 'new', name: 'copy', enable: ['a', 'c'] }))
    const switches = (doc: WorkflowDocument): (boolean | undefined)[] =>
      doc.nodes.filter(isTrigger).map((node) => node.data.enabled)
    const loaded = await to.repository.load('copy')
    expect(switches(loaded.document ?? graph([]))).toEqual([true, undefined, undefined])
    const saved = expectOk(await to.repository.readVersion('copy', 1))
    expect(switches(saved.document)).toEqual([true, undefined, undefined])

    // 不给：照导出时的开关，打不开的关掉。
    const other = await side('switch-defaults')
    const again = await upload(other.dataDir, zip)
    expectOk(await applyPack(other.deps, { token: again, mode: 'new', name: 'copy-2' }))
    const kept = await other.repository.load('copy-2')
    expect(switches(kept.document ?? graph([]))).toEqual([true, true, undefined])
  })

  it('导入预览：shell、服务商、模型、预设、权限这台机器上没有的也算缺（卡片没写的看工作流的）；取不到就不查', async () => {
    const from = await side('triggers-gaps')
    const workspace = slash(join(from.dataDir, 'ws'))
    await mkdir(workspace, { recursive: true })
    const base = graph([])
    const http = (hook: string) => ({ kind: 'http' as const, hook, token: 't' })
    await makeWorkflow(from.repository, 'gaps', [
      {
        ...base,
        settings: { model: { provider: 'ds', model: 'gone' } },
        nodes: [
          ...base.nodes,
          card('a', {
            source: http('a'),
            workspace,
            enabled: true,
            shell: slash(join(from.dataDir, 'no-shell.exe')),
            launch: {
              model: { provider: 'nowhere', model: 'x' },
              preset: 'ghost',
              permission: 'never',
            },
          }),
          // 卡片没写模型：跟着工作流的（这个服务商有，模型没有）。
          card('b', { source: http('b'), workspace, launch: { preset: 'standard' } }),
        ],
      },
    ])
    // 导出时把模型、预设也带上（缺省只带权限）。
    const exported = expectOk(
      await exportPack(from.deps, {
        name: 'gaps',
        versions: [1],
        pack: [],
        choice: { model: true, preset: true, permission: true },
      }),
    )
    const zip = await download(from.dataDir, exported.token)
    const to = await side('trigger-gap-catalog')
    let asked = 0
    const host = {
      ...to.deps,
      catalog: async () => {
        asked += 1
        return {
          presets: [{ id: 'standard', name: '', isDefault: true }],
          providers: [
            { id: 'ds', name: 'DeepSeek', models: [{ id: 'chat', name: 'chat', efforts: [] }] },
          ],
          failures: [],
          modelSelectable: true,
          permissions: {
            options: [{ id: 'read-only', name: 'read-only' }],
            defaultId: 'read-only',
          },
        }
      },
    } satisfies typeof from.deps
    const preview = expectOk(await inspectPack(host, { token: await upload(to.dataDir, zip) }))
    expect(asked).toBe(1)
    expect(preview.triggers?.cards.map((entry) => entry.gaps)).toEqual([
      [
        { kind: 'shell', path: slash(join(from.dataDir, 'no-shell.exe')) },
        { kind: 'provider', provider: 'nowhere' },
        { kind: 'preset', preset: 'ghost' },
        { kind: 'permission', permission: 'never' },
      ],
      [{ kind: 'model', provider: 'DeepSeek', model: 'gone' }],
    ])
    // 开着导出、却缺东西的，导入后关着。
    expectOk(
      await applyPack(host, { token: await upload(to.dataDir, zip), mode: 'new', name: 'copy' }),
    )
    const loaded = await to.repository.load('copy')
    expect(
      (loaded.document ?? graph([])).nodes.filter(isTrigger).map((n) => n.data.enabled),
    ).toEqual([undefined, undefined])

    // 取不到这台机器上的列表：只查 shell 这类地方。
    const broken = {
      ...to.deps,
      catalog: () => Promise.reject(new Error('down')),
    } satisfies typeof from.deps
    const blind = expectOk(await inspectPack(broken, { token: await upload(to.dataDir, zip) }))
    expect(blind.triggers?.cards.map((entry) => entry.gaps.map((gap) => gap.kind))).toEqual([
      ['shell'],
      [],
    ])
  })

  it('没有卡片的包，导入预览里没有触发器那一段', async () => {
    const from = await side('no-triggers')
    await makeWorkflow(from.repository, 'review', [graph([])])
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1], pack: [] }),
    )
    const token = await upload(from.dataDir, await download(from.dataDir, exported.token))
    expect(expectOk(await inspectPack(from.deps, { token })).triggers).toBeNull()
  })
})

describe('并入已有工作流', () => {
  it('内容一样的版本不再存，其余接着编号；不自动存本机现在的内容', async () => {
    const { from } = await sourceSide()
    expectOk(await from.repository.setTags('review', ['周报', '本机']))
    expectOk(await from.repository.setTagColor('周报', 'pink'))
    expectOk(await from.repository.setTagColor('本机', 'olive'))
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1, 2], pack: [] }),
    )
    const zip = await download(from.dataDir, exported.token)

    const to = await side('to')
    await makeWorkflow(to.repository, 'review', [graph([], '本机的一版')])
    expectOk(await to.repository.setTags('review', ['本机']))
    expectOk(await to.repository.setTagColor('本机', 'slate'))
    // 本机现在的内容没存成版本。
    expectOk(await to.repository.save('review', graph([], '没存的改动'), { baseHash: null }))
    await mkdir(assetsDir(to.dataDir, 'review'), { recursive: true })
    await writeFile(join(assetsDir(to.dataDir, 'review'), 'notes.md'), '本机的笔记')

    const token = await upload(to.dataDir, zip)
    const preview = expectOk(await inspectPack(to.deps, { token }))
    expect(preview).toMatchObject({ exists: true, unsaved: true, clashes: ['notes.md'] })
    const applied = expectOk(
      await applyPack(to.deps, { token, mode: 'merge', name: 'review', assets: 'local' }),
    )
    expect(applied.versions).toEqual([2, 3])
    const listed = expectOk(await to.repository.listVersions('review'))
    expect(listed.map((version) => version.n)).toEqual([3, 2, 1])
    expect(listed[0]?.current).toBe(true)
    expect(JSON.stringify(listed)).not.toContain('没存的改动')
    // 并入：包里的标签添在本机已有的后面。
    expect(await to.repository.tagsOf('review')).toEqual(['本机', '周报'])
    // 颜色：本机挑过的为准，本机没挑过的用包里的。
    expect(await to.repository.tagColors()).toEqual({ 本机: 'slate', 周报: 'pink' })
    expect(await readFile(join(assetsDir(to.dataDir, 'review'), 'notes.md'), 'utf8')).toBe(
      '本机的笔记',
    )

    // 再并一次：全都重复。
    const again = await upload(to.dataDir, zip)
    const second = expectOk(
      await applyPack(to.deps, { token: again, mode: 'merge', name: 'review', assets: 'package' }),
    )
    expect(second).toMatchObject({ versions: [], duplicates: [1, 2] })
    expect(await readFile(join(assetsDir(to.dataDir, 'review'), 'notes.md'), 'utf8')).toBe('笔记')
  })

  it('只能并入同名的那张', async () => {
    const { from } = await sourceSide()
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1], pack: [] }),
    )
    const to = await side('to')
    const token = await upload(to.dataDir, await download(from.dataDir, exported.token))
    expect(
      expectError(await applyPack(to.deps, { token, mode: 'merge', name: 'review' })).code,
    ).toBe('invalid_args')
  })
})

describe('skill 冲突', () => {
  async function packWithSkill(): Promise<{ zip: Uint8Array }> {
    const { from } = await sourceSide()
    const scan = expectOk(await scanPack(from.deps, { name: 'review', versions: [2] }))
    const key = scan.items.find((item) => item.value === 'my-skill')?.key as string
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [2], pack: [key] }),
    )
    return { zip: await download(from.dataDir, exported.token) }
  }

  it('内容一样：跳过', async () => {
    const { zip } = await packWithSkill()
    const to = await side('to')
    await mkdir(join(to.skillsRoot, 'my-skill'), { recursive: true })
    await writeFile(
      join(to.skillsRoot, 'my-skill', 'SKILL.md'),
      '---\nname: my-skill\ndescription: x\n---\n正文',
    )
    await writeFile(join(to.skillsRoot, 'my-skill', 'run.sh'), 'echo hi')
    const token = await upload(to.dataDir, zip)
    const preview = expectOk(await inspectPack(to.deps, { token }))
    expect(preview.skills[0]).toMatchObject({ state: 'same', overwritable: true })
    const applied = expectOk(await applyPack(to.deps, { token, mode: 'new', name: 'review' }))
    expect(applied.skills).toEqual([{ name: 'my-skill', as: 'my-skill', action: 'skip' }])
  })

  it('内容不同：缺省保留本机的；能覆盖、能换名安装（改 SKILL.md 与图里的引用）', async () => {
    const { zip } = await packWithSkill()
    const to = await side('to')
    const local = join(to.skillsRoot, 'my-skill')
    await mkdir(local, { recursive: true })
    await writeFile(join(local, 'SKILL.md'), '---\nname: my-skill\n---\n本机的')

    const token = await upload(to.dataDir, zip)
    const preview = expectOk(await inspectPack(to.deps, { token }))
    expect(preview.skills[0]).toMatchObject({
      state: 'different',
      overwritable: true,
      rename: 'my-skill-2',
    })
    expect(
      expectError(
        await applyPack(to.deps, {
          token,
          mode: 'new',
          name: 'review',
          skills: { 'my-skill': 'install' },
        }),
      ).code,
    ).toBe('conflict')

    const renamed = expectOk(
      await applyPack(to.deps, {
        token,
        mode: 'new',
        name: 'review',
        skills: { 'my-skill': 'rename' },
      }),
    )
    expect(renamed.skills).toEqual([{ name: 'my-skill', as: 'my-skill-2', action: 'rename' }])
    expect(await readFile(join(to.skillsRoot, 'my-skill-2', 'SKILL.md'), 'utf8')).toContain(
      'name: my-skill-2',
    )
    expect(await readFile(join(local, 'SKILL.md'), 'utf8')).toContain('本机的')
    const loaded = await to.repository.load('review')
    expect(JSON.stringify(loaded.document)).toContain('"my-skill-2"')

    const again = await upload(to.dataDir, zip)
    expectOk(
      await applyPack(to.deps, {
        token: again,
        mode: 'new',
        name: 'review-2',
        skills: { 'my-skill': 'overwrite' },
      }),
    )
    expect(await readFile(join(local, 'SKILL.md'), 'utf8')).toContain('正文')
    expect(await readdir(to.skillsRoot)).toEqual(['my-skill', 'my-skill-2'])
  })

  it('同名的 skill 在别处（不在 ~/.agents/skills）：不能覆盖', async () => {
    const { zip } = await packWithSkill()
    const elsewhere = join(root, 'other-skills', 'my-skill')
    await mkdir(elsewhere, { recursive: true })
    await writeFile(join(elsewhere, 'SKILL.md'), '别处的')
    const to = await side('to', [{ name: 'my-skill', path: join(elsewhere, 'SKILL.md') }])
    const token = await upload(to.dataDir, zip)
    const preview = expectOk(await inspectPack(to.deps, { token }))
    expect(preview.skills[0]).toMatchObject({ state: 'different', overwritable: false })
    expect(
      expectError(
        await applyPack(to.deps, {
          token,
          mode: 'new',
          name: 'review',
          skills: { 'my-skill': 'overwrite' },
        }),
      ).code,
    ).toBe('invalid_args')
  })
})

describe('坏包', () => {
  const manifest = {
    format: PACK_FORMAT,
    kind: PACK_KIND,
    plugin: '1',
    exportedAt: '',
    workflow: { name: 'w' },
    current: 1,
    versions: [{ n: 1, createdAt: 0, note: '', nodeCount: 0 }],
    assets: [],
    skills: [],
    external: [],
  }
  const version = JSON.stringify({
    format: 1,
    n: 1,
    createdAt: 0,
    note: '',
    document: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
  })

  it('能读的最小包；顶层没有同名目录也认', () => {
    const zip = zipSync({
      'manifest.json': strToU8(JSON.stringify(manifest)),
      'versions/1.json': strToU8(version),
    })
    expect(expectOk(openPack(zip)).manifest.workflow.name).toBe('w')
  })

  it('不安全的路径（zip-slip）', () => {
    const zip = zipSync({
      'w/manifest.json': strToU8(JSON.stringify(manifest)),
      'w/versions/1.json': strToU8(version),
      'w/../evil.txt': strToU8('x'),
    })
    expect(expectError(openPack(zip)).message).toContain('不安全')
  })

  it('包格式比本插件新', () => {
    const zip = zipSync({
      'w/manifest.json': strToU8(JSON.stringify({ ...manifest, format: PACK_FORMAT + 1 })),
    })
    expect(expectError(openPack(zip)).message).toContain('请先升级插件')
  })

  it('清单和文件对不上', () => {
    const zip = zipSync({
      'w/manifest.json': strToU8(
        JSON.stringify({ ...manifest, assets: [{ path: 'a.md', bytes: 1, sha256: '00' }] }),
      ),
      'w/versions/1.json': strToU8(version),
      'w/assets/a.md': strToU8('x'),
    })
    expect(expectError(openPack(zip)).message).toContain('内容对不上')
  })

  it('不是 zip、不是工作流包', () => {
    expect(expectError(openPack(strToU8('hello'))).code).toBe('invalid_args')
    expect(expectError(openPack(zipSync({ 'a.txt': strToU8('x') }))).message).toContain(
      'manifest.json',
    )
  })

  it('上传必须一块接一块', async () => {
    const dataDir = join(root, 'up')
    const first = expectOk(
      await appendChunk(dataDir, undefined, 0, Buffer.from('ab').toString('base64')),
    )
    expect(first.received).toBe(2)
    expect(
      expectError(await appendChunk(dataDir, first.token, 5, Buffer.from('c').toString('base64')))
        .code,
    ).toBe('invalid_args')
    expect(expectError(await appendChunk(dataDir, '../../x', 2, '')).code).toBe('invalid_args')
  })
})

describe('renameSkillDoc', () => {
  it('改头部的 name；没有就补一行；没有头部原样返回', () => {
    expect(renameSkillDoc('---\nname: a\ndescription: d\n---\nbody', 'b')).toBe(
      '---\nname: b\ndescription: d\n---\nbody',
    )
    expect(renameSkillDoc('---\r\ndescription: d\r\n---\r\nbody', 'b')).toBe(
      '---\r\nname: b\r\ndescription: d\r\n---\r\nbody',
    )
    expect(renameSkillDoc('just text', 'b')).toBe('just text')
  })
})

/** 把文件里的 `{workflow}/` 改回旧写法 `{assets}/`（模拟 0.4.0 – 0.6.0 留下的数据）。 */
async function toLegacy(file: string): Promise<void> {
  const text = await readFile(file, 'utf8')
  expect(text).toContain('{workflow}/')
  await writeFile(file, text.replaceAll('{workflow}/', '{assets}/'))
}

describe('旧写法 {assets}（0.4.0 – 0.6.0 的数据）', () => {
  it('磁盘上的旧图：打开、编译、导出、导入都按工作流目录走，写出来的是 {workflow}', async () => {
    const { from } = await sourceSide()
    for (const file of [
      workflowFile(from.dataDir, 'review'),
      versionFile(from.dataDir, 'review', 1),
      versionFile(from.dataDir, 'review', 2),
    ]) {
      await toLegacy(file)
    }

    const loaded = await from.repository.load('review')
    expect(JSON.stringify(loaded.document)).toContain('{workflow}/notes.md')
    expect(JSON.stringify(loaded.document)).not.toContain('{assets}')
    const version = expectOk(await from.repository.readVersion('review', 1))
    expect(JSON.stringify(version.document)).toContain('{workflow}/notes.md')

    const plan = expectOk(await compileWorkflow(from.repository, from.dataDir, 'review'))
    expect(plan.plan).toContain(slash(join(assetsDir(from.dataDir, 'review'), 'notes.md')))
    expect(plan.plan).not.toContain('{assets}')

    const scan = expectOk(await scanPack(from.deps, { name: 'review', versions: [1, 2] }))
    expect(scan.items.find((item) => item.value.endsWith('notes.md'))).toMatchObject({
      value: '{workflow}/notes.md',
      state: 'assets',
    })
    const pack = scan.items.filter((item) => item.state === 'pack').map((item) => item.key)
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1, 2], pack }),
    )
    const zip = await download(from.dataDir, exported.token)
    const opened = expectOk(openPack(zip))
    for (const n of [1, 2]) {
      const text = new TextDecoder().decode(opened.entries.get(PACK_PATHS.version(n)))
      expect(text).toContain('{workflow}/notes.md')
      expect(text).toContain('{workflow}/spec.md')
      expect(text).not.toContain('{assets}')
    }

    const to = await side('to', [{ name: 'web' }])
    const token = await upload(to.dataDir, zip)
    expectOk(await applyPack(to.deps, { token, mode: 'new', name: 'review' }))
    expect(await readFile(join(assetsDir(to.dataDir, 'review'), 'notes.md'), 'utf8')).toBe('笔记')
    const imported = await readFile(workflowFile(to.dataDir, 'review'), 'utf8')
    expect(imported).toContain('{workflow}/notes.md')
    expect(imported).not.toContain('{assets}')

    // 旧图存一次，磁盘上就是新写法。
    expectOk(
      await from.repository.save('review', loaded.document as WorkflowDocument, {
        baseHash: loaded.hash ?? null,
      }),
    )
    const saved = await readFile(workflowFile(from.dataDir, 'review'), 'utf8')
    expect(saved).toContain('{workflow}/notes.md')
    expect(saved).not.toContain('{assets}')
  })

  it('0.6.0 导出的旧包：导入后图里是 {workflow}，计划里是绝对路径', async () => {
    const { from } = await sourceSide()
    const scan = expectOk(await scanPack(from.deps, { name: 'review', versions: [1, 2] }))
    const pack = scan.items.filter((item) => item.state === 'pack').map((item) => item.key)
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1, 2], pack }),
    )
    const opened = expectOk(openPack(await download(from.dataDir, exported.token)))
    const legacy: Record<string, Uint8Array> = {}
    for (const [path, data] of opened.entries) {
      const text = path.startsWith('versions/') ? new TextDecoder().decode(data) : undefined
      legacy[path] =
        text === undefined ? data : strToU8(text.replaceAll('{workflow}/', '{assets}/'))
    }
    const old = zipSync(legacy)
    expect(
      new TextDecoder().decode(expectOk(openPack(old)).entries.get('versions/2.json')),
    ).toContain('{assets}/spec.md')

    const to = await side('to', [{ name: 'web' }])
    const token = await upload(to.dataDir, old)
    expectOk(await inspectPack(to.deps, { token }))
    const applied = expectOk(await applyPack(to.deps, { token, mode: 'new', name: 'review' }))
    expect(applied).toMatchObject({ versions: [1, 2], assets: 3 })

    const loaded = JSON.stringify((await to.repository.load('review')).document)
    expect(loaded).toContain('{workflow}/spec.md')
    expect(loaded).toContain('{workflow}/notes.md')
    expect(loaded).not.toContain('{assets}')
    const v1 = await readFile(versionFile(to.dataDir, 'review', 1), 'utf8')
    expect(v1).toContain('{workflow}/spec.md')
    expect(v1).not.toContain('{assets}')

    const plan = expectOk(await compileWorkflow(to.repository, to.dataDir, 'review'))
    expect(plan.plan).toContain(slash(join(assetsDir(to.dataDir, 'review'), 'spec.md')))
    expect(plan.plan).not.toContain('{assets}')
    expect(plan.plan).not.toContain('{workflow}')
  })
})

describe('资料目录跟着工作流走', () => {
  it('改名搬过去，删除一起删', async () => {
    const side1 = await side('a')
    await makeWorkflow(side1.repository, 'old', [graph([])])
    await mkdir(assetsDir(side1.dataDir, 'old'), { recursive: true })
    await writeFile(join(assetsDir(side1.dataDir, 'old'), 'x.md'), 'x')
    expectOk(await side1.repository.rename('old', 'new'))
    expect(await pathKind(assetsDir(side1.dataDir, 'old'))).toBe('missing')
    expect(await readFile(join(assetsDir(side1.dataDir, 'new'), 'x.md'), 'utf8')).toBe('x')
    expectOk(await side1.repository.remove('new'))
    expect(await pathKind(assetsDir(side1.dataDir, 'new'))).toBe('missing')
  })
})

describe('pluginVersion', () => {
  it('读得到本包的版本号', async () => {
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, '../../package.json'), 'utf8'))
    expect(pluginVersion()).toBe(pkg.version)
  })
})
