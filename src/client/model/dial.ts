/**
 * dsh-workflow-lite — 刻度盘的几何与手感：展示卡的各轮产出时间线（`ui/display/HistoryDial.tsx`）照这里算。
 *
 * 刻度盘：正中不动，刻度尺在下面滑；一版一道主刻度，两道之间几道小刻度，两头再各延出一截渐隐的小刻度。
 * 位置 `pos` 是「第几版」的连续值（0 = 第一版），拖动时停在两版之间，松手吸附到最近一版。
 * 离正中越近的刻度越高、越亮（放大镜区）；滑过去用一根略欠阻尼的弹簧，停下前轻轻过冲。
 *
 * 全是纯函数：组件每帧只拿结果去写 transform / opacity。
 *
 * @module @xiaoso/dsh-workflow-lite/client/model/dial
 */

/** 相邻两版主刻度隔多远（px，未缩放的画布坐标）。 */
export const DIAL_GAP = 56

/** 两版之间几道小刻度。 */
export const DIAL_MINORS = 4

/** 头尾外面各延出几道小刻度（拨到头时刻度不显得断）。 */
export const DIAL_TAIL = 7

/** 拖出头尾时只跟手这么多（橡皮筋）。 */
const RUBBER = 0.3

/** 一道刻度：`x` 以「版」为单位；主刻度带它是第几版，小刻度是 `null`。 */
export interface DialMark {
  x: number
  major: number | null
}

/** 共 `count` 版时的全部刻度，从左到右。 */
export function dialMarks(count: number): DialMark[] {
  if (count < 1) return []
  const step = DIAL_MINORS + 1
  const last = (count - 1) * step
  const marks: DialMark[] = []
  for (let k = -DIAL_TAIL; k <= last + DIAL_TAIL; k += 1) {
    const major = k >= 0 && k <= last && k % step === 0
    marks.push({ x: k / step, major: major ? k / step : null })
  }
  return marks
}

/** 一道刻度此刻的样子：横纵缩放、透明度，和它在放大区里的程度（0–1，标签跟着用）。 */
export interface TickLook {
  sx: number
  sy: number
  opacity: number
  lens: number
}

/** 放大区的半宽（px，高斯的 σ）。 */
const LENS_PX = 34
/** 透明度从正中往两边落下去的半宽（px）。 */
const FADE_PX = 90

/**
 * 离正中 `distance` px 的刻度长什么样。主刻度最多高到 2 倍，小刻度本来短，放大得多一些（2.6 倍），
 * 正中附近的小刻度和主刻度差不多高，像表冠上被放大的那一段。
 */
export function tickLook(distance: number, major: boolean): TickLook {
  const lens = Math.exp(-((distance / LENS_PX) ** 2))
  return {
    sx: 1 + 0.35 * lens,
    sy: major ? 1 + lens : 1 + 1.6 * lens,
    opacity: 0.3 + 0.7 * Math.exp(-((distance / FADE_PX) ** 2)),
    lens,
  }
}

/** 最近的一版。 */
export function nearest(pos: number, count: number): number {
  return Math.max(0, Math.min(count - 1, Math.round(pos)))
}

/** 拖出头尾：超出的部分只跟三成，松手弹回去。 */
export function rubber(pos: number, count: number): number {
  const end = count - 1
  if (pos < 0) return pos * RUBBER
  if (pos > end) return end + (pos - end) * RUBBER
  return pos
}

export interface Spring {
  pos: number
  vel: number
}

/** 刚度与阻尼比：阻尼比略小于 1，停下前过冲一点点，像拨盘落进齿里。 */
const STIFFNESS = 260
const DAMPING_RATIO = 0.78

/** 弹簧往 `target` 走 `dt` 秒（半隐式欧拉；`dt` 由调用方封顶，掉帧时不至于飞出去）。 */
export function springStep(spring: Spring, target: number, dt: number): Spring {
  const damping = 2 * Math.sqrt(STIFFNESS) * DAMPING_RATIO
  const vel = spring.vel + (-(spring.pos - target) * STIFFNESS - spring.vel * damping) * dt
  return { pos: spring.pos + vel * dt, vel }
}

/** 停稳了：离目标、速度都小到看不出来。 */
export function springAtRest(spring: Spring, target: number): boolean {
  return Math.abs(spring.pos - target) < 0.0015 && Math.abs(spring.vel) < 0.01
}

/** 一段滚动里第一下之后，攒够这么多（px）再走一版：触控板的细碎滚动攒起来再走。 */
export const DIAL_WHEEL_STEP = 60
