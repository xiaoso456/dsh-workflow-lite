/**
 * dsh-workflow-lite — `trigger/*`：触发卡片的状态、「重新启用」自动停用了的卡片、HTTP 触发的缺省地址与令牌、「立即触发一次」、
 * 触发记录与一次触发的详情、取消排着的一次或清空一张卡片排着的、一段时间里的次数、最近的输出（摘要、几条的行、清空）、「试运行」命令与 HTTP 测试请求、本机的 shell，以及工作流中心「触发」页的全部卡片与「全部暂停」。
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
  if (endpoint === 'trigger/shells') return ok(await deps.triggers.shells())
  if (endpoint === 'trigger/shell') {
    const outcome = await deps.triggers.checkShell(requireString(input, 'path'))
    return outcome.ok ? ok(outcome.result) : failFrom(outcome.error)
  }
  if (endpoint === 'trigger/detail')
    return ok(await deps.triggers.detail(requireString(input, 'fire')))
  if (endpoint === 'trigger/cancel') {
    const outcome = await deps.triggers.cancelQueued(requireString(input, 'fire'))
    return outcome.ok ? ok(outcome.result) : failFrom(outcome.error)
  }
  if (endpoint === 'trigger/of-instance')
    return ok({ fires: await deps.triggers.ofInstance(requireString(input, 'instance')) })
  const workflow = requireString(input, 'workflow')
  switch (endpoint) {
    case 'trigger/list':
      return ok(await deps.triggers.list(workflow))

    case 'trigger/reopen': {
      const outcome = await deps.triggers.reopen(workflow, requireString(input, 'node'))
      return outcome.ok ? ok(outcome.result) : failFrom(outcome.error)
    }

    case 'trigger/endpoint':
      return ok(await deps.triggers.endpoint(workflow, requireString(input, 'node')))

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
      if (input.limit !== undefined && typeof input.limit !== 'number') {
        throw new Error('limit must be a number')
      }
      return ok({
        fires: await deps.triggers.history(workflow, optionalString(input, 'node'), input.limit),
      })

    case 'trigger/activity':
      if (typeof input.since !== 'number') throw new Error('since must be a number')
      return ok({
        slots: await deps.triggers.activity(workflow, requireString(input, 'node'), input.since),
      })

    case 'trigger/try': {
      const kind = input.kind
      if (kind !== 'check' && kind !== 'listen') throw new Error('kind must be check or listen')
      const shell = clearableString(input, 'shell')
      const cwd = clearableString(input, 'cwd')
      const workspace = clearableString(input, 'workspace')
      const outcome = await deps.triggers.tryCommand({
        workflow,
        node: requireString(input, 'node'),
        kind,
        command: requireString(input, 'command'),
        ...(cwd === undefined ? {} : { cwd }),
        ...(workspace === undefined ? {} : { workspace }),
        ...(shell === undefined ? {} : { shell }),
      })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'trigger/ping': {
      const outcome = await deps.triggers.ping({ workflow, node: requireString(input, 'node') })
      if (!outcome.ok) return failFrom(outcome.error)
      return ok(outcome.result)
    }

    case 'trigger/output': {
      const filter = input.filter ?? 'all'
      if (filter !== 'all' && filter !== 'met' && filter !== 'fail') {
        throw new Error('filter must be all, met or fail')
      }
      if (input.limit !== undefined && typeof input.limit !== 'number') {
        throw new Error('limit must be a number')
      }
      return ok(deps.triggers.output(workflow, requireString(input, 'node'), filter, input.limit))
    }

    case 'trigger/output-lines': {
      const { entries, tail } = input
      if (!Array.isArray(entries) || !entries.every((id) => Number.isInteger(id))) {
        throw new Error('entries must be a list of integers')
      }
      if (tail !== undefined && typeof tail !== 'number') throw new Error('tail must be a number')
      return ok(deps.triggers.outputLinesOf(workflow, requireString(input, 'node'), entries, tail))
    }

    case 'trigger/waive': {
      const outcome = await deps.triggers.waive(workflow, requireString(input, 'node'))
      return outcome.ok ? ok(outcome.result) : failFrom(outcome.error)
    }

    case 'trigger/clear-queue': {
      const outcome = await deps.triggers.clearQueue(workflow, requireString(input, 'node'))
      return outcome.ok ? ok(outcome.result) : failFrom(outcome.error)
    }

    case 'trigger/output-clear':
      deps.triggers.clearOutput(workflow, requireString(input, 'node'))
      return ok({})
  }
}
