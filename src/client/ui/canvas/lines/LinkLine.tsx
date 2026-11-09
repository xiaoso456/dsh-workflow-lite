/**
 * dsh-workflow-lite — 步骤之间的流程线：贝塞尔 / 绕行折线，线上的条件牌子与交接标记。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/lines/LinkLine
 */

import { BaseEdge, type EdgeProps } from '@xyflow/react'
import { memo } from 'react'
import { flowPath } from '../../../model/route.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { WHEN_COLOR } from '../../kit/lineColors.ts'
import shared from '../canvas.module.css'
import type { LinkEdge } from '../types.ts'
import { FlowStreaks } from './FlowStreaks.tsx'
import { HandoffMark } from './HandoffMark.tsx'
import { OnLabels } from './LabelLayer.tsx'
import css from './linkLine.module.css'
import { bypass, detour, laneStart } from './route.ts'

/** 条件超过这么多字就在线上截断、悬停看全文（与 CSS 里标签的最大宽度大致对应）。 */
const LABEL_FULL_AT = 12

export const LinkLine = memo(function LinkLine(props: EdgeProps<LinkEdge>): React.JSX.Element {
  const { id, data, markerEnd, sourceX, sourceY, targetX, targetY } = props
  // 往回走的线（循环、或终点在起点左边）用圆角折线绕开卡片；贝塞尔在这种时候会拧成一个结。
  const backwards = targetX < sourceX + 8
  const lane = data?.lane ?? null
  const shift = data?.shift ?? null
  const [path, pathLabelX, labelY] = backwards
    ? detour(sourceX, sourceY, targetX, targetY, lane ?? laneStart(sourceY, targetY), shift)
    : lane === null
      ? flowPath(sourceX, sourceY, targetX, targetY)
      : bypass(sourceX, sourceY, targetX, targetY, lane, shift)
  const labelX = backwards || lane !== null ? (data?.labelX ?? pathLabelX) : pathLabelX
  const text = data?.text ?? ''
  const showWhen = text !== '' || data?.back === true
  const handoff = data?.handoff ?? null
  const color = data?.color ?? WHEN_COLOR.always
  return (
    <>
      <path
        d={path}
        className={shared.halo}
        data-active={data?.active === true}
        style={{ stroke: color }}
      />
      <BaseEdge
        id={id}
        path={path}
        interactionWidth={28}
        style={{ stroke: color }}
        {...(markerEnd ? { markerEnd } : {})}
      />
      {data !== undefined && (
        <FlowStreaks path={path} color={color} active={data.active && handoff?.none !== true} />
      )}
      {(showWhen || handoff !== null) && data !== undefined && (
        <OnLabels>
          {/* 条件在上、交接在下，竖着叠在线的中点：两张卡之间的空隙放不下横排的两块。
              两块都和线同色。 */}
          <div
            className={cx(css.linkLabels, 'nodrag', 'nopan')}
            data-vanish={id}
            style={
              {
                transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
                '--wl-chip': color,
              } as React.CSSProperties
            }
          >
            {showWhen && (
              <button
                type="button"
                className={css.linkLabel}
                data-when={data.when}
                data-selected={props.selected === true}
                // 长条件在线上只露一截，悬停时弹出全文。
                data-tip={text.length > LABEL_FULL_AT ? text : undefined}
                onClick={() => data.onPick(id)}
              >
                {data.back && <Icon name="loop" size={11} />}
                {text !== '' && <span className={css.linkText}>{text}</span>}
              </button>
            )}
            {handoff !== null && (
              <HandoffMark
                edgeId={id}
                handoff={handoff}
                route={data.route}
                t={data.t}
                selected={props.selected === true}
                onPick={data.onPick}
                acts={data.acts}
              />
            )}
          </div>
        </OnLabels>
      )}
    </>
  )
})
