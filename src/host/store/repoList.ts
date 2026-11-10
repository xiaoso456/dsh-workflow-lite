/**
 * dsh-workflow-lite — 仓储的列举部分：`list` 扫描 `workflows/` 与 `templates/nodes/`，给出每一项的概况与告警。
 *
 * 只读，不进锁：列举每次都看盘上的文件。每份图文件读出来的结论（几步、能不能用）按文件身份
 * （文件号 + 大小 + 修改时间）记着：身份没变就不再读、不再解析和校验——几百张图时这三样是列表的大头。
 * 原子写入换的是新文件，外部编辑会改修改时间，所以身份一变就重读；记着的结论只取决于文件内容和图名
 * （保存级校验不看别的，见 `DocumentValidator`）。
 * @module @xiaoso/dsh-workflow-lite/host/store/repoList
 */

import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readDocument } from '../../shared/model.ts'
import type {
  ListResult,
  TemplateEntry,
  ToolWarning,
  ValidationProblem,
  WorkflowEntry,
} from '../../shared/types.ts'
import { readFileText } from './atomic.ts'
import {
  type DirScan,
  pathKind,
  scanTemplateDir,
  scanWorkflowDir,
  templateFile,
  workflowFile,
} from './paths.ts'
import type { RepoCore } from './repoCore.ts'
import { describeProblems, onlyLevel, saveProblem } from './repoResult.ts'
import { parseNodeData, templateProblems } from './repoTemplates.ts'
import { countVersions } from './versions.ts'

/** 列举部分用到的核心能力。 */
type ListCore = Pick<RepoCore, 'dataDir' | 'validate'>

/** 同时读几个文件（几百张图时一个接一个读太慢，一下全开又可能撞上打开文件数的上限）。 */
const READ_AHEAD = 16

/** 一份图文件读出来的结论：只取决于文件内容和图名。 */
type FileFacts =
  | { parsed: false; reason: string }
  | { parsed: true; nodeCount: number; errors: ValidationProblem[] }

/** 文件身份：换了文件（原子写入落下的是新文件）、改了大小或修改时间，都会变。 */
function stampOf(stats: Stats): string {
  return `${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`
}

/** 按 `items` 的次序给出结果，同时最多 `limit` 个在跑。 */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await run(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export class WorkflowLister {
  private readonly core: ListCore
  /** 图名 → 上次读到的文件身份与结论。 */
  private readonly facts = new Map<string, { stamp: string; facts: FileFacts }>()

  constructor(core: ListCore) {
    this.core = core
  }

  async list(): Promise<ListResult> {
    const warnings: ToolWarning[] = []

    const [scan, templateNodes] = await Promise.all([
      scanWorkflowDir(this.core.dataDir),
      scanTemplateDir(this.core.dataDir),
    ])
    const legacy = await this.detectLegacy(scan)

    if (legacy) {
      warnings.push({
        level: 'hint',
        code: 'legacy_structure',
        message: '检测到 md 版旧结构，未迁移、不读取',
      })
    }
    this.reportIgnored(scan, 'workflows/', warnings)
    this.reportIgnored(templateNodes, 'templates/nodes/', warnings)

    const workflows = await mapLimited(scan.names, READ_AHEAD, async (name) => {
      const [entry, versions] = await Promise.all([
        this.describeWorkflow(name, scan),
        countVersions(this.core.dataDir, name),
      ])
      return versions > 0 ? { ...entry, versions } : entry
    })
    // 不在了的图，记着的结论也不留。
    const present = new Set(scan.names)
    for (const name of this.facts.keys()) if (!present.has(name)) this.facts.delete(name)

    return {
      workflows,
      templates: {
        nodes: await this.describeTemplates(templateNodes.names),
      },
      warnings,
    }
  }

  private async detectLegacy(scan: DirScan): Promise<boolean> {
    if (scan.directories.length > 0) return true
    return (await pathKind(join(this.core.dataDir, 'nodes'))) === 'dir'
  }

  private reportIgnored(scan: DirScan, label: string, warnings: ToolWarning[]): void {
    for (const name of scan.ignored) {
      warnings.push({
        level: 'hint',
        code: 'stray_entry',
        message: `${label}${name} 不像图文件（非 .json / 隐藏 / .tmp-* / 符号链接），已忽略`,
        workflows: [name],
      })
    }
    for (const name of scan.directories) {
      warnings.push({
        level: 'hint',
        code: 'legacy_structure',
        message: `${label}${name} 是目录：目录不是图文件，已忽略`,
        workflows: [name],
      })
    }
  }

  private async describeWorkflow(name: string, scan: DirScan): Promise<WorkflowEntry> {
    const file = workflowFile(this.core.dataDir, name)
    let stats: Stats
    try {
      stats = await stat(file)
    } catch {
      return { name, nodeCount: 0, updatedAt: 0, invalid: true, reason: '文件在扫描后消失' }
    }
    const updatedAt = stats.mtimeMs
    const facts = await this.factsOf(name, file, stampOf(stats))
    if (facts === null) {
      return { name, nodeCount: 0, updatedAt, invalid: true, reason: '文件在扫描后消失' }
    }
    if (!facts.parsed) return { name, nodeCount: 0, updatedAt, invalid: true, reason: facts.reason }
    const errors = [...facts.errors]
    const collides = scan.directories.some((dir) => dir.toLowerCase() === name.toLowerCase())
    if (collides) {
      errors.unshift(
        saveProblem(
          'workflow_dir_collision',
          `workflows/${name}.json 与 workflows/${name}/ 同时存在`,
        ),
      )
    }
    if (errors.length > 0) {
      return {
        name,
        nodeCount: facts.nodeCount,
        updatedAt,
        invalid: true,
        reason: describeProblems(errors),
      }
    }
    return { name, nodeCount: facts.nodeCount, updatedAt }
  }

  /** 这份图文件的结论：文件身份和上次一样就用上次的，否则读、解析、校验一遍；读不到是 `null`。 */
  private async factsOf(name: string, file: string, stamp: string): Promise<FileFacts | null> {
    const known = this.facts.get(name)
    if (known !== undefined && known.stamp === stamp) return known.facts
    const text = await readFileText(file)
    if (text === null) return null
    const parsed = readDocument(text)
    const facts: FileFacts =
      parsed.document === null
        ? { parsed: false, reason: describeProblems(onlyLevel(parsed.problems, 'save')) }
        : {
            parsed: true,
            nodeCount: parsed.document.nodes.length,
            errors: onlyLevel(this.core.validate(parsed.document, name), 'save'),
          }
    this.facts.set(name, { stamp, facts })
    return facts
  }

  private async describeTemplates(names: readonly string[]): Promise<TemplateEntry[]> {
    const entries: TemplateEntry[] = []
    for (const name of names) {
      const text = await readFileText(templateFile(this.core.dataDir, name))
      if (text === null) {
        entries.push({ name, invalid: true, reason: '文件在扫描后消失' })
        continue
      }
      const errors = templateProblems(text).filter(
        (problem) => problem.level === 'save' || problem.level === 'compile',
      )
      // 顺带给出它的描述：步骤库的条目上要显示"这一步做什么"。
      const data = parseNodeData(text).data
      const description = data.description
      const described = {
        ...(description === undefined || description === '' ? {} : { description }),
        // 我的步骤自己选的图标与颜色：步骤库的条目照着画。
        ...(data.icon === undefined ? {} : { icon: data.icon }),
        ...(data.color === undefined ? {} : { color: data.color }),
      }
      if (errors.length > 0) {
        entries.push({ name, invalid: true, reason: describeProblems(errors), ...described })
      } else {
        entries.push({ name, ...described })
      }
    }
    return entries
  }
}
