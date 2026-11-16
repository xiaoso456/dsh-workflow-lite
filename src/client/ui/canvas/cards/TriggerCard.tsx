/**
 * dsh-workflow-lite — 触发卡片：什么时候自动执行这个工作流。不连线——它触发的是整个工作流。
 *
 * 和步骤卡同一副外壳，上沿挂一个闪电圆标（开着时强调色）。三层：
 * - 标题行：触发源的图标块（每种一个图标、一种颜色）、名字、状态小标（已停用 / 等待中 / 接收中…）；
 * - 速览：按触发源换样子，一眼看出怎么触发（见 {@link TriggerGlanceRow}）；
 * - 底行：「主动 ↗」/「被动 ↙」小标（触发源的颜色）+ 状态的后半句（下一次什么时候、上次检查的结果、出了什么错）。
 *
 * 卡片上不放开关：开关在属性面板和工作流中心「触发」页里（要确认命令的也在那里问）。
 * 卡片选中之后再点速览，打开「触发方式」对话框（面板接手）；没选中时点它只是选中卡片（速览占着卡片中间，
 * 一点就弹框太冒失）。按着速览拖动卡片不算点。
 * 名字和速览来自图；状态和本机现场是这台机器上的事，从 {@link useTriggerEnv} 现读，
 * 所以轮询到新状态时只有这张卡片换字、换属性，不重建节点。实例视图里没有现场：只剩图里写着的部分。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/cards/TriggerCard
 */

import type { NodeProps } from '@xyflow/react'
import { memo, useRef } from 'react'
import { stateBadge, stateNote, stateTone } from '../../../model/triggerText.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import tone from '../../trigger/stateTone.module.css'
import { TriggerGlanceRow } from '../../trigger/TriggerGlanceRow.tsx'
import { ModeChip, TriggerMark, triggerTint } from '../../trigger/TriggerMark.tsx'
import { useTriggerEnv } from '../../trigger/triggerEnv.ts'
import shared from '../canvas.module.css'
import { useHandlesMeasured } from '../hooks/useHandlesMeasured.ts'
import type { TriggerFlowNode } from '../types.ts'
import css from './triggerCard.module.css'

export const TriggerCard = memo(function TriggerCard(
  props: NodeProps<TriggerFlowNode>,
): React.JSX.Element {
  const { data, selected, id } = props
  const measured = useHandlesMeasured(id)
  const env = useTriggerEnv()
  const view = env?.triggers.view(id)
  const note = env === null ? '' : stateNote(data.t, view, data.kind)
  return (
    <div
      className={cx(shared.card, css.card, selected && shared.cardSelected)}
      data-measured={measured}
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
      {env === null ? (
        <TriggerGlanceRow glance={data.glance} view={view} />
      ) : (
        <GlanceButton
          label={data.t('trigger.editWhen')}
          armed={selected}
          onPress={() => env.editSource(id)}
        >
          <TriggerGlanceRow glance={data.glance} view={view} />
        </GlanceButton>
      )}
      <div className={css.foot}>
        <ModeChip t={data.t} kind={data.kind} named testId="wl-trigger-mode" />
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

/** 指针按下到松开挪了超过这么多像素就是在拖卡片，不算点。 */
const DRAG_SLOP = 4

/**
 * 速览外面那层按钮：卡片选中时点它打开「触发方式」（弹窗从它长出来）。不进 Tab 顺序（键盘走面板里的那一行），
 * 拖动照常交给画布——松手时离按下的地方远了就不算点。
 * 选中与否在按下时记下：这一下点击本身也会选中卡片，松手时再看就分不出是第一下还是第二下了。
 */
function GlanceButton(props: {
  label: string
  /** 卡片选中着：点了才打开。 */
  armed: boolean
  onPress(): void
  children: React.ReactNode
}): React.JSX.Element {
  const down = useRef<{ x: number; y: number; armed: boolean } | null>(null)
  return (
    <button
      type="button"
      className={css.glanceHit}
      tabIndex={-1}
      aria-label={props.label}
      data-testid="wl-trigger-glance-edit"
      data-armed={props.armed}
      onPointerDown={(event) => {
        down.current = { x: event.clientX, y: event.clientY, armed: props.armed }
      }}
      onClick={(event) => {
        const from = down.current
        down.current = null
        // 键盘、程序点的没有按下：看现在选没选中。
        if (!(from?.armed ?? props.armed)) return
        if (from !== null && Math.hypot(event.clientX - from.x, event.clientY - from.y) > DRAG_SLOP)
          return
        props.onPress()
      }}
    >
      {props.children}
    </button>
  )
}
