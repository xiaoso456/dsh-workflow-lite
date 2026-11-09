/**
 * dsh-workflow-lite — `config/*`：「设置」页读写插件配置。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc/config
 */

import type { WorkflowLiteEndpoint } from '../../shared/wire.ts'
import { readPluginConfig, writePluginConfig } from '../pluginConfig.ts'
import { asRecord, failFrom, ok, type RpcDeps, type RpcResult } from './shared.ts'

export async function dispatchConfig(
  deps: RpcDeps,
  endpoint: Extract<WorkflowLiteEndpoint, `config/${string}`>,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  switch (endpoint) {
    case 'config/get':
      return ok(readPluginConfig(deps.config.port(), deps.config.live))

    case 'config/set': {
      const input = asRecord(payload)
      const revision = input.revision
      if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) {
        throw new Error('revision must be a non-negative integer')
      }
      const set = input.set === undefined ? {} : asRecord(input.set)
      const reset = input.reset ?? []
      if (!Array.isArray(reset) || !reset.every((key) => typeof key === 'string')) {
        throw new Error('reset must be a list of keys')
      }
      const outcome = await writePluginConfig(deps.config.port(), deps.config.live, {
        revision,
        set,
        reset,
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
