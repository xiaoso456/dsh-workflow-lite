/**
 * dsh-workflow-lite — 数据目录的路径构造与「什么算一个图文件」的扫描判据。
 *
 * 目录与布局，三件要紧的事：
 * - **同名目录也算被占用**（`create` / `save_as_template` 加序号、`rename_workflow` 拒绝）；
 * - `.dispatch/` 以 `.` 开头 ⇒ 一切扫描**天然忽略**，它也**不参与任何读入**；
 * - 扫描只认「普通文件 + 非隐藏 + 以 `.json` 结尾（不区分大小写）」，其余条目
 *   （非 `.json`、隐藏文件、`.tmp-*`、子目录、符号链接、编辑器残渣）一律忽略，
 *   由调用方逐条报提示。
 *
 * 本模块只做**只读**文件系统访问（`stat` / `readdir`）与路径拼接；一切写入在 `atomic.ts`。
 * 依赖方向严格单向：`atomic.ts` → 本模块 → `shared/*`，不成环。
 * @module @xiaoso/dsh-workflow-lite/host/store/paths
 */

import { randomUUID } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { compareByCodepoint } from '../../shared/graph.ts'
import { DISPATCH_DIR, TEMPLATES_DIR, TMP_PREFIX, WORKFLOWS_DIR } from '../../shared/limits.ts'
import type { PlanId } from '../../shared/types.ts'

/** 图文件 / 模板文件的后缀。判据不区分大小写。 */
export const JSON_SUFFIX = '.json'

/** 一个路径当前的占用形态。 */
export type PathKind = 'file' | 'dir' | 'missing'

/** 一个图名在 `workflows/` 下被谁占了位。`both` = 同名 `.json` 与同名目录同时存在（保存级）。 */
export type NameOccupant = 'file' | 'dir' | 'both' | null

/** `errno` 码；拿不到就 `null`（异常形态不可控，一律当成"未知 IO 失败"）。 */
export function errnoCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  if (!('code' in error)) return null
  const code: unknown = error.code
  return typeof code === 'string' ? code : null
}

/** 「不存在」的三种 errno：`ENOENT`、路径中间是文件的 `ENOTDIR`、目标是目录的 `EISDIR`。 */
export function isAbsentError(error: unknown): boolean {
  const code = errnoCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR'
}

/** 读路径上的失败是否应当当成「不存在」（目录缺失、目标是个目录）。 */
export function isMissingOrUnreadableAsFile(error: unknown): boolean {
  const code = errnoCode(error)
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EISDIR' || code === 'EPERM'
}

// ─────────────────────────────────────────────────────────────
// 路径构造（纯字符串拼接；调用方负责先 normalizeName）
// ─────────────────────────────────────────────────────────────

/** `<dataDir>/workflows/`。 */
export function workflowsDir(dataDir: string): string {
  return join(dataDir, WORKFLOWS_DIR)
}

/** `<dataDir>/templates/nodes/`：节点模板（画布步骤库的「我的步骤」）。 */
export function templatesDir(dataDir: string): string {
  return join(dataDir, TEMPLATES_DIR, 'nodes')
}

/** `<dataDir>/workflows/<名>.json`。 */
export function workflowFile(dataDir: string, name: string): string {
  return join(workflowsDir(dataDir), `${name}${JSON_SUFFIX}`)
}

/** `<dataDir>/templates/nodes/<名>.json`。 */
export function templateFile(dataDir: string, name: string): string {
  return join(templatesDir(dataDir), `${name}${JSON_SUFFIX}`)
}

/** `<dataDir>/.dispatch/` —— 派生根，**启动时不创建**，编译时才建。 */
export function dispatchRoot(dataDir: string): string {
  return join(dataDir, DISPATCH_DIR)
}

/** `<dataDir>/.dispatch/<图名>`。 */
export function dispatchDir(dataDir: string, workflow: string): string {
  return join(dispatchRoot(dataDir), workflow)
}

/** `<dataDir>/.dispatch/<图名>/<planId>`。 */
export function payloadDir(dataDir: string, workflow: string, planId: PlanId): string {
  return join(dispatchDir(dataDir, workflow), planId)
}

/** `<dataDir>/.dispatch/<图名>/<planId>/<节点 id>.md`。 */
export function payloadFile(
  dataDir: string,
  workflow: string,
  planId: PlanId,
  nodeId: string,
): string {
  return join(payloadDir(dataDir, workflow, planId), `${nodeId}.md`)
}

/** 首次启动按需创建的那两个目录（**不含** `.dispatch/`）。 */
export function layoutDirs(dataDir: string): string[] {
  return [workflowsDir(dataDir), templatesDir(dataDir)]
}

/**
 * 同目录临时文件名：`.tmp-<随机>`。
 * 以 `.` 开头 ⇒ 一切扫描天然忽略；与目标同目录 ⇒ `rename` 同卷、原子。
 */
export function tempName(target: string): string {
  const random = randomUUID().replaceAll('-', '').slice(0, 16)
  return join(dirname(target), `${TMP_PREFIX}${random}`)
}

// ─────────────────────────────────────────────────────────────
// 扫描判据
// ─────────────────────────────────────────────────────────────

export interface DirScan {
  /** 可用的条目名（**已去掉 `.json` 后缀**，保持磁盘上的原样大小写）。 */
  names: string[]
  /** 被忽略的条目名：非 `.json`、隐藏、`.tmp-*`、符号链接…… */
  ignored: string[]
  /** 被忽略的子目录名（图目录 = 旧结构信号，见 {@link legacyStructureDetected}）。 */
  directories: string[]
}

const EMPTY_SCAN: DirScan = { names: [], ignored: [], directories: [] }

/**
 * 扫一个「一文件一 JSON」的目录。**目录不存在 = 空**（首次启动的常态），不抛错。
 * 判据：普通文件 · 非隐藏（文件名以 `.` 开头即视为隐藏）· 以 `.json` 结尾（不区分大小写）。
 */
export async function scanJsonDir(dir: string): Promise<DirScan> {
  let entries: Dirent[]
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (isAbsentError(error)) return { ...EMPTY_SCAN }
    throw error
  }

  const names: string[] = []
  const ignored: string[] = []
  const directories: string[] = []
  for (const entry of entries) {
    const name = entry.name
    if (entry.isDirectory()) {
      directories.push(name)
      continue
    }
    // 符号链接 / junction / FIFO 等：既不是普通文件，也不是我们要的目录。
    if (!entry.isFile()) {
      ignored.push(name)
      continue
    }
    if (name.startsWith('.')) {
      ignored.push(name)
      continue
    }
    if (!name.toLowerCase().endsWith(JSON_SUFFIX)) {
      ignored.push(name)
      continue
    }
    names.push(name.slice(0, -JSON_SUFFIX.length))
  }

  names.sort(compareByCodepoint)
  ignored.sort(compareByCodepoint)
  directories.sort(compareByCodepoint)
  return { names, ignored, directories }
}

/** `workflows/` 下的图名（只认图文件；其余条目进 `ignored` / `directories`）。 */
export async function scanWorkflowDir(dataDir: string): Promise<DirScan> {
  return scanJsonDir(workflowsDir(dataDir))
}

/** `workflows/` 下的图名——`list` / `read` 的入口。 */
export async function workflowNamesOnDisk(dataDir: string): Promise<string[]> {
  return (await scanWorkflowDir(dataDir)).names
}

/** `templates/nodes/` 下的节点模板名。 */
export async function scanTemplateDir(dataDir: string): Promise<DirScan> {
  return scanJsonDir(templatesDir(dataDir))
}

/** 一个路径是文件、目录，还是不存在。 */
export async function pathKind(target: string): Promise<PathKind> {
  try {
    const info = await stat(target)
    return info.isDirectory() ? 'dir' : 'file'
  } catch (error) {
    if (isAbsentError(error) || errnoCode(error) === 'EPERM') return 'missing'
    throw error
  }
}

/** 一个图名在 `workflows/` 下的占位情况——**同名目录也算被占用**。 */
export async function workflowOccupant(dataDir: string, name: string): Promise<NameOccupant> {
  return nameOccupant(workflowsDir(dataDir), name)
}

/** 一个节点模板名在 `templates/nodes/` 下的占位情况——同样把同名目录算进来。 */
export async function templateOccupant(dataDir: string, name: string): Promise<NameOccupant> {
  return nameOccupant(templatesDir(dataDir), name)
}

async function nameOccupant(dir: string, name: string): Promise<NameOccupant> {
  const fileKind = await pathKind(join(dir, `${name}${JSON_SUFFIX}`))
  const dirKind = await pathKind(join(dir, name))
  const hasFile = fileKind === 'file'
  const hasDir = dirKind === 'dir'
  if (hasFile && hasDir) return 'both'
  if (hasFile) return 'file'
  if (hasDir) return 'dir'
  return null
}

/**
 * 旧结构（md 版）是否在场：`workflows/` 下有**目录**，或 `dataDir` 顶层有 `nodes/`。
 * 只在启动 / `list` 呈现，报一条专用提示，**不进图列表**。
 */
export async function legacyStructureDetected(dataDir: string): Promise<boolean> {
  const scan = await scanWorkflowDir(dataDir)
  if (scan.directories.length > 0) return true
  return (await pathKind(join(dataDir, 'nodes'))) === 'dir'
}

/** 占位者的人话描述，用于警告文案。 */
export function describeOccupant(occupant: NameOccupant): string {
  if (occupant === 'both') return '同名文件与同名目录'
  if (occupant === 'file') return '同名文件'
  if (occupant === 'dir') return '同名目录'
  return '无'
}
