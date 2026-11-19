/**
 * dsh-workflow-lite — 「进程」图里按时间摆的小件（一段条、横轴上的一个时刻）换位置时怎么动。
 *
 * 位置是父元素宽度的百分比（`left` / `width` 写在 style 里），换一个实例、时间往前走、一步做完时会变：
 * - 同一个小件换了位置、长短：从旧的样子滑到新的样子（`translate` + 从左边起的 `scale`），不跳；
 *   列表换了一项时（{@link SwapScope}）照切换的节奏，和右栏别的字一起；
 * - 图已经在了之后新冒出来的小件：条从左端长出来，时刻淡入。刚挂上时（整张图一起出来）不动。
 *
 * 全在 CSS 里放（overviewTab.module.css）：这里只在渲染时算出从哪来（`--gx` 是挪了父元素宽度的百分之几，
 * 父元素是尺寸容器，CSS 用 `cqw` 换成像素；`--gs` 是旧宽度 / 新宽度），`data-move` 在 a / b 之间换着从头放。
 * 不量版面、不调 `animate()`：换一项时一张图十几个小件，每个当场量一下、放一下，整页样式就要跟着重算好几遍。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/ganttMotion
 */

import { type CSSProperties, useState } from 'react'
import { switching, useSwapSwitch } from '../../motion/swapScope.tsx'

/** 在父元素里的位置（百分比）；`width` 缺省 = 只有位置（横轴上的时刻）。 */
export interface GanttSpot {
  left: number
  width?: number
}

interface Moving {
  spot: GanttSpot
  /** 挪了几次（a / b 换着放）；0 = 没挪过。 */
  n: number
  from: { x: number; scale: number }
  /** 这次挪是列表换了一项（照切换的节奏）。 */
  switched: boolean
}

/** 宽度比旧的差太多（几乎为 0 的一段）时不按比例缩放：一段细线放大几十倍再缩回来，看着是闪。 */
const MAX_SCALE = 20

/**
 * 一个小件这次怎么动：返回要合进去的 style（位置和起点变量）和属性。
 * `enter`：挂上时图已经在了（新冒出来的），放进场。
 */
export function useGanttSpot(
  spot: GanttSpot,
  enter: boolean,
): { style: CSSProperties; attrs: Record<string, string | undefined> } {
  const swap = useSwapSwitch()
  const [born] = useState(enter)
  const [moving, setMoving] = useState<Moving>({
    spot,
    n: 0,
    from: { x: 0, scale: 1 },
    switched: false,
  })
  const was = moving.spot
  if (was.left !== spot.left || was.width !== spot.width) {
    const ratio =
      spot.width === undefined || was.width === undefined || spot.width <= 0
        ? 1
        : was.width / spot.width
    setMoving({
      spot,
      n: moving.n + 1,
      from: { x: was.left - spot.left, scale: Math.min(MAX_SCALE, Math.max(0, ratio)) },
      switched: switching(swap),
    })
  }
  return {
    style: {
      left: `${String(spot.left)}%`,
      ...(spot.width === undefined ? {} : { width: `${String(spot.width)}%` }),
      ...(moving.n === 0
        ? {}
        : { '--gx': String(moving.from.x), '--gs': String(moving.from.scale) }),
    } as CSSProperties,
    attrs: {
      'data-born': born ? '' : undefined,
      'data-move': moving.n === 0 ? undefined : moving.n % 2 === 1 ? 'a' : 'b',
      'data-move-switch': moving.n > 0 && moving.switched ? '' : undefined,
    },
  }
}
