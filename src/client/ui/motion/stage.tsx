/**
 * dsh-workflow-lite — 整块内容换成另一块的动效：按步骤横向交接（{@link Staged}）、同一处换一版内容（{@link SlideSwap}）、
 * 叠在同一格里轮流出现的几段话（{@link FadeStack}）。只动 `transform` / `opacity`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/stage
 */

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cx } from '../kit/cx.ts'
import { ghostClone } from '../kit/ghost.ts'
import { EASE_OUT, REDUCED } from './shared.ts'
import css from './stage.module.css'

/** 整块内容换成另一块（{@link useStage}）：横向挪多远、旧的退多久、新的进多久。 */
const STAGE_SHIFT = 16
const STAGE_OUT_MS = 150
const STAGE_IN_MS = 240

/** 往里走（进了下一级）、往回走（回了上一级）、平级跳转（只淡）。 */
export type StageDir = -1 | 0 | 1

/**
 * 一整块内容换成另一块（文件选择框里进下一级、回上一级）：
 * 往里走时旧的往左退、淡出，新的从右边进来；往回走反过来；平级跳转只淡入淡出、竖向挪一点。
 *
 * 用法：`wrap` 挂在内容外面那层（要 `position: relative; overflow: hidden`），`body` 挂在内容本身；
 * 数据到了、换进新内容的那一刻先 `leave(dir)`（给旧内容留个影子往外走），内容换上之后 `enter(dir)`
 * （新内容从该来的一侧进来）。只放 Web Animation 的 transform / opacity。
 */
export function useStage(
  options: {
    /** 旧内容淡出用多久（默认 150ms）。 */
    outMs?: number
    /** 新内容等多久再进来（默认 40ms；平级跳转不等）。行密、字多的列表把它设得接近 `outMs`，两层文字就不会叠在一起。 */
    delayMs?: number
  } = {},
): {
  wrap: RefObject<HTMLDivElement>
  body: { current: HTMLElement | null }
  leave(dir: StageDir): void
  enter(dir: StageDir): void
} {
  const wrap = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLElement | null>(null)
  const outMs = options.outMs ?? STAGE_OUT_MS
  const delayMs = options.delayMs ?? 40
  const leave = useCallback(
    (dir: StageDir): void => {
      const frame = wrap.current
      const node = body.current
      if (frame === null || node === null || REDUCED?.matches === true) return
      const box = node.getBoundingClientRect()
      const host = frame.getBoundingClientRect()
      if (box.height === 0) return
      const ghost = ghostClone(node)
      Object.assign(ghost.node.style, {
        position: 'absolute',
        top: `${box.top - host.top}px`,
        left: `${box.left - host.left}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
        margin: '0',
        // 数据还没到时旧内容是压暗着的（载入中）：影子从那个亮度开始淡。
        opacity: getComputedStyle(frame.firstElementChild ?? frame).opacity,
      })
      ghost.place(frame)
      const from = Number(ghost.node.style.opacity) || 1
      ghost.node.animate(
        [
          { transform: 'none' },
          { transform: dir === 0 ? 'translateY(-4px)' : `translateX(${-dir * STAGE_SHIFT}px)` },
        ],
        { duration: STAGE_IN_MS, easing: EASE_OUT, fill: 'forwards' },
      )
      const out = ghost.node.animate([{ opacity: from }, { opacity: 0 }], {
        duration: outMs,
        easing: 'linear',
        fill: 'forwards',
      })
      const drop = (): void => ghost.node.remove()
      out.finished.then(drop, drop)
    },
    [outMs],
  )
  const enter = useCallback(
    (dir: StageDir): void => {
      const node = body.current
      if (node === null || REDUCED?.matches === true) return
      node.animate(
        [
          {
            opacity: 0,
            transform: dir === 0 ? 'translateY(4px)' : `translateX(${dir * STAGE_SHIFT}px)`,
          },
          { opacity: 1, transform: 'none' },
        ],
        {
          duration: STAGE_IN_MS,
          easing: EASE_OUT,
          delay: dir === 0 ? 0 : delayMs,
          fill: 'backwards',
        },
      )
    },
    [delayMs],
  )
  return useMemo(() => ({ wrap, body, leave, enter }), [leave, enter])
}

/**
 * 一块内容按步骤换（导出：选版本 → 资源清单 → Skill 信息；读完了换上结果）：`at` 变了，旧的留个影子往外退，
 * 新的从该来的一侧进来（{@link useStage}）。`order` 是第几步：往后走新的从右边进，往回走从左边进，同一步里换只淡。
 * 外层定位、裁切（影子摆在里面），里层是内容本身；两层都是纵向 flex、撑满父元素，间距沿用父元素的。
 */
export function Staged(props: {
  at: string
  order: number
  className?: string
  children: ReactNode
}): React.JSX.Element {
  const stage = useStage()
  const shown = useRef({ at: props.at, order: props.order })
  const heading = useRef<StageDir>(0)
  const bodyRef = useCallback(
    (node: HTMLDivElement | null): void => {
      stage.body.current = node
    },
    [stage.body],
  )
  // 渲染阶段 DOM 还是旧的：影子只能在这里拍（同 useSwap）；提交之后就已经是新内容了。
  if (props.at !== shown.current.at) {
    heading.current = Math.sign(props.order - shown.current.order) as StageDir
    stage.leave(heading.current)
    shown.current = { at: props.at, order: props.order }
  }
  const mounted = useRef(false)
  useLayoutEffect(() => {
    // 第一次挂上不放：页面自己有入场。
    if (mounted.current) stage.enter(heading.current)
    mounted.current = true
  }, [props.at, stage])
  return (
    <div className={cx(css.stage, props.className)} ref={stage.wrap}>
      <div className={css.stageBody} ref={bodyRef}>
        {props.children}
      </div>
    </div>
  )
}

/** 换一版内容（{@link SlideSwap}）：横向挪多远、旧的淡出多久、新的晚多久进来（两层字少叠在一起）、滑动多久、新的最多等多久。 */
const SLIDE_SHIFT = 32
const SLIDE_OUT_MS = 130
const SLIDE_LAG_MS = 70
const SLIDE_MOVE_MS = 300
const SLIDE_WAIT_MS = 900

interface SlideLayer {
  n: number
  id: string
  state: 'shown' | 'pending' | 'leaving'
  /** 往哪边走：`1` = 往后（新的从右边进来）。 */
  dir: 1 | -1
}

/**
 * 同一处换一版内容（展示卡回看各轮）：新的一层先垫在底下读（看不见），读好了——没有读取中的块、网页载完、
 * 图片解完（最多等 {@link SLIDE_WAIT_MS}）——再从行进方向滑进来，旧的一层同时往另一边滑走、淡掉。
 * 新的没读好时旧的一直在（不闪空）；连着换时还没轮上的那层直接丢掉。旧的一层是真的 DOM（不是影子），网页不会变白。
 * `dir`：`up` = 往后的版（配 {@link useTrend}）。`children(id)` 画某一版。
 */
export function SlideSwap(props: {
  id: string
  dir: 'up' | 'down'
  children(id: string): ReactNode
}): React.JSX.Element {
  const [layers, setLayers] = useState<SlideLayer[]>(() => [
    { n: 0, id: props.id, state: 'shown', dir: 1 },
  ])
  const next = useRef(1)
  const target =
    layers.find((layer) => layer.state === 'pending')?.id ??
    layers.find((layer) => layer.state === 'shown')?.id
  if (props.id !== target) {
    const dir = props.dir === 'down' ? -1 : 1
    const n = next.current
    setLayers((list) => {
      const rest = list.filter((layer) => layer.state !== 'pending')
      // 换回了正显示着的那一版：只是不换了。
      if (rest.some((layer) => layer.state === 'shown' && layer.id === props.id)) return rest
      return [...rest, { n, id: props.id, state: 'pending', dir }]
    })
    next.current = n + 1
  }
  const ready = useCallback((n: number): void => {
    setLayers((list) => {
      const layer = list.find((one) => one.n === n && one.state === 'pending')
      if (layer === undefined) return list
      return list.map((one) =>
        one === layer
          ? { ...one, state: 'shown' }
          : one.state === 'shown'
            ? { ...one, state: 'leaving', dir: layer.dir }
            : one,
      )
    })
  }, [])
  const drop = useCallback((n: number): void => {
    setLayers((list) => list.filter((one) => one.n !== n))
  }, [])
  return (
    <div
      className={css.slides}
      data-moving={layers.some((layer) => layer.state === 'leaving') || undefined}
    >
      {layers.map((layer) => (
        <SlidePane key={layer.n} layer={layer} onReady={ready} onDrop={drop}>
          {props.children(layer.id)}
        </SlidePane>
      ))}
    </div>
  )
}

function SlidePane(props: {
  layer: SlideLayer
  onReady(n: number): void
  onDrop(n: number): void
  children: ReactNode
}): React.JSX.Element {
  const { layer, onReady, onDrop } = props
  const ref = useRef<HTMLDivElement>(null)
  const was = useRef(layer.state)
  // 垫在底下的那层：每帧看一眼读好了没有。网页的 load 不冒泡，在捕获阶段接。
  useLayoutEffect(() => {
    const node = ref.current
    if (layer.state !== 'pending' || node === null) return
    const loaded = new WeakSet<EventTarget>()
    const onLoad = (event: Event): void => {
      if (event.target !== null) loaded.add(event.target)
    }
    node.addEventListener('load', onLoad, true)
    const start = performance.now()
    let frame = 0
    const check = (): void => {
      const done =
        node.firstElementChild !== null &&
        node.querySelector('[aria-busy="true"]') === null &&
        [...node.querySelectorAll('iframe')].every((element) => loaded.has(element)) &&
        [...node.querySelectorAll('img')].every((element) => element.complete)
      if (done || performance.now() - start > SLIDE_WAIT_MS) onReady(layer.n)
      else frame = requestAnimationFrame(check)
    }
    frame = requestAnimationFrame(check)
    return () => {
      cancelAnimationFrame(frame)
      node.removeEventListener('load', onLoad, true)
    }
  }, [layer.state, layer.n, onReady])
  useLayoutEffect(() => {
    const from = was.current
    was.current = layer.state
    const node = ref.current
    if (node === null || from === layer.state) return
    const still = REDUCED?.matches === true
    if (layer.state === 'shown' && !still) {
      node.animate(
        [
          { opacity: 0, transform: `translateX(${layer.dir * SLIDE_SHIFT}px)` },
          { opacity: 1, transform: 'none' },
        ],
        { duration: SLIDE_MOVE_MS, easing: EASE_OUT, delay: SLIDE_LAG_MS, fill: 'backwards' },
      )
    }
    if (layer.state === 'leaving') {
      if (still) {
        onDrop(layer.n)
        return
      }
      node.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: SLIDE_OUT_MS,
        easing: 'linear',
        fill: 'forwards',
      })
      const slide = node.animate(
        [{ transform: 'none' }, { transform: `translateX(${-layer.dir * SLIDE_SHIFT}px)` }],
        { duration: SLIDE_MOVE_MS, easing: EASE_OUT, fill: 'forwards' },
      )
      slide.finished.then(
        () => onDrop(layer.n),
        () => undefined,
      )
    }
  }, [layer.state, layer.dir, layer.n, onDrop])
  return (
    <div
      ref={ref}
      className={css.slide}
      data-state={layer.state}
      aria-hidden={layer.state === 'shown' ? undefined : true}
      {...(layer.state === 'shown' ? {} : { inert: '' })}
    >
      {props.children}
    </div>
  )
}

/**
 * 几段话轮流摆在同一处（导出页的说明：工作流包、Skill 各一句）：全叠在同一格里，高度按最高的那段占住，
 * 换的时候旧的原地淡掉、新的从下面浮上来——换字不推动下面的东西。只有 `at` 那段读得到（其余 aria-hidden）。
 */
export function FadeStack(props: {
  at: string
  items: readonly { key: string; node: ReactNode }[]
  className?: string
}): React.JSX.Element {
  return (
    <span className={cx(css.fadeStack, props.className)}>
      {props.items.map((item) => (
        <span
          key={item.key}
          className={css.fadeLayer}
          data-on={item.key === props.at}
          aria-hidden={item.key === props.at ? undefined : true}
        >
          {item.node}
        </span>
      ))}
    </span>
  )
}

/**
 * 按位置认的列表（项没有自己的 id，可以重名、可以为空）配一串稳定的键：
 * 删中间一项前先 `drop(index)`，删掉的就是那一行的元素（不是最后一行），其余行滑上去。
 * 项数从外面变了（撤销、加了一项）只在末尾补齐 / 截掉。
 */
export function useRowKeys(count: number): { keys: readonly string[]; drop(index: number): void } {
  const state = useRef({ keys: [] as string[], next: 0 })
  const own = state.current
  while (own.keys.length < count) {
    own.keys.push(`row${own.next}`)
    own.next += 1
  }
  if (own.keys.length > count) own.keys.length = count
  return {
    keys: own.keys,
    drop: (index) => {
      own.keys.splice(index, 1)
    },
  }
}
