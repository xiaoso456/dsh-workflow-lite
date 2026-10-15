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
import { assetsDir, pathKind, workflowFile } from '../../src/host/store/paths.ts'
import { createRepository, type Outcome, type Repository } from '../../src/host/store/repository.ts'
import { pluginVersion } from '../../src/host/version.ts'
import { readDocument } from '../../src/shared/model.ts'
import { PACK_CHUNK_BYTES, PACK_FORMAT, PACK_KIND } from '../../src/shared/pack.ts'
import {
  NODE_TYPE,
  RESOURCE_TYPE,
  type ResourceItem,
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
    { kind: 'file', value: '{assets}/notes.md' },
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
    expect(by('spec.md')).toMatchObject({ state: 'pack', as: '{assets}/spec.md', versions: [1, 2] })
    expect(by('docs')).toMatchObject({ state: 'pack', as: '{assets}/docs', files: 1, skipped: 1 })
    expect(by('README.md')?.state).toBe('relative')
    expect(by('report.md')?.state).toBe('output')
    expect(by('my-skill')).toMatchObject({ state: 'pack', files: 2, source: 'user' })
    expect(by('web')?.state).toBe('builtin')
    expect(by('{assets}/notes.md')?.state).toBe('assets')
    expect(scan.assets).toMatchObject({ files: 1 })
    // 网址、自定义文本不是外部资源，不进清单
    expect(scan.items.some((item) => item.kind === 'url')).toBe(false)
  })

  it('资料目录里已有同名的：打包进去的换个名字', async () => {
    const { from } = await sourceSide()
    await writeFile(join(assetsDir(from.dataDir, 'review'), 'spec.md'), '已有')
    const scan = expectOk(await scanPack(from.deps, { name: 'review', versions: [2] }))
    expect(scan.items.find((item) => item.value.endsWith('ext/spec.md'))?.as).toBe(
      '{assets}/spec-2.md',
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
  it('来回一趟：版本号、资料、skill 都在，图里改成 {assets}，计划里是绝对路径', async () => {
    const { from } = await sourceSide()
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
    expect(JSON.stringify(original.document)).not.toContain('{assets}/spec.md')

    const opened = expectOk(openPack(zip))
    expect(opened.manifest).toMatchObject({
      format: PACK_FORMAT,
      plugin: '9.9.9',
      current: 2,
      workflow: { name: 'review' },
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

    const versions = expectOk(await to.repository.listVersions('review'))
    expect(versions.map((version) => [version.n, version.note, version.current])).toEqual([
      [2, '第 2 版', true],
      [1, '第 1 版', false],
    ])
    const loaded = await to.repository.load('review')
    const values = JSON.stringify(loaded.document)
    expect(values).toContain('{assets}/spec.md')
    expect(values).toContain('{assets}/docs')
    expect(values).toContain('第二版')
    expect(await readFile(join(assetsDir(to.dataDir, 'review'), 'docs', 'a.md'), 'utf8')).toBe('A')
    expect(await pathKind(join(assetsDir(to.dataDir, 'review'), 'docs', '.git'))).toBe('missing')
    expect(await readFile(join(to.skillsRoot, 'my-skill', 'run.sh'), 'utf8')).toBe('echo hi')

    const plan = expectOk(await compileWorkflow(to.repository, to.dataDir, 'review'))
    expect(plan.plan).toContain(slash(join(assetsDir(to.dataDir, 'review'), 'spec.md')))
    expect(plan.plan).not.toContain('{assets}')

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

describe('并入已有工作流', () => {
  it('内容一样的版本不再存，其余接着编号；不自动存本机现在的内容', async () => {
    const { from } = await sourceSide()
    const exported = expectOk(
      await exportPack(from.deps, { name: 'review', versions: [1, 2], pack: [] }),
    )
    const zip = await download(from.dataDir, exported.token)

    const to = await side('to')
    await makeWorkflow(to.repository, 'review', [graph([], '本机的一版')])
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
