/**
 * dsh-workflow-lite — 「视为已结束」：上次执行一直没结束（模型没改运行状态）时，把它当作已经结束，
 * 跳过的下一次照常触发、排着的第 1 个马上发出。点了先在按钮旁边浮出确认卡，确认后才做。
 *
 * 「触发」页时间线「排队中」最上面「上次执行」那一行的行尾（描边、带勾）、排着的那条的详情（页脚）用它；
 * 面板状态行的问题小卡走 `SwitchConfirm` 的同一句话。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/WaiveButton
 */

import { useState } from 'react'
import type { T } from '../../i18n.ts'
import { useConfirm } from '../kit/Confirm.tsx'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import css from './prevRun.module.css'

export function WaiveButton(props: {
  t: T
  /** 按钮上的字：组头里短（「视为已结束」），详情里长（「上次执行视为已结束」）。 */
  long?: boolean
  /** 确认卡里说之后会怎样：排着的第 1 个发出，或下一次触发照常执行。 */
  queued: boolean
  /** `soft`：浅底（页脚）；`outline`：描边带勾（时间线那一行的行尾，和行里的字分得开又不抢）。 */
  look?: 'soft' | 'outline'
  /** 按钮的 `data-testid`；确认按钮是 `${testId}-ok`。 */
  testId: string
  /** 做不了回一句原因。 */
  onWaive(): Promise<string | null>
  onProblem(reason: string | null): void
}): React.JSX.Element {
  const { t } = props
  const confirm = useConfirm<HTMLButtonElement>()
  const [busy, setBusy] = useState(false)
  const label = t(props.long === true ? 'trigger.waiveLong' : 'trigger.waive')
  return (
    <>
      <button
        ref={confirm.anchorRef}
        type="button"
        className={cx(ui.btn, ui.small, props.look === 'outline' ? css.outline : ui.soft)}
        aria-expanded={confirm.open}
        disabled={busy}
        data-testid={props.testId}
        onClick={confirm.toggle}
      >
        {props.look === 'outline' && <Icon name="check" size={13} />}
        {label}
      </button>
      {confirm.render({
        t,
        title: t('trigger.waiveTitle'),
        desc: t(props.queued ? 'trigger.waiveDesc.queue' : 'trigger.waiveDesc.skip'),
        confirmText: t('trigger.waive'),
        testId: `${props.testId}-ok`,
        danger: false,
        onConfirm: () => {
          setBusy(true)
          props.onProblem(null)
          void props.onWaive().then((reason) => {
            setBusy(false)
            props.onProblem(reason)
          })
        },
      })}
    </>
  )
}
