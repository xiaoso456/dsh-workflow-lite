/**
 * dsh-workflow-lite — 连线上"流动"的光带：选中步骤/文件时，沿着和它相连的线按数据的方向走。
 *
 * 每道光带是一枚渐变短条，头亮尾淡，颜色随线。沿路径取样，按行进方向旋转，在两端收短、淡入淡出。
 *
 * 关键帧只改 `transform` 和 `opacity`。每道光带用一个元素和一个 Web Animations 动画。
 * 线变了只换关键帧，保留动画时间。拖卡片时先隐藏、暂停，停稳后再按最终走线铺。
 * 平移、缩放或弹窗盖住画布时停在原地，结束后接着走。
 *
 * 挂上、卸掉光带本身也贵：宿主页面的 `:has()` 规则让视图里任何一次插拔都把整页样式重算一遍。
 * 所以画布在动的时候（点卡片后挪出右栏、平移、拖卡片）不挂也不卸，停下来再做。
 *
 * 系统设了「减少动态效果」就什么都不画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/canvas/lines/FlowStreaks
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { afterPaint } from '../../../app/reveal.ts'
import { type MeasuredPath, measurePath, sampleOrientedPath } from '../../../model/pathSample.ts'
import { useViewCovered } from '../../kit/viewCover.ts'
import { useCanvasMoving } from '../../motion/canvasMoving.ts'
import css from './flowStreaks.module.css'
import { OnLabels } from './LabelLayer.tsx'

/** 一条线上最多几道光带；短线只放一道。 */
const MAX_STREAKS = 2
/** 每多这么长放一道。 */
const SPACING = 200
/** 光带半长（画布像素），样式也从这里取。 */
const STREAK_HALF_LENGTH = 10
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
 * 光带怎么样：`run` 照常走；`pause` 停在原地（平移、缩放画布时，视图被弹窗盖着时）；
 * `hold` 藏起来停着，松手后再按最终的线铺（拖卡片时）。
 */
type StreakMode = 'run' | 'pause' | 'hold'
/** 画布给的：拖卡片时 `hold`，其余 `run`（视口在动另有 {@link useCanvasMoving}）。 */
export const StreaksMode = createContext<'run' | 'hold'>('run')

function useStreakMode(): StreakMode {
  const mode = useContext(StreaksMode)
  const moving = useCanvasMoving()
  // 视图被弹窗盖着也停在原地：看不见，不用一帧帧地走。
  const covered = useViewCovered()
  return mode === 'run' && (moving || covered) ? 'pause' : mode
}

/** 这么长的线放几道光带。 */
function streakCount(length: number): number {
  return Math.max(1, Math.min(MAX_STREAKS, Math.round(length / SPACING)))
}

/** 沿路径等距取点，短条随切线转向，两端收短再淡掉。 */
function sample(path: MeasuredPath): Keyframe[] {
  const { length } = path
  const count = Math.max(16, Math.min(72, Math.round(length / 8)))
  const fade = Math.min(FADE, length / 3)
  return sampleOrientedPath(path, count).map(({ at, x, y, angle }, index) => {
    const room = Math.max(0, Math.min(at, length - at))
    const scale = Math.min(1, room / STREAK_HALF_LENGTH)
    return {
      offset: index / (count - 1),
      transform: `translate(${x}px, ${y}px) rotate(${angle}rad) scaleX(${scale})`,
      opacity: Math.min(1, room / fade),
    }
  })
}

export function FlowStreaks(props: {
  path: string
  /** 光带颜色：必须和这条线此刻的描边色一致（通常是一个 `var(--wl-…)`）。 */
  color: string
  /** 线是不是"活"的。变成 `false` 后先淡出、再卸载。 */
  active: boolean
}): React.JSX.Element | null {
  const still = reducedMotion()
  // 画布在动（平移、缩放、定位、拖卡片）时不挂也不卸，停下来再说：宿主页面上有带 `:has()` 的规则，
  // 视图里插、摘一个元素就要把整页样式重算一遍，落在视口动画中间就是一次明显的卡顿。
  const quiet = useStreakMode() === 'run'
  const [mounted, setMounted] = useState(props.active)
  useEffect(() => {
    if (!quiet || mounted === props.active) return
    if (!props.active) {
      const timer = setTimeout(() => setMounted(false), LEAVE_MS)
      return () => clearTimeout(timer)
    }
    // 从这一帧画完才开始等：点卡片那一帧很重，从提交算起的话，慢机器上那一帧一画完就到点了，
    // 正赶在画布开始挪（同样隔一帧起步，见 afterPaint）之前插进来。
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = afterPaint(() => {
      timer = setTimeout(() => setMounted(true), ENTER_DELAY_MS)
    })
    return () => {
      cancel()
      clearTimeout(timer)
    }
  }, [props.active, quiet, mounted])
  if (still || !mounted) return null
  return <Trail path={props.path} color={props.color} leaving={!props.active} />
}

function Trail(props: { path: string; color: string; leaving: boolean }): React.JSX.Element {
  const mode = useStreakMode()
  const held = mode === 'hold'
  /** 光带停在原地：整组在淡出，或画布正在平移、缩放。 */
  const stopped = props.leaving || mode === 'pause'
  /** 挂几道光带（按线长；线变长、变短时跟着 `lay` 改）。 */
  const [slots, setSlots] = useState(() => {
    const path = measurePath(props.path)
    return path === null ? 1 : streakCount(path.length)
  })
  const streakElements = useRef<(HTMLSpanElement | null)[]>([])
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
    // 同一条线的光带共用一套关键帧，错开起点。
    const base = new KeyframeEffect(null, sample(path), {
      duration,
      iterations: Number.POSITIVE_INFINITY,
      easing: 'linear',
    })
    for (let streak = 0; streak < MAX_STREAKS; streak += 1) {
      const element = streakElements.current[streak]
      const current = running.current[streak]
      if (element == null || streak >= streaks) {
        current?.cancel()
        running.current[streak] = null
        continue
      }
      const effect = new KeyframeEffect(base)
      effect.target = element
      effect.updateTiming({ delay: -(duration * streak) / streaks - duration })
      if (current != null) {
        current.effect = effect
        continue
      }
      const animation = new Animation(effect, document.timeline)
      animation.play()
      running.current[streak] = animation
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
    // 线在连续变（或刚松手）：先淡出、暂停，停下来再按最终的线铺一次。
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

  // 淡出、平移缩放时停在原地，又活过来 / 停手就接着走（藏着等铺的时候由铺完那一下接着走）。
  useLayoutEffect(() => {
    if (stopped) {
      for (const animation of running.current) animation?.pause()
      return
    }
    if (!frozen.current && settle.current === null) {
      for (const animation of running.current) animation?.play()
    }
  }, [stopped])

  // 线变长、多出一道光带：这里给刚挂上的元素补动画（藏着的时候松手再铺）。
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
    <OnLabels>
      <div
        className={css.streaks}
        data-leaving={props.leaving}
        data-moving={moving}
        style={
          {
            '--wl-streak': props.color,
            '--wl-streak-half': `${STREAK_HALF_LENGTH}px`,
          } as React.CSSProperties
        }
      >
        {Array.from({ length: slots }, (_, slot) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: 光带是固定的槽位，下标就是身份
            key={slot}
            ref={(element) => {
              streakElements.current[slot] = element
            }}
            className={css.streak}
            data-testid="wl-flow-streak"
          />
        ))}
      </div>
    </OnLabels>
  )
}
