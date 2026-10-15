/**
 * dsh-workflow-lite — 打包时看一棵目录：有哪些文件、多大、内容哈希。
 *
 * 跳过 `.git`、`node_modules` 与树里面的符号链接（链出去的东西不该被悄悄打进包）；超过上限就停下报 `over`，
 * 不读完一整棵大树。路径一律用 `/` 分隔、相对树根。
 *
 * @module @xiaoso/dsh-workflow-lite/host/pack/tree
 */

import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { PACK_MAX_BYTES, PACK_MAX_FILES, PACK_SKIP_DIRS, type PackFile } from '../../shared/pack.ts'

export interface TreeFile {
  /** 相对树根（单个文件时是它的文件名）。 */
  rel: string
  full: string
  bytes: number
}

export interface Tree {
  /** 树根是目录（不是单个文件）。 */
  dir: boolean
  files: TreeFile[]
  bytes: number
  /** 跳过了几项（`.git`、`node_modules`、符号链接、读不了的）。 */
  skipped: number
  /** 超了上限，没看完。 */
  over: boolean
}

export interface TreeLimits {
  maxFiles?: number
  maxBytes?: number
}

/**
 * 看一个文件或一棵目录。不存在回 `null`。
 * @param root - 文件或目录的绝对路径。
 */
export async function walkTree(root: string, limits: TreeLimits = {}): Promise<Tree | null> {
  const maxFiles = limits.maxFiles ?? PACK_MAX_FILES
  const maxBytes = limits.maxBytes ?? PACK_MAX_BYTES
  let info: Awaited<ReturnType<typeof stat>>
  try {
    // 树根自己是链接（常见：skill 目录链到别处）就跟过去；里面的链接才跳过。
    info = await stat(root)
  } catch {
    return null
  }
  if (info.isFile()) {
    const over = info.size > maxBytes
    return {
      dir: false,
      files: [{ rel: basename(root), full: root, bytes: info.size }],
      bytes: info.size,
      skipped: 0,
      over,
    }
  }
  if (!info.isDirectory()) return null
  const tree: Tree = { dir: true, files: [], bytes: 0, skipped: 0, over: false }
  const visit = async (dir: string, prefix: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      tree.skipped += 1
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (tree.over) return
      const full = join(dir, entry.name)
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (PACK_SKIP_DIRS.includes(entry.name)) {
          tree.skipped += 1
          continue
        }
        await visit(full, rel)
        continue
      }
      if (!entry.isFile()) {
        tree.skipped += 1
        continue
      }
      let size: number
      try {
        size = (await lstat(full)).size
      } catch {
        tree.skipped += 1
        continue
      }
      tree.files.push({ rel, full, bytes: size })
      tree.bytes += size
      if (tree.files.length > maxFiles || tree.bytes > maxBytes) tree.over = true
    }
  }
  await visit(root, '')
  return tree
}

export function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 读出一棵树的全部文件，连同清单（相对路径前面加 `prefix`）。 */
export async function readTree(
  tree: Tree,
  prefix = '',
): Promise<{ files: PackFile[]; data: Map<string, Uint8Array> }> {
  const files: PackFile[] = []
  const data = new Map<string, Uint8Array>()
  for (const file of tree.files) {
    const bytes = new Uint8Array(await readFile(file.full))
    const path = prefix === '' ? file.rel : `${prefix}/${file.rel}`
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes) })
    data.set(path, bytes)
  }
  return { files, data }
}

/** 一棵树的内容指纹（文件清单 + 每个文件的哈希）：比两份 skill 一不一样用。 */
export function fingerprint(files: readonly { path: string; sha256: string }[]): string {
  return [...files]
    .map((file) => `${file.path}\u0000${file.sha256}`)
    .sort()
    .join('\n')
}
