/**
 * 编辑时看资源里的文件夹（`src/host/store/graphFiles.ts`）：按存好的工作流找那一项，
 * `{workflow}` 指工作流目录，相对路径按当前对话的工作区，只许往下走。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { graphDir, graphFile, graphImage } from '../../src/host/store/graphFiles.ts'
import { assetsDir } from '../../src/host/store/paths.ts'
import { createRepository, type Outcome } from '../../src/host/store/repository.ts'
import { addGlobalMemory, addStepMemory } from '../../src/shared/presets.ts'
import { NODE_TYPE, type WorkflowDocument } from '../../src/shared/types.ts'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'wf-graph-files-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function expectOk<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(`${outcome.error.code}: ${outcome.error.message}`)
  return outcome.result
}

/** `review` 开着本工作流范围的记忆，另有一份本工作区范围的全局记忆；两边都攒了 SKILL.md。 */
async function fixture() {
  const dataDir = join(root, 'data')
  const workspace = join(root, 'ws')
  await mkdir(dataDir, { recursive: true })
  const repository = createRepository({ dataDir })
  let document: WorkflowDocument = {
    nodes: [{ id: 'review', type: NODE_TYPE, position: { x: 0, y: 0 }, data: { prompt: '审' } }],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  }
  document =
    addStepMemory(document, 'review', 'workflow', 'demo', { x: 0, y: 0 })?.document ?? document
  document = addGlobalMemory(document, 'workspace', 'demo', { x: 0, y: 0 }).document
  expectOk(await repository.create('demo'))
  expectOk(await repository.save('demo', document, { baseHash: null }))
  const step = join(assetsDir(dataDir, 'demo'), 'memory', 'mem-review')
  await mkdir(join(step, 'scripts'), { recursive: true })
  await writeFile(join(step, 'SKILL.md'), '# 审查\n')
  await writeFile(join(step, 'scripts', 'check.sh'), 'pnpm lint\n')
  const global = join(workspace, '.workflow-lite', 'memory', 'demo', 'mem-global')
  await mkdir(global, { recursive: true })
  await writeFile(join(global, 'SKILL.md'), '# 全局\n')
  return { deps: { repository, dataDir }, workspace }
}

describe('编辑时看资源里的文件夹', () => {
  it('本工作流的记忆在工作流目录里，不用知道工作区', async () => {
    const { deps } = await fixture()
    const target = { name: 'demo', node: 'mem-review', item: 0 }
    const dir = expectOk(await graphDir(deps, target))
    expect(dir.exists).toBe(true)
    expect(dir.entries.map((entry) => entry.name)).toEqual(['scripts', 'SKILL.md'])
    expect(expectOk(await graphFile(deps, target)).kind).toBe('folder')
    const skill = expectOk(await graphFile(deps, { ...target, sub: 'SKILL.md' }))
    expect(skill.text).toBe('# 审查\n')
    const sub = expectOk(await graphDir(deps, { ...target, sub: 'scripts' }))
    expect(sub.entries.map((entry) => entry.name)).toEqual(['check.sh'])
  })

  it('本工作区的记忆按当前对话的工作区找；不知道工作区就说清楚', async () => {
    const { deps, workspace } = await fixture()
    const target = { name: 'demo', node: 'mem-global', item: 0 }
    const skill = expectOk(await graphFile(deps, { ...target, cwd: workspace, sub: 'SKILL.md' }))
    expect(skill.text).toBe('# 全局\n')
    expect(skill.display).toBe('.workflow-lite/memory/demo/mem-global/SKILL.md')
    const blind = await graphDir(deps, target)
    expect(blind.ok).toBe(false)
    if (!blind.ok) expect(blind.error.message).toContain('不知道当前对话在哪个工作区')
  })

  it('还没攒下东西：文件夹不存在，照实说', async () => {
    const { deps } = await fixture()
    await rm(join(assetsDir(deps.dataDir, 'demo'), 'memory'), { recursive: true })
    const dir = expectOk(await graphDir(deps, { name: 'demo', node: 'mem-review', item: 0 }))
    expect(dir.exists).toBe(false)
    expect(
      expectOk(await graphFile(deps, { name: 'demo', node: 'mem-review', item: 0 })).kind,
    ).toBe('missing')
  })

  it('只认图里写着的那一项和它下面：往上走、不存在的节点、不是图片都拒绝', async () => {
    const { deps } = await fixture()
    const target = { name: 'demo', node: 'mem-review', item: 0 }
    expect((await graphFile(deps, { ...target, sub: '../../demo.json' })).ok).toBe(false)
    expect((await graphFile(deps, { ...target, node: 'nope' })).ok).toBe(false)
    expect((await graphFile(deps, { ...target, name: 'nope' })).ok).toBe(false)
    expect((await graphImage(deps, { ...target, sub: 'SKILL.md' })).ok).toBe(false)
  })
})
