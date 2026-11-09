/**
 * dsh-workflow-lite — `graph/*`：工作流图与节点模板的增删改查、版本。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc/graph
 */

import type { MemoryVersionEntry } from '../../shared/memoryLib.ts'
import { normalizeDocument, readNodeData as readDataFields } from '../../shared/model.ts'
import { memoryRefs } from '../../shared/presets.ts'
import type { NodeData } from '../../shared/types.ts'
import type { GraphLoadResponse } from '../../shared/wire/graph.ts'
import type { WorkflowLiteEndpoint } from '../../shared/wire.ts'
import { hasMemory } from '../store/memories.ts'
import { saveMemoryVersion } from '../store/memoryVersions.ts'
import { problemsToWarnings } from '../store/repoResult.ts'
import type { LoadResult } from '../store/repoWorkflows.ts'
import {
  asRecord,
  fail,
  failFrom,
  ok,
  optionalString,
  type RpcDeps,
  type RpcResult,
  requireString,
  requireVersion,
} from './shared.ts'

/**
 * 把线上来的 `data` 形状归一成节点的 `data` 本体：只认 `label` / `prompt` / `output`。
 *
 * `prompt` 缺省当**空串**：空 prompt 是编译级问题（由图上的校验面板去说），
 * 不该在这里被拦成"参数不合法"——那会把"内容还没写完的模板"变成"建不出来"。
 */
function readNodeData(value: unknown): NodeData {
  const input = value === undefined || value === null ? {} : asRecord(value)
  const data = readDataFields(input)
  if (data.label === '') delete data.label
  if (data.description === '') delete data.description
  return { ...data, prompt: data.prompt ?? '' }
}

/** 连同工作流版本一起存：它现在引用的每条记忆各存一份（内容没变的跳过，不在库里的不存）。 */
async function saveWorkflowMemories(
  deps: RpcDeps,
  name: string,
  note: string,
): Promise<{ id: string; version: MemoryVersionEntry | null; error?: string }[]> {
  const load = await deps.repository.load(name)
  if (load.document === null) return []
  const results: { id: string; version: MemoryVersionEntry | null; error?: string }[] = []
  for (const id of memoryRefs(load.document)) {
    if (!(await hasMemory(deps.dataDir(), id))) continue
    const saved = await saveMemoryVersion(deps.dataDir(), id, note, { skipSame: true })
    results.push(
      saved.ok ? { id, version: saved.result } : { id, version: null, error: saved.error.message },
    )
  }
  return results
}

export async function dispatchGraph(
  deps: RpcDeps,
  endpoint: Extract<WorkflowLiteEndpoint, `graph/${string}`>,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  switch (endpoint) {
    case 'graph/list': {
      const list = await deps.repository.list()
      return ok({ ...list, limits: deps.limits() })
    }

    case 'graph/load': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const load: LoadResult = await deps.repository.load(name)
      if (!load.exists) return fail('not_found', `图 ${name} 不存在`)
      const response: GraphLoadResponse = {
        name: load.name,
        // 保存级破损时给空壳文档——画布据此进只读错误态；原文一并回给模型/用户去修。
        document: load.document ?? { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } },
        hash: load.hash ?? '',
        problems: load.problems,
        warnings: problemsToWarnings(load.problems),
        ...(load.text === null ? {} : { raw: load.text }),
      }
      return ok(response)
    }

    case 'graph/save': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const parsed = normalizeDocument(input.document)
      if (parsed.document === null) {
        return fail(
          'invalid_args',
          `提交的文档形状不合法：${parsed.problems.map((problem) => problem.message).join('；')}`,
        )
      }
      const baseHash = optionalString(input, 'baseHash') ?? null
      // 「保留我的」只在画布（人在场、看过冲突清单）时有意义；工具写路径不传，也就拿不到。
      const force = input.force === true
      const outcome = await deps.repository.save(name, parsed.document, { baseHash, force })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({
        hash: outcome.result.hash,
        warnings: outcome.result.warnings,
        // 成功路径上恒为空：真冲突在非 force 时走 `error.detail.ids` 返回（不写盘），
        // 而 force 时冲突 id 已按本地为准写完，没有"未能合并"的残留。
        conflictIds: [],
      })
    }

    case 'graph/create': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.create(name)
      if (!outcome.ok) return failFrom(outcome.error)
      // 撞名加序号时，实际生成的名字在 changed 里。
      const created = outcome.result.changed[0]?.id ?? name
      return ok({ name: created, warnings: outcome.result.warnings })
    }

    case 'graph/rename': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const to = requireString(input, 'to')
      const outcome = await deps.repository.rename(name, to)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ name: to, warnings: outcome.result.warnings })
    }

    case 'graph/delete': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.remove(name)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ warnings: outcome.result.warnings })
    }

    case 'graph/versions': {
      const input = asRecord(payload)
      const outcome = await deps.repository.listVersions(requireString(input, 'name'))
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ versions: outcome.result })
    }

    case 'graph/versionSave': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const note = typeof input.note === 'string' ? input.note : ''
      const outcome = await deps.repository.saveVersion(name, note)
      if (input.memories !== true) {
        return outcome.ok ? ok({ version: outcome.result }) : failFrom(outcome.error)
      }
      // 连同记忆：工作流和某一版一样就不另存，记忆照存（记忆可能变了）。
      const same = outcome.ok ? undefined : outcome.error.detail?.same
      if (!outcome.ok && typeof same !== 'number') return failFrom(outcome.error)
      return ok({
        version: outcome.ok ? outcome.result : null,
        ...(typeof same === 'number' ? { same } : {}),
        memories: await saveWorkflowMemories(deps, name, note),
      })
    }

    case 'graph/versionLoad': {
      const input = asRecord(payload)
      const outcome = await deps.repository.readVersion(
        requireString(input, 'name'),
        requireVersion(input),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ version: outcome.result.entry, document: outcome.result.document })
    }

    case 'graph/versionRestore': {
      const input = asRecord(payload)
      const outcome = await deps.repository.restoreVersion(
        requireString(input, 'name'),
        requireVersion(input),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'graph/versionNote': {
      const input = asRecord(payload)
      const note = typeof input.note === 'string' ? input.note : ''
      const outcome = await deps.repository.noteVersion(
        requireString(input, 'name'),
        requireVersion(input),
        note,
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ version: outcome.result })
    }

    case 'graph/versionDelete': {
      const input = asRecord(payload)
      const outcome = await deps.repository.deleteVersion(
        requireString(input, 'name'),
        requireVersion(input),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'graph/templates': {
      const list = await deps.repository.list()
      return ok(list.templates)
    }

    case 'graph/nodeTemplate': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.readTemplate(name)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ name, data: outcome.result })
    }

    case 'graph/nodeTemplateCreate': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.createNodeTemplate(name, readNodeData(input.data))
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ name, warnings: outcome.result.warnings })
    }

    case 'graph/nodeTemplateDraft': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.readNodeTemplateDraft(name)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ name, data: outcome.result })
    }

    case 'graph/nodeTemplateSave': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const from = optionalString(input, 'from')
      const outcome = await deps.repository.saveNodeTemplate(name, readNodeData(input.data), from)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ name, warnings: outcome.result.warnings })
    }

    case 'graph/nodeTemplateDelete': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const outcome = await deps.repository.deleteNodeTemplate(name)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ warnings: outcome.result.warnings })
    }

    default: {
      const exhaustive: never = endpoint
      throw new Error(`unknown endpoint ${String(exhaustive)}`)
    }
  }
}
