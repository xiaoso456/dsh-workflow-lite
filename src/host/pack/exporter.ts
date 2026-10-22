/**
 * dsh-workflow-lite — 导出：盘点选中版本里的资源（{@link scanPack}），按用户勾的打成 zip（{@link exportPack}）。
 *
 * 只导出**存成了版本的**内容。资源分几种：
 * - 绝对路径的文件、文件夹（只被读的）：可以打包，打进 `assets/`，包里那几个版本的图改写成 `{workflow}/…`
 *   （本机的工作流不动）；重名的依次加 `-2`、`-3`；
 * - 有目录的 skill：可以打包，整个目录进 `skills/<名>/`；内置或插件注册的没有目录，只能原样引用；
 * - 工作流目录（`{workflow}/…`）：总是整个打进去；
 * - 相对路径、产出、网址、自定义文本：原样留在图里。
 *
 * @module @xiaoso/dsh-workflow-lite/host/pack/exporter
 */

import { readdir } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { zipSync } from 'fflate'
import { normalize } from 'pathe'
import { isResource } from '../../shared/model.ts'
import { isAbsoluteRoot, normalizeRoot } from '../../shared/outputPaths.ts'
import {
  freeName,
  isSkillName,
  PACK_FORMAT,
  PACK_KIND,
  PACK_MAX_BYTES,
  PACK_MAX_FILES,
  PACK_PATHS,
  PACK_SUFFIX,
  type PackExportRequest,
  type PackExportResponse,
  type PackExternal,
  type PackFile,
  type PackManifest,
  type PackScanItem,
  type PackScanRequest,
  type PackScanResponse,
  type PackSkill,
} from '../../shared/pack.ts'
import { isWorkflowPath, workflowPath, workflowRelative } from '../../shared/pathVars.ts'
import { resourceGraph } from '../../shared/resources.ts'
import {
  type ErrorCode,
  type VersionEntry,
  type WorkflowDocument,
  WRITABLE_KINDS,
} from '../../shared/types.ts'
import type { HostSkillEntry } from '../../shared/wire.ts'
import { listSkills, type SkillViewer } from '../hostFs.ts'
import { assetsDir } from '../store/paths.ts'
import type { DocumentValidator, Outcome, Repository } from '../store/repository.ts'
import { versionText } from '../store/versions.ts'
import { newStage, writeOut } from './staging.ts'
import { readTree, type Tree, walkTree } from './tree.ts'

export interface PackDeps {
  dataDir: string
  repository: Repository
  skills?: SkillViewer
  /** skill 装到哪：`~/.agents/skills`。 */
  skillsRoot: string
  /** 插件版本（写进清单）。 */
  plugin: string
  /** 文档级校验（导出成 skill 时看有没有编译级问题）；没给就不查。 */
  validate?: DocumentValidator
  now?: () => number
}

type Fail = {
  ok: false
  error: { code: ErrorCode; message: string; detail?: Record<string, unknown> }
}

function fail(code: ErrorCode, message: string, detail?: Record<string, unknown>): Fail {
  return { ok: false, error: detail === undefined ? { code, message } : { code, message, detail } }
}

/** 选中的一个版本。 */
interface PickedVersion {
  entry: VersionEntry
  document: WorkflowDocument
}

/** 盘点时顺手留下的东西（导出时直接用，不再看一遍磁盘）。 */
export interface ScanState {
  response: PackScanResponse
  versions: PickedVersion[]
  trees: Map<string, Tree>
  assetsTree: Tree | null
  skills: Map<string, HostSkillEntry>
}

function itemKey(kind: string, value: string): string {
  return kind === 'skill' ? `skill\n${value.trim()}` : `${kind}\n${normalize(value.trim())}`
}

export function isAbsolutePath(value: string): boolean {
  return isAbsoluteRoot(normalize(value.trim()))
}

async function pickVersions(
  repository: Repository,
  name: string,
  numbers: readonly number[],
): Promise<Outcome<PickedVersion[]>> {
  const unique = [...new Set(numbers)].sort((a, b) => a - b)
  if (unique.length === 0) return fail('invalid_args', '至少选一个版本')
  const picked: PickedVersion[] = []
  for (const n of unique) {
    const read = await repository.readVersion(name, n)
    if (!read.ok) return read
    picked.push({ entry: read.result.entry, document: read.result.document })
  }
  return { ok: true, result: picked }
}

async function skillCatalog(
  viewer: SkillViewer | undefined,
  scope: { cwd?: string; session?: string },
): Promise<Map<string, HostSkillEntry>> {
  const listed = await listSkills(viewer, scope)
  return new Map(listed.skills.map((skill) => [skill.name, skill]))
}

function scopeOf(request: { cwd?: string; session?: string }): { cwd?: string; session?: string } {
  return {
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    ...(request.session === undefined ? {} : { session: request.session }),
  }
}

export async function scanState(
  deps: PackDeps,
  request: PackScanRequest,
): Promise<Outcome<ScanState>> {
  const picked = await pickVersions(deps.repository, request.name, request.versions)
  if (!picked.ok) return picked
  const versions = picked.result
  const skills = await skillCatalog(deps.skills, scopeOf(request))
  const items = new Map<string, PackScanItem>()
  const trees = new Map<string, Tree>()
  const roots = new Set<string>()

  for (const { entry, document } of versions) {
    const root = normalizeRoot(document.settings?.outputRoot)
    if (root !== undefined && isAbsoluteRoot(root)) roots.add(root)
    for (const info of resourceGraph(document).values()) {
      const written = info.writers.length > 0
      for (const item of info.resource.data.items) {
        if (item.value.trim() === '') continue
        // 网址、自定义文本写在图里，本来就跟着走，不是外部资源。
        if (item.kind === 'url' || item.kind === 'text') continue
        const key = itemKey(item.kind, item.value)
        const seen = items.get(key)
        if (seen !== undefined) {
          if (!seen.versions.includes(entry.n)) seen.versions.push(entry.n)
          // 哪一版里是产出，就算产出（产出不该被打包）。
          if (written && WRITABLE_KINDS.includes(item.kind) && seen.state !== 'assets') {
            seen.state = 'output'
            delete seen.as
          }
          continue
        }
        const base = { key, kind: item.kind, value: item.value.trim(), versions: [entry.n] }
        if (item.kind === 'skill') {
          const found = skills.get(base.value)
          if (found === undefined) {
            items.set(key, { ...base, state: 'missing' })
          } else if (found.path === undefined || !isSkillName(found.name)) {
            items.set(key, { ...base, state: 'builtin', source: found.source })
          } else {
            const dir = dirname(found.path)
            const tree = await walkTree(dir)
            if (tree === null) {
              items.set(key, { ...base, state: 'missing', source: found.source })
              continue
            }
            trees.set(key, tree)
            items.set(key, {
              ...base,
              state: tree.over ? 'tooLarge' : 'pack',
              source: found.source,
              location: dir.replace(/\\/gu, '/'),
              bytes: tree.bytes,
              files: tree.files.length,
              ...(tree.skipped > 0 ? { skipped: tree.skipped } : {}),
            })
          }
          continue
        }
        if (isWorkflowPath(item.value)) {
          items.set(key, { ...base, state: 'assets' })
          continue
        }
        if (written) {
          items.set(key, { ...base, state: 'output' })
          continue
        }
        if (!isAbsolutePath(item.value)) {
          items.set(key, { ...base, state: 'relative' })
          continue
        }
        const location = normalize(item.value.trim())
        const tree = await walkTree(location)
        // 写的是文件、实际是个目录（或者反过来）：当成找不到。
        if (tree === null || tree.dir !== (item.kind === 'folder')) {
          items.set(key, { ...base, state: 'missing', location })
          continue
        }
        trees.set(key, tree)
        items.set(key, {
          ...base,
          state: tree.over ? 'tooLarge' : 'pack',
          location,
          bytes: tree.bytes,
          files: tree.files.length,
          ...(tree.skipped > 0 ? { skipped: tree.skipped } : {}),
        })
      }
    }
  }

  // 资料目录：在就整个打包。
  const assetsLocation = assetsDir(deps.dataDir, request.name)
  const assetsTree = await walkTree(assetsLocation)
  const assets = assetsTree?.dir === true ? assetsTree : null

  // 要打包的文件、文件夹在资料目录里叫什么：用原来的名字，和资料目录里已有的、彼此之间撞了就加序号。
  const taken = new Set<string>()
  try {
    for (const name of await readdir(assetsLocation)) taken.add(name.toLowerCase())
  } catch {
    // 没有资料目录。
  }
  for (const item of items.values()) {
    if (item.kind === 'skill' || item.state !== 'pack' || item.location === undefined) continue
    const name = freeName(
      basename(item.location) || 'item',
      (candidate) => taken.has(candidate.toLowerCase()),
      item.kind === 'file',
    )
    taken.add(name.toLowerCase())
    item.as = workflowPath(name)
  }

  const sorted = [...items.values()].map((item) => ({
    ...item,
    versions: [...item.versions].sort((a, b) => a - b),
  }))
  return {
    ok: true,
    result: {
      response: {
        name: request.name,
        items: sorted,
        assets:
          assets === null
            ? null
            : {
                location: assetsLocation.replace(/\\/gu, '/'),
                files: assets.files.length,
                bytes: assets.bytes,
              },
        roots: [...roots],
        limit: PACK_MAX_BYTES,
      },
      versions,
      trees,
      assetsTree: assets,
      skills,
    },
  }
}

/** 盘点选中版本里的资源。 */
export async function scanPack(
  deps: PackDeps,
  request: PackScanRequest,
): Promise<Outcome<PackScanResponse>> {
  const state = await scanState(deps, request)
  return state.ok ? { ok: true, result: state.result.response } : state
}

/** 把包里那几个版本的图改写一下：打包的文件、文件夹换成 `{workflow}/…`。 */
export function rewriteForPack(
  document: WorkflowDocument,
  renames: ReadonlyMap<string, string>,
): WorkflowDocument {
  if (renames.size === 0) return document
  let changed = false
  const nodes = document.nodes.map((node) => {
    if (!isResource(node)) return node
    let touched = false
    const items = node.data.items.map((item) => {
      if (item.kind !== 'file' && item.kind !== 'folder') return item
      const to = renames.get(itemKey(item.kind, item.value))
      if (to === undefined) return item
      touched = true
      return { ...item, value: to }
    })
    if (!touched) return node
    changed = true
    return { ...node, data: { ...node.data, items } }
  })
  return changed ? { ...document, nodes } : document
}

/** 打包：按用户勾的项，写一个 zip 到暂存区，回暂存编号。 */
export async function exportPack(
  deps: PackDeps,
  request: PackExportRequest,
): Promise<Outcome<PackExportResponse>> {
  const scanned = await scanState(deps, request)
  if (!scanned.ok) return scanned
  const { response, versions, trees, assetsTree } = scanned.result
  const wanted = new Set(request.pack)
  const top = response.name
  const entries: Record<string, Uint8Array> = {}
  const put = (path: string, data: Uint8Array): void => {
    entries[`${top}/${path}`] = data
  }
  let total = 0
  let count = 0
  const tally = (bytes: number): void => {
    total += bytes
    count += 1
  }

  // 资料目录 + 要打包的文件、文件夹 → assets/
  const assets: PackFile[] = []
  if (assetsTree !== null) {
    const read = await readTree(assetsTree)
    for (const file of read.files) {
      assets.push(file)
      put(PACK_PATHS.asset(file.path), read.data.get(file.path) as Uint8Array)
      tally(file.bytes)
    }
  }
  const renames = new Map<string, string>()
  const skills: PackSkill[] = []
  const external: PackExternal[] = []
  for (const item of response.items) {
    const chosen = item.state === 'pack' && wanted.has(item.key)
    if (!chosen) {
      if (item.state === 'output' || item.state === 'assets') continue
      if (item.kind === 'url' || item.kind === 'text') continue
      external.push({
        kind: item.kind,
        value: item.value,
        why:
          item.state === 'builtin'
            ? 'builtin'
            : item.state === 'relative'
              ? 'relative'
              : item.state === 'missing'
                ? 'missing'
                : 'not-packed',
      })
      continue
    }
    const tree = trees.get(item.key)
    if (tree === undefined) continue
    if (item.kind === 'skill') {
      const read = await readTree(tree)
      skills.push({ name: item.value, source: item.source ?? '', files: read.files })
      for (const file of read.files) {
        put(PACK_PATHS.skill(item.value, file.path), read.data.get(file.path) as Uint8Array)
        tally(file.bytes)
      }
      continue
    }
    if (item.as === undefined) continue
    const name = workflowRelative(item.as)
    // 单个文件：读出来的相对路径是它原来的文件名，换成资料目录里的名字。
    const read = await readTree(tree)
    for (const file of read.files) {
      const path = item.kind === 'file' ? name : `${name}/${file.path}`
      assets.push({ ...file, path })
      put(PACK_PATHS.asset(path), read.data.get(file.path) as Uint8Array)
      tally(file.bytes)
    }
    renames.set(item.key, item.as)
  }
  for (const root of response.roots) external.push({ kind: 'root', value: root, why: 'root' })
  if (total > PACK_MAX_BYTES || count > PACK_MAX_FILES) {
    return fail(
      'invalid_args',
      `包太大了：${count} 个文件、${Math.ceil(total / 1024 / 1024)} MB（上限 ${PACK_MAX_FILES} 个、${Math.round(PACK_MAX_BYTES / 1024 / 1024)} MB），少勾几项`,
    )
  }

  // 导入后用哪一版当工作流的内容：和磁盘上一样的那版；选的里面没有就用最新的。
  const current =
    versions.find((version) => version.entry.current)?.entry.n ??
    Math.max(...versions.map((version) => version.entry.n))
  const encoder = new TextEncoder()
  for (const { entry, document } of versions) {
    put(
      PACK_PATHS.version(entry.n),
      encoder.encode(
        versionText({
          n: entry.n,
          createdAt: entry.createdAt,
          note: entry.note,
          document: rewriteForPack(document, renames),
        }),
      ),
    )
  }
  const manifest: PackManifest = {
    format: PACK_FORMAT,
    kind: PACK_KIND,
    plugin: deps.plugin,
    exportedAt: new Date(deps.now?.() ?? Date.now()).toISOString(),
    workflow: { name: top },
    current,
    versions: versions.map(({ entry }) => ({
      n: entry.n,
      createdAt: entry.createdAt,
      note: entry.note,
      nodeCount: entry.nodeCount,
    })),
    assets,
    skills,
    external,
  }
  put(PACK_PATHS.manifest, encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`))

  const zip = zipSync(entries, { level: 6 })
  const stage = await newStage(deps.dataDir)
  await writeOut(stage.dir, zip)
  return {
    ok: true,
    result: { token: stage.token, bytes: zip.length, fileName: `${top}${PACK_SUFFIX}` },
  }
}
