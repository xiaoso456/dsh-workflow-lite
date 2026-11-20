/**
 * dsh-workflow-lite — 资源卡 / 输入卡底边那对接总线的连接点（见 model/bus.ts）。
 *
 * 卡片摆在用到它的几个步骤上方时，读写线从这里竖着落到干线上。平时不露，有线挂上才显示，
 * 和步骤卡上的备用点一样（`data-used`）；拖它连线和拖左右两点是同一个意思（见 model/connect.ts）。
 * 拖线落到卡片上时由左右两点接（整张卡都是它们的命中区），这两个点不当落点。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/cards/BusHandles
 */

import { Handle, Position } from '@xyflow/react'
import { FILE_SPOTS, type Spot } from '../../../model/route.ts'
import { cx } from '../../kit/cx.ts'
import shared from '../canvas.module.css'

/** 上下边上的连接点沿边摆在几成处：交给 CSS 变量，样式表据此定位（拖线时也要用它放回圆点）。 */
export function spotVar(spot: Spot): React.CSSProperties {
  return { '--wl-at': spot.at } as React.CSSProperties
}

/**
 * @param used - 这张卡上挂着线的连接点。
 * @param ask - 输入卡：只有被读（交回答）的点，颜色和右边那个一样。
 */
export function BusHandles({
  used,
  ask = false,
}: {
  used: readonly string[]
  ask?: boolean
}): React.JSX.Element {
  return (
    <>
      {!ask && (
        <Handle
          id="inBus"
          type="target"
          position={Position.Bottom}
          className={cx(shared.handle, shared.hBusIn, shared.handleAux, shared.spotted)}
          style={spotVar(FILE_SPOTS.inBus)}
          data-used={used.includes('inBus')}
        />
      )}
      <Handle
        id="outBus"
        type="source"
        position={Position.Bottom}
        className={cx(
          shared.handle,
          shared.handleOut,
          shared.hBusOut,
          ask && shared.handleAsk,
          shared.handleAux,
          shared.spotted,
        )}
        style={spotVar(FILE_SPOTS.outBus)}
        data-used={used.includes('outBus')}
      />
    </>
  )
}
