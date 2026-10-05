/**
 * dsh-workflow-lite — 「工作流中心 · 存储」：数据目录的统计与清理。
 *
 * 统计数据目录里的几样东西：工作流、我的步骤、实例记录（`runs/` 下的图快照与回答）、
 * 旧版本遗留的任务描述（`.dispatch/`：早先编译时写在这里，现在任务描述放在各实例目录的 `tasks/` 里，
 * 不再有人写它、也不再有人读它）。
 *
 * 两样能清的东西：旧版遗留文件（随时可删）、已结束的实例记录（完成 / 已取消；只删索引条目与快照，
 * 工作区里的状态文件不动）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/storage
 */

import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { VERSIONS_DIR } from '../../shared/limits.ts'
import type { StorageStats } from '../../shared/wire.ts'
import { removeTree } from '../store/atomic.ts'
import { dispatchRoot, templatesDir, workflowsDir } from '../store/paths.ts'
import type { RunService } from './service.ts'
import { RUNS_DIR } from './store.ts'

export type StorageAction = 'stats' | 'clearDispatch' | 'clearFinished'

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
  const all = await runs.list(undefined, true)
  const [workflows, templates, versions, snapshots, dispatch] = await Promise.all([
    treeSize(workflowsDir(dataDir)),
    treeSize(templatesDir(dataDir)),
    treeSize(join(dataDir, VERSIONS_DIR)),
    treeSize(join(dataDir, RUNS_DIR)),
    treeSize(dispatchRoot(dataDir)),
  ])
  return {
    dataDir,
    workflows: workflows.files,
    workflowBytes: workflows.bytes,
    templates: templates.files,
    templateBytes: templates.bytes,
    versions: versions.files,
    versionBytes: versions.bytes,
    instances: all.length,
    finished: all.filter((item) => item.status === 'done' || item.status === 'cancelled').length,
    instanceBytes: snapshots.bytes,
    dispatchFiles: dispatch.files,
    dispatchBytes: dispatch.bytes,
    ...(cleared === undefined ? {} : { cleared }),
  }
}
