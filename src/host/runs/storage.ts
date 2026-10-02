/**
 * dsh-workflow-lite — 「工作流中心 · 存储」：数据目录的统计与清理。
 *
 * 两样能清的东西：派发缓存（`.dispatch/`，编译时物化的载荷，随时可删，代价是在途计划失效）、
 * 已结束的实例记录（完成 / 已取消；只删索引条目与快照，工作区里的状态文件不动）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/storage
 */

import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { StorageStats } from '../../shared/wire.ts'
import { removeTree } from '../store/atomic.ts'
import { dispatchRoot } from '../store/paths.ts'
import type { RunService } from './service.ts'

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
  const dispatch = await treeSize(dispatchRoot(dataDir))
  return {
    dataDir,
    instances: all.length,
    finished: all.filter((item) => item.status === 'done' || item.status === 'cancelled').length,
    dispatchFiles: dispatch.files,
    dispatchBytes: dispatch.bytes,
    ...(cleared === undefined ? {} : { cleared }),
  }
}
