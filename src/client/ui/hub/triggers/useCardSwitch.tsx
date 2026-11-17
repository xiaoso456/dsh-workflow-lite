/**
 * dsh-workflow-lite — 工作流中心「触发」页里开、关一张卡片：左栏每行的开关、右栏头部的开关、问题条上的「确认并打开」都走这里。
 *
 * 要在本机跑命令、还没确认过（或命令、工作区、shell 改过）的，开之前在点的那个按钮旁边浮出确认卡，
 * 列出命令、工作区和 shell，确认了才记下这条命令并打开（和画布上一样，不绕过确认）。
 * 还有排着的，关之前同样问一句（关掉后它们不再执行、记成跳过）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/useCardSwitch
 */

import { commandOf } from '../../../../shared/trigger.ts'
import type { TriggerEntry } from '../../../../shared/wire/trigger.ts'
import type { TriggerHub } from '../../../app/useTriggerHub.ts'
import type { T } from '../../../i18n.ts'
import { useSwitchConfirm } from '../../trigger/SwitchConfirm.tsx'

export interface CardSwitch<A extends HTMLElement> {
  /** 挂到点的那个按钮上（确认卡浮在它旁边）。 */
  anchorRef: React.RefObject<A>
  /** 确认卡开着。 */
  asking: boolean
  /** 开关：关着的打开（要确认的先问），开着的关掉（还有排着的先问）。 */
  flip(): void
  /** 打开：要确认的先问（问题条上的「确认并打开」「确认命令」「重新打开」）。 */
  turnOn(): void
  /** 确认卡（没在问时什么都没有）。 */
  confirm: React.ReactNode
}

export function useCardSwitch<A extends HTMLElement>(props: {
  t: T
  hub: TriggerHub
  entry: TriggerEntry
  /** 确认按钮的 `data-testid`。 */
  testId: string
  onNotice(text: string, tone?: 'info' | 'error'): void
}): CardSwitch<A> {
  const { t, hub, entry } = props
  const approve = useSwitchConfirm<A>()
  const command = commandOf(entry.data.source)
  // 开着、但命令改过了（待确认）也要再问一次。
  const needsApproval =
    command !== undefined && (entry.view.approved !== true || entry.view.state === 'confirm')

  const set = (enabled: boolean): void => {
    void hub.set(entry.workflow, entry.view.node, { enabled }).then((problem) => {
      if (problem !== null) props.onNotice(problem, 'error')
    })
  }

  const turnOn = (): void => {
    if (approve.open) {
      approve.hide()
      return
    }
    if (needsApproval) approve.askApprove()
    else set(true)
  }

  const turnOff = (): void => {
    if (approve.open) {
      approve.hide()
      return
    }
    if ((entry.view.queued ?? 0) > 0) approve.askOff()
    else set(false)
  }

  return {
    anchorRef: approve.anchorRef,
    asking: approve.open,
    flip: () => (entry.view.enabled ? turnOff() : turnOn()),
    turnOn,
    confirm: approve.render({
      off: {
        t,
        queued: entry.view.queued ?? 0,
        testId: `${props.testId}-off`,
        onOff: () => set(false),
      },
      approve:
        command === undefined
          ? undefined
          : {
              t,
              command,
              workspace: entry.view.workspace,
              shell: entry.view.runShell,
              noCwd: t('hub.trgNoCwd'),
              testId: props.testId,
              onApprove: (approved) =>
                void hub
                  .set(entry.workflow, entry.view.node, { approve: approved, enabled: true })
                  .then((problem) => {
                    if (problem !== null) props.onNotice(problem, 'error')
                  }),
            },
    }),
  }
}
