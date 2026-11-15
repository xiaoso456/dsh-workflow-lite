/**
 * dsh-workflow-lite — 一张触发卡片眼下有没有要人处理的事：一句话、一种颜色、能直接做的那一下。
 * 画布面板最上面的框和「触发」页右栏的状态条都在状态后面亮一枚图标（`ui/trigger/ProblemMark.tsx`），说法从这里取。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/triggerProblem
 */

import { commandOf } from '../../shared/trigger.ts'
import type { TriggerSource } from '../../shared/types.ts'
import type { TriggerView } from '../../shared/wire/trigger.ts'
import type { LocaleKey, T } from '../i18n.ts'

/** 小卡里那个按钮做什么：确认命令（再打开）、重新打开停用了的卡片、从全部暂停里恢复。 */
export type ProblemFix = 'approve' | 'reopen' | 'resume'

export interface Problem {
  text: string
  /** 说明 / 提醒 / 出错：图标的样子和颜色跟着它。 */
  tone: 'calm' | 'warn' | 'bad'
  action?: { label: LocaleKey; run: ProblemFix }
}

/**
 * 按卡片的状态说：别的进程在负责、自动停用了、命令待确认、出错、重启中、要跑命令还没确认过、全部暂停着。
 * 全部暂停着这一条不带按钮（画布面板上恢复不了，「触发」页自己加上「恢复」）。
 * 别的状态（等着、监视着、关着且不用确认……）没事，回 `null`。
 * @param owner - 负责触发的是别的进程时它的 pid（「在别处运行」才用得上）。
 */
export function problemOf(
  t: T,
  view: TriggerView,
  source: TriggerSource,
  owner: number | undefined,
): Problem | null {
  switch (view.state) {
    case 'elsewhere':
      return owner === undefined
        ? null
        : { text: t('trigger.ownerOther').replace('{pid}', String(owner)), tone: 'calm' }
    case 'stopped':
      return {
        text: `${view.problem ?? ''} ${t('trigger.stoppedHint')}`.trim(),
        tone: 'bad',
        action: { label: 'hub.trgReopen', run: 'reopen' },
      }
    case 'confirm':
      return {
        text: view.problem ?? t('trigger.confirmHint'),
        tone: 'warn',
        action: { label: 'trigger.confirmAgain', run: 'approve' },
      }
    case 'error':
    case 'invalid':
      return view.problem === undefined ? null : { text: view.problem, tone: 'bad' }
    case 'paused':
      return { text: t('trigger.pausedHint'), tone: 'calm' }
    case 'restarting':
    case 'unavailable':
      return view.problem === undefined ? null : { text: view.problem, tone: 'warn' }
    case 'off':
      return commandOf(source) !== undefined && view.approved !== true
        ? {
            text: t('hub.trgApproveHint'),
            tone: 'calm',
            action: { label: 'hub.trgApproveOpen', run: 'approve' },
          }
        : null
    default:
      return null
  }
}
