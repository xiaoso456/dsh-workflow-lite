/**
 * dsh-workflow-lite — `memory/*`：记忆库的增删改查、文件浏览与版本。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc/memory
 */

import type { MemoryType } from '../../shared/types.ts'
import type { WorkflowLiteEndpoint } from '../../shared/wire.ts'
import {
  createMemory,
  deleteMemory,
  listMemories,
  type MemoryDeps,
  memoryDir,
  memoryFile,
  memoryImage,
  updateMemory,
} from '../store/memories.ts'
import {
  deleteMemoryVersion,
  listMemoryVersions,
  noteMemoryVersion,
  restoreMemoryVersion,
  saveMemoryVersion,
} from '../store/memoryVersions.ts'
import {
  asRecord,
  failFrom,
  ok,
  optionalString,
  type RpcDeps,
  type RpcResult,
  requireString,
  requireVersion,
} from './shared.ts'

function memoryDeps(deps: RpcDeps): MemoryDeps {
  return { dataDir: deps.dataDir(), repository: deps.repository }
}

export async function dispatchMemory(
  deps: RpcDeps,
  endpoint: Extract<WorkflowLiteEndpoint, `memory/${string}`>,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  switch (endpoint) {
    case 'memory/list': {
      return ok({ memories: await listMemories(memoryDeps(deps)) })
    }

    case 'memory/create': {
      const input = asRecord(payload)
      const type = requireString(input, 'type')
      const id = optionalString(input, 'id')
      const name = typeof input.name === 'string' ? input.name : undefined
      const description = typeof input.description === 'string' ? input.description : undefined
      const outcome = await createMemory(memoryDeps(deps), {
        type: type as MemoryType,
        ...(id === undefined ? {} : { id }),
        ...(name === undefined ? {} : { name }),
        ...(description === undefined ? {} : { description }),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ memory: outcome.result })
    }

    case 'memory/update': {
      const input = asRecord(payload)
      const outcome = await updateMemory(memoryDeps(deps), {
        id: requireString(input, 'id'),
        ...(typeof input.name === 'string' ? { name: input.name } : {}),
        ...(typeof input.description === 'string' ? { description: input.description } : {}),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ memory: outcome.result })
    }

    case 'memory/delete': {
      const outcome = await deleteMemory(memoryDeps(deps), requireString(asRecord(payload), 'id'))
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'memory/file':
    case 'memory/image':
    case 'memory/dir': {
      const input = asRecord(payload)
      const sub = optionalString(input, 'sub')
      const src = optionalString(input, 'src')
      const request = {
        id: requireString(input, 'id'),
        ...(input.version === undefined ? {} : { version: requireVersion({ n: input.version }) }),
        ...(sub === undefined ? {} : { sub }),
      }
      const outcome =
        endpoint === 'memory/file'
          ? await memoryFile(deps.dataDir(), request)
          : endpoint === 'memory/dir'
            ? await memoryDir(deps.dataDir(), request)
            : await memoryImage(deps.dataDir(), {
                ...request,
                ...(src === undefined ? {} : { src }),
              })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'memory/versions': {
      const outcome = await listMemoryVersions(
        deps.dataDir(),
        requireString(asRecord(payload), 'id'),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ versions: outcome.result })
    }

    case 'memory/versionSave': {
      const input = asRecord(payload)
      const note = typeof input.note === 'string' ? input.note : ''
      const outcome = await saveMemoryVersion(deps.dataDir(), requireString(input, 'id'), note)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ version: outcome.result })
    }

    case 'memory/versionRestore': {
      const input = asRecord(payload)
      const outcome = await restoreMemoryVersion(
        deps.dataDir(),
        requireString(input, 'id'),
        requireVersion(input),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'memory/versionNote': {
      const input = asRecord(payload)
      const note = typeof input.note === 'string' ? input.note : ''
      const outcome = await noteMemoryVersion(
        deps.dataDir(),
        requireString(input, 'id'),
        requireVersion(input),
        note,
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok({ version: outcome.result })
    }

    case 'memory/versionDelete': {
      const input = asRecord(payload)
      const outcome = await deleteMemoryVersion(
        deps.dataDir(),
        requireString(input, 'id'),
        requireVersion(input),
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    default: {
      const exhaustive: never = endpoint
      throw new Error(`unknown endpoint ${String(exhaustive)}`)
    }
  }
}
