/**
 * dsh-workflow-lite — 触发卡片开关旁边浮出的确认卡，问这几件事之一：
 *
 * - 关掉一张还有排着的卡片：「还有 3 个在排队」，关掉后它们不再执行、记成跳过；
 * - 问题小卡里的「去打开」：在这个工作流里开启「记录运行状态」（跳过、排队靠它判断上次执行结束没有）；
 * - 问题小卡里的「视为已结束」：上次执行一直没结束，把它当作已经结束。
 *
 * 面板里的开关、工作流中心「触发」页头部的开关和问题条都用它：在哪里点的就在哪里问。同一个开关同一时刻只问一件事，
 * 几件事共用一张浮卡（一个锚点）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/SwitchConfirm
 */

import { useState } from 'react'
import type { T } from '../../i18n.ts'
import { useConfirm } from '../kit/Confirm.tsx'

/** 关、去打开「记录运行状态」、视为已结束：一句标题、一句说明、一个按钮。 */
export interface PlainOptions {
  /** 确认按钮的 `data-testid`；整张卡是 `${testId}-pop`。 */
  testId: string
  onConfirm(): void
}

export interface SwitchQuestions {
  /** 排着几个（关之前问）。 */
  off: PlainOptions & { queued: number }
  /** 在哪个工作流里开启「记录运行状态」。 */
  runState: PlainOptions & { workflow: string }
  /** 有没有排着的（说之后会怎样）。 */
  waive: PlainOptions & { queued: boolean }
}

export type SwitchQuestion = keyof SwitchQuestions

export interface SwitchConfirm<A extends HTMLElement> {
  anchorRef: React.RefObject<A>
  open: boolean
  ask(question: SwitchQuestion): void
  hide(): void
  /** 浮卡。 */
  render(t: T, questions: SwitchQuestions): React.ReactNode
}

export function useSwitchConfirm<A extends HTMLElement>(): SwitchConfirm<A> {
  const confirm = useConfirm<A>()
  const [question, setQuestion] = useState<SwitchQuestion>('off')
  return {
    anchorRef: confirm.anchorRef,
    open: confirm.open,
    ask: (next) => {
      setQuestion(next)
      confirm.show()
    },
    hide: confirm.hide,
    render: (t, questions) => {
      switch (question) {
        case 'off': {
          const { off } = questions
          return confirm.render({
            t,
            title: t('trigger.offQueued').replace('{n}', String(off.queued)),
            desc: t('trigger.offQueuedDesc'),
            confirmText: t('trigger.offQueuedOk'),
            testId: off.testId,
            onConfirm: off.onConfirm,
          })
        }
        case 'runState': {
          const { runState } = questions
          return confirm.render({
            t,
            title: t('trigger.runStateTitle').replace('{name}', runState.workflow),
            desc: t('trigger.runStateDesc'),
            confirmText: t('trigger.runStateOk'),
            testId: runState.testId,
            danger: false,
            onConfirm: runState.onConfirm,
          })
        }
        case 'waive': {
          const { waive } = questions
          return confirm.render({
            t,
            title: t('trigger.waiveTitle'),
            desc: t(waive.queued ? 'trigger.waiveDesc.queue' : 'trigger.waiveDesc.skip'),
            confirmText: t('trigger.waive'),
            testId: waive.testId,
            danger: false,
            onConfirm: waive.onConfirm,
          })
        }
      }
    },
  }
}
