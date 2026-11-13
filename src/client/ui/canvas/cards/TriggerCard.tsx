/**
 * dsh-workflow-lite — 触发卡片：什么时候自动执行这个工作流。不连线——它触发的是整个工作流。
 *
 * 和步骤卡同一副外壳：上沿挂一个闪电圆标；标题行是名字和开关，下面两行是触发源（定时规则、轮询间隔、监听、HTTP）
 * 和此刻的状态（等待中 · 下一次什么时候 / 已停用 / 由另一个 DSH 负责…）。名字和规则来自图；状态和开关是这台机器上的事，从 {@link useTriggerEnv} 现读，
 * 所以轮询到新状态时只有这张卡片换字、换属性，不重建节点。实例视图里没有现场：只剩名字和规则。
 *
 * 要在本机跑命令、还没确认过的，点开关就在开关旁边浮出确认卡（不跳到右栏去问）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/cards/TriggerCard
 */

import type { NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { stateText } from '../../../model/triggerText.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { SwitchTrack } from '../../motion/marks.tsx'
import { useApproveConfirm } from '../../trigger/ApproveConfirm.tsx'
import { useTriggerEnv } from '../../trigger/triggerEnv.ts'
import shared from '../canvas.module.css'
import type { TriggerFlowNode } from '../types.ts'
import css from './triggerCard.module.css'

export const TriggerCard = memo(function TriggerCard(
  props: NodeProps<TriggerFlowNode>,
): React.JSX.Element {
  const { data, selected, id } = props
  const env = useTriggerEnv()
  const view = env?.triggers.view(id)
  const on = view?.enabled === true
  const approve = useApproveConfirm<HTMLButtonElement>()
  const switchTip = data.t(on ? 'trigger.switchOff' : 'trigger.switchOn')
  return (
    <div
      className={cx(shared.card, css.card, selected && shared.cardSelected)}
      data-state={env === null ? undefined : (view?.state ?? 'off')}
      data-dim={data.dim}
      data-testid="wl-trigger"
      data-tip={data.note === '' ? undefined : data.note}
    >
      {/* 挂在上沿的圆标：开着（等着触发）时是强调色，关着是灰的。 */}
      <span className={css.badge} aria-hidden="true">
        <Icon name="bolt" size={11} />
      </span>
      <div className={css.head}>
        <span className={shared.cardTitle}>{data.title}</span>
        {data.tone !== 'ok' && (
          <span className={shared.cardFlag} data-tone={data.tone}>
            <Icon name="alert" size={13} />
          </span>
        )}
        {env !== null && (
          <button
            ref={approve.anchorRef}
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={data.t('trigger.switch')}
            // 确认卡开着时不再出提示，免得盖在卡片上。
            data-tip={approve.open ? undefined : switchTip}
            className={cx(css.toggle, 'nodrag')}
            data-testid="wl-trigger-switch"
            onClick={(event) => {
              // 点开关不算选中卡片。
              event.stopPropagation()
              if (approve.open) approve.hide()
              else if (env.toggle(id, !on) === 'confirm') approve.show()
            }}
          >
            <SwitchTrack on={on} />
          </button>
        )}
      </div>
      <div className={css.lines}>
        <span className={css.rule}>{data.rule}</span>
        {env !== null && (
          <span className={css.status} data-testid="wl-trigger-state">
            <span className={css.dot} aria-hidden="true" />
            <span className={css.statusText}>{stateText(data.t, view, data.kind)}</span>
          </span>
        )}
      </div>
      {env !== null &&
        data.command !== undefined &&
        approve.render({
          t: data.t,
          command: data.command,
          workspace: view?.workspace,
          noCwd: data.t('trigger.confirmNoCwd'),
          testId: 'wl-trigger-card-approve',
          onApprove: (command) => env.approve(id, command),
        })}
    </div>
  )
})
