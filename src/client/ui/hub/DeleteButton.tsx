/**
 * dsh-workflow-lite — 工作流中心的删除按钮：垃圾桶，确认卡浮在它旁边（说清后果，焦点先落在「取消」上）。
 *
 * 「工作流」「记忆」「运行实例」右栏标题栏共用（实例那张卡多一个勾选框，见 `runs/RunDelete.tsx`）。
 * 平时是灰的图标按钮，悬停、确认卡开着时才变红：标题栏只有主按钮（查看 / 打开）带字、带底。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/DeleteButton
 */

import type { T } from '../../i18n.ts'
import { useConfirm } from '../kit/Confirm.tsx'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'

export function DeleteButton(props: {
  t: T
  /** 读屏念的（「删除 周报」）；缺省「删除」。 */
  label?: string
  /** 按钮的 testId；确认按钮是 `confirmTestId`。 */
  testId: string
  confirmTestId: string
  /** 确认卡上问的那句、补的后果。 */
  title: string
  desc?: string
  /** 确认卡里额外的东西（比如「连同状态文件」勾选框）。 */
  children?: React.ReactNode
  /** 每次打开确认卡之前（重置卡里的勾选）。 */
  onOpen?(): void
  onConfirm(): void
}): React.JSX.Element {
  const { t } = props
  const confirm = useConfirm<HTMLButtonElement>()
  return (
    <>
      <button
        ref={confirm.anchorRef}
        type="button"
        className={cx(ui.btn, ui.icon, ui.small, ui.dangerQuiet)}
        data-danger="true"
        aria-label={props.label ?? t('common.delete')}
        data-tip={confirm.open ? undefined : t('common.delete')}
        aria-expanded={confirm.open}
        data-testid={props.testId}
        onClick={() => {
          if (!confirm.open) props.onOpen?.()
          confirm.toggle()
        }}
      >
        <Icon name="trash" size={14} />
      </button>
      {confirm.render({
        t,
        title: props.title,
        ...(props.desc === undefined ? {} : { desc: props.desc }),
        confirmText: t('common.delete'),
        testId: props.confirmTestId,
        onConfirm: props.onConfirm,
        children: props.children,
      })}
    </>
  )
}
