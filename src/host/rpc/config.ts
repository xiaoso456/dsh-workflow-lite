/**
 * dsh-workflow-lite — `config/*`：「设置」页读写插件配置。
 *
 * @module @xiaoso/dsh-workflow-lite/host/rpc/config
 */

import type { PluginConfigView } from '../../shared/wire/config.ts'
import type { WorkflowLiteEndpoint } from '../../shared/wire.ts'
import { readPluginConfig, writePluginConfig } from '../pluginConfig.ts'
import { listenInterfaces } from '../triggers/netAddress.ts'
import { asRecord, failFrom, ok, type RpcDeps, type RpcResult } from './shared.ts'

export async function dispatchConfig(
  deps: RpcDeps,
  endpoint: Extract<WorkflowLiteEndpoint, `config/${string}`>,
  payload: unknown,
): Promise<RpcResult<unknown>> {
  switch (endpoint) {
    case 'config/get':
      return ok(withInterfaces(readPluginConfig(deps.config.port(), deps.config.live)))

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
      return ok(withInterfaces(outcome.result))
    }

    default: {
      const exhaustive: never = endpoint
      throw new Error(`unknown endpoint ${String(exhaustive)}`)
    }
  }
}

/** 带上本机各块网卡（设置页选监听地址用；每次现查，换了网也对）。 */
function withInterfaces(view: PluginConfigView): PluginConfigView {
  return { ...view, interfaces: listenInterfaces() }
}
