/**
 * dsh-workflow-lite — `write_resource` 带 `memory` 时加记忆卡：引用记忆库里已有的一条，或新建一条再挂上。
 * @module @xiaoso/dsh-workflow-lite/host/tool/memoryCard
 */

import { idKey, isStep } from '../../shared/model.ts'
import { stepMemories, suggestMemoryId } from '../../shared/presets.ts'
import type { ChangedEntry, MemoryType, ToolWarning } from '../../shared/types.ts'
import { MEMORY_TYPES } from '../../shared/types.ts'
import { createMemory, deleteMemory, type MemoryDeps, readMemoryMeta } from '../store/memories.ts'
import type { Outcome } from '../store/repoResult.ts'
import type { MemoryArgs } from './args.ts'
import type { ToolDeps } from './tool.ts'

type MemoryCardOutcome = Outcome<{
  changed: ChangedEntry[]
  warnings: ToolWarning[]
  memory: { id: string; type: MemoryType; created: boolean; note?: string }
}>

function memoryFail(
  code: 'invalid_args' | 'not_found' | 'conflict',
  message: string,
): MemoryCardOutcome {
  return { ok: false, error: { code, message } }
}

/**
 * `write_resource` 带 `memory`：引用库里已有的一条（给了 `id` 且库里有），或新建一条（没给 `id` 时按画布的规则起名，
 * 撞了加序号），再加一张记忆卡。先查图，查过了才建库里的那条；卡没加上就把刚建的删掉，不留没人用的空记忆。
 */
export async function writeMemoryCard(
  deps: ToolDeps,
  workflow: string,
  input: MemoryArgs,
): Promise<MemoryCardOutcome> {
  for (const key of ['id', 'step', 'name', 'description'] as const) {
    const value = input[key]
    if (value !== undefined && typeof value !== 'string') {
      return memoryFail('invalid_args', `memory.${key} 必须是文字`)
    }
  }
  let type: MemoryType | undefined
  if (input.type !== undefined) {
    type = MEMORY_TYPES.find((candidate) => candidate === input.type)
    if (type === undefined) {
      return memoryFail(
        'invalid_args',
        `memory.type 不认识：${String(input.type)}（可选：${MEMORY_TYPES.join(' / ')}）`,
      )
    }
  }
  const id = input.id === undefined || input.id.trim() === '' ? undefined : input.id.trim()
  const step = input.step === undefined || input.step.trim() === '' ? undefined : input.step.trim()

  const load = await deps.repository.load(workflow)
  if (!load.exists) return memoryFail('not_found', `图 ${workflow} 不存在`)
  const document = load.document
  if (document === null) return memoryFail('invalid_args', `图 ${workflow} 有保存级问题，先修好`)
  if (step !== undefined) {
    const node = document.nodes.find((candidate) => idKey(candidate.id) === idKey(step))
    if (node === undefined) return memoryFail('not_found', `图 ${workflow} 里没有节点 ${step}`)
    if (!isStep(node)) return memoryFail('invalid_args', `${node.id} 不是步骤，记忆只能挂在步骤上`)
    const existing = stepMemories(document, node.id)[0]
    if (existing !== undefined) {
      return memoryFail('conflict', `步骤 ${node.id} 已经有记忆了（${existing.id}）`)
    }
  }

  const dataDir = deps.dataDir()
  const memoryDeps: MemoryDeps = { dataDir, repository: deps.repository }
  const meta = id === undefined ? null : await readMemoryMeta(dataDir, id)
  if (meta === 'invalid') {
    return memoryFail('invalid_args', `记忆库里的 ${id} 元数据读不出来，换一条或新建一条`)
  }
  if (meta !== null && type !== undefined && type !== meta.type) {
    return memoryFail(
      'invalid_args',
      `记忆库里的 ${meta.id} 是${meta.type === 'step' ? '步骤' : '工作流'}记忆，和 memory.type 对不上`,
    )
  }
  const resolved: MemoryType = meta?.type ?? type ?? (step === undefined ? 'workflow' : 'step')
  if (resolved === 'step' && step === undefined) {
    return memoryFail('invalid_args', '步骤记忆要给 memory.step（挂在哪一步）')
  }
  if (resolved === 'workflow' && step !== undefined) {
    return memoryFail(
      'invalid_args',
      '工作流记忆不挂在步骤上，去掉 memory.step；一步的做法用步骤记忆',
    )
  }

  let ref: { memory: string; type: MemoryType }
  let created = false
  // 引用已有的：名称、描述是库里那一条的，这里给了也不改（改在工作流中心「记忆」页）。
  const ignored = meta !== null && (input.name !== undefined || input.description !== undefined)
  if (meta !== null) {
    ref = { memory: meta.id, type: meta.type }
  } else {
    const made = await createMemory(memoryDeps, {
      type: resolved,
      id: id ?? suggestMemoryId(resolved, workflow, step),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
    })
    if (!made.ok) return memoryFail('invalid_args', made.error.message)
    ref = { memory: made.result.id, type: made.result.type }
    created = true
  }

  const outcome = await deps.repository.addMemory(workflow, {
    ref,
    ...(step === undefined ? {} : { step }),
  })
  if (!outcome.ok) {
    if (created) await deleteMemory(memoryDeps, ref.memory)
    return outcome
  }
  return {
    ok: true,
    result: {
      changed: outcome.result.changed,
      warnings: outcome.result.warnings,
      memory: {
        id: ref.memory,
        type: ref.type,
        created,
        ...(ignored
          ? { note: '引用的是库里已有的一条，name / description 只在新建时起作用，没用上' }
          : {}),
      },
    },
  }
}
