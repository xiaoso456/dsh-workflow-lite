/**
 * dsh-workflow-lite — 刻度盘的动：把 `model/dial.ts` 算出来的位置、放大区逐帧写到刻度上。
 *
 * 只写 transform / opacity 和一两个 data 属性，不经过 React 重渲染，也不插拔元素（宿主页面有条 `:has` 规则，
 * 插拔一次就整页重算样式）。刻度元素由组件渲染，这里按 `[data-mark]` 找出来，每道记着上一回写的值，没变就不写：
 * 离正中远的刻度很快收敛到同一个样子，之后每帧只动正中附近那十几道。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/useDialMotion
 */

import { type RefCallback, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import {
  DIAL_GAP,
  nearest,
  type Spring,
  springAtRest,
  springStep,
  tickLook,
} from '../../model/dial.ts'
import { REDUCED } from '../motion/shared.ts'

/** 主刻度的高（px），和 historyDial.module.css 里 `.mark[data-major] .tick` 的 height 一致：判定点跟着刻度顶抬高。 */
const MAJOR_TICK_PX = 10

/** 一帧最多走这么久（秒）：掉帧、切走标签页回来时弹簧不至于飞出去。 */
const MAX_DT = 0.032

interface MarkNode {
  root: HTMLElement
  tick: HTMLElement
  dot: HTMLElement | null
  label: HTMLElement | null
  bob: HTMLElement | null
  x: number
  major: number | null
  /** 上一回写下的值，没变就不写。 */
  last: string
}

export interface DialMotion {
  /** 挂在刻度尺上（刻度是它的子元素，带 `data-mark` 和 `data-x`）。 */
  ruler: RefCallback<HTMLElement>
  /** 现在停在哪（第几版的连续值）。 */
  at(): number
  /** 立刻到这里（拖动时跟手）；正在走的弹簧停下。 */
  jump(pos: number): void
  /** 按弹簧走到这一版；「减少动态效果」时直接到。 */
  glide(to: number): void
}

/**
 * @param count - 共几版（刻度变了要重新找一遍刻度元素）。
 * @param onIndex - 正中对着的那一版变了（拖动时用来预览）。
 */
export function useDialMotion(count: number, onIndex: (index: number) => void): DialMotion {
  const rulerEl = useRef<HTMLElement | null>(null)
  const marks = useRef<MarkNode[]>([])
  const state = useRef({
    pos: 0,
    vel: 0,
    target: 0,
    raf: 0,
    last: 0,
    index: -1,
    settled: -1,
    flip: false,
  })
  const report = useRef(onIndex)
  report.current = onIndex

  const apply = useCallback((): void => {
    const s = state.current
    const ruler = rulerEl.current
    if (ruler === null) return
    ruler.style.transform = `translate3d(${(-s.pos * DIAL_GAP).toFixed(2)}px, 0, 0)`
    for (const mark of marks.current) {
      const look = tickLook(Math.abs(mark.x - s.pos) * DIAL_GAP, mark.major !== null)
      const key = `${look.sx.toFixed(3)} ${look.sy.toFixed(3)} ${look.opacity.toFixed(3)}`
      if (key === mark.last) continue
      mark.last = key
      mark.tick.style.transform = `scale(${look.sx.toFixed(3)}, ${look.sy.toFixed(3)})`
      mark.tick.style.opacity = look.opacity.toFixed(3)
      if (mark.dot !== null) {
        mark.dot.style.transform = `translateY(${(-(look.sy - 1) * MAJOR_TICK_PX).toFixed(2)}px)`
      }
      if (mark.label !== null) {
        mark.label.style.opacity = (0.5 + 0.5 * look.lens).toFixed(3)
        mark.label.style.transform = `translateX(-50%) scale(${(0.92 + 0.12 * look.lens).toFixed(3)})`
      }
    }
    const index = nearest(s.pos, count)
    if (index !== s.index) {
      s.index = index
      for (const mark of marks.current) {
        if (mark.major !== null) mark.root.toggleAttribute('data-cur', mark.major === index)
      }
      report.current(index)
    }
  }, [count])

  /** 停稳在一版上：那道刻度轻轻一跳（两套同样的关键帧轮流换名字，不用强制回流就能重放）。 */
  const snap = useCallback((index: number): void => {
    const s = state.current
    if (index === s.settled) return
    s.settled = index
    const bob = marks.current.find((mark) => mark.major === index)?.bob
    if (bob === null || bob === undefined || REDUCED?.matches === true) return
    s.flip = !s.flip
    bob.dataset.snap = s.flip ? 'a' : 'b'
  }, [])

  const stop = (): void => {
    const s = state.current
    if (s.raf !== 0) cancelAnimationFrame(s.raf)
    s.raf = 0
  }

  const frame = useCallback(
    (now: number): void => {
      const s = state.current
      const dt = Math.min(MAX_DT, (now - s.last) / 1000 || 1 / 60)
      s.last = now
      const next: Spring = springStep(s, s.target, dt)
      s.pos = next.pos
      s.vel = next.vel
      if (springAtRest(s, s.target)) {
        s.pos = s.target
        s.vel = 0
        s.raf = 0
        apply()
        if (Number.isInteger(s.target)) snap(s.target)
        return
      }
      apply()
      s.raf = requestAnimationFrame(frame)
    },
    [apply, snap],
  )

  // 刻度变了（多了一版）：重新找刻度元素，照现在的位置画一遍。
  useLayoutEffect(() => {
    const ruler = rulerEl.current
    if (ruler === null) return
    marks.current = [...ruler.querySelectorAll<HTMLElement>('[data-mark]')].map((root) => ({
      root,
      tick: root.querySelector<HTMLElement>('[data-part="tick"]') as HTMLElement,
      dot: root.querySelector<HTMLElement>('[data-part="dot"]'),
      label: root.querySelector<HTMLElement>('[data-part="label"]'),
      bob: root.querySelector<HTMLElement>('[data-part="bob"]'),
      x: Number(root.dataset.x),
      major: root.dataset.major === undefined ? null : Number(root.dataset.major),
      last: '',
    }))
    state.current.index = -1
    apply()
  }, [apply, count])

  useEffect(() => stop, [])

  const ruler = useCallback<RefCallback<HTMLElement>>((element) => {
    rulerEl.current = element
  }, [])

  return {
    ruler,
    at: () => state.current.pos,
    jump: (pos) => {
      stop()
      const s = state.current
      s.pos = pos
      s.target = pos
      s.vel = 0
      // 直接放在某一版上（初次挂上）算已经停稳，之后弹簧回到这一版不再跳一下。
      s.settled = Number.isInteger(pos) ? pos : -1
      apply()
    },
    glide: (to) => {
      const s = state.current
      s.target = to
      if (REDUCED?.matches === true) {
        stop()
        s.pos = to
        s.vel = 0
        apply()
        snap(to)
        return
      }
      if (s.raf === 0) {
        s.last = performance.now()
        s.raf = requestAnimationFrame(frame)
      }
    },
  }
}
