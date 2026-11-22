/**
 * dsh-workflow-lite — 把模型的一次编译对回触发它的那次触发（实例据此记下来源）。
 *
 * 触发消息里写着触发编号，模型编译时带回来就按编号对；没带（模型漏了）就看这个会话里
 * 有没有刚发过、还没对上实例的同一个工作流的触发，取最早的那次。太久以前的不算——
 * 那多半是用户后来在同一个会话里自己发起的。
 *
 * 触发发进会话时模型没另建实例、而是在原来的实例里接着做（恢复它、改它的状态），这次触发记成接进了那个实例
 * （`joined`）；之后模型又为它编译了新实例，就改记到新实例上。这些都只记在触发记录里。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/claims
 */

import type { OriginSource } from '../runs/runCore.ts'
import { originOfFire } from './message.ts'
import type { TriggerStore } from './store.ts'

/** 没带触发编号时，多久以内的触发还算是这次编译的起因。 */
export const CLAIM_WINDOW_MS = 60 * 60_000

export function createFireClaims(store: TriggerStore, now: () => number = Date.now): OriginSource {
  return {
    async find({ workflowId, session, fire }) {
      if (fire !== undefined) {
        const named = await store.detail(fire)
        if (named?.record.workflowId === workflowId) {
          return { fire: named.record.id, origin: originOfFire(named) }
        }
      }
      if (session === undefined) return undefined
      const pending = await store.unclaimed(workflowId, session, now() - CLAIM_WINDOW_MS)
      if (pending === undefined) return undefined
      const detail = await store.detail(pending.id)
      return detail === null ? undefined : { fire: pending.id, origin: originOfFire(detail) }
    },

    bind: (fire, instance) => store.bind(fire, instance),

    // 太久以前的同样不算（和认领一个窗口）。
    join: ({ workflowId, session, instance, since }) =>
      store.join(workflowId, session, Math.max(since, now() - CLAIM_WINDOW_MS), instance),
  }
}
