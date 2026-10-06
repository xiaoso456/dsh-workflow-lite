/**
 * dsh-workflow-lite — 连线上"流动"的光带：选中步骤/文件时，沿着和它相连的线按数据的方向走。
 *
 * 一道光带是一串紧挨着的小圆点（头大尾小、头亮尾淡），每个点都**在线上**走、只是比前一个
 * 晚出发一点点——所以光带永远贴着曲线弯，也不会伸出线的两头压到卡片上。每个点走到线的两头
 * 时各自淡入淡出：光带是从端点里"长出来"、再"没进"另一头的。颜色永远跟所在的线一致。
 *
 * 只动 `transform` 与 `opacity`，交给合成线程跑，不占主线程、不触发重绘：
 * - 按路径字符串直接算出整条线的长度、等距取点（`model/pathSample.ts`，不碰 DOM），算出每点的位移与透明度；
 * - 每个点外层的 HTML 元素用 Web Animations 按这些点做 `translate` 关键帧（里层只管大小和颜色）；
 *   关键帧每条线只解析一次，各点拷一份再改延迟（逐个 `animate` 要把几十个关键帧各解析一遍，
 *   一条线几十个点，点一下卡片就要卡上几十毫秒）；短线只放一道光带，也只挂一道的点；
 * - 线变了只换关键帧，动画进度不重来；线在连续变（拖卡片时每帧都变）就先把整组淡出、不跟着换，
 *   停下来 {@link SETTLE_MS} 后按最终的线换一次再淡入——每帧给几十个点换关键帧是拖动卡顿的大头；
 * - 拖卡片期间（{@link StreaksMode} 为 `hold`）不看时间间隔，一律藏着、停着，松手才铺：机器一慢、
 *   两帧隔得比 {@link SETTLE_MS} 还久，按时间判断就会每帧都重铺一次，越铺越慢；
 * - 线"活"起来时整组淡入，不再活时整组淡出后才卸载——不会突然出现、突然消失。
 *
 * 点在合成线程上走，平时不占主线程；但只要主线程还在出帧（点卡片后的重渲染、卡片和线的淡入淡出），
 * 每一帧都要把所有在走的点的样式过一遍，点越多越贵。所以点卡片后先等 {@link ENTER_DELAY_MS}，
 * 等那一阵过渡走完再挂上光带；淡出时点停在原地，只让整组淡掉；平移、缩放画布时（每帧都出）点也停在
 * 原地，停手再接着走。停住的动画不用每帧过样式。
 *
 * 系统设了「减少动态效果」就什么都不画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/FlowStreaks
 */

import { EdgeLabelRenderer } from '@xyflow/react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { type MeasuredPath, measurePath } from '../model/pathSample.ts'
import css from './canvas.module.css'

/** 一条线上最多几道光带；短线只放一道。 */
const MAX_STREAKS = 2
/** 每多这么长放一道。 */
const SPACING = 200
/**
 * 一道光带由几个点组成、点与点沿线相隔多远（画布像素）。
 * 点再少就压不住了，尾巴会露出一颗颗的珠子（试过十个点、间隔 2.8）。
 */
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
/** 线"活"起来后等多久才挂光带：卡片、线的淡入淡出（最长 280ms 的光晕）大半走完再上。 */
const ENTER_DELAY_MS = 200
/** 线两次变化隔得比这短就算"正在动"；停下来这么久才按最终的线重新铺点。 */
const SETTLE_MS = 140

/** 「减少动态效果」：查询对象只建一次（每条线每次渲染都 `matchMedia` 一遍也不便宜），读的是它的实时值。 */
const MOTION_QUERY = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null

function reducedMotion(): boolean {
  return MOTION_QUERY?.matches === true
}

/**
 * 画布让光带怎么样：`run` 照常走；`pause` 停在原地（平移、缩放画布时）；
 * `hold` 藏起来停着，松手后再按最终的线铺（拖卡片时）。
 */
export type StreakMode = 'run' | 'pause' | 'hold'
export const StreaksMode = createContext<StreakMode>('run')

/** 这么长的线放几道光带。 */
function streakCount(length: number): number {
  return Math.max(1, Math.min(MAX_STREAKS, Math.round(length / SPACING)))
}

/** 光带里第 `index` 个点（0 = 头）的大小与透明度：头大尾小、头亮尾淡。 */
function dotStyle(index: number): React.CSSProperties {
  const t = index / (TRAIL - 1)
  // 点比间距大，相邻的点互相压住，连成一条渐细的光带而不是一串珠子。
  const size = 5 - 3 * t
  return { width: size, height: size, margin: -size / 2, opacity: 1 - 0.9 * t * t }
}

/** 沿路径等距取点，带上两头的淡入淡出。 */
function sample(path: MeasuredPath): Keyframe[] {
  const { length } = path
  const count = Math.max(16, Math.min(72, Math.round(length / 8)))
  const fade = Math.min(FADE, length / 3)
  return path.sample(count).map((point, index) => ({
    offset: index / (count - 1),
    transform: `translate(${point.x}px, ${point.y}px)`,
    opacity: Math.max(0, Math.min(1, point.at / fade, (length - point.at) / fade)),
  }))
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
    const timer = props.active
      ? setTimeout(() => setMounted(true), ENTER_DELAY_MS)
      : setTimeout(() => setMounted(false), LEAVE_MS)
    return () => clearTimeout(timer)
  }, [props.active])
  if (still || !mounted) return null
  return <Trail path={props.path} color={props.color} leaving={!props.active} />
}

function Trail(props: { path: string; color: string; leaving: boolean }): React.JSX.Element {
  const mode = useContext(StreaksMode)
  const held = mode === 'hold'
  /** 点停在原地：整组在淡出，或画布正在平移、缩放。 */
  const stopped = props.leaving || mode === 'pause'
  /** 挂几道光带的点（按线长；线变长、变短时跟着 `lay` 改）。 */
  const [slots, setSlots] = useState(() => {
    const path = measurePath(props.path)
    return path === null ? 1 : streakCount(path.length)
  })
  const dots = useRef<(HTMLSpanElement | null)[]>([])
  const running = useRef<(Animation | null)[]>([])
  const latest = useRef(props.path)
  latest.current = props.path
  /** 上一次线变的时刻；正在动时等它停下来的定时器。 */
  const changed = useRef(Number.NEGATIVE_INFINITY)
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 拖卡片期间藏起来了（松手后还要等停稳再铺）。 */
  const frozen = useRef(false)
  const [moving, setMoving] = useState(false)
  const stoppedRef = useRef(stopped)
  stoppedRef.current = stopped

  const lay = useCallback((d: string): void => {
    const path = measurePath(d)
    if (path === null) return
    const { length } = path
    const streaks = streakCount(length)
    setSlots(streaks)
    const duration = Math.min(MAX_MS, Math.max(MIN_MS, (length / SPEED) * 1000))
    const lag = (TRAIL_GAP / SPEED) * 1000
    // 关键帧只解析这一次：各点拷一份（拷贝不重新解析），再改各自的延迟。
    const base = new KeyframeEffect(null, sample(path), {
      duration,
      iterations: Number.POSITIVE_INFINITY,
      easing: 'linear',
    })
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
        const effect = new KeyframeEffect(base)
        effect.target = dot
        effect.updateTiming({ delay })
        if (current !== null) {
          // 换效果不换动画：当前进度留着，点接着从原来的位置走。
          current.effect = effect
          continue
        }
        const animation = new Animation(effect, document.timeline)
        animation.play()
        running.current[slot] = animation
      }
    }
    if (stoppedRef.current) for (const animation of running.current) animation?.pause()
  }, [])

  useLayoutEffect(() => {
    const now = performance.now()
    const hide = (): void => {
      setMoving(true)
      for (const animation of running.current) animation?.pause()
    }
    if (held) {
      // 拖卡片中：藏着、停着，线怎么变都不铺。
      changed.current = now
      if (settle.current !== null) {
        clearTimeout(settle.current)
        settle.current = null
      } else if (!frozen.current) {
        hide()
      }
      frozen.current = true
      return
    }
    const rapid = frozen.current || settle.current !== null || now - changed.current < SETTLE_MS
    changed.current = now
    if (!rapid) {
      lay(props.path)
      return
    }
    // 线在连续变（或刚松手）：先淡出、暂停（藏着的点不必再占合成层），停下来再按最终的线铺一次。
    if (settle.current !== null) clearTimeout(settle.current)
    else if (!frozen.current) hide()
    frozen.current = false
    settle.current = setTimeout(() => {
      settle.current = null
      lay(latest.current)
      if (!stoppedRef.current) for (const animation of running.current) animation?.play()
      setMoving(false)
    }, SETTLE_MS)
  }, [props.path, held, lay])

  // 淡出、平移缩放时点停在原地，又活过来 / 停手就接着走（藏着等铺的时候由铺完那一下接着走）。
  useLayoutEffect(() => {
    if (stopped) {
      for (const animation of running.current) animation?.pause()
      return
    }
    if (!frozen.current && settle.current === null) {
      for (const animation of running.current) animation?.play()
    }
  }, [stopped])

  // 线变长、多出一道光带：新挂上的点等这次渲染完才有，这里补上它们的动画（藏着的时候松手再铺）。
  const laidSlots = useRef(slots)
  useLayoutEffect(() => {
    if (laidSlots.current === slots) return
    laidSlots.current = slots
    if (!frozen.current && settle.current === null) lay(latest.current)
  }, [slots, lay])

  useLayoutEffect(
    () => () => {
      if (settle.current !== null) clearTimeout(settle.current)
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
        data-moving={moving}
        style={{ '--wl-streak': props.color } as React.CSSProperties}
      >
        {Array.from({ length: slots * TRAIL }, (_, slot) => (
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
