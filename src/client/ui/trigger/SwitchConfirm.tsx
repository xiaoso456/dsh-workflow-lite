/**
 * dsh-workflow-lite — 点触发卡片的开关时在开关旁边浮出的确认卡，问两件事之一：
 *
 * - 打开一张要在本机跑命令（轮询、监听）、命令还没确认过的卡片：列出命令、它在哪个工作区、用哪个 shell 运行，
 *   确认后记下这条命令并打开开关；
 * - 关掉一张还有排着的卡片：「还有 3 个在排队」，关掉后它们不再执行、记成跳过。
 *
 * 面板里的开关、工作流中心「触发」页头部的开关和问题条都用它：在哪里点的就在哪里问。同一个开关同一时刻只问一件事，
 * 两件事共用一张浮卡（一个锚点）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/SwitchConfirm
 */

import { useState } from 'react'
import type { T } from '../../i18n.ts'
import { useConfirm } from '../kit/Confirm.tsx'
import ins from '../panel/panel.module.css'
import css from './trigger.module.css'

export interface ApproveOptions {
  t: T
  /** 要确认的命令（原样显示，也原样交给宿主）。 */
  command: string
  /** 命令在哪个工作区运行；还没选是 `undefined`（确认按钮不可点）。 */
  workspace: string | undefined
  /** 还没选工作区时的那句话（各处去选工作区的地方不一样）。 */
  noCwd: string
  /** 用哪个 shell 跑（宿主算好的，见 `TriggerView.runShell`）；还没读到不显示。 */
  shell?: { path: string; name: string } | undefined
  /** 确认按钮的 `data-testid`；整张卡是 `${testId}-pop`。 */
  testId: string
  onApprove(command: string): void
}

export interface OffOptions {
  t: T
  /** 排着几个。 */
  queued: number
  /** 确认按钮的 `data-testid`；整张卡是 `${testId}-pop`。 */
  testId: string
  onOff(): void
}

export interface SwitchConfirm<A extends HTMLElement> {
  anchorRef: React.RefObject<A>
  open: boolean
  /** 问「运行这条命令？」。 */
  askApprove(): void
  /** 问「还有几个在排队，关不关」。 */
  askOff(): void
  hide(): void
  /** 浮卡：问的是确认命令而卡片没有命令（`approve` 没给）时什么都没有。 */
  render(options: { approve?: ApproveOptions | undefined; off: OffOptions }): React.ReactNode
}

export function useSwitchConfirm<A extends HTMLElement>(): SwitchConfirm<A> {
  const confirm = useConfirm<A>()
  const [question, setQuestion] = useState<'approve' | 'off'>('approve')
  return {
    anchorRef: confirm.anchorRef,
    open: confirm.open,
    askApprove: () => {
      setQuestion('approve')
      confirm.show()
    },
    askOff: () => {
      setQuestion('off')
      confirm.show()
    },
    hide: confirm.hide,
    render: ({ approve, off }) => {
      if (question === 'off') {
        return confirm.render({
          t: off.t,
          title: off.t('trigger.offQueued').replace('{n}', String(off.queued)),
          desc: off.t('trigger.offQueuedDesc'),
          confirmText: off.t('trigger.offQueuedOk'),
          testId: off.testId,
          onConfirm: off.onOff,
        })
      }
      if (approve === undefined) return null
      return confirm.render({
        t: approve.t,
        title: approve.t('trigger.confirmTitle'),
        desc: approve.t('trigger.confirmDesc'),
        confirmText: approve.t('trigger.confirmOk'),
        testId: approve.testId,
        disabled: approve.workspace === undefined,
        onConfirm: () => approve.onApprove(approve.command),
        children: <ApproveBody options={approve} />,
      })
    },
  }
}

/** 确认命令的卡里：命令原样、在哪个工作区、用哪个 shell。 */
function ApproveBody(props: { options: ApproveOptions }): React.JSX.Element {
  const { options } = props
  return (
    <div className={css.confirmCommand}>
      <code className={css.confirmCode} data-testid="wl-trigger-approve-command">
        {options.command}
      </code>
      <span className={options.workspace === undefined ? ins.error : ins.help}>
        {options.workspace === undefined
          ? options.noCwd
          : options.t('trigger.confirmCwd').replace('{path}', options.workspace)}
      </span>
      {options.shell !== undefined && (
        <span
          className={ins.help}
          data-tip={options.shell.path}
          data-testid="wl-trigger-approve-shell"
        >
          {options.t('trigger.confirmShell').replace('{name}', options.shell.name)}
        </span>
      )}
    </div>
  )
}
