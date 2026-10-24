/**
 * dsh-workflow-lite — 把工作流的一个版本导出成 skill（布局见 `shared/skillPack.ts`）。
 *
 * 和导出工作流包共用盘点（{@link scanState}）与"打包哪些"的勾选：打包的文件、文件夹、资料目录进
 * `assets/`，打包的 skill 进 `skills/<名>/`，引用的记忆（勾了带内容的）进 `memory/<id>/`。不同的是图不进包——包里是编译好的提示词：
 * SKILL.md 是 skill 口径的派发计划，`steps/<id>.md` 是各步骤的任务描述，路径里包内的写成 `{skill}/…`，
 * 产出根目录原样保留（`{instance}` 由执行者开始时取一个编号）。
 *
 * 出口两个：打成 zip 走暂存区给浏览器下载，或直接装进 `~/.agents/skills/<名>`。
 *
 * @module @xiaoso/dsh-workflow-lite/host/pack/skillExporter
 */

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { buildPlan, buildTaskTexts, type SkillPlan } from '../../shared/compile.ts'
import { analyzeGraph } from '../../shared/graph.ts'
import { isStep } from '../../shared/model.ts'
import { rootOf } from '../../shared/outputPaths.ts'
import { PACK_MAX_BYTES, PACK_MAX_FILES } from '../../shared/pack.ts'
import {
  INSTANCE_VAR,
  isMemoryPath,
  isWorkflowPath,
  skillPath,
  workflowRelative,
} from '../../shared/pathVars.ts'
import { memoryOf } from '../../shared/presets.ts'
import { bindDirs, resourceGraph } from '../../shared/resources.ts'
import {
  checkSkillMeta,
  SKILL_ASSETS,
  SKILL_MEMORY,
  SKILL_PATHS,
  type SkillBuildRequest,
  type SkillExisting,
  type SkillExportRequest,
  type SkillExportResponse,
  type SkillPreviewResponse,
  skillDoc,
} from '../../shared/skillPack.ts'
import type { ErrorCode, ValidationProblem, WorkflowDocument } from '../../shared/types.ts'
import { pathKind } from '../store/paths.ts'
import type { Outcome } from '../store/repository.ts'
import { isAbsolutePath, type PackDeps, rewriteForPack, scanState } from './exporter.ts'
import { installSkill } from './importer.ts'
import { stageSkill } from './skillBrowse.ts'
import { newStage, writeOut } from './staging.ts'
import { readTree } from './tree.ts'

type Fail = {
  ok: false
  error: { code: ErrorCode; message: string; detail?: Record<string, unknown> }
}

function fail(code: ErrorCode, message: string, detail?: Record<string, unknown>): Fail {
  return { ok: false, error: detail === undefined ? { code, message } : { code, message, detail } }
}

const slash = (path: string): string => path.replace(/\\/gu, '/')

/** 编好的 skill：除 SKILL.md 头部以外的全部。 */
interface BuiltSkill {
  preview: SkillPreviewResponse
  /** 相对 skill 目录的路径 → 内容（不含 SKILL.md）。 */
  files: Map<string, Uint8Array>
}

/** 本机已有的 skill：模型能看到的，加上 `~/.agents/skills` 里的目录（哪怕没开给模型用）。 */
async function existingSkills(
  skillsRoot: string,
  visible: ReadonlyMap<string, { path?: string }>,
): Promise<SkillExisting[]> {
  const installed = new Set<string>()
  try {
    for (const entry of await readdir(skillsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) installed.add(entry.name)
    }
  } catch {
    // 还没有 skillsRoot。
  }
  const out = new Map<string, SkillExisting>()
  for (const [name, entry] of visible) {
    out.set(name, {
      name,
      ...(entry.path === undefined ? {} : { path: entry.path.replace(/\/SKILL\.md$/iu, '') }),
      overwritable: installed.has(name),
    })
  }
  for (const name of installed) {
    if (!out.has(name)) {
      out.set(name, { name, path: slash(join(skillsRoot, name)), overwritable: true })
    }
  }
  return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** 编译、收文件：预览和导出都走这里，两边看到的是同一份。 */
async function buildSkill(
  deps: PackDeps,
  request: SkillBuildRequest,
): Promise<Outcome<BuiltSkill>> {
  const scanned = await scanState(deps, {
    name: request.name,
    versions: [request.version],
    ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
    ...(request.session === undefined ? {} : { session: request.session }),
  })
  if (!scanned.ok) return scanned
  const { response, versions, trees, assetsTree, skills, memories } = scanned.result
  const [picked] = versions
  if (picked === undefined) return fail('invalid_args', '至少选一个版本')
  const original = picked.document
  const wanted = new Set(request.pack)

  const files = new Map<string, Uint8Array>()
  let bytes = 0
  const put = (path: string, data: Uint8Array): void => {
    files.set(path, data)
    bytes += data.length
  }

  // 资料目录整个带上；勾了的文件、文件夹放进去（名字盘点时已经排好，见 `PackScanItem.as`）。
  if (assetsTree !== null) {
    const read = await readTree(assetsTree)
    for (const file of read.files) {
      put(SKILL_PATHS.asset(file.path), read.data.get(file.path) as Uint8Array)
    }
  }
  const renames = new Map<string, string>()
  const bundled = new Set<string>()
  const needs: string[] = []
  const absolute: string[] = []
  for (const item of response.items) {
    const memory = memories.get(item.key)
    if (memory !== undefined) {
      // 记忆：勾了就把现在攒下的带进去，没勾就是一个空文件夹（执行时从头攒）。
      const tree = trees.get(item.key)
      if (item.state !== 'memory' || !wanted.has(item.key) || tree === undefined) continue
      const read = await readTree(tree)
      for (const file of read.files) {
        put(SKILL_PATHS.memory(memory.id, file.path), read.data.get(file.path) as Uint8Array)
      }
      continue
    }
    const chosen = item.state === 'pack' && wanted.has(item.key)
    if (item.kind === 'skill') {
      if (!chosen) {
        needs.push(item.value)
        continue
      }
      const tree = trees.get(item.key)
      if (tree === undefined) continue
      const read = await readTree(tree)
      for (const file of read.files) {
        put(SKILL_PATHS.skill(item.value, file.path), read.data.get(file.path) as Uint8Array)
      }
      bundled.add(item.value)
      continue
    }
    if (item.kind !== 'file' && item.kind !== 'folder') continue
    // 库里已经没有的记忆：skill 里是个空的 memory/<id>，执行时从头攒，不算按绝对路径引用。
    if (isMemoryPath(item.value)) continue
    if (!chosen) {
      // 相对路径换台机器照样按工作区找，资料目录里的随包走；产出写在产出根目录下，
      // 写到绝对路径的（比如在别的仓库里就地更新）却和读的一样，换台机器不一定有。
      const external =
        item.state === 'output'
          ? isAbsolutePath(item.value)
          : item.state === 'pack' || item.state === 'missing' || item.state === 'tooLarge'
      if (external) {
        // 和计划里资源的路径同一种写法（`/` 分隔），同一个文件夹别在两处写成两样。
        absolute.push(slash(item.value))
      }
      continue
    }
    const tree = trees.get(item.key)
    if (tree === undefined || item.as === undefined) continue
    const name = workflowRelative(item.as)
    const read = await readTree(tree)
    for (const file of read.files) {
      const path = item.kind === 'file' ? name : `${name}/${file.path}`
      put(SKILL_PATHS.asset(path), read.data.get(file.path) as Uint8Array)
    }
    renames.set(item.key, item.as)
  }

  // 图：打包的换成 `{workflow}/…`，工作流目录再换成 `{skill}/assets/…`、记忆换成 `{skill}/memory/…`；产出根目录写实（没配就是默认值）。
  const rewritten = rewriteForPack(original, renames)
  const document: WorkflowDocument = {
    ...bindDirs(rewritten, { workflow: SKILL_ASSETS, memory: SKILL_MEMORY }),
    settings: { ...rewritten.settings, outputRoot: rootOf(rewritten.settings) },
  }
  const problems: ValidationProblem[] = deps.validate?.(original, request.name) ?? []
  const analysis = analyzeGraph(document)
  const payloadPaths = new Map(
    document.nodes
      .filter(isStep)
      .map((node) => [node.id, skillPath(SKILL_PATHS.step(node.id))] as const),
  )
  const facts = { name: request.name, document, payloadPaths }
  const skill: SkillPlan = { bundled, needs, absolute }
  // 开了「记录运行状态」：skill 里没有插件，改成模型自己维护状态文件（编号由执行者开始时取）。
  const runState =
    original.settings?.runState === true ? { runState: { instance: INSTANCE_VAR } } : {}
  const plan = buildPlan(facts, analysis, { problems, skill, ...runState })
  if (plan.problems.length === 0) {
    const encoder = new TextEncoder()
    for (const [id, text] of buildTaskTexts(facts, analysis, { skill })) {
      put(SKILL_PATHS.step(id), encoder.encode(text))
    }
  }

  const labels = new Map(document.nodes.filter(isStep).map((node) => [node.id, node.data.label]))
  const writtenAssets: string[] = []
  for (const info of resourceGraph(original).values()) {
    // 记忆不管连没连线都会被写（工作流记忆由编排者收尾时整理）。
    const memory = memoryOf(info.resource.data)
    if (memory !== undefined && memory.memory !== '') {
      writtenAssets.push(SKILL_PATHS.memory(memory.memory, '').replace(/\/$/u, ''))
      continue
    }
    if (info.writers.length === 0) continue
    for (const item of info.resource.data.items) {
      if ((item.kind === 'file' || item.kind === 'folder') && isWorkflowPath(item.value)) {
        writtenAssets.push(SKILL_PATHS.asset(workflowRelative(item.value)).replace(/\/$/u, ''))
      }
    }
  }

  return {
    ok: true,
    result: {
      files,
      preview: {
        body: plan.plan,
        problems: plan.problems,
        steps: analysis.batches.flatMap((batch) =>
          batch.nodes.map((id) => labels.get(id)?.trim() || id),
        ),
        files: files.size,
        bytes,
        runState: original.settings?.runState === true,
        writtenAssets: [...new Set(writtenAssets)],
        needs,
        absolute,
        roots: response.roots,
        skillsRoot: slash(deps.skillsRoot),
        existing: await existingSkills(deps.skillsRoot, skills),
      },
    },
  }
}

/**
 * 预览：SKILL.md 正文、要提醒的事、本机已有的 skill；能导出时整个包另摆进暂存区（`browse`），
 * 前端像看文件夹一样看它（见 `skillBrowse.ts`）。
 */
export async function previewSkill(
  deps: PackDeps,
  request: SkillBuildRequest,
): Promise<Outcome<SkillPreviewResponse>> {
  const built = await buildSkill(deps, request)
  if (!built.ok) return built
  const { preview, files } = built.result
  if (preview.problems.length > 0) return { ok: true, result: preview }
  const browse = await stageSkill(deps.dataDir, request.name, preview.body, files)
  return { ok: true, result: { ...preview, browse } }
}

/** 导出：打成 zip（`<名>/…`）放进暂存区，或直接装进 `~/.agents/skills/<名>`。 */
export async function exportSkill(
  deps: PackDeps,
  request: SkillExportRequest,
): Promise<Outcome<SkillExportResponse>> {
  const problem = checkSkillMeta(request.meta)
  if (problem !== null) {
    return fail('invalid_args', `skill 的 ${problem.field} 不合规矩：${problem.problem}`, {
      ...problem,
    })
  }
  const built = await buildSkill(deps, request)
  if (!built.ok) return built
  const { preview, files } = built.result
  if (preview.problems.length > 0) {
    return fail(
      'invalid_args',
      `这一版有编译级问题，导不出来：${preview.problems.map((item) => item.message).join('；')}`,
      { problems: preview.problems },
    )
  }
  const doc = new TextEncoder().encode(skillDoc(request.meta, preview.body))
  const all = new Map<string, Uint8Array>([[SKILL_PATHS.doc, doc], ...files])
  const total = preview.bytes + doc.length
  if (total > PACK_MAX_BYTES || all.size > PACK_MAX_FILES) {
    return fail(
      'invalid_args',
      `包太大了：${all.size} 个文件、${Math.ceil(total / 1024 / 1024)} MB（上限 ${PACK_MAX_FILES} 个、${Math.round(PACK_MAX_BYTES / 1024 / 1024)} MB），少勾几项`,
    )
  }
  const name = request.meta.name

  if (request.target === 'install') {
    const target = join(deps.skillsRoot, name)
    const kind = await pathKind(target)
    const present = kind !== 'missing'
    if (kind === 'file') {
      return fail('conflict', `${slash(target)} 是一个文件，不能装在这里`, { path: slash(target) })
    }
    if (present && request.replace !== true) {
      return fail('conflict', `~/.agents/skills 里已经有 ${name} 了`, { path: slash(target) })
    }
    await installSkill(
      deps.skillsRoot,
      target,
      [...all].map(([path, data]) => ({ path, data })),
      present,
    )
    return { ok: true, result: { bytes: total, path: slash(target) } }
  }

  const entries: Record<string, Uint8Array> = {}
  for (const [path, data] of all) entries[`${name}/${path}`] = data
  const zip = zipSync(entries, { level: 6 })
  const stage = await newStage(deps.dataDir)
  await writeOut(stage.dir, zip)
  return { ok: true, result: { token: stage.token, bytes: zip.length, fileName: `${name}.zip` } }
}
