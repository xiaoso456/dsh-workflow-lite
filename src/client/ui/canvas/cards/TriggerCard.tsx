/**
 * dsh-workflow-lite — 触发卡片：什么时候自动执行这个工作流。不连线——它触发的是整个工作流。
 *
 * 卡片上三行：名字、触发源（定时规则、轮询间隔、监听、HTTP）、此刻的状态（等待中 · 下一次什么时候 / 已停用 / 由另一个 DSH 负责…），
 * 右边一个开关。名字和规则来自图；状态和开关是这台机器上的事，从 {@link useTriggerEnv} 现读，
 * 所以轮询到新状态时只有这张卡片换字、换属性，不重建节点。实例视图里没有现场：只剩名字和规则。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/cards/TriggerCard
 */

import type { NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { stateText } from '../../../model/triggerText.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { SwitchTrack } from '../../motion/marks.tsx'
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
  return (
    <div
      className={css.card}
      data-selected={selected || undefined}
      data-state={env === null ? undefined : (view?.state ?? 'off')}
      data-dim={data.dim}
      data-testid="wl-trigger"
      data-tip={data.note === '' ? undefined : data.note}
    >
      <span className={css.tab} aria-hidden="true">
        <Icon name="bolt" size={15} />
      </span>
      <span className={css.text}>
        <span className={css.title}>{data.title}</span>
        <span className={css.rule}>{data.rule}</span>
        {env !== null && (
          <span className={css.status} data-testid="wl-trigger-state">
            <span className={css.dot} aria-hidden="true" />
            <span className={css.statusText}>{stateText(data.t, view, data.kind)}</span>
          </span>
        )}
      </span>
      {data.tone !== 'ok' && (
        <span className={shared.cardFlag} data-tone={data.tone}>
          <Icon name="alert" size={12} />
        </span>
      )}
      {env !== null && (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={data.t('trigger.switch')}
          data-tip={data.t('trigger.switch')}
          className={cx(css.toggle, 'nodrag')}
          data-testid="wl-trigger-switch"
          onClick={(event) => {
            // 点开关不算选中卡片。
            event.stopPropagation()
            env.toggle(id, !on)
          }}
        >
          <SwitchTrack on={on} />
        </button>
      )}
    </div>
  )
})
