/**
 * dsh-workflow-lite — 一次触发的投递：按卡片上的启动方式选会话、把消息发进去、记一条触发记录。
 *
 * 这里只管「这一次」：该不该触发（到没到点、超没超上限）和发不出去之后怎么办（连续失败自动停用）
 * 是 `service.ts` 的事。结果只有三种：发出去了、跳过、没发出去——工作流后来执行得怎么样不归这里管。
 *
 * @module @xiaoso/dsh-workflow-lite/host/triggers/launcher
 */

import { type FireChannel, launchOf } from '../../shared/trigger.ts'
import type { FireOutcome, FireRecord } from '../../shared/wire/trigger.ts'
import type { TriggerDefinition } from './graphs.ts'
import { fireMessage, fireSummary } from './message.ts'
import type { SessionPort } from './sessions.ts'
import { type FireDetail, newFireId, type TriggerLocal, type TriggerStore } from './store.ts'

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
}

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export class Launcher {
  private readonly sessions: SessionPort
  private readonly store: TriggerStore

  constructor(sessions: SessionPort, store: TriggerStore) {
    this.sessions = sessions
    this.store = store
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
      ...(info === undefined || info === '' ? {} : { info }),
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

  /** 发起一次：选会话、发消息、记下结果。 */
  async fire(input: FireInput): Promise<FireRecord> {
    const detail = this.detail(input)
    const unavailable = this.sessions.unavailable()
    if (unavailable !== null) return this.close(detail, 'failed', { reason: unavailable })

    const { local } = input
    const launch = launchOf(input.trigger.data)
    const target =
      launch.session === 'fixed'
        ? local.session
        : launch.session === 'last'
          ? local.lastSession
          : undefined
    if (launch.session === 'fixed' && target === undefined) {
      return this.close(detail, 'failed', { reason: '还没选定发进哪个会话' })
    }
    // 上一次还在跑就不叠上去；用户自己点的「立即触发一次」不拦。
    const previous = target ?? local.lastSession
    if (
      input.channel !== 'now' &&
      launch.overlap === 'skip' &&
      previous !== undefined &&
      this.sessions.busy(previous)
    ) {
      return this.close(detail, 'skipped', { reason: '上一次触发的会话还在运行' })
    }

    const text = fireMessage(detail, input.trigger.data)
    const summary = fireSummary(detail)
    if (target !== undefined) {
      try {
        await this.sessions.send(target, text, summary)
        return await this.close(detail, 'sent', { session: target })
      } catch (error) {
        if (launch.session === 'fixed') {
          return this.close(detail, 'failed', {
            reason: `选定的会话发不进去：${reasonOf(error)}`,
          })
        }
        // 「接着上一次的会话」：那个会话不在了就新建一个。
      }
    }
    if (local.workspace === undefined) {
      return this.close(detail, 'failed', { reason: '还没选在哪个工作区里新建会话' })
    }
    let session: string
    try {
      session = await this.sessions.open({
        cwd: local.workspace,
        title: `${input.workflow} · ${input.trigger.name}`,
      })
    } catch (error) {
      return this.close(detail, 'failed', {
        reason: `在 ${local.workspace} 里新建不了会话：${reasonOf(error)}`,
      })
    }
    try {
      await this.sessions.send(session, text, summary)
    } catch (error) {
      return this.close(detail, 'failed', {
        reason: `新建的会话发不进去：${reasonOf(error)}`,
        session,
      })
    }
    return this.close(detail, 'sent', { session })
  }
}
