/**
 * dsh-workflow-lite — 动效工具里不止一个文件要用的几样：「减少动态效果」查询、两条缓动曲线、
 * 删掉的项留下的影子的登记、「看得见吗」的判断、退场的位移 / 透明度动画。
 *
 * 只放被多个动效文件共用的东西；只有一个文件用的留在那个文件里。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/shared
 */

/** 「减少动态效果」：查询对象只建一次，读它的实时值。 */
export const REDUCED = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null

export const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** 视口坐标里 `top` 起、`height` 高的一块，和 `band` 有交集吗。 */
export function seen(band: [number, number], top: number, height: number): boolean {
  return top + height >= band[0] && top <= band[1]
}

/** 删掉的项留下的影子：列表再量各项时跳过它们。 */
export const leaving = new WeakSet<Element>()

/**
 * 退场：位移、缩放缓出，透明度匀速——透明度也缓出的话一开始就掉光，看着像一下没了。
 * 返回透明度那段（放完就看不见了，拿它当删影子的时机）。
 */
export function fadeAway(
  target: Element,
  from: { opacity: number; transform: string },
  to: string,
  ms: number,
): Animation {
  target.animate([{ transform: from.transform }, { transform: to }], {
    duration: ms,
    easing: EASE_OUT,
    fill: 'forwards',
  })
  return target.animate([{ opacity: from.opacity }, { opacity: 0 }], {
    duration: ms,
    easing: 'linear',
    fill: 'forwards',
  })
}

const EASE_OUT_CURVE = [0.22, 1, 0.36, 1] as const

/** 「平滑减速」：一开始就走得快，尾巴轻轻落定。 */
export const EASE_OUT = `cubic-bezier(${EASE_OUT_CURVE.join(', ')})`

/** {@link EASE_OUT} 在时间进度 `t`（0…1）上的值：要知道动画此刻走到哪、又不想让浏览器当场算样式时自己算。 */
export const easeOutAt = bezierAt(...EASE_OUT_CURVE)

/** `cubic-bezier(x1, y1, x2, y2)` 在时间进度上的值（先解出 x = t 的参数，再取 y）。 */
export function bezierAt(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const axis = (a: number, b: number, s: number): number =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    let low = 0
    let high = 1
    let s = t
    for (let i = 0; i < 30; i++) {
      const x = axis(x1, x2, s)
      if (Math.abs(x - t) < 1e-6) break
      if (x < t) low = s
      else high = s
      s = (low + high) / 2
    }
    return axis(y1, y2, s)
  }
}

/**
 * 这一帧画完之后再跑（下一帧开始前的一个任务里）：这时版面已经算好，读位置、尺寸、`getAnimations()` 是现成的，
 * 不逼浏览器当场重算。提交里（layout effect、回调 ref、紧跟着的 MutationObserver）读版面，
 * 碰上右栏整块换了内容，就是当场把整页样式、排版算一遍（控制台报 Forced reflow）。返回取消函数。
 */
export function afterPaint(run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(run, 0)
  })
  return () => {
    cancelAnimationFrame(frame)
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * 这一帧排完版之后、画出来之前跑（一次性的 ResizeObserver：开始观察时它在这一帧排完版后回调一次）：
 * 读位置是现成的，放的动画、改的东西这一帧就画出来，不晚一帧。`el` 量不到大小（没显示、0×0）时不回调，
 * 退到画完之后（{@link afterPaint}）。返回取消函数。
 */
export function afterLayout(el: Element, run: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return afterPaint(run)
  let done = false
  const once = (): void => {
    if (done) return
    done = true
    sizes.disconnect()
    late()
    run()
  }
  const sizes = new ResizeObserver(once)
  sizes.observe(el)
  const late = afterPaint(once)
  return () => {
    done = true
    sizes.disconnect()
    late()
  }
}
