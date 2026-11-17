/**
 * dsh-workflow-lite — 触发卡片开关旁边浮出的确认卡，问这几件事之一：
 *
 * - 打开一张要在本机跑命令（定时检查、监听）、命令还没确认过的卡片：列出命令、它在哪个工作区、用哪个 shell 运行，
 *   确认后记下这条命令并打开开关；
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

/** 关、去打开「记录运行状态」、视为已结束：一句标题、一句说明、一个按钮。 */
export interface PlainOptions {
  /** 确认按钮的 `data-testid`；整张卡是 `${testId}-pop`。 */
  testId: string
  onConfirm(): void
}

export interface SwitchQuestions {
  approve?: ApproveOptions | undefined
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
  /** 浮卡：问的是确认命令而卡片没有命令（`approve` 没给）时什么都没有。 */
  render(t: T, questions: SwitchQuestions): React.ReactNode
}

export function useSwitchConfirm<A extends HTMLElement>(): SwitchConfirm<A> {
  const confirm = useConfirm<A>()
  const [question, setQuestion] = useState<SwitchQuestion>('approve')
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
        case 'approve': {
          const { approve } = questions
          if (approve === undefined) return null
          return confirm.render({
            t,
            title: t('trigger.confirmTitle'),
            desc: t('trigger.confirmDesc'),
            confirmText: t('trigger.confirmOk'),
            testId: approve.testId,
            disabled: approve.workspace === undefined,
            onConfirm: () => approve.onApprove(approve.command),
            children: <ApproveBody options={approve} />,
          })
        }
      }
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
