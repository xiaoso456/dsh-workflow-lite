/**
 * dsh-workflow-lite — 实例里的文件：给画布看一眼（资源面板与查看框）。
 *
 * 只读、只认这个实例名下的文件：要么是快照里某个资源的文件项，要么是落在实例工作区里的相对路径
 * （模型在状态文件 `outputs` 里写的那些）。随手传进来的工作区外路径一律拒绝——这条路由不是通用的读文件口子。
 *
 * 读多少：小文本整份回去（`RUN_FILE_TEXT_MAX`，HTML 另按 `RUN_FILE_HTML_MAX` 放宽），大了只回元信息
 * 让前端说"太大了"；前 8 KB 里有 NUL 字节就当二进制。
 *
 * @module @xiaoso/dsh-workflow-lite/host/runs/files
 */

import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { isResource } from '../../shared/model.ts'
import { resolveItemPath, resolveOutputPath } from '../../shared/outputPaths.ts'
import { resourceGraph } from '../../shared/resources.ts'
import type { InstanceRecord } from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import {
  RUN_DIR_MAX,
  RUN_FILE_HTML_MAX,
  RUN_FILE_TEXT_MAX,
  RUN_IMAGE_MAX,
  type RunDirEntry,
  type RunDirResponse,
  type RunFileKind,
  type RunFileResponse,
  type RunImageResponse,
} from '../../shared/wire.ts'
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

/**
 * 要看哪份：快照里某个资源的第几项（文件夹项可以再带 `sub`：往下走的相对路径），
 * 或实例工作区里的相对路径。
 */
export type RunFileTarget = { node: string; item: number; sub?: string } | { path: string }

/**
 * 整理文件夹里的相对路径：`/`、`\` 都当分隔符，空段和 `.` 去掉；`..`、盘符、绝对路径、空字符一律拒绝
 * （只许往下走）。回 `/` 分隔、没有首尾斜杠的串，根是空串。
 */
export function cleanSub(sub: string | undefined): Outcome<string> {
  const parts = (sub ?? '').split(/[\\/]+/u).filter((part) => part !== '' && part !== '.')
  const bad = parts.find((part) => part === '..' || part.includes(':') || part.includes('\u0000'))
  if (bad !== undefined) {
    return { ok: false, error: { code: 'invalid_args', message: '只能看文件夹里面的东西' } }
  }
  return { ok: true, result: parts.join('/') }
}

/**
 * `full` 真实位置（软链也算）还在 `root` 里面吗？`full` 还不存在时看不出，放行（读它自会说不存在）。
 * 文件夹里放一个指向外面的软链，不该成为读任意文件的口子。
 */
export async function realInside(root: string, full: string): Promise<boolean> {
  try {
    const base = await realpath(root)
    const real = await realpath(full)
    return real === base || inside(base, real)
  } catch {
    return true
  }
}

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
): Outcome<{ full: string; display: string; root?: string }> {
  const base = resolveBase(record, document, target, underRoot)
  if (!base.ok || !('node' in target) || target.sub === undefined) return base
  // 文件夹里的一份：在文件夹项的位置上往下走，不许走出去。
  const sub = cleanSub(target.sub)
  if (!sub.ok) return sub
  if (sub.result === '') return base
  const full = resolve(base.result.full, ...sub.result.split('/'))
  if (!inside(resolve(base.result.full), full)) {
    return { ok: false, error: { code: 'invalid_args', message: '只能看文件夹里面的东西' } }
  }
  return {
    ok: true,
    result: {
      full,
      display: `${base.result.display.replace(/[\\/]+$/u, '')}/${sub.result}`,
      root: base.result.full,
    },
  }
}

function resolveBase(
  record: InstanceRecord,
  document: WorkflowDocument,
  target: RunFileTarget,
  underRoot: boolean,
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

/** 能当图片看的扩展名。 */
const IMAGE_MIME: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
}

/**
 * Markdown 里引用的图片在哪：`src` 按文档所在目录解析（去掉 `?…` / `#…`）。
 * 只认相对路径与图片扩展名；结果要在工作区里，或在文档自己的目录下（产出根目录可能是工作区外的绝对路径）。
 */
export function resolveImageRef(
  cwd: string | undefined,
  docFull: string,
  src: string,
): Outcome<{ full: string; mime: string }> {
  const bare = src.trim().replace(/[?#].*$/u, '')
  const refused = (message: string): Outcome<never> => ({
    ok: false,
    error: { code: 'invalid_args', message },
  })
  if (bare === '' || isAbsolute(bare) || /^[a-z][a-z0-9+.-]*:/iu.test(bare)) {
    return refused(`只能看文档旁边的相对路径图片：${src}`)
  }
  const mime = IMAGE_MIME[extname(bare).toLowerCase()]
  if (mime === undefined) return refused(`不是图片：${src}`)
  const docDir = dirname(docFull)
  const full = resolve(docDir, bare)
  const allowed = inside(resolve(docDir), full) || (cwd !== undefined && inside(resolve(cwd), full))
  if (!allowed) return refused(`图片不在实例工作区里：${src}`)
  return { ok: true, result: { full, mime } }
}

/** 文件自己当图看：按扩展名认类型（和 {@link resolveImageRef} 同一张表），不是图片就拒绝。 */
export function resolveSelfImage(full: string): Outcome<{ full: string; mime: string }> {
  const mime = IMAGE_MIME[extname(full).toLowerCase()]
  if (mime === undefined) {
    return { ok: false, error: { code: 'invalid_args', message: `不是图片：${full}` } }
  }
  return { ok: true, result: { full, mime } }
}

/** 读一张图（上限 {@link RUN_IMAGE_MAX}）。 */
export async function readRunImage(full: string, mime: string): Promise<Outcome<RunImageResponse>> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(full)
  } catch {
    return { ok: false, error: { code: 'not_found', message: `图片不存在：${full}` } }
  }
  if (!info.isFile()) {
    return { ok: false, error: { code: 'not_found', message: `图片不存在：${full}` } }
  }
  if (info.size > RUN_IMAGE_MAX) {
    return { ok: false, error: { code: 'invalid_args', message: `图片太大：${full}` } }
  }
  return { ok: true, result: { mime, data: (await readFile(full)).toString('base64') } }
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
  const kind = textKind(full)
  const limit = kind === 'html' ? RUN_FILE_HTML_MAX : RUN_FILE_TEXT_MAX
  const meta = { ...base, exists: true, size: info.size, mtime: info.mtimeMs, limit }
  const handle = await open(full, 'r')
  try {
    const sniff = Buffer.alloc(Math.min(SNIFF_BYTES, info.size))
    await handle.read(sniff, 0, sniff.length, 0)
    if (sniff.includes(0)) return { ...meta, kind: 'binary' }
    if (info.size > limit) return { ...meta, kind: 'tooLarge' }
    const text = (await handle.readFile()).toString('utf8')
    return { ...meta, kind, text }
  } finally {
    await handle.close()
  }
}

/** 列一层目录：目录在前、各自按名字排（数字按大小）；读不了的条目（断了的软链）跳过。 */
export async function readRunDir(
  full: string,
  display: string,
  sub: string,
): Promise<RunDirResponse> {
  const base = { path: full, display, sub }
  let names: string[]
  try {
    names = await readdir(full)
  } catch {
    return { ...base, exists: false, entries: [], truncated: false }
  }
  const entries: RunDirEntry[] = []
  await Promise.all(
    names.slice(0, RUN_DIR_MAX).map(async (name) => {
      try {
        const info = await stat(join(full, name))
        const dir = info.isDirectory()
        entries.push({ name, dir, size: dir ? 0 : info.size, mtime: info.mtimeMs })
      } catch {
        // 断了的软链、刚被删掉的：不列。
      }
    }),
  )
  entries.sort((a, b) =>
    a.dir === b.dir ? a.name.localeCompare(b.name, undefined, { numeric: true }) : a.dir ? -1 : 1,
  )
  return { ...base, exists: true, entries, truncated: names.length > RUN_DIR_MAX }
}
