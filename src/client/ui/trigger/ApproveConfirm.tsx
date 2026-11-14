/**
 * dsh-workflow-lite — 打开一张要在本机跑命令（轮询、监听）、命令还没确认过的触发卡片时，在那个开关旁边浮出的确认卡：
 * 列出命令、它在哪个工作区、用哪个 shell 运行，确认后记下这条命令并打开开关。
 *
 * 画布上卡片的开关、面板里的开关、工作流中心「触发」页每行的开关都用它：在哪里点的就在哪里问。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/ApproveConfirm
 */

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

export function useApproveConfirm<A extends HTMLElement>(): {
  anchorRef: React.RefObject<A>
  open: boolean
  show(): void
  hide(): void
  toggle(): void
  render(options: ApproveOptions): React.ReactNode
} {
  const confirm = useConfirm<A>()
  return {
    anchorRef: confirm.anchorRef,
    open: confirm.open,
    show: confirm.show,
    hide: confirm.hide,
    toggle: confirm.toggle,
    render: (options) =>
      confirm.render({
        t: options.t,
        title: options.t('trigger.confirmTitle'),
        desc: options.t('trigger.confirmDesc'),
        confirmText: options.t('trigger.confirmOk'),
        testId: options.testId,
        disabled: options.workspace === undefined,
        onConfirm: () => options.onApprove(options.command),
        children: (
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
        ),
      }),
  }
}
