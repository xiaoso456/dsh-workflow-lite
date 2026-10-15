/**
 * dsh-workflow-lite — 导入导出的暂存区：`<dataDir>/.pack/<token>/`。
 *
 * zip 在前后端之间分块传（{@link PACK_CHUNK_BYTES} 一块，base64），不赌宿主对单条消息的上限：
 * - 导出：主机把 zip 写成 `out.zip`，前端按偏移一块块取（{@link readChunk}）；
 * - 导入：前端一块块传上来，主机接在 `in.zip` 后面（{@link appendChunk}），读清单、落盘时再解开。
 *
 * 用完就删；每次开新暂存时顺手清掉放了一天以上的（上次中途关掉页面留下的）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/pack/staging
 */

import { randomBytes } from 'node:crypto'
import { appendFile, mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PACK_CHUNK_BYTES, PACK_MAX_BYTES } from '../../shared/pack.ts'
import type { ErrorCode } from '../../shared/types.ts'
import { packRoot } from '../store/paths.ts'
import type { Outcome } from '../store/repository.ts'

/** 暂存放多久算没人要了。 */
const STALE_MS = 24 * 60 * 60 * 1000

const TOKEN = /^[a-f0-9]{24}$/u

export const OUT_ZIP = 'out.zip'
export const IN_ZIP = 'in.zip'

function fail(
  code: ErrorCode,
  message: string,
): { ok: false; error: { code: ErrorCode; message: string } } {
  return { ok: false, error: { code, message } }
}

/** 一个暂存目录；token 不对回 `null`（不让拼出暂存区外的路径）。 */
export function stageDir(dataDir: string, token: string): string | null {
  return TOKEN.test(token) ? join(packRoot(dataDir), token) : null
}

/** 开一个新的暂存目录（顺手清掉过期的）。 */
export async function newStage(dataDir: string): Promise<{ token: string; dir: string }> {
  await sweep(dataDir)
  const token = randomBytes(12).toString('hex')
  const dir = join(packRoot(dataDir), token)
  await mkdir(dir, { recursive: true })
  return { token, dir }
}

/** 清掉放了一天以上的暂存。 */
export async function sweep(dataDir: string, now = Date.now()): Promise<void> {
  const root = packRoot(dataDir)
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return
  }
  for (const name of names) {
    const dir = join(root, name)
    try {
      if (now - (await stat(dir)).mtimeMs > STALE_MS)
        await rm(dir, { recursive: true, force: true })
    } catch {
      // 别的进程正在用 / 已经删了：不管它。
    }
  }
}

export async function discard(dataDir: string, token: string): Promise<void> {
  const dir = stageDir(dataDir, token)
  if (dir !== null) await rm(dir, { recursive: true, force: true })
}

/** 写下导出的 zip。 */
export async function writeOut(dir: string, zip: Uint8Array): Promise<void> {
  await writeFile(join(dir, OUT_ZIP), zip)
}

/** 取导出的 zip 的一块。 */
export async function readChunk(
  dataDir: string,
  token: string,
  offset: number,
): Promise<Outcome<{ data: string; next: number | null }>> {
  const dir = stageDir(dataDir, token)
  if (dir === null) return fail('invalid_args', '暂存编号不对')
  if (!Number.isInteger(offset) || offset < 0) return fail('invalid_args', '偏移不对')
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(join(dir, OUT_ZIP), 'r')
  } catch {
    return fail('not_found', '导出的包不见了（可能已经取完或过期），请重新导出')
  }
  try {
    const size = (await handle.stat()).size
    if (offset > size) return fail('invalid_args', '偏移超出了包的大小')
    const length = Math.min(PACK_CHUNK_BYTES, size - offset)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, offset)
    const end = offset + length
    return {
      ok: true,
      result: { data: buffer.toString('base64'), next: end >= size ? null : end },
    }
  } finally {
    await handle.close()
  }
}

/** 收导入的一块：必须正好接在已收到的后面（重复、跳块都拒绝）。 */
export async function appendChunk(
  dataDir: string,
  token: string | undefined,
  offset: number,
  data: string,
): Promise<Outcome<{ token: string; received: number }>> {
  let dir: string
  let id: string
  if (token === undefined) {
    if (offset !== 0) return fail('invalid_args', '第一块必须从 0 开始')
    const stage = await newStage(dataDir)
    dir = stage.dir
    id = stage.token
  } else {
    const found = stageDir(dataDir, token)
    if (found === null) return fail('invalid_args', '暂存编号不对')
    dir = found
    id = token
  }
  const file = join(dir, IN_ZIP)
  let size = 0
  try {
    size = (await stat(file)).size
  } catch {
    if (token !== undefined) return fail('not_found', '上传中断了，请重新选择文件')
  }
  if (offset !== size) return fail('invalid_args', `这一块应该从 ${size} 开始，收到的是 ${offset}`)
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length > PACK_CHUNK_BYTES) return fail('invalid_args', '一块太大了')
  if (size + bytes.length > PACK_MAX_BYTES) {
    await rm(dir, { recursive: true, force: true })
    return fail('invalid_args', `包太大了（上限 ${Math.round(PACK_MAX_BYTES / 1024 / 1024)} MB）`)
  }
  await appendFile(file, bytes)
  return { ok: true, result: { token: id, received: size + bytes.length } }
}

/** 读出上传完的 zip。 */
export async function readIn(dataDir: string, token: string): Promise<Outcome<Uint8Array>> {
  const dir = stageDir(dataDir, token)
  if (dir === null) return fail('invalid_args', '暂存编号不对')
  try {
    return { ok: true, result: new Uint8Array(await readFile(join(dir, IN_ZIP))) }
  } catch {
    return fail('not_found', '上传的包不见了（可能已经导入或过期），请重新选择文件')
  }
}
