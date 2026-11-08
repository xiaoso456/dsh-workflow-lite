/**
 * dsh-workflow-lite — 选中底块的动效：列表里的选中底块滑过去（{@link ListThumb}）、
 * 单选组里的选中块滑过去并弹一下（{@link PickThumb}）。只动 `transform` / `opacity`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/thumb
 */

import { useLayoutEffect, useRef, useState } from 'react'
import { cx } from '../kit/primitives.tsx'
import ui from '../kit/ui.module.css'
import { EASE_OUT, REDUCED } from './shared.ts'
import { swappedAt } from './swap.tsx'

interface Place {
  top: number
  left: number
  width: number
  height: number
  /** 选中的项暂时不在（比如正在改名换成了输入框行）：底块原地淡掉，回来时再从这里滑。 */
  hidden: boolean
}

/**
 * 选中底块：列表里 `data-selected="true"` 的那一项底下垫一块，换选中时滑过去（不是这块灭、那块亮）。
 * 放在列表的第一个子位置（列表要 `position: relative`）；项自己不再画选中底色。
 * `layout` 同 {@link useFlip}：选中项、列表内容变了才重新量。
 *
 * 列表是自己的父元素（不收外面的 ref）：外面那个 ref 在子组件的 layout effect 跑的时候还没挂上。
 *
 * `carry`：列表会整个卸掉又挂上（下拉每次打开都是新的一份）时，给个名字，
 * 新挂上的这块从上次停的地方滑到现在选中的那一项（没变就原地淡入），不是凭空出现在新位置。
 */
export function ListThumb(props: {
  layout: string
  className?: string
  carry?: string
}): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [place, setPlace] = useState<Place | null>(null)
  /** 第一次摆在上次停的地方、下一帧再滑去的终点。 */
  const glideTo = useRef<Place | null>(null)
  /** 第一次摆好之前不带过渡：打开时不从顶上滑下来。 */
  const [live, setLive] = useState(false)
  /** 列表本身变宽变窄（窗口缩放、出了滚动条）：项的宽度跟着变，重新量。 */
  const [resized, setResized] = useState(0)
  useLayoutEffect(() => {
    const list = ref.current?.parentElement
    if (list == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setResized((n) => n + 1))
    observer.observe(list)
    return () => observer.disconnect()
  }, [])
  // layout / resized 变了才量。
  useLayoutEffect(() => {
    const item = ref.current?.parentElement?.querySelector<HTMLElement>(
      ':scope > [data-selected="true"]',
    )
    if (item == null) {
      setPlace((was) => (was === null ? null : { ...was, hidden: true }))
      return
    }
    const next: Place = {
      top: item.offsetTop,
      left: item.offsetLeft,
      width: item.offsetWidth,
      height: item.offsetHeight,
      hidden: false,
    }
    const from = props.carry === undefined ? undefined : thumbCarry.get(props.carry)
    if (props.carry !== undefined) thumbCarry.set(props.carry, next)
    setPlace((was) => {
      if (was === null) {
        if (from === undefined || from.top === next.top || REDUCED?.matches === true) return next
        glideTo.current = next
        return { ...next, top: from.top }
      }
      glideTo.current = null
      return Object.entries(next).every(([k, v]) => was[k as keyof Place] === v) ? was : next
    })
  }, [props.layout, resized, props.carry])
  useLayoutEffect(() => {
    if (place === null || live) return
    const frame = requestAnimationFrame(() => {
      setLive(true)
      // 同一次渲染里开过渡、挪到终点：从上次停的地方滑过去。
      if (glideTo.current !== null) {
        setPlace(glideTo.current)
        glideTo.current = null
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [place, live])
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cx(ui.listThumb, props.className)}
      data-live={live}
      data-hidden={place === null || place.hidden}
      // 自己管位置（行内 transform），不参与列表的滑动：藏起来（display: none）时 offsetTop 会变，会被当成"挪了"。
      data-no-flip=""
      data-testid="wl-list-thumb"
      style={{
        left: place?.left ?? 0,
        width: place?.width ?? 0,
        height: place?.height ?? 0,
        transform: `translateY(${place?.top ?? 0}px)`,
        opacity: place === null || place.hidden ? 0 : 1,
      }}
    />
  )
}

/** 各列表的选中底块上次停在哪儿（见 {@link ListThumb} 的 `carry`）。 */
const thumbCarry = new Map<string, Place>()

/** 选中块的位置、尺寸（相对单选组的内边距框）。 */
interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * 元素在 `group` 里的位置：沿 offsetParent 一路加到 group（group 要是定位元素）。
 * 不用 getBoundingClientRect：对话框正在缩放入场时量出来的是缩过的值。
 */
function boxIn(group: HTMLElement, element: HTMLElement): Box {
  let x = 0
  let y = 0
  let at: HTMLElement | null = element
  while (at !== null && at !== group) {
    x += at.offsetLeft
    y += at.offsetTop
    const parent: HTMLElement | null =
      at.offsetParent instanceof HTMLElement ? at.offsetParent : null
    if (parent !== null && parent !== group) {
      x += parent.clientLeft
      y += parent.clientTop
    }
    at = parent
  }
  return { x, y, w: element.offsetWidth, h: element.offsetHeight }
}

const PICK_MS = 320
/** 选中滑块换格的时长（弹簧要留出收住的时间）。 */
const SLIDE_MS = 420

/** 视图根上的 `--wl-spring` 令牌（`linear()` 采样的弹簧，或老内核上的贝塞尔），读不到退回缓出。 */
function springOf(element: Element): string {
  return getComputedStyle(element).getPropertyValue('--wl-spring').trim() || EASE_OUT
}
/** 新选中那项里的小图标弹一下：稍微冲过头再落定。 */
const POP_EASE = 'cubic-bezier(0.34, 1.56, 0.64, 1)'

/** 选中项里带 `data-pick-pop` 的小图标从小弹到原大（属性值是起始大小，空 = 0.55；文字用 0.9 左右）。 */
function popIn(item: HTMLElement): void {
  for (const mark of item.querySelectorAll<HTMLElement>('[data-pick-pop]')) {
    const from = Number(mark.dataset.pickPop) || 0.55
    mark.animate([{ transform: `scale(${from})` }, { transform: 'none' }], {
      duration: 380,
      easing: POP_EASE,
    })
  }
}

/**
 * 选中块跨"重新挂载"接着滑：整个单选组随面板一起卸掉又挂上时（实例右栏的「运行 / 编辑」切换：
 * 两个面各带一份标题栏），卸掉前记下块停在哪、选的是什么，新挂上的那份从那里滑过去。
 */
const carried = new Map<string, { box: Box; layout: string; time: number }>()

/**
 * 单选组的选中块：放在组里（组要 `position: relative`），垫在 `aria-checked="true"` 的那一项下面；
 * 换选中时从旧的一项滑到新的一项（横竖都行，宽窄不同时一边滑一边变宽变窄），不是这块灭、那块亮。
 *
 * 只动 transform：块先摆到新位置（改一次 left / top / 宽高），再从"看上去还在旧位置"的
 * `translate + scale` 放回原样（FLIP）。半路上又换了，从它此刻的样子接着滑。
 *
 * - `part`：垫在选中项里面的某一块下面（主题卡只框缩略图），给选择器；
 * - `tone`：块有几种颜色（状态色）时每种叠一层，换色时交叉淡过去（只动 opacity），不是颜色瞬切；
 *   `attr` 是层上用来挑颜色的属性名，`className` 画每一层的样子。
 *
 * 没有选中项时原地淡掉；再选中时在新位置淡入、略放大。新选中项里带 `data-pick-pop` 的图标弹一下。
 */
export function PickThumb(props: {
  /** 选中值、各项变了才重新量：调用方把它们拼成一串。 */
  layout: string
  part?: string
  /**
   * 哪一项是选中的：相对单选组的选择器，默认 `:scope > [aria-checked="true"]`。
   * 选中的不是直接子元素时写后代选择器（`[data-active="true"]`）；别用 `data-on`，块自己带着它。
   */
  item?: string
  className?: string
  /** 单选组会跟着面板一起卸掉重挂时给个名字（两份用同一个），块跨重挂接着滑，见 {@link carried}。 */
  carry?: string
  tone?: {
    list: readonly string[]
    on: string | null | undefined
    attr: string
    className?: string
  }
}): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  /** 上一次摆到哪儿。 */
  const at = useRef<Box | null>(null)
  const running = useRef<Animation | null>(null)
  /** 上一次的 `layout`：只有它变了才放动画（组变宽变窄只重新摆）。 */
  const seen = useRef<string | null>(null)
  const [resized, setResized] = useState(0)
  useLayoutEffect(() => {
    const group = ref.current?.parentElement
    if (group == null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setResized((n) => n + 1))
    observer.observe(group)
    return () => observer.disconnect()
  }, [])
  const { layout, part, carry, item: match = ':scope > [aria-checked="true"]' } = props
  // 卸掉时记下块停在哪（半路上的话是此刻的位置）。
  useLayoutEffect(() => {
    const thumb = ref.current
    return () => {
      if (carry === undefined || thumb == null || at.current === null || seen.current === null) {
        return
      }
      let box = at.current
      if (running.current?.playState === 'running') {
        const m = new DOMMatrixReadOnly(getComputedStyle(thumb).transform)
        box = { x: box.x + m.e, y: box.y + m.f, w: box.w * m.a, h: box.h * m.d }
      }
      carried.set(carry, { box, layout: seen.current, time: performance.now() })
    }
  }, [carry])
  // layout / part / resized 变了才量。
  useLayoutEffect(() => {
    const thumb = ref.current
    const group = thumb?.parentElement
    if (thumb == null || group == null) return
    if (seen.current === null && carry !== undefined) {
      // 刚挂上：同一帧里卸掉的那份留了话，就从它停的地方接着滑。
      const last = carried.get(carry)
      carried.delete(carry)
      if (last !== undefined && performance.now() - last.time < 50) {
        at.current = last.box
        seen.current = last.layout
        thumb.dataset.on = 'true'
      }
    }
    const changed = seen.current !== null && seen.current !== layout
    seen.current = layout
    const item = group.querySelector<HTMLElement>(match)
    const target =
      item === null ? null : part === undefined ? item : item.querySelector<HTMLElement>(part)
    if (target === null) {
      thumb.dataset.on = 'false'
      return
    }
    const next = boxIn(group, target)
    const shown = thumb.dataset.on === 'true'
    let from = at.current
    const was = running.current
    // 只是被叫来重新量（比如刚挂上时 ResizeObserver 的第一次回调）、位置没变：别打断正在滑的这一下。
    if (
      !changed &&
      was !== null &&
      from !== null &&
      Math.abs(from.x - next.x) < 0.5 &&
      Math.abs(from.y - next.y) < 0.5 &&
      Math.abs(from.w - next.w) < 0.5 &&
      Math.abs(from.h - next.h) < 0.5
    ) {
      return
    }
    if (was !== null && was.playState === 'running' && from !== null) {
      // 半路上：读动画此刻的值（不是起点）。
      const m = new DOMMatrixReadOnly(getComputedStyle(thumb).transform)
      from = { x: from.x + m.e, y: from.y + m.f, w: from.w * m.a, h: from.h * m.d }
    }
    was?.cancel()
    running.current = null
    Object.assign(thumb.style, {
      left: `${next.x}px`,
      top: `${next.y}px`,
      width: `${next.w}px`,
      height: `${next.h}px`,
    })
    at.current = next
    thumb.dataset.on = 'true'
    if (thumb.dataset.live !== 'true') {
      // 第一次摆好之前不带过渡：打开时不从无到有淡一下。
      requestAnimationFrame(() => {
        thumb.dataset.live = 'true'
      })
    }
    // 右栏整块换了内容（换了一个步骤）：选中项跟着内容一起换过来，不单独滑。
    if (!changed || REDUCED?.matches === true || performance.now() - swappedAt < 80) return
    if (!shown || from === null) {
      // 从没选中到选中：在新位置略放大、淡入（淡入是 CSS 的 opacity 过渡）。
      running.current = thumb.animate(
        [
          { transform: `translate(${next.w * 0.04}px, ${next.h * 0.04}px) scale(0.92)` },
          { transform: 'none' },
        ],
        { duration: PICK_MS, easing: EASE_OUT },
      )
      if (item !== null) popIn(item)
      return
    }
    const dx = from.x - next.x
    const dy = from.y - next.y
    const sx = from.w / next.w
    const sy = from.h / next.h
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01) return
    // 滑块换格：弹簧（--wl-spring，读自视图根的令牌，老内核上是贝塞尔），到位略过冲再收住。
    running.current = thumb.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }],
      { duration: SLIDE_MS, easing: springOf(thumb) },
    )
    if (item !== null) popIn(item)
  }, [layout, part, match, resized, carry])
  const { tone } = props
  return (
    <span ref={ref} aria-hidden="true" className={cx(ui.pickThumb, props.className)}>
      {tone?.list.map((name) => (
        <span
          key={name}
          className={cx(ui.pickTone, tone.className)}
          data-on={name === tone.on}
          {...{ [tone.attr]: name }}
        />
      ))}
    </span>
  )
}
