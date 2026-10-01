/**
 * dsh-workflow-lite — 连线上"流动"的光带：选中步骤/文件时，沿着和它相连的线按数据的方向走。
 *
 * 一道光带是一串紧挨着的小圆点（头大尾小、头亮尾淡），每个点都**在线上**走、只是比前一个
 * 晚出发一点点——所以光带永远贴着曲线弯，也不会伸出线的两头压到卡片上。每个点走到线的两头
 * 时各自淡入淡出：光带是从端点里"长出来"、再"没进"另一头的。颜色永远跟所在的线一致。
 *
 * 只动 `transform` 与 `opacity`，交给合成线程跑，不占主线程、不触发重绘：
 * - 用一条不可见的 SVG 路径量出整条线，按长度等距取点，算出每点的位移与透明度；
 * - 每个点外层的 HTML 元素用 Web Animations 按这些点做 `translate` 关键帧（里层只管大小和颜色）；
 * - 线变了（拖动卡片）只换关键帧，动画进度不重来；
 * - 线"活"起来时整组淡入，不再活时整组淡出后才卸载——不会突然出现、突然消失。
 *
 * 系统设了「减少动态效果」就什么都不画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FlowStreaks
 */

import { EdgeLabelRenderer } from '@xyflow/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import css from './canvas.module.css'

/** 一条线上最多几道光带；短线只放一道。 */
const MAX_STREAKS = 2
/** 每多这么长放一道。 */
const SPACING = 200
/** 一道光带由几个点组成、点与点沿线相隔多远（画布像素）。 */
const TRAIL = 16
const TRAIL_GAP = 1.7
/** 沿线走的速度（画布像素 / 秒）与一圈的时长上下限。 */
const SPEED = 110
const MIN_MS = 1300
const MAX_MS = 5000
/** 端点处淡入淡出的长度（画布像素）。 */
const FADE = 22
/** 整组淡出用多久（与 CSS 里 `.streaks` 的过渡一致），之后才卸载。 */
const LEAVE_MS = 320

function reducedMotion(): boolean {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** 光带里第 `index` 个点（0 = 头）的大小与透明度：头大尾小、头亮尾淡。 */
function dotStyle(index: number): React.CSSProperties {
  const t = index / (TRAIL - 1)
  // 点比间距大，相邻的点互相压住，连成一条渐细的光带而不是一串珠子。
  const size = 5 - 3 * t
  return { width: size, height: size, margin: -size / 2, opacity: 1 - 0.9 * t * t }
}

/** 沿路径等距取点，带上两头的淡入淡出。 */
function sample(path: SVGPathElement, length: number): Keyframe[] {
  const count = Math.max(16, Math.min(72, Math.round(length / 8)))
  const fade = Math.min(FADE, length / 3)
  const frames: Keyframe[] = []
  for (let index = 0; index < count; index += 1) {
    const at = (length * index) / (count - 1)
    const point = path.getPointAtLength(at)
    frames.push({
      offset: index / (count - 1),
      transform: `translate(${point.x}px, ${point.y}px)`,
      opacity: Math.max(0, Math.min(1, at / fade, (length - at) / fade)),
    })
  }
  return frames
}

export function FlowStreaks(props: {
  path: string
  /** 光带颜色：必须和这条线此刻的描边色一致（通常是一个 `var(--wl-…)`）。 */
  color: string
  /** 线是不是"活"的。变成 `false` 后先淡出、再卸载。 */
  active: boolean
}): React.JSX.Element | null {
  const still = reducedMotion()
  const [mounted, setMounted] = useState(props.active)
  useEffect(() => {
    if (props.active) {
      setMounted(true)
      return
    }
    const timer = setTimeout(() => setMounted(false), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [props.active])
  if (still || !mounted) return null
  return <Trail path={props.path} color={props.color} leaving={!props.active} />
}

function Trail(props: { path: string; color: string; leaving: boolean }): React.JSX.Element {
  const probe = useRef<SVGPathElement>(null)
  const dots = useRef<(HTMLSpanElement | null)[]>([])
  const running = useRef<(Animation | null)[]>([])

  useLayoutEffect(() => {
    const path = probe.current
    if (path === null) return
    const length = path.getTotalLength()
    if (!(length > 0)) return
    const streaks = Math.max(1, Math.min(MAX_STREAKS, Math.round(length / SPACING)))
    const duration = Math.min(MAX_MS, Math.max(MIN_MS, (length / SPEED) * 1000))
    const lag = (TRAIL_GAP / SPEED) * 1000
    const frames = sample(path, length)
    for (let streak = 0; streak < MAX_STREAKS; streak += 1) {
      for (let index = 0; index < TRAIL; index += 1) {
        const slot = streak * TRAIL + index
        const dot = dots.current[slot]
        const current = running.current[slot] ?? null
        if (dot === null || dot === undefined || streak >= streaks) {
          current?.cancel()
          running.current[slot] = null
          continue
        }
        // 全是负的延迟：一挂上去就在半路，第 index 个点比头晚 index 个间隔。
        const delay = index * lag - (duration * streak) / streaks - duration
        const effect = current?.effect
        if (current !== null && effect instanceof KeyframeEffect) {
          effect.setKeyframes(frames)
          effect.updateTiming({ duration, delay })
          continue
        }
        running.current[slot] = dot.animate(frames, {
          duration,
          delay,
          iterations: Number.POSITIVE_INFINITY,
          easing: 'linear',
        })
      }
    }
  }, [props.path])

  useLayoutEffect(
    () => () => {
      for (const animation of running.current) animation?.cancel()
      running.current = []
    },
    [],
  )

  return (
    <EdgeLabelRenderer>
      <div
        className={css.streaks}
        data-leaving={props.leaving}
        style={{ '--wl-streak': props.color } as React.CSSProperties}
      >
        <svg className={css.probe} aria-hidden="true">
          <path ref={probe} d={props.path} />
        </svg>
        {Array.from({ length: MAX_STREAKS * TRAIL }, (_, slot) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: 点是固定的槽位，下标就是身份
            key={slot}
            ref={(element) => {
              dots.current[slot] = element
            }}
            className={css.streakDot}
            data-testid={slot % TRAIL === 0 ? 'wl-flow-streak' : undefined}
          >
            <span style={dotStyle(slot % TRAIL)} />
          </span>
        ))}
      </div>
    </EdgeLabelRenderer>
  )
}
