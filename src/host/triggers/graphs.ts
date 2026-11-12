/**
 * dsh-workflow-lite — 触发器看图：一个工作流里有哪些触发卡片、这张图现在能不能执行。
 *
 * 触发器不直接碰仓储，只认 {@link TriggerGraphs}。负责触发的进程每隔几秒要对一遍，
 * 所以按文件的修改时间与大小留着上一次读出来的结果，文件没动就不重读、不重新校验。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/graphs
 */

import { stat } from 'node:fs/promises'
import { isTrigger } from '../../shared/model.ts'
import { triggerName } from '../../shared/trigger.ts'
import type { TriggerData } from '../../shared/types.ts'
import { workflowFile } from '../store/paths.ts'
import type { Repository } from '../store/repository.ts'
import type { TriggerStore } from './store.ts'

/** 图里的一张触发卡片。 */
export interface TriggerDefinition {
  node: string
  name: string
  data: TriggerData
}

export type WorkflowTriggers =
  /** 工作流不在了。 */
  | { kind: 'missing' }
  /** 文件在，但读不出一张合法的图（先别动它的开关，等用户修好）。 */
  | { kind: 'broken'; reason: string }
  | {
      kind: 'ok'
      triggers: TriggerDefinition[]
      /** 图有编译级问题、出不了计划时的一句原因（触发了也执行不了）。 */
      blocked?: string
    }

export interface TriggerGraphs {
  read(workflow: string): Promise<WorkflowTriggers>
}

export function createTriggerGraphs(repository: Repository): TriggerGraphs {
  const cache = new Map<string, { stamp: string; value: WorkflowTriggers }>()
  return {
    async read(workflow) {
      let stamp: string
      try {
        const info = await stat(workflowFile(repository.dataDir, workflow))
        stamp = `${String(info.mtimeMs)}:${String(info.size)}`
      } catch {
        cache.delete(workflow)
        return { kind: 'missing' }
      }
      const cached = cache.get(workflow)
      if (cached !== undefined && cached.stamp === stamp) return cached.value
      const load = await repository.load(workflow)
      if (!load.exists) return { kind: 'missing' }
      let value: WorkflowTriggers
      if (!load.loadable || load.document === null) {
        value = { kind: 'broken', reason: '工作流有保存级问题，读不出来' }
      } else {
        const blocking = load.problems.filter((problem) => problem.level === 'compile')
        value = {
          kind: 'ok',
          triggers: load.document.nodes
            .filter(isTrigger)
            .map((node) => ({ node: node.id, name: triggerName(node), data: node.data })),
          ...(blocking.length === 0
            ? {}
            : { blocked: blocking.map((problem) => problem.message).join('；') }),
        }
      }
      cache.set(workflow, { stamp, value })
      return value
    },
  }
}

/** 工作流改名时，触发卡片的开关与设置跟着走。 */
export function followRenames(repository: Repository, store: TriggerStore): Repository {
  return {
    ...repository,
    rename: async (workflow, to) => {
      const outcome = await repository.rename(workflow, to)
      if (outcome.ok) await store.rename(workflow, to).catch(() => {})
      return outcome
    },
  }
}
