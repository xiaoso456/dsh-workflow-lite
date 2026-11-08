/**
 * dsh-workflow-lite — 读写线：步骤与资源卡 / 输入卡之间的产出、更新、读取、提问线，线上挂写法小牌子。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/lines/FileLine
 */

import { BaseEdge, type EdgeProps, getBezierPath } from '@xyflow/react'
import { memo } from 'react'
import { cx } from '../../kit/cx.ts'
import { SwapIcon, SwapText, useLast } from '../../motion/swapText.tsx'
import shared from '../canvas.module.css'
import type { FileEdge } from '../types.ts'
import { FlowStreaks } from './FlowStreaks.tsx'
import css from './fileLine.module.css'
import { OnLabels } from './LabelLayer.tsx'
import { ACCESS_COLOR, type Access } from './lines.ts'
import { routedPath, writePath } from './route.ts'

const ACCESS_ICON = { produce: 'pencil', update: 'reload', read: 'eye', ask: 'ask' } as const

const ACCESSES = ['produce', 'update', 'read', 'ask'] as const satisfies readonly Access[]

/**
 * 读写线：「左右走流程，上下走资源」——两头都落在真实的连接点上；挂哪个点由画布按两张卡
 * 当下的位置挑（见 `route.ts`），拖动卡片时线会跟着换到合适的点。
 * 三种各有颜色与线型：产出 = 金色实线，在原文件上更新 = 洋红实线、两头箭头，读取 = 青色虚线。
 * 与选中的东西相连时描粗、加光晕、光带按数据方向流动，中点挂一个小牌子写明是哪种。
 */
/** 旧线色留多久（同 fileLine.module.css 的 lineFade）。 */
const LINE_FADE_MS = 240

export const FileLine = memo(function FileLine(props: EdgeProps<FileEdge>): React.JSX.Element {
  const { id, data, markerEnd, markerStart } = props
  // 写线走直角（资源挂在步骤下面，几条写线共用一根树干再分叉）；读线是贝塞尔曲线。
  const points = data?.points ?? null
  const [path, labelX, labelY] =
    points !== null
      ? routedPath(points, props.sourceX, props.sourceY, props.targetX, props.targetY)
      : data?.kind === 'write'
        ? writePath(
            props.sourceX,
            props.sourceY,
            props.sourcePosition,
            props.targetX,
            props.targetY,
            data.cardH,
          )
        : getBezierPath(props)
  const active = data?.active === true
  const color = data?.color ?? ACCESS_COLOR.produce
  // 换了写法（产出 ↔ 更新）线色跟着变：旧颜色的一份叠在上面淡出，不是颜色瞬切。
  const faded = useLast(color, LINE_FADE_MS)
  return (
    <>
      {/* 光晕常驻、平时透明：活起来时淡入，不活了淡出，不会一闪而现。 */}
      <path d={path} className={shared.halo} data-active={active} style={{ stroke: color }} />
      <BaseEdge
        // 换色那一下重新挂：新颜色（连箭头）的一份淡入，和叠在上面淡出的旧颜色交叉。
        key={faded.n}
        id={id}
        path={path}
        interactionWidth={20}
        style={{ stroke: color }}
        {...(faded.n > 0 ? { className: css.lineIn } : {})}
        {...(markerEnd ? { markerEnd } : {})}
        {...(markerStart ? { markerStart } : {})}
      />
      {faded.was !== null && (
        <path
          key={faded.n}
          d={path}
          className={cx('react-flow__edge-path', css.lineFade)}
          style={{ stroke: faded.was }}
        />
      )}
      <FlowStreaks path={path} color={color} active={active} />
      {data !== undefined && (
        <OnLabels>
          {/* 不接指针：点在小牌子上等于点在线上（下面就是线的命中区），悬停也不会被它打断。
              常驻、平时透明，和光晕一样淡入淡出。 */}
          <span
            className={css.ioChip}
            data-vanish={id}
            data-access={data.access}
            data-active={active}
            aria-hidden={!active}
            data-testid="wl-io-chip"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          >
            {/* 底色、描边按写法上色：几层叠着，换写法时交叉淡过去；图标、字原地换。 */}
            {ACCESSES.map((access) => (
              <span
                key={access}
                className={css.ioTone}
                data-access={access}
                data-on={access === data.access}
              />
            ))}
            <SwapIcon name={ACCESS_ICON[data.access]} size={11} />
            <SwapText text={data.chipText} />
          </span>
        </OnLabels>
      )}
    </>
  )
})
