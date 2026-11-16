/**
 * dsh-workflow-lite — 读、清空一张定时检查或监听卡片最近的输出（宿主那边见 `host/triggers/outputLog.ts`）。
 *
 * 工作流中心「触发」页的「输出」、「触发方式」对话框里的「最近的输出」共用。读不到时回 `null`，界面照旧显示上一次的。
 *
 * @module @xiaoso/dsh-workflow-lite/client/app/triggerOutput
 */

import type {
  OutputFilter,
  TriggerOutputLinesResponse,
  TriggerOutputResponse,
} from '../../shared/wire/trigger.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'

export type OutputLines = TriggerOutputLinesResponse['entries'][number]

export interface OutputAccess {
  /** 摘要：按筛选的若干条，新的在前。 */
  list(node: string, filter: OutputFilter): Promise<TriggerOutputResponse | null>
  /** 几条的行；`tail` 给了就每条只要最后几行。 */
  lines(node: string, entries: readonly number[], tail?: number): Promise<OutputLines[] | null>
  /** 清空；清不了回一句原因。 */
  clear(node: string): Promise<string | null>
}

/** 没有工作流（还没打开）时什么都读不到。 */
export function createOutputAccess(rpc: WorkflowLiteRpc, workflow: string | null): OutputAccess {
  return {
    list: async (node, filter) => {
      if (workflow === null) return null
      try {
        return await rpc.call('trigger/output', { workflow, node, filter })
      } catch {
        return null
      }
    },
    lines: async (node, entries, tail) => {
      if (workflow === null || entries.length === 0) return entries.length === 0 ? [] : null
      try {
        const response = await rpc.call('trigger/output-lines', {
          workflow,
          node,
          entries: [...entries],
          ...(tail === undefined ? {} : { tail }),
        })
        return response.entries
      } catch {
        return null
      }
    },
    clear: async (node) => {
      if (workflow === null) return null
      try {
        await rpc.call('trigger/output-clear', { workflow, node })
        return null
      } catch (reason) {
        return errorMessage(reason)
      }
    },
  }
}
