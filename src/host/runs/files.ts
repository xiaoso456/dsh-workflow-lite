/**
 * dsh-workflow-lite — 实例里的文件：给画布看一眼（资源面板与查看框）。
 *
 * 只读、只认这个实例名下的文件：要么是快照里某个资源的文件项，要么是落在实例工作区里的相对路径
 * （模型在状态文件 `outputs` 里写的那些）。随手传进来的工作区外路径一律拒绝——这条路由不是通用的读文件口子。
 *
 * 读多少：小文本整份回去（`RUN_FILE_TEXT_MAX`），大了只回元信息让前端说"太大了"；
 * 前 8 KB 里有 NUL 字节就当二进制。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/files
 */

import { open, stat } from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { isResource } from '../../shared/model.ts'
import { resolveItemPath, resolveOutputPath } from '../../shared/outputPaths.ts'
import { resourceGraph } from '../../shared/resources.ts'
import type { InstanceRecord } from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import { RUN_FILE_TEXT_MAX, type RunFileKind, type RunFileResponse } from '../../shared/wire.ts'
import type { Outcome } from '../store/repository.ts'

const SNIFF_BYTES = 8192
const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])
const HTML = new Set(['.html', '.htm'])

/** 文本文件按扩展名分：Markdown、HTML（画布上都能排版着看），其余原样。 */
function textKind(full: string): RunFileKind {
  const ext = extname(full).toLowerCase()
  if (MARKDOWN.has(ext)) return 'markdown'
  return HTML.has(ext) ? 'html' : 'text'
}

/** 要看哪份：快照里某个资源的第几项，或实例工作区里的相对路径。 */
export type RunFileTarget = { node: string; item: number } | { path: string }

/**
 * 快照里一个资源的第几项实际在哪（还没拼工作区）；不是文件 / 文件夹就是 `null`。
 * 相对路径：有步骤写这个资源时在产出根目录下，只被读时相对工作区。
 */
export function itemLocation(
  document: WorkflowDocument,
  node: string,
  item: number,
): string | null {
  const resource = document.nodes.find((candidate) => candidate.id === node)
  if (resource === undefined || !isResource(resource)) return null
  const entry = resource.data.items[item]
  if (entry === undefined || (entry.kind !== 'file' && entry.kind !== 'folder')) return null
  if (entry.value.trim() === '') return null
  const written = (resourceGraph(document).get(resource.id)?.writers.length ?? 0) > 0
  return resolveItemPath(document.settings?.outputRoot, entry.value, written)
}

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
    const location = itemLocation(document, target.node, target.item)
    if (location === null) {
      return {
        ok: false,
        error: {
          code: 'not_found',
          message: `快照里资源 ${target.node} 没有第 ${target.item + 1} 项文件`,
        },
      }
    }
    display = location
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
    // 绝对路径（出自快照：资源里写的绝对路径、绝对的产出根目录）：认；随手传进来的不认。
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

/** 读一份文件给画布：小文本带正文，其余（含文件夹）只有元信息。 */
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
  // 资源里的文件夹项：给它的绝对路径与修改时间（右栏用来打开、列里面有什么），不读内容。
  if (info.isDirectory())
    return { ...base, exists: true, size: 0, mtime: info.mtimeMs, kind: 'folder' }
  if (!info.isFile()) return { ...base, exists: false, size: 0, mtime: 0, kind: 'missing' }
  const meta = { ...base, exists: true, size: info.size, mtime: info.mtimeMs }
  const handle = await open(full, 'r')
  try {
    const sniff = Buffer.alloc(Math.min(SNIFF_BYTES, info.size))
    await handle.read(sniff, 0, sniff.length, 0)
    if (sniff.includes(0)) return { ...meta, kind: 'binary' }
    if (info.size > RUN_FILE_TEXT_MAX) return { ...meta, kind: 'tooLarge' }
    const text = (await handle.readFile()).toString('utf8')
    return { ...meta, kind: textKind(full), text }
  } finally {
    await handle.close()
  }
}
