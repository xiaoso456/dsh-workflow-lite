import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readFileText } from '../../../src/host/store/atomic.ts'
import {
  pathKind,
  versionFile,
  versionsDir,
  workflowFile,
  workflowsDir,
} from '../../../src/host/store/paths.ts'
import {
  createRepository,
  type Outcome,
  type Repository,
} from '../../../src/host/store/repository.ts'
import { parseVersion, versionText } from '../../../src/host/store/versions.ts'
import { MAX_VERSIONS } from '../../../src/shared/limits.ts'
import { readDocument, writeDocument } from '../../../src/shared/model.ts'
import {
  NODE_TYPE,
  type ToolError,
  type WorkflowDocument,
  type WorkflowNode,
} from '../../../src/shared/types.ts'

let root = ''
let repo: Repository

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-versions-'))
  repo = createRepository({ dataDir: root })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function step(id: string, prompt = '做事', x = 0): WorkflowNode {
  return { id, type: NODE_TYPE, position: { x, y: 0 }, data: { prompt } }
}

function doc(nodes: WorkflowNode[], zoom = 1): WorkflowDocument {
  return { nodes, edges: [], viewport: { x: 0, y: 0, zoom } }
}

function expectOk<T>(outcome: Outcome<T>): T {
  if (!outcome.ok)
    throw new Error(`期望成功，却失败：${outcome.error.code} ${outcome.error.message}`)
  return outcome.result
}

function expectError<T>(outcome: Outcome<T>): ToolError['error'] {
  if (outcome.ok) throw new Error('期望失败，却成功了')
  return outcome.error
}

async function seed(name: string, document: WorkflowDocument): Promise<void> {
  await mkdir(workflowsDir(root), { recursive: true })
  await writeFile(workflowFile(root, name), writeDocument(document))
}

async function graph(name: string): Promise<WorkflowDocument | null> {
  const text = await readFileText(workflowFile(root, name))
  return text === null ? null : readDocument(text).document
}

describe('版本文件', () => {
  it('写出去再读回来一样；坏文件读成没有图', () => {
    const document = doc([step('a')])
    const text = versionText({ n: 2, createdAt: 5, note: '说明', autoBefore: 1, document })
    expect(parseVersion(text, 2)).toEqual({
      n: 2,
      createdAt: 5,
      note: '说明',
      autoBefore: 1,
      document,
    })
    expect(parseVersion('{', 3).document).toBeNull()
    expect(parseVersion('[]', 3).document).toBeNull()
  })
})

describe('存版本', () => {
  it('序号从 1 往上数；新的在前；和现在一样的那个标 current', async () => {
    await seed('w', doc([step('a')]))
    const v1 = expectOk(await repo.saveVersion('w', '  第一版\n能跑  '))
    expect(v1).toMatchObject({ n: 1, note: '第一版 能跑', nodeCount: 1, current: true })

    await seed('w', doc([step('a'), step('b')]))
    const v2 = expectOk(await repo.saveVersion('w', ''))
    expect(v2.n).toBe(2)

    const list = expectOk(await repo.listVersions('w'))
    expect(list.map((entry) => [entry.n, entry.current])).toEqual([
      [2, true],
      [1, false],
    ])
    expect((await repo.list()).workflows.find((entry) => entry.name === 'w')?.versions).toBe(2)
  })

  it('内容和已有版本一样就不存；只动了视口不算改', async () => {
    await seed('w', doc([step('a')]))
    expectOk(await repo.saveVersion('w', ''))
    await seed('w', doc([step('a')], 1.5))
    const error = expectError(await repo.saveVersion('w', ''))
    expect(error.code).toBe('invalid_args')
    expect(error.detail?.same).toBe(1)
    expect(expectOk(await repo.listVersions('w'))[0]?.current).toBe(true)
  })

  it('说明太长、工作流不存在都拒绝', async () => {
    await seed('w', doc([step('a')]))
    expect(expectError(await repo.saveVersion('w', 'x'.repeat(501))).code).toBe('invalid_args')
    expect(expectError(await repo.saveVersion('nope', '')).code).toBe('not_found')
  })

  // 这条要写满 MAX_VERSIONS 个版本文件再剪枝：整套并行跑时默认 5s 不够（隔离跑约 0.3s）。
  it(`最多 ${MAX_VERSIONS} 个`, { timeout: 20_000 }, async () => {
    await seed('w', doc([step('a')]))
    await mkdir(versionsDir(root, 'w'), { recursive: true })
    for (let n = 1; n <= MAX_VERSIONS; n += 1) {
      await writeFile(
        versionFile(root, 'w', n),
        versionText({ n, createdAt: n, note: '', document: doc([step(`s${n}`)]) }),
      )
    }
    expect(expectError(await repo.saveVersion('w', '')).code).toBe('invalid_args')
  })
})

describe('切换版本', () => {
  it('现在的内容没存过：先自动存一份，再写回那个版本', async () => {
    await seed('w', doc([step('a')]))
    expectOk(await repo.saveVersion('w', 'v1'))
    await seed('w', doc([step('a', '改过')]))

    const restored = expectOk(await repo.restoreVersion('w', 1))
    expect(restored.saved).toMatchObject({ n: 2, autoBefore: 1, note: '', current: false })
    expect((await graph('w'))?.nodes[0]?.data).toEqual({ prompt: '做事' })

    // 再切回 v2：现在的内容就是 v1，不用再存。
    const back = expectOk(await repo.restoreVersion('w', 2))
    expect(back.saved).toBeNull()
    expect((await graph('w'))?.nodes[0]?.data).toEqual({ prompt: '改过' })
    expect(expectOk(await repo.listVersions('w')).map((entry) => entry.n)).toEqual([2, 1])
  })

  it('切换后画布拿新哈希接着存，不报冲突', async () => {
    await seed('w', doc([step('a')]))
    expectOk(await repo.saveVersion('w', ''))
    await seed('w', doc([step('b')]))
    const loaded = await repo.load('w')
    const { hash } = expectOk(await repo.restoreVersion('w', 1))
    expect(hash).not.toBe(loaded.hash)
    expectOk(await repo.save('w', doc([step('a', '接着改')]), { baseHash: hash }))
    expect((await graph('w'))?.nodes[0]?.data).toEqual({ prompt: '接着改' })
  })

  it('不存在的版本、坏掉的版本文件都不切', async () => {
    await seed('w', doc([step('a')]))
    expect(expectError(await repo.restoreVersion('w', 9)).code).toBe('not_found')
    await mkdir(versionsDir(root, 'w'), { recursive: true })
    await writeFile(versionFile(root, 'w', 1), '{ 坏了')
    expect(expectError(await repo.restoreVersion('w', 1)).code).toBe('blocked')
    expect(expectOk(await repo.listVersions('w'))[0]).toMatchObject({ n: 1, invalid: true })
  })
})

describe('说明、删除、跟着工作流走', () => {
  it('改说明、读版本、删版本', async () => {
    await seed('w', doc([step('a')]))
    expectOk(await repo.saveVersion('w', ''))
    expect(expectOk(await repo.noteVersion('w', 1, '稳定版')).note).toBe('稳定版')
    const read = expectOk(await repo.readVersion('w', 1))
    expect(read.entry.note).toBe('稳定版')
    expect(read.document.nodes.map((node) => node.id)).toEqual(['a'])
    expectOk(await repo.deleteVersion('w', 1))
    expect(expectOk(await repo.listVersions('w'))).toEqual([])
    expect(expectError(await repo.deleteVersion('w', 1)).code).toBe('not_found')
  })

  it('改名带着版本走；删工作流连版本一起删', async () => {
    await seed('w', doc([step('a')]))
    expectOk(await repo.saveVersion('w', ''))
    expectOk(await repo.rename('w', 'x'))
    expect(await pathKind(versionsDir(root, 'w'))).toBe('missing')
    expect(expectOk(await repo.listVersions('x')).map((entry) => entry.n)).toEqual([1])

    expectOk(await repo.remove('x'))
    expect(await pathKind(versionsDir(root, 'x'))).toBe('missing')
  })

  it('改到的新名字下有没人认领的旧版本：清掉，不混进来', async () => {
    await seed('w', doc([step('a')]))
    await mkdir(versionsDir(root, 'x'), { recursive: true })
    await writeFile(
      versionFile(root, 'x', 1),
      versionText({ n: 1, createdAt: 1, note: '旧的', document: doc([step('z')]) }),
    )
    expectOk(await repo.rename('w', 'x'))
    expect(expectOk(await repo.listVersions('x'))).toEqual([])
  })
})
