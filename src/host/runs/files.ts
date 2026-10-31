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

import { lstat, open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileKindOf } from '../../shared/fileKind.ts'
import { isResource } from '../../shared/model.ts'
import { resolveItemPath, resolveOutputPath } from '../../shared/outputPaths.ts'
import { resourceGraph, underOutputRoot } from '../../shared/resources.ts'
import type { InstanceRecord } from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import {
  RUN_DIR_COUNTED,
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

/** UTF-16 的两种 BOM（这种文件里全是 0 字节，不先认出来就被当成二进制）。 */
const UTF16_BOM = { le: [0xff, 0xfe], be: [0xfe, 0xff] } as const
const startsWith = (bytes: Uint8Array, head: readonly number[]): boolean =>
  head.every((byte, index) => bytes[index] === byte)

/** 宿主的 Node 不带这套编码（没有完整的 ICU）时是 `null`。 */
function decoder(label: string, fatal = false): TextDecoder | null {
  try {
    return new TextDecoder(label, { fatal })
  } catch {
    return null
  }
}

/**
 * 文本文件按什么编码读：带 BOM 的按 BOM（UTF-8 / UTF-16，BOM 本身不留在正文里）；没有的先按 UTF-8 严格解，
 * 解不通再退到 GB18030（GBK 的超集：Windows 上的中文日志、记事本存的文件多半是它）。
 * 宿主没有这套编码时按 UTF-8 宽松读（认不出的字节成了替换符）。
 */
export function decodeText(bytes: Uint8Array): string {
  if (startsWith(bytes, UTF16_BOM.le)) return (decoder('utf-16le') as TextDecoder).decode(bytes)
  const be = startsWith(bytes, UTF16_BOM.be) ? decoder('utf-16be') : null
  if (be !== null) return be.decode(bytes)
  // TextDecoder 默认就把开头的 UTF-8 BOM 去掉。
  try {
    return (decoder('utf-8', true) as TextDecoder).decode(bytes)
  } catch {
    return (decoder('gb18030') ?? new TextDecoder('utf-8')).decode(bytes)
  }
}

/** 开头是 UTF-16 的 BOM（里面的 0 字节不算二进制）。 */
export const isUtf16 = (bytes: Uint8Array): boolean =>
  startsWith(bytes, UTF16_BOM.le) || startsWith(bytes, UTF16_BOM.be)
const MARKDOWN = new Set(['.md', '.markdown', '.mdx'])
const HTML = new Set(['.html', '.htm'])

/** 文本文件按扩展名分：Markdown、HTML（画布上都能排版着看），其余原样。 */
function textKind(full: string): RunFileKind {
  const ext = extname(full).toLowerCase()
  if (MARKDOWN.has(ext)) return 'markdown'
  return HTML.has(ext) ? 'html' : 'text'
}

/**
 * 要看哪份：快照里某个资源的第几项（文件夹项可以再带 `sub`：往下走的相对路径；文件项可以带 `version`：
 * 存下的第几版，见 `history.ts`），或实例工作区里的相对路径。
 */
export type RunFileTarget =
  | { node: string; item: number; sub?: string; version?: number }
  | { path: string }

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
  const written = underOutputRoot(resourceGraph(document).get(resource.id))
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
  record: Pick<InstanceRecord, 'cwd'>,
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
  record: Pick<InstanceRecord, 'cwd'>,
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

/**
 * 读一份文件给画布：小文本带正文，其余（含文件夹）只有元信息。
 * `tail`：太大的文本不说「太大」，读最后 `limit` 字节（从下一个换行起，不留半行），`cut` 是前面没读的字节数——
 * 日志要看的是最新那几行。UTF-16 的不这么读（从中间切开对不上字节）。
 */
export async function readRunFile(
  full: string,
  display: string,
  options: { tail?: boolean } = {},
): Promise<RunFileResponse> {
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
    if (sniff.includes(0) && !isUtf16(sniff)) return { ...meta, kind: 'binary' }
    if (info.size > limit && options.tail === true && kind === 'text' && !isUtf16(sniff)) {
      const bytes = Buffer.alloc(limit)
      const { bytesRead } = await handle.read(bytes, 0, limit, info.size - limit)
      // 切在一行中间（多半也切在一个字的中间）：从下一个换行之后开始。
      const newline = bytes.indexOf(0x0a)
      const start = newline < 0 || newline >= bytesRead - 1 ? 0 : newline + 1
      const cut = info.size - limit + start
      return { ...meta, kind, text: decodeText(bytes.subarray(start, bytesRead)), cut }
    }
    if (info.size > limit) return { ...meta, kind: 'tooLarge' }
    const text = decodeText(await handle.readFile())
    return { ...meta, kind, text }
  } finally {
    await handle.close()
  }
}

/** 大文件夹每回只再看这么多份最近改过的（往里加、删、改名改的是文件夹自己的时间，不用逐份看）。 */
const DIR_HOT = 64
/** 隔这么久整份重看一次：原地改写一份不在「最近」里的旧文件，最多晚这么久看到。 */
const DIR_RESCAN_MS = 60_000
/** 记着几个文件夹的上回结果（画布上同时展示的文件夹不会多）。 */
const DIR_SCANS_MAX = 128

interface DirScan {
  /** 整份看时文件夹自己的修改时间：变了就是加、删、改名过，要重看。 */
  dirMtime: number
  at: number
  count: number
  newest: number
  /** 最近改过的那几份。 */
  hot: string[]
}

const dirScans = new Map<string, DirScan>()

async function mtimeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return 0
  }
}

/**
 * 一个路径现在的样子（画布展示问在不在、变没变）：文件是大小与修改时间；文件夹的「大小」是这一层有几项，
 * 修改时间取它自己和这一层里各项中最新的（往里加、删一份改的是文件夹自己的时间，覆盖写一份只改那一份的）。
 * 不在、读不了、是文件夹却要文件（或反过来）都回 `null`。只看一层，最多 {@link RUN_DIR_MAX} 项。
 *
 * 文件夹隔一会儿就被问一次：文件夹自己的时间没变时，只再看上回最近改过的 {@link DIR_HOT} 份，
 * 每 {@link DIR_RESCAN_MS} 整份重看一次，几千份的文件夹也不必每回逐份 stat。
 */
export async function statRunPath(
  full: string,
  want: 'file' | 'folder',
): Promise<{ size: number; mtime: number } | null> {
  let info: Awaited<ReturnType<typeof stat>>
  try {
    info = await stat(full)
  } catch {
    return null
  }
  if (want === 'file') return info.isFile() ? { size: info.size, mtime: info.mtimeMs } : null
  if (!info.isDirectory()) return null
  const now = Date.now()
  const known = dirScans.get(full)
  if (known !== undefined && known.dirMtime === info.mtimeMs && now - known.at < DIR_RESCAN_MS) {
    const times = await Promise.all(known.hot.map((name) => mtimeOf(join(full, name))))
    return { size: known.count, mtime: Math.max(info.mtimeMs, known.newest, ...times) }
  }
  let names: string[]
  try {
    names = await readdir(full)
  } catch {
    return null
  }
  const shown = names.slice(0, RUN_DIR_MAX)
  const times = await Promise.all(shown.map((name) => mtimeOf(join(full, name))))
  const hot = shown
    .map((name, index) => ({ name, time: times[index] ?? 0 }))
    .sort((a, b) => b.time - a.time)
    .slice(0, DIR_HOT)
    .map(({ name }) => name)
  const newest = Math.max(info.mtimeMs, ...times)
  dirScans.delete(full)
  dirScans.set(full, { dirMtime: info.mtimeMs, at: now, count: names.length, newest, hot })
  if (dirScans.size > DIR_SCANS_MAX) {
    const oldest = dirScans.keys().next().value
    if (oldest !== undefined) dirScans.delete(oldest)
  }
  return { size: names.length, mtime: newest }
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
  // 子文件夹数一下里面有几项、几张图（列表里写「3 张图」，不用点进去才知道）。软链不数：可能指到文件夹外面。
  await Promise.all(
    entries
      .filter((entry) => entry.dir)
      .slice(0, RUN_DIR_COUNTED)
      .map(async (entry) => {
        try {
          if ((await lstat(join(full, entry.name))).isSymbolicLink()) return
          const inner = await readdir(join(full, entry.name))
          entry.items = inner.length
          entry.images = inner.filter((name) => fileKindOf(name) === 'image').length
        } catch {
          // 读不了就不写项数。
        }
      }),
  )
  return { ...base, exists: true, entries, truncated: names.length > RUN_DIR_MAX }
}
