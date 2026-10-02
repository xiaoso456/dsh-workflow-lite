/**
 * dsh-workflow-lite — 实例里的产出文件：给画布看一眼（文件面板与查看框）。
 *
 * 只读、只认这个实例名下的文件：要么是快照里的文件节点，要么是落在实例工作区里的相对路径
 * （模型在状态文件 `outputs` 里写的那些）。工作区外的路径一律拒绝——这条路由不是通用的读文件口子。
 *
 * 读多少：小文本整份回去（`RUN_FILE_TEXT_MAX`），大了只回元信息让前端说"太大了"；
 * 前 8 KB 里有 NUL 字节就当二进制。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/files
 */

import { open, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { isFile } from '../../shared/model.ts'
import { resolveOutputPath } from '../../shared/outputPaths.ts'
import type { InstanceRecord } from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import { RUN_FILE_TEXT_MAX, type RunFileKind, type RunFileResponse } from '../../shared/wire.ts'
import type { Outcome } from '../store/repository.ts'

const SNIFF_BYTES = 8192
const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])

/** 要看哪份：快照里的文件节点，或实例工作区里的相对路径。 */
export type RunFileTarget = { node: string } | { path: string }

function inside(root: string, full: string): boolean {
  const rel = relative(root, full)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * 把目标解析成绝对路径与给人看的相对路径；越界或找不到就是错误。
 * @param underRoot - 相对路径按产出根目录解析（模型报告产出时可能是相对根目录写的）。
 */
export function resolveRunFile(
  record: InstanceRecord,
  document: WorkflowDocument,
  target: RunFileTarget,
  underRoot = false,
): Outcome<{ full: string; display: string }> {
  const cwd = record.cwd
  let display: string
  // 拼上了产出根目录（出自快照，可以信）；随手传进来的绝对路径不行。
  let fromRoot = true
  if ('node' in target) {
    const node = document.nodes.find((candidate) => candidate.id === target.node)
    if (node === undefined || !isFile(node)) {
      return {
        ok: false,
        error: { code: 'not_found', message: `快照里没有文件节点 ${target.node}` },
      }
    }
    display = resolveOutputPath(document.settings?.outputRoot, node.data.path)
  } else if (underRoot && !isAbsolute(target.path.trim())) {
    // 根目录可能是绝对路径（不在工作区里）：拼之前先拦掉往上跳的写法。
    if (target.path.split(/[\\/]/u).includes('..')) {
      return { ok: false, error: { code: 'invalid_args', message: '只能看实例工作区里的文件' } }
    }
    display = resolveOutputPath(document.settings?.outputRoot, target.path)
  } else {
    display = target.path.trim()
    fromRoot = false
  }
  if (isAbsolute(display)) {
    // 绝对路径（产出根目录写成了绝对路径）：只认根目录拼出来的，不认随手传进来的。
    if (!fromRoot) {
      return { ok: false, error: { code: 'invalid_args', message: '只能看实例工作区里的文件' } }
    }
    return { ok: true, result: { full: display, display } }
  }
  if (cwd === undefined) {
    return {
      ok: false,
      error: { code: 'invalid_args', message: '这个实例没有工作区，找不到相对路径的文件' },
    }
  }
  const full = resolve(join(cwd, display))
  if (!inside(resolve(cwd), full)) {
    return { ok: false, error: { code: 'invalid_args', message: '只能看实例工作区里的文件' } }
  }
  return { ok: true, result: { full, display } }
}

/** 读一份文件给画布：小文本带正文，其余只有元信息。 */
export async function readRunFile(full: string, display: string): Promise<RunFileResponse> {
  const base = {
    path: full,
    display,
    limit: RUN_FILE_TEXT_MAX,
  }
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(full)
  } catch {
    return { ...base, exists: false, size: 0, mtime: 0, kind: 'missing' }
  }
  if (!info.isFile()) return { ...base, exists: false, size: 0, mtime: 0, kind: 'missing' }
  const meta = { ...base, exists: true, size: info.size, mtime: info.mtimeMs }
  const handle = await open(full, 'r')
  try {
    const sniff = Buffer.alloc(Math.min(SNIFF_BYTES, info.size))
    await handle.read(sniff, 0, sniff.length, 0)
    if (sniff.includes(0)) return { ...meta, kind: 'binary' }
    if (info.size > RUN_FILE_TEXT_MAX) return { ...meta, kind: 'tooLarge' }
    const text = (await handle.readFile()).toString('utf8')
    const kind: RunFileKind = MARKDOWN.has(extname(full).toLowerCase()) ? 'markdown' : 'text'
    return { ...meta, kind, text }
  } finally {
    await handle.close()
  }
}
