/**
 * dsh-workflow-lite — `pack/*`：导入导出工作流包、导出成 skill，以及预览时浏览整个包。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc/pack
 */

import type { PackMemoryAction, PackSkillAction } from '../../shared/pack.ts'
import type { SkillBrowseRequest, SkillBuildRequest, SkillMeta } from '../../shared/skillPack.ts'
import type { WorkflowLiteEndpoint } from '../../shared/wire.ts'
import { exportPack, type PackDeps, scanPack } from '../pack/exporter.ts'
import { applyPack, inspectPack } from '../pack/importer.ts'
import { skillDir, skillFile, skillImage } from '../pack/skillBrowse.ts'
import { exportSkill, previewSkill } from '../pack/skillExporter.ts'
import { appendChunk, discard, readChunk } from '../pack/staging.ts'
import {
  asRecord,
  failFrom,
  ok,
  optionalString,
  type RpcDeps,
  type RpcResult,
  requireString,
} from './shared.ts'

/** 一列正整数（版本号）。 */
function requireNumbers(input: Record<string, unknown>, field: string): number[] {
  const value = input[field]
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === 'number' && Number.isInteger(item) && item > 0)
  ) {
    throw new Error(`${field} must be a list of positive integers`)
  }
  return value as number[]
}

/** `pack/skill*` 共用的那几项：哪张图、哪一版、打包哪些。 */
function readSkillBuild(input: Record<string, unknown>): SkillBuildRequest {
  const pack = input.pack ?? []
  if (!Array.isArray(pack) || !pack.every((key) => typeof key === 'string')) {
    throw new Error('pack must be a list of keys')
  }
  const version = input.version
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error('version must be a positive integer')
  }
  return {
    name: requireString(input, 'name'),
    version,
    pack: pack as string[],
    ...readScope(input),
  }
}

/** SKILL.md 的头部：名字、描述必填，使用时机可选。 */
function readSkillMeta(meta: Record<string, unknown>): SkillMeta {
  const whenToUse = optionalString(meta, 'whenToUse')
  return {
    name: requireString(meta, 'name'),
    description: requireString(meta, 'description'),
    ...(whenToUse === undefined ? {} : { whenToUse }),
  }
}

/** `pack/skillDir` / `pack/skillFile` / `pack/skillImage`：暂存编号、包里的路径，可带头部。 */
function readSkillBrowse(input: Record<string, unknown>): SkillBrowseRequest {
  const sub = optionalString(input, 'sub')
  return {
    token: requireString(input, 'token'),
    ...(sub === undefined ? {} : { sub }),
    ...(input.meta === undefined ? {} : { meta: draftMeta(asRecord(input.meta)) }),
  }
}

/** 浏览时的头部是还在填的草稿：空着也照样拼（导出时才按 {@link readSkillMeta} 要求填齐）。 */
function draftMeta(meta: Record<string, unknown>): SkillMeta {
  const text = (field: string): string =>
    typeof meta[field] === 'string' ? (meta[field] as string) : ''
  const whenToUse = text('whenToUse')
  return {
    name: text('name'),
    description: text('description'),
    ...(whenToUse === '' ? {} : { whenToUse }),
  }
}

/** 看 skill 时站在哪个会话、哪个工作区。 */
function readScope(input: Record<string, unknown>): { cwd?: string; session?: string } {
  const cwd = optionalString(input, 'cwd')
  const session = optionalString(input, 'session')
  return {
    ...(cwd === undefined ? {} : { cwd }),
    ...(session === undefined ? {} : { session }),
  }
}

function packDeps(deps: RpcDeps): PackDeps {
  return {
    dataDir: deps.dataDir(),
    repository: deps.repository,
    ...(deps.skills === undefined ? {} : { skills: deps.skills }),
    skillsRoot: deps.pack.skillsRoot,
    plugin: deps.pack.plugin,
    ...(deps.pack.validate === undefined ? {} : { validate: deps.pack.validate }),
  }
}

export async function dispatchPack(
  deps: RpcDeps,
  endpoint: Extract<WorkflowLiteEndpoint, `pack/${string}`>,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  switch (endpoint) {
    case 'pack/scan': {
      const input = asRecord(payload)
      const outcome = await scanPack(packDeps(deps), {
        name: requireString(input, 'name'),
        versions: requireNumbers(input, 'versions'),
        ...readScope(input),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'pack/export': {
      const input = asRecord(payload)
      const pack = input.pack ?? []
      if (!Array.isArray(pack) || !pack.every((key) => typeof key === 'string')) {
        throw new Error('pack must be a list of keys')
      }
      const outcome = await exportPack(packDeps(deps), {
        name: requireString(input, 'name'),
        versions: requireNumbers(input, 'versions'),
        pack: pack as string[],
        ...readScope(input),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'pack/read': {
      const input = asRecord(payload)
      const offset = typeof input.offset === 'number' ? input.offset : 0
      const outcome = await readChunk(deps.dataDir(), requireString(input, 'token'), offset)
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'pack/upload': {
      const input = asRecord(payload)
      const offset = typeof input.offset === 'number' ? input.offset : -1
      const data = typeof input.data === 'string' ? input.data : ''
      const outcome = await appendChunk(
        deps.dataDir(),
        optionalString(input, 'token'),
        offset,
        data,
      )
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'pack/inspect': {
      const input = asRecord(payload)
      const outcome = await inspectPack(packDeps(deps), {
        token: requireString(input, 'token'),
        ...readScope(input),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'pack/apply': {
      const input = asRecord(payload)
      const mode = input.mode
      if (mode !== 'new' && mode !== 'merge') throw new Error('mode must be new or merge')
      const assets = input.assets
      if (assets !== undefined && assets !== 'package' && assets !== 'local') {
        throw new Error('assets must be package or local')
      }
      const skills: Record<string, PackSkillAction> = {}
      if (input.skills !== undefined) {
        for (const [name, action] of Object.entries(asRecord(input.skills))) {
          if (
            action !== 'install' &&
            action !== 'skip' &&
            action !== 'overwrite' &&
            action !== 'rename'
          ) {
            throw new Error(`unknown skill action for ${name}`)
          }
          skills[name] = action
        }
      }
      const memories: Record<string, PackMemoryAction> = {}
      if (input.memories !== undefined) {
        for (const [id, action] of Object.entries(asRecord(input.memories))) {
          if (action !== 'use' && action !== 'copy') {
            throw new Error(`unknown memory action for ${id}`)
          }
          memories[id] = action
        }
      }
      const outcome = await applyPack(packDeps(deps), {
        token: requireString(input, 'token'),
        mode,
        name: requireString(input, 'name'),
        ...(assets === undefined ? {} : { assets }),
        skills,
        memories,
        ...readScope(input),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'pack/discard': {
      const input = asRecord(payload)
      await discard(deps.dataDir(), requireString(input, 'token'))
      return ok({ removed: true })
    }

    case 'pack/skillPreview': {
      const outcome = await previewSkill(packDeps(deps), readSkillBuild(asRecord(payload)))
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'pack/skillExport': {
      const input = asRecord(payload)
      const target = input.target
      if (target !== 'zip' && target !== 'install') throw new Error('target must be zip or install')
      const outcome = await exportSkill(packDeps(deps), {
        ...readSkillBuild(input),
        meta: readSkillMeta(asRecord(input.meta)),
        target,
        ...(input.replace === true ? { replace: true } : {}),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'pack/skillDir': {
      const outcome = await skillDir(deps.dataDir(), readSkillBrowse(asRecord(payload)))
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'pack/skillFile': {
      const outcome = await skillFile(deps.dataDir(), readSkillBrowse(asRecord(payload)))
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'pack/skillImage': {
      const input = asRecord(payload)
      const src = optionalString(input, 'src')
      const outcome = await skillImage(deps.dataDir(), {
        ...readSkillBrowse(input),
        ...(src === undefined ? {} : { src }),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    default: {
      const exhaustive: never = endpoint
      throw new Error(`unknown endpoint ${String(exhaustive)}`)
    }
  }
}
