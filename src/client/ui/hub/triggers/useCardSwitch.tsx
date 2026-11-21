/**
 * dsh-workflow-lite — 工作流中心「触发」页里开、关一张卡片：左栏每行的开关、右栏头部的开关、问题条上的按钮都走这里。
 *
 * 还有排着的，关之前在点的那个按钮旁边问一句（关掉后它们不再执行、记成跳过）。
 * 选了跳过、排队却没开「记录运行状态」的打不开：交给外面（`onBlocked`，把问题小卡钉开）。
 * 自动停用了的「重新启用」、问题小卡里的「去打开」「视为已结束」也在这里（后两样先问一句再做）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/useCardSwitch
 */

import { needsRunState } from '../../../../shared/trigger.ts'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { T } from '../../../i18n.ts'
import { type SwitchQuestion, useSwitchConfirm } from '../../trigger/SwitchConfirm.tsx'

export interface CardSwitch<A extends HTMLElement> {
  /** 挂到点的那个按钮上（确认卡浮在它旁边）。 */
  anchorRef: React.RefObject<A>
  /** 确认卡开着。 */
  asking: boolean
  /** 开关：关着的打开，开着的关掉（还有排着的先问）。 */
  flip(): void
  /** 「重新启用」自动停用了的卡片。 */
  reopen(): void
  /** 问一句再做：去打开「记录运行状态」、视为已结束（问题小卡里的按钮）。 */
  ask(question: Extract<SwitchQuestion, 'runState' | 'waive'>): void
  /** 确认卡（没在问时什么都没有）。 */
  confirm: React.ReactNode
}

export function useCardSwitch<A extends HTMLElement>(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  /** 确认按钮的 `data-testid`。 */
  testId: string
  /** 改图里的开关（缺工作区、会话时说一句，不改）。 */
  toggle(on: boolean): void
  onNotice(text: string, tone?: 'info' | 'error'): void
  /** 在这个工作流里开启「记录运行状态」；做不了回一句原因。 */
  enableRunState(workflow: string): Promise<string | null>
  /** 打不开（没开「记录运行状态」）时：把问题小卡钉开。 */
  onBlocked(): void
}): CardSwitch<A> {
  const { t, hub, entry } = props
  const asker = useSwitchConfirm<A>()

  const turnOn = (): void => {
    if (asker.open) {
      asker.hide()
      return
    }
    if (needsRunState(entry.data, entry.view.runState === true)) props.onBlocked()
    else props.toggle(true)
  }

  const report = (task: Promise<string | null>): void => {
    void task.then((problem) => {
      if (problem !== null) props.onNotice(problem, 'error')
    })
  }

  const turnOff = (): void => {
    if (asker.open) {
      asker.hide()
      return
    }
    if ((entry.view.queued ?? 0) > 0) asker.ask('off')
    else props.toggle(false)
  }

  return {
    anchorRef: asker.anchorRef,
    asking: asker.open,
    flip: () => (entry.view.enabled ? turnOff() : turnOn()),
    reopen: () => report(hub.reopen(entry.workflow, entry.view.node)),
    ask: asker.ask,
    confirm: asker.render(t, {
      off: {
        queued: entry.view.queued ?? 0,
        testId: `${props.testId}-off`,
        onConfirm: () => props.toggle(false),
      },
      runState: {
        workflow: entry.workflow,
        testId: `${props.testId}-run-state`,
        onConfirm: () => report(props.enableRunState(entry.workflow)),
      },
      waive: {
        queued: (entry.view.queued ?? 0) > 0,
        testId: `${props.testId}-waive`,
        onConfirm: () => report(hub.waive(entry.workflow, entry.view.node)),
      },
    }),
  }
}
