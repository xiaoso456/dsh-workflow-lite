/**
 * dsh-workflow-lite — 导入：解开上传的包、校验（{@link openPack}），给出预览（{@link inspectPack}），
 * 按用户的决定落盘（{@link applyPack}）。
 *
 * 解包这一步就挡掉坏包：条目路径不安全（zip-slip）、总大小 / 文件数超限、清单与文件对不上（哈希）、
 * 版本读不出来、包格式比本插件新。
 *
 * 落盘的顺序：检查都过了才动手 → 资料目录 → skill → 记忆 → 版本 → 工作流文件。工作流文件最后写，
 * 中途失败不会留下一张半成品工作流。**不自动存**本机现在的内容（并入时前端事先提醒过）。
 *
 * @module @xiaoso/dsh-workflow-lite/host/pack/importer
 */

import { randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'
import { normalize } from 'pathe'
import { idKey, isResource } from '../../shared/model.ts'
import { checkName, normalizeName } from '../../shared/naming.ts'
import { isAbsoluteRoot } from '../../shared/outputPaths.ts'
import {
  freeName,
  isSafeRelative,
  PACK_MAX_BYTES,
  PACK_MAX_FILES,
  PACK_PATHS,
  type PackApplyRequest,
  type PackApplyResponse,
  type PackImportPreview,
  type PackManifest,
  type PackMemoryAction,
  type PackMemoryPreview,
  type PackSkill,
  type PackSkillAction,
  type PackSkillPreview,
  readManifest,
} from '../../shared/pack.ts'
import { renameMemoryRefs } from '../../shared/presets.ts'
import type { ErrorCode, WorkflowDocument } from '../../shared/types.ts'
import { listSkills } from '../hostFs.ts'
import { renameDir } from '../store/atomic.ts'
import { freeMemoryId, readMemoryMeta, writeMemoryMeta } from '../store/memories.ts'
import {
  assetsDir,
  assetsRoot,
  memoryFolder,
  memoryMetaFile,
  pathKind,
  scanWorkflowDir,
} from '../store/paths.ts'
import type { ImportVersion, Outcome } from '../store/repository.ts'
import { parseVersion } from '../store/versions.ts'
import type { PackDeps } from './exporter.ts'
import { discard, readIn } from './staging.ts'
import { fingerprint, readTree, sha256, walkTree } from './tree.ts'

type Fail = {
  ok: false
  error: { code: ErrorCode; message: string; detail?: Record<string, unknown> }
}

function fail(code: ErrorCode, message: string, detail?: Record<string, unknown>): Fail {
  return { ok: false, error: detail === undefined ? { code, message } : { code, message, detail } }
}

/** 解开、校验过的包。 */
export interface OpenedPack {
  manifest: PackManifest
  /** 包里的版本（按编号从小到大），图已读好。 */
  versions: ImportVersion[]
  /** 相对顶层目录的路径 → 内容。 */
  entries: Map<string, Uint8Array>
}

/**
 * 解开一个包。顶层可以是一层同名目录（导出的样子），也可以直接是清单（用户解开又重新压过）。
 */
export function openPack(zip: Uint8Array): Outcome<OpenedPack> {
  let raw: Record<string, Uint8Array>
  let total = 0
  let count = 0
  let tooBig = false
  try {
    raw = unzipSync(zip, {
      filter: (file) => {
        if (file.name.endsWith('/')) return false
        total += file.originalSize
        count += 1
        if (total > PACK_MAX_BYTES || count > PACK_MAX_FILES) tooBig = true
        return !tooBig
      },
    })
  } catch (error) {
    return fail(
      'invalid_args',
      `读不了这个 zip：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (tooBig) {
    return fail(
      'invalid_args',
      `包太大了（上限 ${PACK_MAX_FILES} 个文件、${Math.round(PACK_MAX_BYTES / 1024 / 1024)} MB）`,
    )
  }
  const names = Object.keys(raw)
  for (const name of names) {
    if (!isSafeRelative(name)) return fail('invalid_args', `包里有不安全的路径：${name}`)
  }
  let prefix = ''
  if (raw[PACK_PATHS.manifest] === undefined) {
    const first = names[0]?.split('/')[0]
    const single = first !== undefined && names.every((name) => name.startsWith(`${first}/`))
    if (!single || raw[`${first}/${PACK_PATHS.manifest}`] === undefined) {
      return fail('invalid_args', '这不是工作流包：找不到 manifest.json')
    }
    prefix = `${first}/`
  }
  const entries = new Map<string, Uint8Array>()
  let actual = 0
  for (const name of names) {
    const data = raw[name] as Uint8Array
    actual += data.length
    entries.set(name.slice(prefix.length), data)
  }
  if (actual > PACK_MAX_BYTES) return fail('invalid_args', '包太大了')

  const decoder = new TextDecoder()
  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(entries.get(PACK_PATHS.manifest)))
  } catch {
    return fail('invalid_args', 'manifest.json 不是合法的 JSON')
  }
  const read = readManifest(parsed)
  if (!read.ok) {
    return fail(
      'invalid_args',
      read.message,
      read.newer === undefined ? undefined : { newer: read.newer },
    )
  }
  const manifest = read.manifest
  const workflowName = normalizeName(manifest.workflow.name)
  if (checkName(workflowName) !== null) {
    return fail('invalid_args', `包里的工作流名不能当文件名：${manifest.workflow.name}`)
  }

  const check = (path: string, expected: { bytes: number; sha256: string }): string | null => {
    const data = entries.get(path)
    if (data === undefined) return `少了 ${path}`
    if (data.length !== expected.bytes || sha256(data) !== expected.sha256)
      return `${path} 内容对不上`
    return null
  }
  for (const file of manifest.assets) {
    const problem = check(PACK_PATHS.asset(file.path), file)
    if (problem !== null) return fail('invalid_args', `包坏了：${problem}`)
  }
  for (const skill of manifest.skills) {
    if (!skill.files.some((file) => file.path.toLowerCase() === 'skill.md')) {
      return fail('invalid_args', `包坏了：skill ${skill.name} 没有 SKILL.md`)
    }
    for (const file of skill.files) {
      const problem = check(PACK_PATHS.skill(skill.name, file.path), file)
      if (problem !== null) return fail('invalid_args', `包坏了：${problem}`)
    }
  }
  for (const memory of manifest.memories) {
    for (const file of memory.files) {
      const problem = check(PACK_PATHS.memory(memory.id, file.path), file)
      if (problem !== null) return fail('invalid_args', `包坏了：${problem}`)
    }
  }
  const versions: ImportVersion[] = []
  for (const meta of manifest.versions) {
    const data = entries.get(PACK_PATHS.version(meta.n))
    if (data === undefined) return fail('invalid_args', `包坏了：少了 v${meta.n}`)
    const version = parseVersion(decoder.decode(data), meta.n)
    if (version.document === null) return fail('invalid_args', `包坏了：v${meta.n} 读不出来`)
    versions.push({
      n: meta.n,
      createdAt: version.createdAt,
      note: version.note,
      document: version.document,
    })
  }
  return {
    ok: true,
    result: { manifest: { ...manifest, workflow: { name: workflowName } }, versions, entries },
  }
}

// ─────────────────────────────────────────────────────────────
// 预览
// ─────────────────────────────────────────────────────────────

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/** 本机上已有的同名 skill 和包里的比一比。 */
async function compareSkill(
  deps: PackDeps,
  skill: PackSkill,
  visible: ReadonlyMap<string, string | undefined>,
  taken: (name: string) => boolean,
): Promise<PackSkillPreview> {
  const target = join(deps.skillsRoot, skill.name)
  const listed = visible.get(skill.name)
  let existing: string | undefined
  let overwritable = false
  if ((await pathKind(target)) === 'dir') {
    existing = target
    overwritable = true
  } else if (listed !== undefined) {
    existing = dirname(listed)
  }
  let state: PackSkillPreview['state'] = 'new'
  if (existing !== undefined) {
    const tree = await walkTree(existing)
    const local = tree === null ? [] : (await readTree(tree)).files
    state = fingerprint(local) === fingerprint(skill.files) ? 'same' : 'different'
  } else if (visible.has(skill.name)) {
    // 同名的内置 / 插件 skill（没有目录）：比不了，当成不一样。
    state = 'different'
  }
  return {
    name: skill.name,
    source: skill.source,
    files: skill.files.map((file) => ({ path: file.path, bytes: file.bytes })),
    bytes: skill.files.reduce((sum, file) => sum + file.bytes, 0),
    state,
    target: slash(target),
    ...(existing === undefined ? {} : { existing: slash(existing) }),
    overwritable,
    rename: freeName(skill.name, taken),
  }
}

function slash(path: string): string {
  return path.replace(/\\/gu, '/')
}

/** 本机能看到的 skill：名字 → SKILL.md 的路径（内置的没有路径）。 */
async function visibleSkills(
  deps: PackDeps,
  scope: { cwd?: string; session?: string },
): Promise<Map<string, string | undefined>> {
  const listed = await listSkills(deps.skills, scope)
  return new Map(listed.skills.map((skill) => [skill.name, skill.path]))
}

/** 已经被占的工作流名（大小写不敏感；同名目录也算）。 */
async function takenWorkflowNames(dataDir: string): Promise<Set<string>> {
  const scan = await scanWorkflowDir(dataDir)
  return new Set([...scan.names, ...scan.directories].map((name) => name.toLowerCase()))
}

/** 读上传的包，给出预览。 */
export async function inspectPack(
  deps: PackDeps,
  request: { token: string; cwd?: string; session?: string },
): Promise<Outcome<PackImportPreview>> {
  const zip = await readIn(deps.dataDir, request.token)
  if (!zip.ok) return zip
  const opened = openPack(zip.result)
  if (!opened.ok) return opened
  const { manifest } = opened.result
  const name = manifest.workflow.name

  const takenNames = await takenWorkflowNames(deps.dataDir)
  const present = takenNames.has(name.toLowerCase())
  let unsaved = false
  if (present) {
    const listed = await deps.repository.listVersions(name)
    unsaved = !listed.ok || !listed.result.some((version) => version.current)
  }
  const suggested = freeName(name, (candidate) => takenNames.has(candidate.toLowerCase()))

  // 并入时资料目录里同一路径内容不一样的文件。
  const clashes: string[] = []
  if (present) {
    const dir = assetsDir(deps.dataDir, name)
    for (const file of manifest.assets) {
      try {
        const local = await readFile(join(dir, file.path))
        if (sha256(new Uint8Array(local)) !== file.sha256) clashes.push(file.path)
      } catch {
        // 本机没有这个文件：不算撞。
      }
    }
  }

  const scope = {
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    ...(request.session === undefined ? {} : { session: request.session }),
  }
  const visible = await visibleSkills(deps, scope)
  // 换名安装用的名字不能和本机能看到的、skillsRoot 里已有的（哪怕没开给模型用）、这一包里别的重名。
  const installed = new Set<string>()
  try {
    for (const entry of await readdir(deps.skillsRoot)) installed.add(entry.toLowerCase())
  } catch {
    // 还没有 skillsRoot。
  }
  const skills: PackSkillPreview[] = []
  for (const skill of manifest.skills) {
    skills.push(
      await compareSkill(
        deps,
        skill,
        visible,
        (candidate) =>
          visible.has(candidate) ||
          installed.has(candidate.toLowerCase()) ||
          manifest.skills.some((other) => other.name === candidate) ||
          skills.some((other) => other.rename === candidate),
      ),
    )
  }

  // 记忆：和本机记忆库比；「另存一份」用的新 id 彼此也不能撞。
  const memories: PackMemoryPreview[] = []
  const renamedTo = new Set<string>()
  for (const memory of manifest.memories) {
    const local = await readMemoryMeta(deps.dataDir, memory.id)
    let rename = memory.id
    for (let n = 2; ; n += 1) {
      const free = await freeMemoryId(deps.dataDir, rename)
      if (free !== null && !renamedTo.has(idKey(free))) {
        rename = free
        break
      }
      if (n > 99) break
      rename = `${memory.id}-${n}`
    }
    renamedTo.add(idKey(rename))
    memories.push({
      id: memory.id,
      type: memory.type,
      name: memory.name,
      files: memory.files.length,
      bytes: memory.files.reduce((sum, file) => sum + file.bytes, 0),
      exists: local !== null,
      ...(local !== null && local !== 'invalid' ? { existingName: local.name } : {}),
      rename,
    })
  }

  const external: PackImportPreview['external'] = []
  for (const entry of manifest.external) {
    let found: boolean | null = null
    if (entry.kind === 'skill') {
      found = visible.has(entry.value)
    } else if (entry.why !== 'relative' && isAbsoluteRoot(normalize(entry.value))) {
      found = await exists(normalize(entry.value))
    }
    external.push({ ...entry, found })
  }

  return {
    ok: true,
    result: {
      token: request.token,
      format: manifest.format,
      plugin: manifest.plugin,
      exportedAt: manifest.exportedAt,
      name,
      current: manifest.current,
      versions: manifest.versions,
      exists: present,
      unsaved,
      suggested,
      assetsRoot: slash(assetsRoot(deps.dataDir)),
      assets: manifest.assets.map((file) => ({ path: file.path, bytes: file.bytes })),
      clashes,
      skillsRoot: slash(deps.skillsRoot),
      skills,
      memories,
      external,
    },
  }
}

// ─────────────────────────────────────────────────────────────
// 落盘
// ─────────────────────────────────────────────────────────────

/**
 * 换名安装时改 SKILL.md 头部的 `name:`。没有头部元数据就原样返回（DSH 按目录名认）。
 */
export function renameSkillDoc(text: string, name: string): string {
  const match = /^(﻿?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/u.exec(text)
  if (match === null) return text
  const [whole, open, body, close] = match as unknown as [string, string, string, string]
  const eol = open.endsWith('\r\n') ? '\r\n' : '\n'
  const line = /^name:[^\r\n]*$/mu
  const nextBody = line.test(body)
    ? body.replace(line, `name: ${name}`)
    : `name: ${name}${eol}${body}`
  return `${open}${nextBody}${close}${text.slice(whole.length)}`
}

/** 包里那几个版本的图：换名安装的 skill 跟着改引用。 */
export function rewriteSkills(
  document: WorkflowDocument,
  renames: ReadonlyMap<string, string>,
): WorkflowDocument {
  if (renames.size === 0) return document
  let changed = false
  const nodes = document.nodes.map((node) => {
    if (!isResource(node)) return node
    if (!node.data.items.some((item) => item.kind === 'skill' && renames.has(item.value.trim()))) {
      return node
    }
    changed = true
    const items = node.data.items.map((item) => {
      const to = item.kind === 'skill' ? renames.get(item.value.trim()) : undefined
      return to === undefined ? item : { ...item, value: to }
    })
    return { ...node, data: { ...node.data, items } }
  })
  return changed ? { ...document, nodes } : document
}

async function writeTree(
  dir: string,
  files: readonly { path: string; data: Uint8Array }[],
): Promise<void> {
  for (const file of files) {
    const full = join(dir, ...file.path.split('/'))
    await mkdir(dirname(full), { recursive: true })
    await writeFile(full, file.data)
  }
}

/** 一个 skill 落到 `target`：先写进旁边的临时目录，再换上去（覆盖时旧的先挪开、换好再删）。 */
export async function installSkill(
  root: string,
  target: string,
  files: readonly { path: string; data: Uint8Array }[],
  replace: boolean,
): Promise<void> {
  await mkdir(root, { recursive: true })
  const temp = join(root, `.tmp-${randomBytes(6).toString('hex')}`)
  await writeTree(temp, files)
  try {
    if (replace) {
      const old = join(root, `.old-${randomBytes(6).toString('hex')}`)
      await renameDir(target, old)
      try {
        await renameDir(temp, target)
      } catch (error) {
        await renameDir(old, target).catch(() => undefined)
        throw error
      }
      await rm(old, { recursive: true, force: true })
    } else {
      await renameDir(temp, target)
    }
  } catch (error) {
    await rm(temp, { recursive: true, force: true })
    throw error
  }
}

/** 按用户的决定导入。 */
export async function applyPack(
  deps: PackDeps,
  request: PackApplyRequest,
): Promise<Outcome<PackApplyResponse>> {
  const preview = await inspectPack(deps, request)
  if (!preview.ok) return preview
  const zip = await readIn(deps.dataDir, request.token)
  if (!zip.ok) return zip
  const opened = openPack(zip.result)
  if (!opened.ok) return opened
  const { manifest, versions, entries } = opened.result
  // 只能并入同名的那张（预览里比的就是它）。
  if (
    request.mode === 'merge' &&
    (!preview.result.exists ||
      normalizeName(request.name).toLowerCase() !== preview.result.name.toLowerCase())
  ) {
    return fail('invalid_args', `只能并入同名的工作流 ${preview.result.name}`)
  }

  // 每个 skill 怎么办。
  const plan: { skill: PackSkillPreview; action: PackSkillAction; as: string }[] = []
  for (const skill of preview.result.skills) {
    const asked = request.skills?.[skill.name]
    const action: PackSkillAction =
      skill.state === 'same' ? 'skip' : (asked ?? (skill.state === 'new' ? 'install' : 'skip'))
    if (action === 'install' && skill.state !== 'new') {
      return fail('conflict', `skill ${skill.name} 本机已经有了：选保留、覆盖或换名安装`)
    }
    if (action === 'overwrite' && !skill.overwritable) {
      return fail(
        'invalid_args',
        `skill ${skill.name} 不在 ${preview.result.skillsRoot} 里，不能覆盖`,
      )
    }
    if (action === 'rename' && skill.state === 'new') {
      return fail('invalid_args', `skill ${skill.name} 本机没有，不用换名`)
    }
    plan.push({ skill, action, as: action === 'rename' ? skill.rename : skill.name })
  }
  const renames = new Map(
    plan.filter((entry) => entry.action === 'rename').map((entry) => [entry.skill.name, entry.as]),
  )
  // 每条记忆怎么办：本机没有的照包里的建；已有的缺省用本机的，「另存一份」换新 id、图里跟着改。
  const memoryPlan: { id: string; as: string; action: PackMemoryAction | 'create' }[] = []
  for (const memory of preview.result.memories) {
    if (!memory.exists) {
      memoryPlan.push({ id: memory.id, as: memory.id, action: 'create' })
      continue
    }
    const action = request.memories?.[memory.id] ?? 'use'
    memoryPlan.push({ id: memory.id, as: action === 'copy' ? memory.rename : memory.id, action })
  }
  const memoryRenames = new Map(
    memoryPlan
      .filter((entry) => entry.action === 'copy')
      .map((entry) => [idKey(entry.id), entry.as]),
  )
  const imported = versions.map((version) => ({
    ...version,
    document: renameMemoryRefs(rewriteSkills(version.document, renames), memoryRenames),
  }))
  const current = imported.find((version) => version.n === manifest.current)
  if (current === undefined) return fail('invalid_args', '包坏了：找不到当前版本')

  let assetsWritten = 0
  const outcome = await deps.repository.importWorkflow({
    mode: request.mode,
    name: request.name,
    versions: imported,
    current: current.document,
    prepare: async (name) => {
      try {
        // 资料目录。
        const dir = assetsDir(deps.dataDir, name)
        if (request.mode === 'new') await rm(dir, { recursive: true, force: true })
        const keepLocal = request.assets !== 'package'
        const clashes = new Set(request.mode === 'merge' ? preview.result.clashes : [])
        const files = manifest.assets
          .filter((file) => !(keepLocal && clashes.has(file.path)))
          .map((file) => ({
            path: file.path,
            data: entries.get(PACK_PATHS.asset(file.path)) as Uint8Array,
          }))
        await writeTree(dir, files)
        assetsWritten = files.length

        // skill。
        for (const entry of plan) {
          if (entry.action === 'skip') continue
          const skill = manifest.skills.find((candidate) => candidate.name === entry.skill.name)
          if (skill === undefined) continue
          const files = skill.files.map((file) => {
            const data = entries.get(PACK_PATHS.skill(skill.name, file.path)) as Uint8Array
            if (entry.action !== 'rename' || file.path.toLowerCase() !== 'skill.md') {
              return { path: file.path, data }
            }
            const text = renameSkillDoc(new TextDecoder().decode(data), entry.as)
            return { path: file.path, data: new TextEncoder().encode(text) }
          })
          const target = join(deps.skillsRoot, entry.as)
          const replace = entry.action === 'overwrite'
          if (!replace && (await pathKind(target)) !== 'missing') {
            return fail('conflict', `${slash(target)} 已经在了`)
          }
          await installSkill(deps.skillsRoot, target, files, replace)
        }

        // 记忆：要建的那几条先查一遍没被占（预览之后可能有人建了同名的），再写元数据和内容。
        for (const entry of memoryPlan) {
          if (entry.action === 'use') continue
          if (
            (await pathKind(memoryMetaFile(deps.dataDir, entry.as))) !== 'missing' ||
            (await pathKind(memoryFolder(deps.dataDir, entry.as))) !== 'missing'
          ) {
            return fail('conflict', `记忆 ${entry.as} 已经在了，重新导入一次`)
          }
        }
        for (const entry of memoryPlan) {
          if (entry.action === 'use') continue
          const memory = manifest.memories.find((candidate) => candidate.id === entry.id)
          if (memory === undefined) continue
          await writeMemoryMeta(deps.dataDir, {
            id: entry.as,
            type: memory.type,
            name: memory.name,
            description: memory.description,
            createdAt: deps.now?.() ?? Date.now(),
          })
          await writeTree(
            memoryFolder(deps.dataDir, entry.as),
            memory.files.map((file) => ({
              path: file.path,
              data: entries.get(PACK_PATHS.memory(memory.id, file.path)) as Uint8Array,
            })),
          )
        }
      } catch (error) {
        return fail(
          'io_error',
          `写文件失败：${error instanceof Error ? error.message : String(error)}`,
        )
      }
      return { ok: true, result: undefined }
    },
  })
  if (!outcome.ok) return outcome
  await discard(deps.dataDir, request.token)
  return {
    ok: true,
    result: {
      name: outcome.result.name,
      versions: outcome.result.versions,
      duplicates: outcome.result.duplicates,
      assets: assetsWritten,
      skills: plan.map((entry) => ({ name: entry.skill.name, as: entry.as, action: entry.action })),
      memories: memoryPlan,
    },
  }
}
