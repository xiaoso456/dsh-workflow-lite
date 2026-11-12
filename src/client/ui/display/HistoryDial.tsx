/**
 * dsh-workflow-lite — 展示卡底边外的各轮产出刻度盘（{@link HistoryBar} 挂进卡片的时间线位置）。
 *
 * 像相机拨盘：正中不动，刻度尺在下面滑。一版一道主刻度，正对正中的那道是强调色（没有另外的指针），
 * 离正中越近的刻度越高越亮，两头渐隐；主刻度头上一颗判定色小点，下面每轮第一版写轮次。下面一行写这一版叫什么。
 *
 * 交互：悬停一道刻度只预览（移开回到钉住的那版）；点一下、按住拖（松手吸附到最近一版）、滚轮、方向键 / Home / End 才换版钉住。
 * 尺子的位置、放大区由 {@link useDialMotion} 逐帧写，这里只渲染一次刻度。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/HistoryDial
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { T } from '../../i18n.ts'
import { DIAL_GAP, DIAL_WHEEL_STEP, dialMarks, nearest, rubber } from '../../model/dial.ts'
import { type HistoryLine, roundMarks, toneWord } from '../../model/outputHistory.ts'
import { shortTime } from '../../model/time.ts'
import { cx } from '../kit/cx.ts'
import { SwapText, useTrend } from '../motion/swapText.tsx'
import shared from './display.module.css'
import css from './historyDial.module.css'
import { useDialMotion } from './useDialMotion.ts'

/** 按下后挪过这么多（px）才算拖，不然是点。 */
const DRAG_SLOP = 3

/** 滚轮停这么久（ms）再滚算新的一段。 */
const WHEEL_IDLE_MS = 220

interface Drag {
  pointer: number
  x: number
  from: number
  moved: boolean
  /** 按下时指着哪道主刻度（点一下就钉住它）。 */
  hit: number | null
  /** 屏幕像素 ÷ 刻度盘自己的像素（画布缩放）。 */
  scale: number
}

export function HistoryDial(props: {
  t: T
  line: HistoryLine
  /** 每一点叫什么（最后一点叫「最新」）。 */
  labels: readonly string[]
  /** 卡片里现在显示的是第几点（含悬停预览；连续换版时等停下才跟上）。 */
  current: number
  /** 现在显示的是悬停预览。 */
  previewing: boolean
  /** 钉住的是第几点（没钉 = 最后一点）。 */
  pinnedAt: number
  /** 钉着旧版的时候又来了新的一版。 */
  newer: boolean
  /** 悬停预览：给 `undefined` 是不预览了。 */
  onPreview(v: number | null | undefined): void
  onPin(v: number | null): void
}): React.JSX.Element {
  const { t, line, labels, current, pinnedAt } = props
  const count = line.dots.length
  const marks = useMemo(() => dialMarks(count), [count])
  const rounds = useMemo(() => roundMarks(t, line), [t, line])
  const dir = useTrend(current)
  const [hover, setHover] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<Drag | null>(null)
  const win = useRef<HTMLDivElement>(null)
  /**
   * 刚在刻度盘上换了版（点、拖、滚轮、键盘）：尺子会在不动的指针底下滑过去，指针下换成了别的刻度。
   * 这时不算悬停，等指针真的挪了再预览，不然一点完卡里就跳到旁边那版去了。
   */
  const still = useRef(false)

  // 事件里要读最新的一份（滚轮的原生监听只挂一次）。
  const latest = useRef(props)
  latest.current = props
  const pinAt = (index: number): void => {
    still.current = true
    setHover(null)
    const { line: now, onPin } = latest.current
    const dot = now.dots[Math.max(0, Math.min(now.dots.length - 1, index))]
    if (dot !== undefined) onPin(dot.v)
  }

  const motion = useDialMotion(count, (index) => {
    // 拖动时正中对着哪版，卡里就临时换成哪版。
    if (drag.current?.moved !== true) return
    const dot = latest.current.line.dots[index]
    if (dot !== undefined) latest.current.onPreview(dot.v)
  })

  // 钉住的那版变了（点、键盘、标题行的列表、来了新的一版）：尺子按弹簧滑过去；初次挂上直接放好。
  const placed = useRef(false)
  useLayoutEffect(() => {
    if (drag.current?.moved === true) return
    if (!placed.current) {
      placed.current = true
      motion.jump(pinnedAt)
    } else {
      motion.glide(pinnedAt)
    }
  }, [pinnedAt, count])

  // 滚轮换版：原生监听（React 的 wheel 是被动的）。刻度盘带 `nowheel`，画布的滚轮缩放不管这里；
  // 按着 Ctrl / ⌘ 的（触控板捏合）也只拦下来，不然落到浏览器上就是整页缩放。
  // 只挂一次，事件里读 latest。
  useEffect(() => {
    const element = win.current
    if (element === null) return
    // 一段滚动的第一下立刻换一版（各家鼠标一格的量差得多），之后攒够 DIAL_WHEEL_STEP 再换下一版（触控板）。
    let sum = 0
    let last = Number.NEGATIVE_INFINITY
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.ctrlKey || event.metaKey) return
      const unit = event.deltaMode === 1 ? 16 : 1
      const delta =
        (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit
      if (delta === 0) return
      const now = performance.now()
      const fresh = now - last > WHEEL_IDLE_MS
      last = now
      if (fresh) sum = 0
      else {
        sum += delta
        if (Math.abs(sum) < DIAL_WHEEL_STEP) return
      }
      const step = Math.sign(fresh ? delta : sum)
      sum = 0
      pinAt(latest.current.pinnedAt + step)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [])

  const hoverAt = (index: number | null): void => {
    if (drag.current !== null || index === hover) return
    setHover(index)
    // 悬停在钉住的那道上就是不预览（标题行不该显示成「预览中」）。
    const dot = index === null || index === pinnedAt ? undefined : line.dots[index]
    props.onPreview(dot === undefined ? undefined : dot.v)
  }
  const tickOf = (target: EventTarget): number | null => {
    const mark = (target as Element).closest?.<HTMLElement>('[data-major]')
    return mark === null || mark === undefined ? null : Number(mark.dataset.major)
  }

  const shownDot = line.dots[current]
  const tone = shownDot?.tone ?? undefined
  const at = shownDot?.version?.at
  const stop = (event: React.SyntheticEvent): void => event.stopPropagation()

  return (
    // 时间线在节点里：点击、双击、按键都别落到卡片上（会改选中、打开查看框、挪卡片）。
    // biome-ignore lint/a11y/noStaticElementInteractions: 只是截住冒泡
    <div
      className={cx(shared.historyTimeline, 'nodrag', 'nopan')}
      data-testid="wl-display-history-timeline"
      onClick={stop}
      onDoubleClick={stop}
      onKeyDown={(event) => {
        // Ctrl/⌘+S（保存实例里的改动）照常往外走。
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') return
        event.stopPropagation()
        const next: Record<string, number> = {
          ArrowLeft: pinnedAt - 1,
          ArrowRight: pinnedAt + 1,
          Home: 0,
          End: count - 1,
        }
        const to = next[event.key]
        if (to === undefined) return
        // 方向键别冒到画布上（会挪选中的卡片）。
        event.preventDefault()
        pinAt(to)
      }}
    >
      <div className={css.dial}>
        <div
          ref={win}
          className={cx(css.window, 'nowheel')}
          role="slider"
          tabIndex={0}
          aria-label={t('history.title')}
          aria-valuemin={1}
          aria-valuemax={count}
          aria-valuenow={pinnedAt + 1}
          aria-valuetext={labels[pinnedAt]}
          data-drag={dragging || undefined}
          data-testid="wl-display-history-track"
          onPointerDown={(event) => {
            if (event.button !== 0) return
            const box = event.currentTarget
            drag.current = {
              pointer: event.pointerId,
              x: event.clientX,
              from: motion.at(),
              moved: false,
              hit: tickOf(event.target),
              scale: box.getBoundingClientRect().width / (box.offsetWidth || 1),
            }
            box.setPointerCapture(event.pointerId)
          }}
          onPointerMove={(event) => {
            const now = drag.current
            if (now === null) {
              // 悬停：命中区首尾相接，指针总在某一道上；挪到头尾外面就停在最后指着的那道。
              if (event.movementX !== 0 || event.movementY !== 0) still.current = false
              const tick = tickOf(event.target)
              if (!still.current && tick !== null) hoverAt(tick)
              return
            }
            if (now.pointer !== event.pointerId) return
            const dx = (event.clientX - now.x) / now.scale
            if (!now.moved) {
              if (Math.abs(dx) < DRAG_SLOP) return
              now.moved = true
              setDragging(true)
              setHover(null)
            }
            // 抓着尺子拖：往右拖露出左边（更早）的版。
            motion.jump(rubber(now.from - dx / DIAL_GAP, count))
          }}
          onPointerUp={(event) => {
            const now = drag.current
            if (now === null || now.pointer !== event.pointerId) return
            drag.current = null
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId)
            }
            if (now.moved) {
              setDragging(false)
              const to = nearest(motion.at(), count)
              // 松手停在原来那版上时钉住的位置没变，自己滑回去。
              motion.glide(to)
              pinAt(to)
            } else if (now.hit !== null) {
              pinAt(now.hit)
            }
          }}
          onPointerCancel={() => {
            drag.current = null
            setDragging(false)
            motion.glide(latest.current.pinnedAt)
          }}
          onPointerLeave={() => {
            still.current = false
            hoverAt(null)
          }}
        >
          <span className={css.lens} aria-hidden="true" />
          <div ref={motion.ruler} className={css.ruler} aria-hidden="true">
            {marks.map((mark, index) => {
              if (mark.major === null) {
                return (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: 刻度只按位置排，个数变了整排重来
                    key={index}
                    className={css.mark}
                    data-mark
                    data-x={mark.x}
                    style={{ left: `${mark.x * DIAL_GAP}px` }}
                  >
                    <span className={css.tick} data-part="tick" />
                  </span>
                )
              }
              const i = mark.major
              const dot = line.dots[i]
              const round = rounds[i]
              return (
                <span
                  // 按位置当 key：「最新」那点的身份会随文件更新变，换 key 就是插拔元素（见 useDialMotion）。
                  // biome-ignore lint/suspicious/noArrayIndexKey: 同上
                  key={index}
                  className={css.mark}
                  data-mark
                  data-x={mark.x}
                  data-major={i}
                  data-tone={dot?.tone ?? undefined}
                  data-live={dot?.v === null || undefined}
                  data-new={(props.newer && i === count - 1) || undefined}
                  data-hover={(hover === i && i !== pinnedAt) || undefined}
                  data-testid="wl-display-history-dot"
                  style={{ left: `${mark.x * DIAL_GAP}px` }}
                >
                  <span className={css.bob} data-part="bob">
                    <span className={css.tick} data-part="tick" />
                    {(dot?.tone != null || dot?.v === null) && (
                      <span className={css.dot} data-part="dot" />
                    )}
                  </span>
                  {round !== null && round !== undefined && (
                    <span className={css.label} data-part="label">
                      {round}
                    </span>
                  )}
                  <span className={css.hit} />
                </span>
              )
            })}
          </div>
        </div>
        <div
          className={css.caption}
          data-tone={tone}
          data-hovering={(props.previewing && !dragging) || undefined}
          data-testid="wl-display-history-caption"
          aria-hidden="true"
        >
          <span className={css.name}>
            <SwapText text={labels[current] ?? ''} dir={dir} />
          </span>
          {tone !== undefined && <span className={css.verdict}>{toneWord(t, tone)}</span>}
          {at !== undefined && <span className={css.time}>{shortTime(at)}</span>}
          <span className={css.count}>
            {current + 1}/{count}
          </span>
        </div>
      </div>
    </div>
  )
}
