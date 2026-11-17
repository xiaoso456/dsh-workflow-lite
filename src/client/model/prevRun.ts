/**
 * dsh-workflow-lite — 在等的上次执行现在怎样。
 *
 * 宿主按运行状态判断上次执行结束没有（`host/triggers/runEnd.ts`），没结束时给出在等的那一次（`TriggerView.waiting`）：
 * 还没对上实例是「尚未开始执行 · 12 分前触发」，在等回复是「实例 c967 等待回复」（提醒色：卡住的原因在用户这边），
 * 执行中是「实例 c967 执行中 · 3 分前更新」，实例没有状态文件是「实例 c967 没有运行状态」。
 * 「排队中」最上面「上次执行」那一行、排着的那条的详情、面板状态行的问题小卡共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/prevRun
 */

import type { TriggerWaiting } from '../../shared/wire/trigger.ts'
import type { T } from '../i18n.ts'
import { durationText } from './time.ts'

/** 上次执行到了哪一步：还没开始、执行中、等用户回复、对上了实例却没有运行状态。时间线上的点跟着它。 */
export type PrevPhase = 'unstarted' | 'running' | 'waiting' | 'noState'

export interface PrevRunText {
  text: string
  phase: PrevPhase
  /** `warn`：在等用户回复。 */
  tone: 'plain' | 'warn'
}

/** 实例编号里认得出它的那一段（`20261117-100109-c967` → `c967`）。 */
export function shortInstance(id: string): string {
  return id.slice(id.lastIndexOf('-') + 1)
}

export function prevRunText(t: T, waiting: TriggerWaiting, now: number): PrevRunText {
  const span = durationText(t, now - waiting.since)
  if (waiting.instance === undefined) {
    return {
      text: t('trigger.prev.unstarted').replace('{span}', span),
      phase: 'unstarted',
      tone: 'plain',
    }
  }
  const id = shortInstance(waiting.instance)
  if (waiting.status === 'waiting') {
    return { text: t('trigger.prev.waiting').replace('{id}', id), phase: 'waiting', tone: 'warn' }
  }
  if (waiting.status === undefined) {
    return { text: t('trigger.prev.noState').replace('{id}', id), phase: 'noState', tone: 'plain' }
  }
  return {
    text: t('trigger.prev.running').replace('{id}', id).replace('{span}', span),
    phase: 'running',
    tone: 'plain',
  }
}
