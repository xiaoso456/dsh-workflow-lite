/**
 * dsh-workflow-lite — 编辑工作流时看资源里的文件、文件夹（`graph/file`、`graph/image`、`graph/dir`）。
 *
 * 和实例里的 `run/*` 同一套规矩（见 `runs/files.ts`），只是没有快照：按**存好的**工作流找到那一项，
 * `{workflow}` 指工作流自己的目录，相对路径按调用方给的 `cwd`（当前对话的工作区）解析。
 * 只认图里写着的那一项和它下面的东西——不是通用的读文件口子。
 *
 * @module @xiaoso/dsh-workflow-lite/host/store/graphFiles
 */

import { isAbsolute } from 'node:path'
import { bindWorkflowDir } from '../../shared/resources.ts'
import type { ErrorCode } from '../../shared/types.ts'
import type { RunDirResponse, RunFileResponse, RunImageResponse } from '../../shared/wire.ts'
import {
  cleanSub,
  itemLocation,
  readRunDir,
  readRunFile,
  readRunImage,
  realInside,
  resolveImageRef,
  resolveRunFile,
  resolveSelfImage,
} from '../runs/files.ts'
import { assetsDir } from './paths.ts'
import type { Outcome, Repository } from './repository.ts'

/** 要看哪份：工作流 `name` 里资源 `node` 的第 `item` 项（文件夹可以再带 `sub`），相对路径按 `cwd`。 */
export interface GraphItemTarget {
  name: string
  node: string
  item: number
  sub?: string
  cwd?: string
}

export interface GraphFileDeps {
  repository: Repository
  dataDir: string
}

function fail(code: ErrorCode, message: string): Outcome<never> {
  return { ok: false, error: { code, message } }
}

/** 找到那一项实际在哪（连同往下走的 `sub`）。 */
async function locate(
  deps: GraphFileDeps,
  target: GraphItemTarget,
): Promise<Outcome<{ full: string; display: string; sub: string }>> {
  const load = await deps.repository.load(target.name)
  if (!load.exists) return fail('not_found', `图 ${target.name} 不存在`)
  if (load.document === null) return fail('blocked', `图 ${target.name} 有保存级问题，读不了`)
  const document = bindWorkflowDir(load.document, assetsDir(deps.dataDir, target.name))
  const location = itemLocation(document, target.node, target.item)
  if (location !== null && !isAbsolute(location) && target.cwd === undefined) {
    return fail('invalid_args', '不知道当前对话在哪个工作区，看不了相对路径的东西')
  }
  const scope = target.cwd === undefined ? {} : { cwd: target.cwd }
  const resolved = resolveRunFile(scope, document, {
    node: target.node,
    item: target.item,
    ...(target.sub === undefined ? {} : { sub: target.sub }),
  })
  if (!resolved.ok) return resolved
  const { full, display, root } = resolved.result
  if (root !== undefined && !(await realInside(root, full))) {
    return fail('invalid_args', '只能看文件夹里面的东西')
  }
  const sub = cleanSub(target.sub)
  return { ok: true, result: { full, display, sub: sub.ok ? sub.result : '' } }
}

function ioError(what: string, error: unknown): Outcome<never> {
  return fail('io_error', `${what}失败：${error instanceof Error ? error.message : String(error)}`)
}

export async function graphFile(
  deps: GraphFileDeps,
  target: GraphItemTarget,
): Promise<Outcome<RunFileResponse>> {
  const found = await locate(deps, target)
  if (!found.ok) return found
  try {
    return { ok: true, result: await readRunFile(found.result.full, found.result.display) }
  } catch (error) {
    return ioError('读文件', error)
  }
}

/** 一张图：`src` 是 Markdown 里的相对路径（按文档所在目录解析）；不给就是目标自己。 */
export async function graphImage(
  deps: GraphFileDeps,
  target: GraphItemTarget,
  src?: string,
): Promise<Outcome<RunImageResponse>> {
  const found = await locate(deps, target)
  if (!found.ok) return found
  const resolved =
    src === undefined
      ? resolveSelfImage(found.result.full)
      : resolveImageRef(target.cwd, found.result.full, src)
  if (!resolved.ok) return resolved
  try {
    return await readRunImage(resolved.result.full, resolved.result.mime)
  } catch (error) {
    return ioError('读图片', error)
  }
}

export async function graphDir(
  deps: GraphFileDeps,
  target: GraphItemTarget,
): Promise<Outcome<RunDirResponse>> {
  const found = await locate(deps, target)
  if (!found.ok) return found
  const { full, display, sub } = found.result
  try {
    return { ok: true, result: await readRunDir(full, display, sub) }
  } catch (error) {
    return ioError('读文件夹', error)
  }
}
