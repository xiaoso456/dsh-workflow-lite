/**
 * dsh-workflow-lite — 「工作流中心 · 存储」：数据目录的统计与清理。
 *
 * 统计数据目录里的几样东西：工作流、我的步骤、记忆库（连同记忆的版本）、实例记录（`runs/` 下的图快照与回答）、
 * 旧版本遗留的任务描述（`.dispatch/`：早先编译时写在这里，现在任务描述放在各实例目录的 `tasks/` 里，
 * 不再有人写它、也不再有人读它）。
 *
 * 三样能清的东西：旧版遗留文件（随时可删）、已结束的实例记录（完成 / 已取消；只删索引条目与快照，
 * 工作区里的状态文件不动）、各实例存下的产出旧版（`runs/<实例>/history/`，现在的文件不动）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/storage
 */

import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { MEMORY_VERSIONS_DIR, VERSIONS_DIR } from '../../shared/limits.ts'
import type { StorageStats } from '../../shared/wire.ts'
import { removeTree } from '../store/atomic.ts'
import { dispatchRoot, memoriesDir, templatesDir, workflowsDir } from '../store/paths.ts'
import { HISTORY_DIR } from './history.ts'
import type { RunService } from './service.ts'
import { RUNS_DIR } from './store.ts'

export type StorageAction = 'stats' | 'clearDispatch' | 'clearFinished' | 'clearHistory'

/** 各实例存下的产出旧版：每个实例目录下的 `history/`。 */
async function historyDirs(dataDir: string): Promise<string[]> {
  const names = await readdir(join(dataDir, RUNS_DIR)).catch(() => [] as string[])
  return names.map((name) => join(dataDir, RUNS_DIR, name, HISTORY_DIR))
}

async function treeSize(dir: string): Promise<{ files: number; bytes: number }> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return { files: 0, bytes: 0 }
  }
  let files = 0
  let bytes = 0
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const inner = await treeSize(full)
      files += inner.files
      bytes += inner.bytes
    } else if (entry.isFile()) {
      files += 1
      bytes += await stat(full).then(
        (info) => info.size,
        () => 0,
      )
    }
  }
  return { files, bytes }
}

/** 记忆库里有几条（数元数据文件）。 */
async function memoryCount(dir: string): Promise<number> {
  const names = await readdir(dir).catch(() => [] as string[])
  return names.filter((name) => name.endsWith('.json')).length
}

export async function storageAction(
  runs: RunService,
  dataDir: string,
  action: StorageAction,
): Promise<StorageStats> {
  let cleared: number | undefined
  if (action === 'clearDispatch') {
    cleared = (await treeSize(dispatchRoot(dataDir))).files
    await removeTree(dispatchRoot(dataDir))
  }
  if (action === 'clearFinished') {
    const finished = (await runs.list(undefined, true)).filter(
      (item) => item.status === 'done' || item.status === 'cancelled',
    )
    for (const item of finished) await runs.remove(item.id, false)
    cleared = finished.length
  }
  if (action === 'clearHistory') {
    cleared = 0
    for (const dir of await historyDirs(dataDir)) {
      cleared += (await treeSize(dir)).files
      await removeTree(dir)
    }
  }
  const all = await runs.list(undefined, true)
  const [
    workflows,
    templates,
    versions,
    memoryTree,
    memoryVersions,
    memories,
    snapshots,
    dispatch,
  ] = await Promise.all([
    treeSize(workflowsDir(dataDir)),
    treeSize(templatesDir(dataDir)),
    treeSize(join(dataDir, VERSIONS_DIR)),
    treeSize(memoriesDir(dataDir)),
    treeSize(join(dataDir, MEMORY_VERSIONS_DIR)),
    memoryCount(memoriesDir(dataDir)),
    treeSize(join(dataDir, RUNS_DIR)),
    treeSize(dispatchRoot(dataDir)),
  ])
  const histories = await Promise.all((await historyDirs(dataDir)).map(treeSize))
  return {
    dataDir,
    workflows: workflows.files,
    workflowBytes: workflows.bytes,
    templates: templates.files,
    templateBytes: templates.bytes,
    versions: versions.files,
    versionBytes: versions.bytes,
    memories,
    memoryBytes: memoryTree.bytes + memoryVersions.bytes,
    instances: all.length,
    finished: all.filter((item) => item.status === 'done' || item.status === 'cancelled').length,
    instanceBytes: snapshots.bytes,
    historyBytes: histories.reduce((sum, tree) => sum + tree.bytes, 0),
    dispatchFiles: dispatch.files,
    dispatchBytes: dispatch.bytes,
    ...(cleared === undefined ? {} : { cleared }),
  }
}
