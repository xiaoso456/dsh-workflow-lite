/**
 * dsh-workflow-lite — 触发卡片：什么时候自动执行这个工作流。不连线——它触发的是整个工作流。
 *
 * 和步骤卡同一副外壳，上沿挂一个闪电圆标（开着时强调色）。三层：
 * - 标题行：触发源的图标块（每种一个图标、一种颜色）、名字、状态小标（已停用 / 等待中 / 接收中…）；
 * - 速览：按触发源换样子，一眼看出怎么触发（见 {@link TriggerGlanceRow}）；
 * - 底行：「主动 ↗」/「被动 ↙」小标（触发源的颜色）+ 状态的后半句（下一次什么时候、上次检查的结果、出了什么错）。
 *
 * 卡片上不放开关：开关在属性面板和工作流中心「触发」页里（要确认命令的也在那里问）。
 * 名字和速览来自图；状态和本机现场是这台机器上的事，从 {@link useTriggerEnv} 现读，
 * 所以轮询到新状态时只有这张卡片换字、换属性，不重建节点。实例视图里没有现场：只剩图里写着的部分。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/cards/TriggerCard
 */

import type { NodeProps } from '@xyflow/react'
import { memo } from 'react'
import { triggerMode } from '../../../model/triggerGlance.ts'
import { stateBadge, stateNote, stateTone } from '../../../model/triggerText.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import tone from '../../trigger/stateTone.module.css'
import { TriggerMark, triggerTint } from '../../trigger/TriggerMark.tsx'
import { useTriggerEnv } from '../../trigger/triggerEnv.ts'
import shared from '../canvas.module.css'
import type { TriggerFlowNode } from '../types.ts'
import { TriggerGlanceRow } from './TriggerGlanceRow.tsx'
import css from './triggerCard.module.css'

export const TriggerCard = memo(function TriggerCard(
  props: NodeProps<TriggerFlowNode>,
): React.JSX.Element {
  const { data, selected, id } = props
  const env = useTriggerEnv()
  const view = env?.triggers.view(id)
  const mode = triggerMode(data.kind)
  const note = env === null ? '' : stateNote(data.t, view, data.kind)
  return (
    <div
      className={cx(shared.card, css.card, selected && shared.cardSelected)}
      style={{ '--wl-kind': triggerTint(data.kind) } as React.CSSProperties}
      data-state={env === null ? undefined : (view?.state ?? 'off')}
      data-kind={data.kind}
      data-dim={data.dim}
      data-testid="wl-trigger"
      data-tip={data.note === '' ? undefined : data.note}
    >
      {/* 挂在上沿的圆标：开着（等着触发）时是强调色，关着是灰的。 */}
      <span className={css.badge} aria-hidden="true">
        <Icon name="bolt" size={11} />
      </span>
      <div className={css.head}>
        <TriggerMark kind={data.kind} />
        <span className={shared.cardTitle}>{data.title}</span>
        {data.tone !== 'ok' && (
          <span className={shared.cardFlag} data-tone={data.tone}>
            <Icon name="alert" size={13} />
          </span>
        )}
        {env !== null && (
          <span
            className={cx(css.pill, tone.tone)}
            data-tone={stateTone(view?.state ?? 'off', data.kind)}
            data-testid="wl-trigger-state"
          >
            <span className={tone.dot} aria-hidden="true" />
            {stateBadge(data.t, view, data.kind)}
          </span>
        )}
      </div>
      <TriggerGlanceRow glance={data.glance} view={view} />
      <div className={css.foot}>
        <span
          className={css.mode}
          data-mode={mode}
          data-tip={data.t(
            mode === 'active' ? 'trigger.mode.activeTip' : 'trigger.mode.passiveTip',
          )}
          data-testid="wl-trigger-mode"
        >
          {/* 主动往外（插件自己去做），被动往里（等外面的事进来）。 */}
          <Icon name={mode === 'active' ? 'arrowOut' : 'arrowIn'} size={10} />
          {data.t(mode === 'active' ? 'trigger.mode.active' : 'trigger.mode.passive')}
        </span>
        {/* 一直挂着（没话说时是空的）：状态变了只换字。 */}
        <span
          className={css.note}
          data-testid="wl-trigger-note"
          data-tip={note === '' ? undefined : note}
        >
          {note}
        </span>
      </div>
    </div>
  )
})
