/**
 * 工作流中心 · 存储：各样东西的计数与占用，清理旧版遗留文件。
 */

import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { RunService } from '../../src/host/runs/service.ts'
import { storageAction } from '../../src/host/runs/storage.ts'

let dataDir: string
let runs: RunService

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'workflow-lite-storage-'))
  runs = new RunService({ dataDir: () => dataDir, validate: () => [] })
})

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

describe('storageAction', () => {
  it('空目录：全是 0，不报错', async () => {
    const stats = await storageAction(runs, dataDir, 'stats')
    expect(stats).toEqual({
      dataDir,
      workflows: 0,
      workflowBytes: 0,
      templates: 0,
      templateBytes: 0,
      instances: 0,
      finished: 0,
      instanceBytes: 0,
      dispatchFiles: 0,
      dispatchBytes: 0,
    })
  })

  it('数工作流、我的步骤、实例快照、旧版遗留文件；清理旧版遗留文件后它们归零', async () => {
    await mkdir(join(dataDir, 'workflows'), { recursive: true })
    await writeFile(join(dataDir, 'workflows', 'a.json'), '{}')
    await writeFile(join(dataDir, 'workflows', 'b.json'), '{"x":1}')
    await mkdir(join(dataDir, 'templates', 'nodes'), { recursive: true })
    await writeFile(join(dataDir, 'templates', 'nodes', 't.json'), '12345')
    await mkdir(join(dataDir, 'runs', 'r1'), { recursive: true })
    await writeFile(join(dataDir, 'runs', 'r1', 'graph.json'), '1234567890')
    await mkdir(join(dataDir, '.dispatch', 'wf', 'plan'), { recursive: true })
    await writeFile(join(dataDir, '.dispatch', 'wf', 'plan', 'n1.md'), 'abc')
    await writeFile(join(dataDir, '.dispatch', 'wf', 'plan', 'n2.md'), 'de')

    const stats = await storageAction(runs, dataDir, 'stats')
    expect(stats).toMatchObject({
      workflows: 2,
      workflowBytes: 9,
      templates: 1,
      templateBytes: 5,
      instanceBytes: 10,
      dispatchFiles: 2,
      dispatchBytes: 5,
    })
    expect(stats.cleared).toBeUndefined()

    const cleared = await storageAction(runs, dataDir, 'clearDispatch')
    expect(cleared).toMatchObject({ cleared: 2, dispatchFiles: 0, dispatchBytes: 0, workflows: 2 })
    await expect(stat(join(dataDir, '.dispatch'))).rejects.toThrow()
  })
})
