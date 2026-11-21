/**
 * dsh-workflow-lite — 触发器看图：一个工作流里有哪些触发卡片、这张图现在能不能执行。
 *
 * 触发器不直接碰仓储，只认 {@link TriggerGraphs}：读卡片，以及把核对过的设置写回图里。负责触发的进程每隔几秒要对一遍，
 * 所以按文件的修改时间与大小留着上一次读出来的结果，文件没动就不重读、不重新校验。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/graphs
 */

import { stat } from 'node:fs/promises'
import { isTrigger } from '../../shared/model.ts'
import { resolveSessionChoice } from '../../shared/sessionChoice.ts'
import { type TriggerSettings, triggerName } from '../../shared/trigger.ts'
import type { SessionChoice, TriggerData } from '../../shared/types.ts'
import { workflowFile } from '../store/paths.ts'
import type { Outcome } from '../store/repoResult.ts'
import type { Repository } from '../store/repository.ts'
import type { TriggerStore } from './store.ts'

/** 图里的一张触发卡片。 */
export interface TriggerDefinition {
  node: string
  name: string
  data: TriggerData
  /** 所在工作流开着「记录运行状态」（跳过、排队靠它看上一次跑完没有，见 `runEnd.ts`）。 */
  runState: boolean
  /** 新建会话时用什么跑：卡片上写了的项用卡片的，否则用工作流的（都没写 = 跟随 DSH）。 */
  choice: SessionChoice
  /** 工作流设置里写的那一份（卡片上「跟随工作流」后面写的就是它）。 */
  workflowChoice: SessionChoice
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
      /** 这张图开着「记录运行状态」（别的图的接续触发要靠它看出什么时候跑完）。 */
      runState: boolean
    }

export interface TriggerGraphs {
  read(workflow: string): Promise<WorkflowTriggers>
  /** 图里有触发卡片的那些工作流（工作流中心「触发」页列它们）。 */
  names(): Promise<string[]>
  /** 换一张卡片的设置（开关、工作区、地址和令牌…，触发器服务核对过的）。 */
  writeSettings(
    workflow: string,
    node: string,
    settings: TriggerSettings,
  ): Promise<Outcome<unknown>>
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
        const settings = load.document.settings
        const runState = settings?.runState === true
        const workflowChoice = resolveSessionChoice(undefined, settings)
        value = {
          kind: 'ok',
          triggers: load.document.nodes.filter(isTrigger).map((node) => ({
            node: node.id,
            name: triggerName(node),
            data: node.data,
            runState,
            choice: resolveSessionChoice(node.data.launch, settings),
            workflowChoice,
          })),
          ...(blocking.length === 0
            ? {}
            : { blocked: blocking.map((problem) => problem.message).join('；') }),
          runState,
        }
      }
      cache.set(workflow, { stamp, value })
      return value
    },
    // 列表按文件身份记着每张图有几张触发卡片，没改过的图不重读。
    async names() {
      const listed = await repository.list()
      return listed.workflows
        .filter((entry) => (entry.triggers ?? 0) > 0)
        .map((entry) => entry.name)
    },
    writeSettings: (workflow, node, settings) =>
      repository.writeTriggerSettings(workflow, node, settings),
  }
}

/** 工作流改名时，触发卡片的运行记录、触发记录跟着走；删掉时一起删。 */
export function followWorkflows(repository: Repository, store: TriggerStore): Repository {
  return {
    ...repository,
    rename: async (workflow, to) => {
      const outcome = await repository.rename(workflow, to)
      if (outcome.ok) await store.rename(workflow, to).catch(() => {})
      return outcome
    },
    remove: async (workflow) => {
      const outcome = await repository.remove(workflow)
      if (outcome.ok) await store.forget(workflow).catch(() => {})
      return outcome
    },
  }
}

/**
 * 改图的那几样成功之后叫一声（触发服务马上对一遍账）：开关、工作区这些都写在图里，
 * 画布上一存就该当场生效，不等下一轮。
 */
export function wakeOnGraphWrites(repository: Repository, wake: () => void): Repository {
  const waking =
    <A extends unknown[], R extends Outcome<unknown>>(write: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const outcome = await write(...args)
      if (outcome.ok) wake()
      return outcome
    }
  return {
    ...repository,
    save: waking(repository.save),
    create: waking(repository.create),
    rename: waking(repository.rename),
    remove: waking(repository.remove),
    restoreVersion: waking(repository.restoreVersion),
    importWorkflow: waking(repository.importWorkflow),
    writeTrigger: waking(repository.writeTrigger),
    writeTriggerSettings: waking(repository.writeTriggerSettings),
    configure: waking(repository.configure),
    deleteNode: waking(repository.deleteNode),
  }
}
