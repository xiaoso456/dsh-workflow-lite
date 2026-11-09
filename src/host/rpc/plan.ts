/**
 * dsh-workflow-lite — `plan/build`：把工作流编译成计划文本。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc/plan
 */

import type { WorkflowLiteEndpoint } from '../../shared/wire.ts'
import { compileWorkflow } from '../plan.ts'
import {
  asRecord,
  failFrom,
  ok,
  optionalString,
  type RpcDeps,
  type RpcResult,
  requireString,
} from './shared.ts'

export async function dispatchPlan(
  deps: RpcDeps,
  endpoint: Extract<WorkflowLiteEndpoint, `plan/${string}`>,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  switch (endpoint) {
    case 'plan/build': {
      const input = asRecord(payload)
      const name = requireString(input, 'name')
      const goal = optionalString(input, 'goal')
      const cwd = optionalString(input, 'cwd')
      const outcome = await compileWorkflow(
        deps.repository,
        deps.dataDir(),
        name,
        {
          ...(input.full === true ? { full: true } : {}),
          ...(goal === undefined ? {} : { goal }),
        },
        cwd,
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
