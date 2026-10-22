import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strFromU8, unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { SkillViewer } from '../../src/host/hostFs.ts'
import { type PackDeps, scanPack } from '../../src/host/pack/exporter.ts'
import { skillDir, skillFile, skillImage, splitHead } from '../../src/host/pack/skillBrowse.ts'
import { exportSkill, previewSkill } from '../../src/host/pack/skillExporter.ts'
import { discard, readChunk } from '../../src/host/pack/staging.ts'
import { assetsDir, versionFile, workflowFile } from '../../src/host/store/paths.ts'
import { createRepository, type Outcome, type Repository } from '../../src/host/store/repository.ts'
import { DSH_ONLY_TERMS } from '../../src/shared/dialect.ts'
import {
  INPUT_TYPE,
  NODE_TYPE,
  RESOURCE_TYPE,
  type ResourceItem,
  type WorkflowDocument,
} from '../../src/shared/types.ts'
import { validateDocument } from '../../src/shared/validate.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-skill-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function expectOk<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`)
  return outcome.result
}

const slash = (path: string): string => path.replace(/\\/gu, '/')

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

const edge = (source: string, target: string) => ({
  id: `${source}->${target}`,
  source,
  target,
  sourceHandle: null,
  targetHandle: null,
})

function graph(items: ResourceItem[], extra: Partial<WorkflowDocument> = {}): WorkflowDocument {
  return {
    nodes: [
      {
        id: 'write',
        type: NODE_TYPE,
        position: { x: 0, y: 0 },
        data: { label: '写报告', prompt: '读资料，写报告' },
      },
      { id: 'spec', type: RESOURCE_TYPE, position: { x: 0, y: 100 }, data: { items } },
      {
        id: 'out',
        type: RESOURCE_TYPE,
        position: { x: 0, y: 200 },
        data: { items: [{ kind: 'file', value: 'report.md' }] },
      },
      {
        id: 'topic',
        type: INPUT_TYPE,
        position: { x: 200, y: 0 },
        data: { question: '写什么主题？', required: true },
      },
    ],
    edges: [edge('spec', 'write'), edge('write', 'out'), edge('topic', 'write')],
    viewport: { x: 0, y: 0, zoom: 1 },
    ...extra,
  }
}

interface Fixture {
  deps: PackDeps
  repository: Repository
  skillsRoot: string
  ext: string
}

/** 一个读资料（绝对路径的文件、相对路径、两种 skill、资料目录）、写报告的工作流，存成 v1。 */
async function fixture(document?: (items: ResourceItem[]) => WorkflowDocument): Promise<Fixture> {
  const dataDir = join(root, 'data')
  const skillsRoot = join(root, 'home', '.agents', 'skills')
  const ext = join(root, 'ext')
  await mkdir(ext, { recursive: true })
  await writeFile(join(ext, 'spec.md'), '# 需求')
  await writeFile(join(ext, 'style.md'), '# 风格')
  const skillDir = join(root, 'src-skills', 'my-skill')
  await mkdir(skillDir, { recursive: true })
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: my-skill\ndescription: x\n---\n正文')
  await mkdir(dataDir, { recursive: true })
  const repository = createRepository({ dataDir })
  await mkdir(assetsDir(dataDir, 'review'), { recursive: true })
  await writeFile(join(assetsDir(dataDir, 'review'), 'notes.md'), '笔记')
  const items: ResourceItem[] = [
    { kind: 'file', value: slash(join(ext, 'spec.md')) },
    { kind: 'file', value: slash(join(ext, 'style.md')) },
    { kind: 'file', value: 'README.md' },
    { kind: 'skill', value: 'my-skill' },
    { kind: 'skill', value: 'web' },
    { kind: 'file', value: '{workflow}/notes.md' },
  ]
  expectOk(await repository.create('review'))
  expectOk(await repository.save('review', (document ?? graph)(items), { baseHash: null }))
  expectOk(await repository.saveVersion('review', 'v1'))
  return {
    repository,
    skillsRoot,
    ext,
    deps: {
      dataDir,
      repository,
      skills: viewer([{ name: 'my-skill', path: join(skillDir, 'SKILL.md') }, { name: 'web' }]),
      skillsRoot,
      plugin: '9.9.9',
      validate: (doc, workflow) => {
        const report = validateDocument(doc, { workflowName: workflow, maxNodes: 200 })
        return [...report.save, ...report.compile, ...report.warning, ...report.hint]
      },
    },
  }
}

/** 勾上：spec.md、my-skill（style.md 不勾）。 */
async function picks(deps: PackDeps): Promise<string[]> {
  const scan = expectOk(await scanPack(deps, { name: 'review', versions: [1] }))
  return scan.items
    .filter((item) => item.value.endsWith('spec.md') || item.value === 'my-skill')
    .map((item) => item.key)
}

async function download(dataDir: string, token: string): Promise<Map<string, string>> {
  const parts: Buffer[] = []
  let offset: number | null = 0
  while (offset !== null) {
    const chunk: { data: string; next: number | null } = expectOk(
      await readChunk(dataDir, token, offset),
    )
    parts.push(Buffer.from(chunk.data, 'base64'))
    offset = chunk.next
  }
  const entries = unzipSync(new Uint8Array(Buffer.concat(parts)))
  return new Map(Object.entries(entries).map(([path, data]) => [path, strFromU8(data)]))
}

const meta = { name: 'review-report', description: '读资料写报告', whenToUse: '要写报告时' }

describe('导出成 skill', () => {
  it('写到绝对路径的产出也要在本机确认；写在产出根目录下的不用', async () => {
    const ledger = slash(join(root, 'repo', 'docs', 'LEDGER.md'))
    const { deps } = await fixture((items) => {
      const document = graph(items)
      return {
        ...document,
        nodes: document.nodes.map((node) =>
          node.id === 'out'
            ? {
                ...node,
                data: {
                  items: [
                    { kind: 'file', value: 'report.md' },
                    { kind: 'file', value: ledger },
                  ],
                },
              }
            : node,
        ),
      } as WorkflowDocument
    })
    const preview = expectOk(
      await previewSkill(deps, { name: 'review', version: 1, pack: await picks(deps) }),
    )
    expect(preview.absolute).toContain(ledger)
    expect(preview.absolute).not.toContain('report.md')
    expect(preview.body).toContain(`\`${ledger}\``)
    expect(preview.body).toContain('要新写出来的，确认它的上一级文件夹在')
  })

  it('预览：正文是 skill 口径的计划，列出要提醒的事', async () => {
    const { deps } = await fixture()
    const preview = expectOk(
      await previewSkill(deps, { name: 'review', version: 1, pack: await picks(deps) }),
    )
    expect(preview.problems).toEqual([])
    expect(preview.steps).toEqual(['写报告'])
    expect(preview.needs).toEqual(['web'])
    expect(preview.absolute).toEqual([slash(join(root, 'ext', 'style.md'))])
    const body = preview.body
    expect(body).toContain('- **`{skill}`**：这个 skill 的目录')
    expect(body).toContain('`{skill}/steps/write.md`')
    // 打包的文件进了 assets/，资料目录也是
    expect(body).toContain('`{skill}/assets/spec.md`')
    expect(body).toContain('`{skill}/assets/notes.md`')
    // 打包的 skill 读包里的，没打包的由执行者自己加载（不点名工具）
    expect(body).toContain('Skill `my-skill`（在包里）')
    expect(body).toContain('读 `{skill}/skills/<名>/SKILL.md`')
    expect(body).toContain('确认这些 skill 在本机能加载（不在包里）：`web`。')
    for (const term of DSH_ONLY_TERMS) expect(body).not.toContain(term)
    // 产出根目录原样保留，`{instance}` 由执行者取编号
    expect(body).toContain('.workflow-lite/runs/{instance}/out/report.md')
    expect(body).toContain('- **`{instance}`**：这次执行的编号')
    // 输入节点：开始之前先问用户
    expect(body).toContain('. 先问用户下面的问题')
    expect(body).toContain('   - 写什么主题？（一句话，必填；交给 `write`）')
    // 没打包的绝对路径：开始之前先确认
    expect(body).toContain('确认这些文件和文件夹在本机')
    // 没有插件：不提 dataDir、运行状态
    expect(body).not.toContain('dataDir')
    expect(body).not.toContain('## 运行状态')
    expect(body).not.toContain('未指定')
  })

  it('旧写法 {assets} 的图（0.4.0 – 0.6.0 的数据）：照样进 assets/，计划里是 {skill}/assets/…', async () => {
    const { deps } = await fixture()
    for (const file of [
      workflowFile(deps.dataDir, 'review'),
      versionFile(deps.dataDir, 'review', 1),
    ]) {
      const text = await readFile(file, 'utf8')
      expect(text).toContain('{workflow}/notes.md')
      await writeFile(file, text.replaceAll('{workflow}/', '{assets}/'))
    }
    const request = { name: 'review', version: 1, pack: await picks(deps) }
    const preview = expectOk(await previewSkill(deps, request))
    expect(preview.body).toContain('`{skill}/assets/notes.md`')
    expect(preview.body).not.toContain('{assets}')
    expect(preview.body).not.toContain('{workflow}')
    const out = expectOk(await exportSkill(deps, { ...request, meta, target: 'zip' }))
    const files = await download(deps.dataDir, out.token as string)
    expect(files.get('review-report/assets/notes.md')).toBe('笔记')
    for (const [path, text] of files) {
      if (!path.endsWith('.md') || path.includes('/assets/')) continue
      expect(text, path).not.toContain('{assets}')
      expect(text, path).not.toContain('{workflow}')
    }
  })

  it('zip：<名>/SKILL.md + steps + assets + skills，路径都在包里', async () => {
    const { deps } = await fixture()
    const out = expectOk(
      await exportSkill(deps, {
        name: 'review',
        version: 1,
        pack: await picks(deps),
        meta,
        target: 'zip',
      }),
    )
    expect(out.fileName).toBe('review-report.zip')
    const files = await download(deps.dataDir, out.token as string)
    expect([...files.keys()].sort()).toEqual([
      'review-report/SKILL.md',
      'review-report/assets/notes.md',
      'review-report/assets/spec.md',
      'review-report/skills/my-skill/SKILL.md',
      'review-report/steps/write.md',
    ])
    const doc = files.get('review-report/SKILL.md') ?? ''
    expect(doc.startsWith('---\nname: review-report\ndescription: "读资料写报告"\n')).toBe(true)
    expect(doc).toContain('whenToUse: "要写报告时"\n---\n')
    const step = files.get('review-report/steps/write.md') ?? ''
    expect(step).toMatch(
      /^# [^\n]*write[^\n]*\n\n工作流 `[^`]+` 里的一个步骤。[^\n]+\n\n读资料，写报告/u,
    )
    expect(step).toContain('`{skill}/assets/spec.md`')
    // 本机的绝对路径只剩没打包的那一个
    expect(doc).not.toContain('spec.md`（')
  })

  it('装到本机：写进 skillsRoot；已经有了要明说覆盖', async () => {
    const { deps, skillsRoot } = await fixture()
    const request = {
      name: 'review',
      version: 1,
      pack: await picks(deps),
      meta,
      target: 'install' as const,
    }
    const first = expectOk(await exportSkill(deps, request))
    expect(first.path).toBe(slash(join(skillsRoot, 'review-report')))
    expect(await readFile(join(skillsRoot, 'review-report', 'assets', 'spec.md'), 'utf8')).toBe(
      '# 需求',
    )
    const again = await exportSkill(deps, request)
    expect(again.ok === false && again.error.code).toBe('conflict')
    await writeFile(join(skillsRoot, 'review-report', 'stale.md'), '旧的')
    expectOk(await exportSkill(deps, { ...request, replace: true }))
    await expect(readFile(join(skillsRoot, 'review-report', 'stale.md'))).rejects.toThrow()
    // 预览里认得出这个名字已经装过了
    const preview = expectOk(await previewSkill(deps, request))
    expect(preview.existing.find((item) => item.name === 'review-report')?.overwritable).toBe(true)
  })

  it('浏览整个包：预览时摆进暂存区，像文件夹一样列、读；SKILL.md 按填的头部现拼', async () => {
    const { deps } = await fixture()
    const preview = expectOk(
      await previewSkill(deps, { name: 'review', version: 1, pack: await picks(deps) }),
    )
    const token = preview.browse as string
    expect(token).toMatch(/^[a-f0-9]{24}$/u)

    const root = expectOk(await skillDir(deps.dataDir, { token, meta }))
    expect(root.display).toBe('review-report')
    expect(root.entries.map((entry) => `${entry.name}${entry.dir ? '/' : ''}`)).toEqual([
      'assets/',
      'skills/',
      'steps/',
      'SKILL.md',
    ])
    const steps = expectOk(await skillDir(deps.dataDir, { token, sub: 'steps', meta }))
    expect(steps.entries.map((entry) => entry.name)).toEqual(['write.md'])

    // SKILL.md：源码是完整的一份（含头部）；头部另外解析好，正文去掉头部
    const doc = expectOk(await skillFile(deps.dataDir, { token, sub: 'SKILL.md', meta }))
    expect(doc.kind).toBe('markdown')
    expect(doc.display).toBe('review-report/SKILL.md')
    expect(doc.text?.startsWith('---\nname: review-report\n')).toBe(true)
    expect(doc.head).toEqual({
      name: 'review-report',
      description: '读资料写报告',
      whenToUse: '要写报告时',
    })
    expect(doc.content?.startsWith('# review-report\n')).toBe(true)
    // 打包的 skill 里的 SKILL.md 同样拆出头部
    const nested = expectOk(
      await skillFile(deps.dataDir, { token, sub: 'skills/my-skill/SKILL.md' }),
    )
    expect(nested.head).toEqual({ name: 'my-skill', description: 'x' })
    expect(nested.content).toBe('正文')
    // 没有头部的就没有 head
    const step = expectOk(await skillFile(deps.dataDir, { token, sub: 'steps/write.md' }))
    expect(step.head).toBeUndefined()
    expect(step.text).toContain('读资料，写报告')

    // 走不出包；编号不对、清掉了都说清楚
    const out = await skillFile(deps.dataDir, { token, sub: '../body.md' })
    expect(out.ok === false && out.error.code).toBe('invalid_args')
    const bad = await skillDir(deps.dataDir, { token: 'nope' })
    expect(bad.ok === false && bad.error.code).toBe('not_found')
    const image = await skillImage(deps.dataDir, {
      token,
      sub: 'steps/write.md',
      src: '../../x.png',
    })
    expect(image.ok).toBe(false)
    await discard(deps.dataDir, token)
    const gone = await skillDir(deps.dataDir, { token })
    expect(gone.ok === false && gone.error.code).toBe('not_found')
  })

  it('YAML 头部：只认开头的 `---` … `---`，解析不了、不是键值就当没有', () => {
    expect(splitHead('---\nname: a\n---\n\n# 正文\n')).toEqual({
      head: { name: 'a' },
      content: '# 正文\n',
    })
    expect(splitHead('# 正文\n---\nname: a\n---\n')).toBeNull()
    expect(splitHead('---\n- a\n---\n正文')).toBeNull()
    expect(splitHead('---\nname: [\n---\n正文')).toBeNull()
  })

  it('名字不合规矩、有编译级问题：导不出来', async () => {
    const { deps } = await fixture()
    const bad = await exportSkill(deps, {
      name: 'review',
      version: 1,
      pack: [],
      meta: { ...meta, name: 'Review_Report' },
      target: 'zip',
    })
    expect(bad.ok === false && bad.error.code).toBe('invalid_args')

    await rm(root, { recursive: true, force: true })
    await mkdir(root, { recursive: true })
    const empty = await fixture((items) => {
      const document = graph(items)
      const [step] = document.nodes
      if (step !== undefined) step.data = { ...step.data, prompt: '' } as never
      return document
    })
    const preview = expectOk(
      await previewSkill(empty.deps, { name: 'review', version: 1, pack: [] }),
    )
    expect(preview.body).toBe('')
    expect(preview.problems.map((problem) => problem.code)).toContain('prompt_empty')
    const out = await exportSkill(empty.deps, {
      name: 'review',
      version: 1,
      pack: [],
      meta,
      target: 'zip',
    })
    expect(out.ok).toBe(false)
  })
})
