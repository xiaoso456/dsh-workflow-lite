/**
 * dsh-workflow-lite — 「进程」图里按时间摆的小件（一段条、横轴上的一个时刻）换位置、出现、消失时怎么动。
 *
 * 位置是父元素宽度的百分比（`left` / `width` 写在 style 里），换一个实例、时间往前走、一步做完时会变：
 * - 同一个小件换了位置、长短：从旧的样子滑到新的样子（`translate` + 从左边起的 `scale`），不跳；
 *   列表换了一项时（{@link SwapScope}）照切换的节奏，和右栏别的字一起；
 * - 图已经在了之后新冒出来的小件：条从左端长出来，时刻淡入。刚挂上时（整张图一起出来）不动；
 * - 没了的小件（换到的实例这一步段数少、刻度少）：不卸掉，原地缩回左端 / 淡出，之后透明地留着（`data-gone`）；
 *   下次又要用到这个位置时再长出来（`data-back`）。所以条、刻度的个数只增不减（{@link useSlots}）：
 *   卸掉就没法放退场，而且视图里插拔元素会让整页样式重算，换属性不会。
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
  /** 最后一次在用时的位置（没了之后停在这里退场）。 */
  spot: GanttSpot
  /** 最近一次变化：挪了位置 / 没了 / 又用上了；`null` = 挂上之后没变过。 */
  kind: 'move' | 'gone' | 'back' | null
  /** 挪了几次（a / b 换着放）。 */
  n: number
  from: { x: number; scale: number }
  /** 这次变化是列表换了一项（照切换的节奏）。 */
  switched: boolean
}

/** 宽度比旧的差太多（几乎为 0 的一段）时不按比例缩放：一段细线放大几十倍再缩回来，看着是闪。 */
const MAX_SCALE = 20

/**
 * 一个小件这次怎么动：返回要合进去的 style（位置和起点变量）和属性。
 * `spot` 为 `null` = 这个位置这次没有东西（放退场，停在上一次的位置）。
 * `enter`：挂上时图已经在了（新冒出来的），放进场。
 */
export function useGanttSpot(
  spot: GanttSpot | null,
  enter: boolean,
): { style: CSSProperties; attrs: Record<string, string | undefined>; gone: boolean } {
  const swap = useSwapSwitch()
  const [born] = useState(enter)
  // 换一项时新冒出来的：和又用上的一样照切换的节奏长出来（等旧的字、「还没开始」先退）。
  const [moving, setMoving] = useState<Moving>(() => {
    const switched = enter && switching(swap)
    return {
      spot: spot ?? { left: 0 },
      kind: switched ? 'back' : null,
      n: 0,
      from: { x: 0, scale: 1 },
      switched,
    }
  })
  const gone = moving.kind === 'gone'
  if (spot === null) {
    if (!gone) setMoving({ ...moving, kind: 'gone', switched: switching(swap) })
  } else if (gone) {
    setMoving({ ...moving, spot, kind: 'back', switched: switching(swap) })
  } else if (moving.spot.left !== spot.left || moving.spot.width !== spot.width) {
    const was = moving.spot
    const ratio =
      spot.width === undefined || was.width === undefined || spot.width <= 0
        ? 1
        : was.width / spot.width
    setMoving({
      spot,
      kind: 'move',
      n: moving.n + 1,
      from: { x: was.left - spot.left, scale: Math.min(MAX_SCALE, Math.max(0, ratio)) },
      switched: switching(swap),
    })
  }
  const at = moving.spot
  return {
    style: {
      left: `${String(at.left)}%`,
      ...(at.width === undefined ? {} : { width: `${String(at.width)}%` }),
      ...(moving.kind === 'move'
        ? { '--gx': String(moving.from.x), '--gs': String(moving.from.scale) }
        : {}),
    } as CSSProperties,
    attrs: {
      'data-born': born ? '' : undefined,
      'data-move': moving.kind === 'move' ? (moving.n % 2 === 1 ? 'a' : 'b') : undefined,
      'data-gone': gone ? '' : undefined,
      'data-back': moving.kind === 'back' ? '' : undefined,
      'data-move-switch': moving.kind !== null && moving.switched ? '' : undefined,
    },
    gone,
  }
}

/** 一组小件占几个位置：只增不减（少了的位置留着放退场，之后透明地留着）。 */
export function useSlots(count: number): number {
  const [slots, setSlots] = useState(count)
  if (count > slots) setSlots(count)
  return Math.max(slots, count)
}

/** 一个开关挂上之后变过没有：变过才放显隐的动画（刚挂上时照原样出来）。 */
export function useToggled(on: boolean): boolean {
  const [first] = useState(on)
  const [toggled, setToggled] = useState(false)
  if (!toggled && on !== first) setToggled(true)
  return toggled || on !== first
}

/** 小件没了之后还要画的东西（颜色、字）：留着最后一次在用时的那份。 */
export function useLast<V>(value: V | undefined, initial: V): V {
  const [last, setLast] = useState<V>(value ?? initial)
  if (value !== undefined && value !== last) setLast(value)
  return value ?? last
}
