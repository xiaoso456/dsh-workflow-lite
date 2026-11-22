import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashOf } from '../../../src/host/store/atomic.ts'
import { DATABASE_FILE } from '../../../src/host/store/database.ts'
import { upgradeWorkflowIdentity } from '../../../src/host/store/migrations/workflowIdentity.ts'
import { assetsDir, dispatchDir, workflowFile } from '../../../src/host/store/paths.ts'
import type { Outcome } from '../../../src/host/store/repoResult.ts'
import { createRepository, type Repository } from '../../../src/host/store/repository.ts'
import { createTriggerGraphs } from '../../../src/host/triggers/graphs.ts'
import type { WorkflowDocument } from '../../../src/shared/types.ts'

let root: string
let repository: Repository

const document: WorkflowDocument = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function check<T>(result: Outcome<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.result
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workflow-identity-'))
  repository = createRepository({ dataDir: root })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('工作流持久 ID', () => {
  it('名称和 ID 分开查找，即使一个名称恰好是另一个工作流的 ID', async () => {
    check(await repository.create('日报'))
    const original = repository.workflowByName('日报')
    if (original === undefined) throw new Error('缺少工作流身份')
    check(await repository.create(original.id))
    expect(repository.workflowByName(original.id)?.id).not.toBe(original.id)
    expect(repository.workflowById(original.id)).toEqual(original)
  })

  it('新增分配 ID，保存、恢复版本和改名沿用 ID', async () => {
    check(await repository.create('旧名'))
    const first = await repository.load('旧名')
    const id = first.document?.workflowId
    expect(id).toMatch(uuid)
    if (id === undefined) throw new Error('工作流没有 ID')
    expect(repository.workflowById(id)?.name).toBe('旧名')
    expect(JSON.parse(await readFile(workflowFile(root, '旧名'), 'utf8')).workflowId).toBe(id)
    const directory = assetsDir(root, '旧名')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'sample.txt'), '原资料')
    const dispatch = dispatchDir(root, '旧名')
    await mkdir(dispatch, { recursive: true })
    check(await repository.saveVersion('旧名', '初版'))
    check(
      await repository.save(
        '旧名',
        {
          ...document,
          workflowId: '8e26ac2c-4e4e-44b7-bbb2-aa6f081ab9ef',
        },
        { baseHash: first.hash },
      ),
    )
    check(await repository.restoreVersion('旧名', 1))
    check(await repository.rename('旧名', '新名'))
    expect((await repository.load('新名')).document?.workflowId).toBe(id)
    expect(repository.workflowById(id)?.name).toBe('新名')
    await expect(lstat(dispatch)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(assetsDir(root, '新名'), 'sample.txt'), 'utf8')).toBe('原资料')
    expect(check(await repository.listVersions('新名')).map(({ n }) => n)).toContain(1)
  })

  it('导入新图会分配 ID，并入保留目标图的 ID', async () => {
    check(await repository.create('目标'))
    const target = (await repository.load('目标')).document
    expect(target?.workflowId).toMatch(uuid)
    if (target === null) throw new Error('缺少目标工作流')
    check(
      await repository.importWorkflow({ mode: 'new', name: '副本', versions: [], current: target }),
    )
    expect((await repository.load('副本')).document?.workflowId).toMatch(uuid)
    expect((await repository.load('副本')).document?.workflowId).not.toBe(target.workflowId)
    check(
      await repository.importWorkflow({
        mode: 'merge',
        name: '目标',
        versions: [],
        current: document,
      }),
    )
    expect((await repository.load('目标')).document?.workflowId).toBe(target.workflowId)
  })

  it('图损坏后通过版本恢复时保留文件里的 ID', async () => {
    check(await repository.create('日报'))
    const workflowId = repository.workflowByName('日报')?.id
    expect(workflowId).toMatch(uuid)
    check(await repository.saveVersion('日报', '初版'))
    await writeFile(workflowFile(root, '日报'), JSON.stringify({ workflowId, nodes: '损坏' }))
    expect((await repository.load('日报')).loadable).toBe(false)
    check(await repository.restoreVersion('日报', 1))
    expect((await repository.load('日报')).document?.workflowId).toBe(workflowId)
  })

  it('同名新建的图拒收旧身份的画布保存', async () => {
    check(await repository.create('日报'))
    const removed = await repository.load('日报')
    if (removed.document === null) throw new Error('缺少工作流')
    check(await repository.remove('日报'))
    check(await repository.create('日报'))
    const replacement = await repository.load('日报')
    expect(replacement.document?.workflowId).not.toBe(removed.document.workflowId)
    const save = await repository.save('日报', removed.document, { baseHash: removed.hash })
    expect(save).toMatchObject({ ok: false, error: { code: 'conflict' } })
  })

  it('读取触发图时拒绝名称查找与读图之间换掉的身份', async () => {
    check(await repository.create('日报'))
    const original = repository.workflowByName('日报')
    if (original === undefined) throw new Error('缺少工作流身份')
    const graphs = createTriggerGraphs({
      ...repository,
      async load(name) {
        check(await repository.remove(name))
        check(await repository.create(name))
        return repository.load(name)
      },
    })
    expect(await graphs.readById(original.id)).toMatchObject({ kind: 'broken' })
    const current = (await repository.load('日报')).document?.workflowId
    expect(current).not.toBe(original.id)
    const staleLookup = createTriggerGraphs({
      ...repository,
      workflowById: () => original,
    })
    expect(await staleLookup.readById(original.id)).toEqual({ kind: 'missing' })
  })

  it('磁盘手工复制相同 ID 的图时，删除副本不会返回原图的 ID', async () => {
    check(await repository.create('日报'))
    const directory = assetsDir(root, '日报')
    await mkdir(directory, { recursive: true })
    await writeFile(workflowFile(root, '副本'), await readFile(workflowFile(root, '日报')))
    expect((await repository.list()).workflows.map(({ invalid }) => invalid)).toEqual([true, true])
    const removed = check(await repository.remove('副本'))
    expect(removed.changed[0]?.detail?.workflowId).toBeUndefined()
    expect((await lstat(directory)).isDirectory()).toBe(true)
  })
})

describe('正式版工作流数据升级', () => {
  it('普通保存和恢复版本不分配身份，由启动升级补上', async () => {
    await publishedFixture()
    const current = await repository.load('日报')
    check(await repository.save('日报', document, { baseHash: current.hash }))
    check(await repository.restoreVersion('日报', 1))
    expect((await repository.load('日报')).document?.workflowId).toBeUndefined()
    await upgradeWorkflowIdentity(root)
    expect((await repository.load('日报')).document?.workflowId).toMatch(uuid)
  })

  async function publishedFixture(): Promise<void> {
    for (const dir of ['workflows', 'assets/日报', 'versions/日报']) {
      await mkdir(join(root, dir), { recursive: true })
    }
    await writeFile(
      workflowFile(root, '日报'),
      JSON.stringify({ ...document, unknown: { keep: true } }),
    )
    await writeFile(join(root, 'assets', '日报', 'notes.md'), '旧资料')
    await writeFile(
      join(root, 'versions', '日报', '1.json'),
      JSON.stringify({
        format: 1,
        n: 1,
        createdAt: 10,
        note: '已发布',
        document,
      }),
    )
    await writeFile(
      join(root, 'instances.json'),
      JSON.stringify({
        version: 1,
        instances: [
          { id: '20261112-100000-36ae', workflow: '日报', statePath: '状态路径' },
          { id: '20261112-120000-229a', workflow: '已删除' },
        ],
        current: { session: '20261112-100000-36ae' },
      }),
    )
  }

  it('升级正式版图、版本和实例，旧计划的绝对资料路径仍然有效', async () => {
    await publishedFixture()
    await Promise.all([upgradeWorkflowIdentity(root), upgradeWorkflowIdentity(root)])
    const graph = await repository.load('日报')
    const id = graph.document?.workflowId
    expect(id).toMatch(uuid)
    if (id === undefined) throw new Error('迁移没有写出 ID')
    expect(await readFile(join(root, 'assets', '日报', 'notes.md'), 'utf8')).toBe('旧资料')
    await expect(lstat(join(root, 'assets', id))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(JSON.parse(await readFile(workflowFile(root, '日报'), 'utf8')).unknown).toEqual({
      keep: true,
    })
    expect(JSON.parse(await readFile(join(root, 'instances.json'), 'utf8'))).toEqual({
      version: 1,
      instances: [
        { id: '20261112-100000-36ae', workflow: '日报', workflowId: id, statePath: '状态路径' },
        { id: '20261112-120000-229a', workflow: '已删除' },
      ],
      current: { session: '20261112-100000-36ae' },
    })
    expect(check(await repository.listVersions('日报'))).toMatchObject([{ n: 1, current: true }])
    check(await repository.rename('日报', '每天'))
    expect(await readFile(join(assetsDir(root, '每天'), 'notes.md'), 'utf8')).toBe('旧资料')
    await upgradeWorkflowIdentity(root)
    expect((await repository.load('每天')).document?.workflowId).toBe(id)
    check(await repository.remove('每天'))
    await expect(lstat(join(root, 'assets', '日报'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('补写工作流 ID 后中断，重启复用登记的 ID', async () => {
    await publishedFixture()
    const id = '8e26ac2c-4e4e-44b7-bbb2-aa6f081ab9ef'
    const journal = join(root, '.migration-workflow-id.json')
    const hash = await hashOf(await readFile(workflowFile(root, '日报'), 'utf8'))
    await writeFile(journal, JSON.stringify([{ name: '日报', id, hash }]))
    await writeFile(workflowFile(root, '日报'), JSON.stringify({ ...document, workflowId: id }))

    await upgradeWorkflowIdentity(root)

    expect((await repository.load('日报')).document?.workflowId).toBe(id)
    expect(await readFile(join(root, 'assets', '日报', 'notes.md'), 'utf8')).toBe('旧资料')
    await expect(lstat(journal)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('全新安装不需要迁移：不打开数据库、不留迁移记录，数据目录不存在也不报错', async () => {
    const sqlite = vi.spyOn(process, 'getBuiltinModule')
    try {
      await upgradeWorkflowIdentity(root)
      await upgradeWorkflowIdentity(join(root, '尚未建立'))
      check(await repository.create('新图'))
      await upgradeWorkflowIdentity(root)
      expect(sqlite).not.toHaveBeenCalled()
    } finally {
      sqlite.mockRestore()
    }
    await expect(lstat(join(root, '尚未建立'))).rejects.toMatchObject({ code: 'ENOENT' })
    const left = await readdir(root)
    expect(left).not.toContain(DATABASE_FILE)
    expect(left).not.toContain('.migration-workflow-id.json')
  })
})
