/**
 * dsh-workflow-lite — 单文件原子写与文本读入；存储层唯一的写入原语。
 *
 * 协议（§3.3「单文件原子写」）：同目录临时文件 `open(..., 'wx')` → 写入 → `fsync` →
 * `rename` 覆盖目标 → `fsync` 父目录。失败一律**清掉临时文件**再抛。
 * 单文件写入天然原子：读者看到的要么是旧全文、要么是新全文，没有中间态。
 *
 * `writeFileAtomic` **抛错**而不是返回错误码——把 errno 翻译成 `invalid_args` / `io_error`
 * 是仓储层的事（见 `repository.ts` 的 `mapWriteFailure`）。
 * @module @xiaoso/dsh-workflow-lite/host/store/atomic
 */

import { createHash } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import { mkdir, open, readFile, rename, rm, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

import { isMissingOrUnreadableAsFile, pathKind, tempName } from './paths.ts'

/**
 * 原子写：临时文件 → fsync → rename 覆盖 → fsync 父目录。
 * 目标父目录**必须已存在**（由仓储的 `ensureLayout` 负责）。
 */
export async function writeFileAtomic(target: string, content: string): Promise<void> {
  const temp = tempName(target)
  let handle: FileHandle | null = null
  try {
    // `wx` = 独占创建：撞名即失败，绝不覆盖别人的临时文件。
    handle = await open(temp, 'wx')
    await handle.writeFile(content, { encoding: 'utf8' })
    await handle.sync()
    await handle.close()
    handle = null
    await rename(temp, target)
  } catch (error) {
    if (handle !== null) {
      await handle.close().catch(() => undefined)
    }
    await unlink(temp).catch(() => undefined)
    throw error
  }
  // 目录项落盘；Windows 上打开目录会被拒，失败即忽略（rename 本身已是原子的）。
  await syncDirectory(dirname(target))
}

/**
 * 读文本。**不存在 → `null`**（`ENOENT` / 中间路径是文件的 `ENOTDIR` / 目标是目录的 `EISDIR`）。
 * 其余失败照抛——那是真 IO 故障，不该被伪装成"文件不存在"。
 */
export async function readFileText(target: string): Promise<string | null> {
  try {
    return await readFile(target, 'utf8')
  } catch (error) {
    if (isMissingOrUnreadableAsFile(error)) return null
    throw error
  }
}

/** 写前冲突比对用的整图哈希（sha-256，十六进制）。同一份文本 ⇒ 同一个值。 */
export async function hashOf(text: string): Promise<string> {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 删一个文件；**不存在 = 成功**（幂等）。 */
export async function unlinkFile(target: string): Promise<void> {
  try {
    await unlink(target)
  } catch (error) {
    if (isMissingOrUnreadableAsFile(error)) return
    throw error
  }
}

/** 递归删一棵树；**不存在 = 成功**。用于 `.dispatch/<图名>` 的连带清理。 */
export async function removeTree(target: string): Promise<void> {
  await rm(target, { recursive: true, force: true })
}

/** 确保一个目录存在（递归）。父路径被文件占位时抛 `ENOTDIR` / `ENOENT`，交给上层翻译。 */
export async function ensureDir(target: string): Promise<boolean> {
  if ((await pathKind(target)) === 'dir') return false
  await mkdir(target, { recursive: true })
  return true
}

/**
 * 同卷 `rename`，失败时清场。
 * 单独列出来是为了让"只改大小写"的两步改名（Windows）与普通改名共用同一套错误翻译。
 */
export async function renamePath(from: string, to: string): Promise<void> {
  await rename(from, to)
}

async function syncDirectory(dir: string): Promise<void> {
  let handle: FileHandle | null = null
  try {
    handle = await open(dir, 'r')
  } catch {
    return
  }
  try {
    await handle.sync()
  } catch {
    // Windows 上目录 fsync 不被支持：忽略。
  } finally {
    await handle.close().catch(() => undefined)
  }
}
