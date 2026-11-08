/**
 * dsh-workflow-lite — 仓储的列举部分：`list` 扫描 `workflows/` 与 `templates/nodes/`，给出每一项的概况与告警。
 *
 * 只读，不进锁：列举永远直接读盘，不设内容缓存。
 * @module @xiaoso/dsh-workflow-lite/host/store/repoList
 */

import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readDocument } from '../../shared/model.ts'
import type { ListResult, TemplateEntry, ToolWarning, WorkflowEntry } from '../../shared/types.ts'
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

export class WorkflowLister {
  private readonly core: ListCore

  constructor(core: ListCore) {
    this.core = core
  }

  async list(): Promise<ListResult> {
    const warnings: ToolWarning[] = []

    const [scan, templateNodes, legacy] = await Promise.all([
      scanWorkflowDir(this.core.dataDir),
      scanTemplateDir(this.core.dataDir),
      this.detectLegacy(),
    ])

    if (legacy) {
      warnings.push({
        level: 'hint',
        code: 'legacy_structure',
        message: '检测到 md 版旧结构，未迁移、不读取',
      })
    }
    this.reportIgnored(scan, 'workflows/', warnings)
    this.reportIgnored(templateNodes, 'templates/nodes/', warnings)

    const workflows: WorkflowEntry[] = []
    for (const name of scan.names) {
      const entry = await this.describeWorkflow(name, scan)
      const versions = await countVersions(this.core.dataDir, name)
      workflows.push(versions > 0 ? { ...entry, versions } : entry)
    }

    return {
      workflows,
      templates: {
        nodes: await this.describeTemplates(templateNodes.names),
      },
      warnings,
    }
  }

  private async detectLegacy(): Promise<boolean> {
    const scan = await scanWorkflowDir(this.core.dataDir)
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
    let updatedAt = 0
    try {
      updatedAt = (await stat(file)).mtimeMs
    } catch {
      return { name, nodeCount: 0, updatedAt, invalid: true, reason: '文件在扫描后消失' }
    }
    const text = await readFileText(file)
    if (text === null) {
      return { name, nodeCount: 0, updatedAt, invalid: true, reason: '文件在扫描后消失' }
    }
    const parsed = readDocument(text)
    if (parsed.document === null) {
      return {
        name,
        nodeCount: 0,
        updatedAt,
        invalid: true,
        reason: describeProblems(onlyLevel(parsed.problems, 'save')),
      }
    }
    const errors = onlyLevel(this.core.validate(parsed.document, name), 'save')
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
        nodeCount: parsed.document.nodes.length,
        updatedAt,
        invalid: true,
        reason: describeProblems(errors),
      }
    }
    return { name, nodeCount: parsed.document.nodes.length, updatedAt }
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
