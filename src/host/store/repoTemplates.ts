/**
 * dsh-workflow-lite — 仓储的节点模板部分：读 / 建 / 存（含改名）/ 删 `templates/nodes/<名>.json`。
 *
 * 模板文件顶层就是节点的 `data` 本体（不套壳）；这里同时放它的规范化写出（`writeNodeTemplate`）、
 * 形状归一（`parseNodeData`）和结构预检（`templateProblems`）。
 * @module @xiaoso/dsh-workflow-lite/host/store/repoTemplates
 */

import { canonicalOutput, readNodeData } from '../../shared/model.ts'
import { sameName } from '../../shared/naming.ts'
import type { NodeData, ValidationProblem, WriteResult } from '../../shared/types.ts'
import { readFileText, unlinkFile, writeFileAtomic } from './atomic.ts'
import { describeOccupant, templateFile, templateOccupant } from './paths.ts'
import type { RepoCore } from './repoCore.ts'
import {
  describeProblems,
  fail,
  hasLevel,
  mapWriteFailure,
  type Outcome,
  ok,
  onlyLevel,
  saveProblem,
} from './repoResult.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 节点模板文件的规范化写出：固定键序（`label` / `description` / `icon` / `color` / `prompt` / `output`）、缺省项不写、
 * 末尾一个换行。与 {@link parseNodeData} 是同一套形状——**文件顶层就是 `data` 本体**，
 * 不套 `{ data: … }` 壳。`prompt` 总是写出来（空串也写）：那是这个模板的正文，
 * 缺键与空串在读者眼里是两件事，别让它含糊。
 */
export function writeNodeTemplate(data: NodeData): string {
  const out: Record<string, unknown> = {}
  if (data.label !== undefined && data.label !== '') out.label = data.label
  if (data.description !== undefined && data.description !== '') {
    out.description = data.description
  }
  if (data.icon !== undefined) out.icon = data.icon
  if (data.color !== undefined) out.color = data.color
  out.prompt = data.prompt ?? ''
  const output = canonicalOutput(data.output)
  if (output !== undefined) out.output = output
  return `${JSON.stringify(out, null, 2)}\n`
}

/** 节点模板 = 一个 `data` 本体；这里只做形状归一，规则判定交给校验层。 */
export function parseNodeData(text: string): { data: NodeData; problems: ValidationProblem[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      data: {},
      problems: [
        saveProblem(
          'json_parse_failed',
          `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    }
  }
  if (!isRecord(parsed)) {
    return { data: {}, problems: [saveProblem('schema_invalid', '节点模板必须是一个 JSON 对象')] }
  }
  const data = readNodeData(parsed)
  const problems: ValidationProblem[] = []
  if (data.prompt === undefined || data.prompt === '') {
    problems.push({
      level: 'compile',
      code: 'prompt_empty',
      message: '节点模板的 prompt 缺失或为空',
    })
  }
  return { data, problems }
}

/** 节点模板预检：只看结构。 */
export function templateProblems(text: string): ValidationProblem[] {
  return parseNodeData(text).problems
}

/** 模板部分用到的核心能力。 */
type TemplatesCore = Pick<RepoCore, 'dataDir' | 'withLock' | 'ensureLayout' | 'resolveName'>

export class TemplateStore {
  private readonly core: TemplatesCore

  constructor(core: TemplatesCore) {
    this.core = core
  }

  async readTemplate(name: string): Promise<Outcome<NodeData>> {
    return this.readNodeTemplate(name)
  }

  async readNodeTemplate(name: string): Promise<Outcome<NodeData>> {
    const loaded = await this.loadTemplateText(name)
    if (!loaded.ok) return loaded
    const parsed = parseNodeData(loaded.result.text)
    if (hasLevel(parsed.problems, 'save')) {
      return fail('blocked', `节点模板 ${name} 不可读`, {
        problems: onlyLevel(parsed.problems, 'save'),
      })
    }
    return ok(parsed.data)
  }

  async createNodeTemplate(name: string, data: NodeData): Promise<Outcome<WriteResult>> {
    return this.core.withLock(async () => {
      const resolved = this.core.resolveName(name)
      if (!resolved.ok) return resolved
      const templateName = resolved.result
      const ready = await this.core.ensureLayout()
      if (!ready.ok) return ready

      const target = templateFile(this.core.dataDir, templateName)
      /*
       * 撞名 = **冲突**，不是"改名后接着写"。
       *
       * 与 `create`（建图）刻意不同：那条路上名字常常是自动取的（"未命名"），撞了加序号
       * 是帮忙；这条路上名字是人在对话框里指名输的，静默改名会让人对着列表找不到刚建的那个，
       * 而覆盖别人的模板更不可接受。
       */
      const occupant = await templateOccupant(this.core.dataDir, templateName)
      if (occupant !== null) {
        return fail(
          'conflict',
          `节点模板 ${templateName} 已存在（${describeOccupant(occupant)}）`,
          {
            template: templateName,
            kind: 'nodes',
            occupant,
          },
        )
      }
      try {
        await writeFileAtomic(target, writeNodeTemplate(data))
      } catch (error) {
        return mapWriteFailure(error, target)
      }
      return ok({
        changed: [
          {
            kind: 'workflow',
            op: 'add',
            id: templateName,
            detail: { template: 'nodes', created: true },
          },
        ],
        warnings: [],
      })
    })
  }

  async readNodeTemplateDraft(name: string): Promise<Outcome<NodeData>> {
    const resolved = this.core.resolveName(name)
    if (!resolved.ok) return resolved
    const text = await readFileText(templateFile(this.core.dataDir, resolved.result))
    if (text === null) {
      return fail('not_found', `节点模板 ${resolved.result} 不存在`, {
        template: resolved.result,
        kind: 'nodes',
      })
    }
    const parsed = parseNodeData(text)
    if (hasLevel(parsed.problems, 'save')) {
      return fail('blocked', `节点模板 ${resolved.result} 不可读`, {
        problems: onlyLevel(parsed.problems, 'save'),
      })
    }
    return ok(parsed.data)
  }

  async saveNodeTemplate(
    name: string,
    data: NodeData,
    from?: string,
  ): Promise<Outcome<WriteResult>> {
    return this.core.withLock(async () => {
      const resolved = this.core.resolveName(name)
      if (!resolved.ok) return resolved
      const templateName = resolved.result
      let previous = templateName
      if (from !== undefined) {
        const source = this.core.resolveName(from)
        if (!source.ok) return source
        previous = source.result
      }
      const ready = await this.core.ensureLayout()
      if (!ready.ok) return ready

      const oldFile = templateFile(this.core.dataDir, previous)
      if ((await readFileText(oldFile)) === null) {
        return fail('not_found', `节点模板 ${previous} 不存在`, {
          template: previous,
          kind: 'nodes',
        })
      }
      // 改名：新名字必须空着（大小写不同的同一个名字算自己，Windows 上它们本来就是同一个文件）。
      const renaming = previous !== templateName
      if (renaming && !sameName(previous, templateName)) {
        const occupant = await templateOccupant(this.core.dataDir, templateName)
        if (occupant !== null) {
          return fail(
            'conflict',
            `节点模板 ${templateName} 已存在（${describeOccupant(occupant)}）`,
            { template: templateName, kind: 'nodes', occupant },
          )
        }
      }
      const target = templateFile(this.core.dataDir, templateName)
      try {
        if (renaming && sameName(previous, templateName)) {
          // 只改大小写：新旧在不区分大小写的盘上是同一个文件，先写再删会把刚写的删掉。
          await unlinkFile(oldFile)
          await writeFileAtomic(target, writeNodeTemplate(data))
        } else {
          // 先写新的再删旧的：中途失败最多多出一份，不会两份都没有。
          await writeFileAtomic(target, writeNodeTemplate(data))
          if (renaming) await unlinkFile(oldFile)
        }
      } catch (error) {
        return mapWriteFailure(error, target)
      }
      return ok({
        changed: [
          {
            kind: 'workflow',
            op: renaming ? 'rename' : 'update',
            id: templateName,
            detail: { template: 'nodes', ...(renaming ? { from: previous } : {}) },
          },
        ],
        warnings: [],
      })
    })
  }

  async deleteNodeTemplate(name: string): Promise<Outcome<WriteResult>> {
    return this.core.withLock(async () => {
      const resolved = this.core.resolveName(name)
      if (!resolved.ok) return resolved
      const target = templateFile(this.core.dataDir, resolved.result)
      if ((await readFileText(target)) === null) {
        return fail('not_found', `节点模板 ${resolved.result} 不存在`, {
          template: resolved.result,
          kind: 'nodes',
        })
      }
      try {
        await unlinkFile(target)
      } catch (error) {
        return mapWriteFailure(error, target)
      }
      return ok({
        changed: [
          { kind: 'workflow', op: 'delete', id: resolved.result, detail: { template: 'nodes' } },
        ],
        warnings: [],
      })
    })
  }

  /** 读出模板文本并做预检：坏的（保存级 / 编译级）一律 `blocked`，绝不复制半成品。 */
  private async loadTemplateText(
    name: string,
  ): Promise<Outcome<{ text: string; problems: ValidationProblem[] }>> {
    const resolved = this.core.resolveName(name)
    if (!resolved.ok) return resolved
    const text = await readFileText(templateFile(this.core.dataDir, resolved.result))
    if (text === null) {
      return fail('not_found', `节点模板 ${resolved.result} 不存在`, {
        template: resolved.result,
      })
    }
    const problems = templateProblems(text)
    const errors = problems.filter(
      (problem) => problem.level === 'save' || problem.level === 'compile',
    )
    if (errors.length > 0) {
      return fail('blocked', `节点模板 ${resolved.result} 不可用：${describeProblems(errors)}`, {
        template: resolved.result,
        problems: errors,
      })
    }
    return ok({ text, problems })
  }
}
