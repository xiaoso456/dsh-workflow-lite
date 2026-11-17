/**
 * dsh-workflow-lite — 一次触发的投递：按卡片上的启动方式选会话、把消息发进去、记一条触发记录。
 *
 * 这里只管「这一次」：该不该触发（到没到点、超没超上限）和发不出去之后怎么办（连续失败自动停用）
 * 是 `service.ts` 的事。工作流后来执行得怎么样不归这里管。
 *
 * 上一次触发发起的执行还没结束（{@link RunEnds}，按运行状态算）时按卡片的「保护」：跳过（记一条跳过）、
 * 排队（记一条排队中，已经有排着的也排在后面，排满了跳过）、同时运行（照发）。
 * 选了跳过、排队却看不出上一次跑完没有（工作流没开「记录运行状态」，{@link endProblem}）时一律跳过。
 * 用户点的「立即触发一次」不拦也不排。
 * 排着的轮到了由 `service.ts` 交回 {@link Launcher.release}：和直接发的走同一段投递，结果写回原来那一条。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/launcher
 */

import {
  type FireChannel,
  type LaunchSettings,
  launchOf,
  reachedLimit,
} from '../../shared/trigger.ts'
import type { TriggerData } from '../../shared/types.ts'
import type { FireOutcome, FireRecord, FireSettled } from '../../shared/wire/trigger.ts'
import type { TriggerDefinition } from './graphs.ts'
import { fireMessage, fireSummary } from './message.ts'
import { endProblem, type RunEnds } from './runEnd.ts'
import type { SessionPort } from './sessions.ts'
import { type FireDetail, newFireId, type TriggerLocal, type TriggerStore } from './store.ts'

/** 跳过时记的原因：上一次触发发起的执行还没结束（卡片据此提示「视为已结束」）。 */
export const SKIP_UNFINISHED = '上次执行未结束（运行状态尚未改为结束）'

export interface FireInput {
  workflow: string
  trigger: TriggerDefinition
  /** 这张卡片在本机的设置（工作区、选定的会话、上一次的会话）。 */
  local: TriggerLocal
  channel: FireChannel
  /** 触发时刻（epoch 毫秒）。 */
  at: number
  /** 触发时带来的背景信息。 */
  info?: string
  /** 合并窗口里并进来了几次。 */
  merged?: number
}

/** 投递一次的结果（还没记下来）。 */
interface Delivery {
  outcome: FireSettled
  reason?: string
  session?: string
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** 发进哪个现成的会话：固定的那个、上一次的那个；每次新建是 `undefined`。 */
function targetOf(launch: LaunchSettings, local: TriggerLocal): string | undefined {
  if (launch.session === 'fixed') return local.session
  if (launch.session === 'last') return local.lastSession
  return undefined
}

export class Launcher {
  private readonly sessions: SessionPort
  private readonly store: TriggerStore
  private readonly ends: RunEnds

  constructor(sessions: SessionPort, store: TriggerStore, ends: RunEnds) {
    this.sessions = sessions
    this.store = store
    this.ends = ends
  }

  private detail(input: FireInput): FireDetail {
    const info = input.info?.trim()
    return {
      record: {
        id: newFireId(new Date(input.at)),
        workflow: input.workflow,
        node: input.trigger.node,
        name: input.trigger.name,
        channel: input.channel,
        at: input.at,
        outcome: 'failed',
      },
      ...(input.trigger.data.note === undefined ? {} : { note: input.trigger.data.note }),
      ...(input.trigger.data.condition === undefined
        ? {}
        : { condition: input.trigger.data.condition }),
      ...(info === undefined || info === '' ? {} : { info }),
      ...(input.merged === undefined || input.merged < 2 ? {} : { merged: input.merged }),
    }
  }

  private async close(
    detail: FireDetail,
    outcome: FireOutcome,
    extra: { reason?: string; session?: string },
  ): Promise<FireRecord> {
    const record: FireRecord = { ...detail.record, outcome, ...extra }
    await this.store.record({ ...detail, record })
    return record
  }

  /** 这一次不触发，只记一条（没轮到它的原因）。 */
  skip(input: FireInput, reason: string): Promise<FireRecord> {
    return this.close(this.detail(input), 'skipped', { reason })
  }

  /** 这一次发不出去，只记一条。 */
  fail(input: FireInput, reason: string): Promise<FireRecord> {
    return this.close(this.detail(input), 'failed', { reason })
  }

  /** 发起一次：上一次还没跑完时按「保护」跳过或排队，否则选会话、发消息；记下结果。 */
  async fire(input: FireInput): Promise<FireRecord> {
    const detail = this.detail(input)
    const launch = launchOf(input.trigger.data)
    if (input.channel !== 'now' && launch.overlap !== 'parallel') {
      const problem = endProblem(input.trigger.data, input.trigger.runState)
      if (problem !== null) return this.close(detail, 'skipped', { reason: problem })
      const running = !(await this.ends.previous(input.local)).ended
      if (launch.overlap === 'skip' && running) {
        return this.close(detail, 'skipped', { reason: SKIP_UNFINISHED })
      }
      if (launch.overlap === 'queue') {
        const waiting = await this.store.queuedCount(input.workflow, input.trigger.node)
        if (running || waiting > 0) {
          if (reachedLimit(waiting, launch.queueMax)) {
            return this.close(detail, 'skipped', {
              reason: `已经排了 ${String(waiting)} 个，排满了`,
            })
          }
          return this.close(detail, 'queued', {})
        }
      }
    }
    const delivery = await this.deliver(detail, input.trigger.data, input.local, launch)
    return this.close(detail, delivery.outcome, delivery)
  }

  /**
   * 排着的一次轮到了：照卡片现在的设置发进会话，结果写回原来那一条（记下轮到的时刻）。
   * 发的这会儿被取消了（已经不是排着的）回 `null`。
   */
  async release(
    detail: FireDetail,
    trigger: TriggerDefinition,
    local: TriggerLocal,
    at: number,
  ): Promise<FireRecord | null> {
    const delivery = await this.deliver(detail, trigger.data, local, launchOf(trigger.data))
    return this.settleQueued(detail, delivery, at)
  }

  /** 排着的一次轮到了，但发不了（工作流现在执行不了）：记成没发出去。 */
  releaseFailed(detail: FireDetail, reason: string, at: number): Promise<FireRecord | null> {
    return this.settleQueued(detail, { outcome: 'failed', reason }, at)
  }

  private async settleQueued(
    detail: FireDetail,
    delivery: Delivery,
    at: number,
  ): Promise<FireRecord | null> {
    const { outcome, ...extra } = delivery
    if (!(await this.store.release(detail.record.id, outcome, extra, at))) return null
    return { ...detail.record, outcome, ...extra, sentAt: at }
  }

  /** 选会话、发消息：发进现成的会话（固定的、上一次的），不在了（上一次的）就在工作区里新建一个。 */
  private async deliver(
    detail: FireDetail,
    data: TriggerData,
    local: TriggerLocal,
    launch: LaunchSettings,
  ): Promise<Delivery> {
    const unavailable = this.sessions.unavailable()
    if (unavailable !== null) return { outcome: 'failed', reason: unavailable }
    const target = targetOf(launch, local)
    if (launch.session === 'fixed' && target === undefined) {
      return { outcome: 'failed', reason: '还没选定发进哪个会话' }
    }
    const text = fireMessage(detail, data, this.store.infoPath(detail.record.id))
    const summary = fireSummary(detail)
    if (target !== undefined) {
      try {
        await this.sessions.send(target, text, summary)
        return { outcome: 'sent', session: target }
      } catch (error) {
        if (launch.session === 'fixed') {
          return { outcome: 'failed', reason: `选定的会话发不进去：${reasonOf(error)}` }
        }
        // 「接着上一次的会话」：那个会话不在了就新建一个。
      }
    }
    if (local.workspace === undefined) {
      return { outcome: 'failed', reason: '还没选在哪个工作区里新建会话' }
    }
    let session: string
    try {
      session = await this.sessions.open({
        cwd: local.workspace,
        title: `${detail.record.workflow} · ${detail.record.name}`,
      })
    } catch (error) {
      return {
        outcome: 'failed',
        reason: `在 ${local.workspace} 里新建不了会话：${reasonOf(error)}`,
      }
    }
    try {
      await this.sessions.send(session, text, summary)
    } catch (error) {
      return { outcome: 'failed', reason: `新建的会话发不进去：${reasonOf(error)}`, session }
    }
    return { outcome: 'sent', session }
  }
}
