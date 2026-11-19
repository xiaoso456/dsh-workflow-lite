/**
 * dsh-workflow-lite — `host/*`：看宿主机上的目录与 DSH 的 skill。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc/hostAccess
 */

import { readModelChoice } from '../../shared/sessionChoice.ts'
import type { WorkflowLiteEndpoint } from '../../shared/wire.ts'
import { listHostDir, listSkills, readSkill } from '../hostFs.ts'
import {
  asRecord,
  fail,
  failFrom,
  ok,
  optionalString,
  type RpcDeps,
  type RpcResult,
  requireString,
} from './shared.ts'

export async function dispatchHost(
  deps: RpcDeps,
  endpoint: Extract<WorkflowLiteEndpoint, `host/${string}`>,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  switch (endpoint) {
    case 'host/list': {
      const input = asRecord(payload)
      const path = optionalString(input, 'path')
      const cwd = optionalString(input, 'cwd')
      const outcome = await listHostDir({
        ...(path === undefined ? {} : { path }),
        ...(cwd === undefined ? {} : { cwd }),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'host/skills': {
      const input = asRecord(payload)
      const cwd = optionalString(input, 'cwd')
      const session = optionalString(input, 'session')
      return ok(
        await listSkills(deps.skills, {
          ...(cwd === undefined ? {} : { cwd }),
          ...(session === undefined ? {} : { session }),
        }),
      )
    }

    case 'host/skill': {
      const input = asRecord(payload)
      const cwd = optionalString(input, 'cwd')
      const session = optionalString(input, 'session')
      const outcome = await readSkill(deps.skills, {
        name: requireString(input, 'name'),
        ...(cwd === undefined ? {} : { cwd }),
        ...(session === undefined ? {} : { session }),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'host/agents': {
      const session = optionalString(asRecord(payload), 'session')
      return ok(await deps.sessions.catalog(session))
    }

    case 'host/prepareSession': {
      const input = asRecord(payload)
      const model = readModelChoice(input.model)
      if (model === undefined) return fail('invalid_args', 'model 要有 provider 和 model')
      return ok({ fallbacks: await deps.sessions.prepare(requireString(input, 'session'), model) })
    }

    default: {
      const exhaustive: never = endpoint
      throw new Error(`unknown endpoint ${String(exhaustive)}`)
    }
  }
}
