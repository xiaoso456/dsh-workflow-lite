/**
 * dsh-workflow-lite — `trigger/*`：触发卡片的状态、开关与本机设置（含确认命令、换令牌）、「立即触发一次」、
 * 触发记录、最近的输出，以及工作流中心「触发」页的全部卡片与「全部暂停」。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc/trigger
 */

import type { WorkflowLiteEndpoint } from '../../shared/wire.ts'
import {
  asRecord,
  failFrom,
  ok,
  optionalString,
  type RpcDeps,
  type RpcResult,
  requireString,
} from './shared.ts'

/** 可以是空串的文字字段（空串 = 清掉）；没给是 `undefined`。 */
function clearableString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

export async function dispatchTrigger(
  deps: RpcDeps,
  endpoint: Extract<WorkflowLiteEndpoint, `trigger/${string}`>,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  const input = asRecord(payload)
  // 这几条不针对某一个工作流。
  if (endpoint === 'trigger/all') return ok(await deps.triggers.all())
  if (endpoint === 'trigger/http') return ok(await deps.triggers.httpStatus())
  if (endpoint === 'trigger/pause') {
    if (typeof input.paused !== 'boolean') throw new Error('paused must be a boolean')
    return ok(await deps.triggers.pause(input.paused))
  }
  const workflow = requireString(input, 'workflow')
  switch (endpoint) {
    case 'trigger/list':
      return ok(await deps.triggers.list(workflow))

    case 'trigger/set': {
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') {
        throw new Error('enabled must be a boolean')
      }
      if (input.resetToken !== undefined && input.resetToken !== true) {
        throw new Error('resetToken must be true')
      }
      const workspace = clearableString(input, 'workspace')
      const session = clearableString(input, 'session')
      const approve = clearableString(input, 'approve')
      // 空串也送进去：由服务说「地址不能为空」，不悄悄当没给。
      const hook = typeof input.hook === 'string' ? input.hook : undefined
      const token = typeof input.token === 'string' ? input.token : undefined
      const outcome = await deps.triggers.set({
        workflow,
        node: requireString(input, 'node'),
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(workspace === undefined ? {} : { workspace }),
        ...(session === undefined ? {} : { session }),
        ...(approve === undefined ? {} : { approve }),
        ...(input.resetToken === true ? { resetToken: true as const } : {}),
        ...(hook === undefined ? {} : { hook }),
        ...(token === undefined ? {} : { token }),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'trigger/fire': {
      const info = optionalString(input, 'info')
      const outcome = await deps.triggers.fireNow({
        workflow,
        node: requireString(input, 'node'),
        ...(info === undefined ? {} : { info }),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'trigger/history':
      return ok({ fires: await deps.triggers.history(workflow, optionalString(input, 'node')) })

    case 'trigger/output':
      return ok({ text: await deps.triggers.output(workflow, requireString(input, 'node')) })
  }
}
