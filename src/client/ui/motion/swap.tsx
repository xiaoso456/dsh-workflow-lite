/**
 * dsh-workflow-lite — 右栏、整张图这类大块「换内容」的动效：旧内容（影子）让开淡出、新内容淡入（{@link useSwap}），
 * 收起时的退场（closeOut），切换工作流时旧图多留一会（{@link useSwapHold}）。
 *
 * `swappedAt` 记着右栏刚换过内容的时刻：列表那边据此把这一刻的整批增删当成换内容，不放增删动画。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion/swap
 */

import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { type Ghost, ghostClone } from '../kit/ghost.ts'
import { whenStill } from './canvasMoving.ts'
import { EASE, EASE_OUT, REDUCED } from './shared.ts'

/** 右栏刚换了内容（{@link swapIn}）：这时列表里的整批增删是换内容，不是有人删了一项，不放增删动画。 */
export let swappedAt = Number.NEGATIVE_INFINITY

/** 整个列表马上要换成另一份（进了另一个目录）：接下来那一次整批增删是换内容，不逐项放退场入场。 */
export function markSwap(): void {
  swappedAt = performance.now()
}

/**
 * 换内容是一次快速交接：旧内容（影子）往外让一点、很快淡掉，新内容同时从另一侧淡入、滑到位。
 * 旧的走得比新的快，两层叠在一起的只有开头一小段，而且那时旧的已经很淡——不糊；
 * 新内容一开始就在走，不会先空一下再冒出来——不闪。不用 blur（糊、也费 GPU），只动 transform / opacity。
 */
const SWAP_IN_MS = 320
const SWAP_OUT_MS = 160
const SWAP_SHIFT = 16

/** 内容此刻的样子（上一次还没换完时是半路上的样子），影子从这里接着走。 */
interface Pose {
  x: number
  opacity: number
}

/** 换内容之前面板里是什么：哪一项、它在画布上的横坐标、看的哪一面、此刻的样子。 */
interface Snapshot {
  key: string
  at: number
  view: number
  ghost: Ghost
  pose: Pose
}

/** 标题栏：同一项换看的面（运行 ↔ 编辑）时它不动，只换下面的内容。 */
const isHead = (child: Element): boolean => child.tagName === 'HEADER'

/** 刚卸掉的那块面板：紧接着又挂上一块（同一帧里），就是"换内容"，不是"新打开"。 */
let gone: { panel: HTMLElement; snap: Snapshot; time: number } | null = null
/** 新内容正在进来的动画：又换了一次从它此刻的样子接着走。 */
const entering = new WeakMap<Element, Animation>()

function snapshot(panel: HTMLElement, key: string, at: number, view: number): Snapshot {
  // 看内容那一块（标题栏在只换面时不动，没有动画可读）。
  const first = [...panel.children].find((child) => !isHead(child)) ?? panel.firstElementChild
  const running = first === null ? undefined : entering.get(first)
  let pose: Pose = { x: 0, opacity: 1 }
  if (first !== null && running?.playState === 'running') {
    const style = getComputedStyle(first)
    pose = { x: new DOMMatrixReadOnly(style.transform).m41, opacity: Number(style.opacity) }
  }
  return { key, at, view, ghost: ghostClone(panel), pose }
}

/**
 * 旧内容（影子）往外让、快速淡出，新内容从目标那一侧淡入，两层同时起步。
 * 方向：新内容在画布上更靠右，就从右边进来、旧的往左让。
 * 影子放完自己删；连点几下时前几个影子各自淡完，不中途拿掉（拿掉会跳一下）。
 */
function swapIn(
  panel: HTMLElement,
  snap: Snapshot,
  at: number,
  view: number,
  sameItem: boolean,
): void {
  const parent = panel.parentNode
  if (parent === null || REDUCED?.matches === true) return
  // `sameItem`：还是同一项、只是换看的面（运行 ↔ 编辑）：标题栏原地不动，只换下面的内容；
  // 方向按两个面的先后（往右边那个面切，新内容从右边进来）。
  if (!sameItem) swappedAt = performance.now()
  const dir = (sameItem ? view >= snap.view : at >= snap.at) ? 1 : -1
  const ghost = snap.ghost.node
  // 影子只留内容：栏框、底色、阴影由新面板画，影子叠在它上面。
  Object.assign(ghost.style, {
    position: 'absolute',
    inset: '0',
    margin: '0',
    background: 'transparent',
    borderColor: 'transparent',
    boxShadow: 'none',
  })
  snap.ghost.place(parent)
  const { pose } = snap
  let out: Animation | null = null
  for (const child of ghost.children) {
    if (sameItem && isHead(child)) {
      // 新面板自己的标题栏就在底下，影子里这份藏起来。
      if (child instanceof HTMLElement) child.style.visibility = 'hidden'
      continue
    }
    out = child.animate(
      [
        { transform: `translateX(${pose.x}px)`, opacity: pose.opacity },
        { transform: `translateX(${pose.x - dir * SWAP_SHIFT}px)`, opacity: 0 },
      ],
      { duration: SWAP_OUT_MS, easing: EASE_OUT, fill: 'forwards' },
    )
  }
  for (const child of panel.children) {
    if (sameItem && isHead(child)) continue
    entering.get(child)?.cancel()
    entering.set(
      child,
      child.animate(
        [
          { transform: `translateX(${dir * SWAP_SHIFT}px)`, opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: SWAP_IN_MS, easing: EASE_OUT },
      ),
    )
  }
  if (out === null) ghost.remove()
  else {
    // 淡完已经看不见了（也不接指针）：画布正在挪（点卡片后让出右栏）就等它停下来再摘，见 whenStill。
    const drop = (): void => whenStill(() => ghost.remove())
    out.finished.then(drop, drop)
  }
}

/** 右栏收起：和步骤库收起（shell.module.css 的 `.library` 收起过渡）同样的距离、时长，方向相反。 */
const CLOSE_MS = 200
const CLOSE_FADE_MS = 160
const CLOSE_SHIFT = 24

/**
 * 右栏关掉（取消选中、点 ✕、收起）：栏框连同内容的影子往右退一点、淡出——和打开时从右边滑进来是一对。
 * 栏框本身已经被 React 摘掉了：照它的样子浅复制一个空框（同样的类、同样的位置）放回原处，影子内容装进去。
 * 页面本身也被卸掉了（换到别的标签页）就不放。
 */
function closeOut(frame: HTMLElement, host: Node, snap: Snapshot): void {
  if (!host.isConnected || frame.isConnected) return
  const shell = frame.cloneNode(false) as HTMLElement
  shell.removeAttribute('data-testid')
  shell.removeAttribute('id')
  Object.assign(shell.style, { animation: 'none', transition: 'none', pointerEvents: 'none' })
  shell.setAttribute('aria-hidden', 'true')
  shell.setAttribute('inert', '')
  host.appendChild(shell)
  snap.ghost.place(shell)
  // 和步骤库收起同一套：位移 200ms 缓出，透明度 160ms 匀速，先淡完再滑完。
  shell.animate([{ transform: 'none' }, { transform: `translateX(${CLOSE_SHIFT}px)` }], {
    duration: CLOSE_MS,
    easing: EASE,
    fill: 'forwards',
  })
  const out = shell.animate([{ opacity: snap.pose.opacity }, { opacity: 0 }], {
    duration: CLOSE_FADE_MS,
    easing: 'linear',
    fill: 'forwards',
  })
  // 透明度先放完，那时已经看不见了，直接拿掉。
  const drop = (): void => shell.remove()
  out.finished.then(drop, drop)
}

/** 同一项的「编辑」面（属性面板那几块传它）；实例右栏的「运行」面用 {@link useSwap} 默认的 0。 */
export const EDIT_VIEW = 1

/**
 * 右栏换了内容（选中了另一个节点 / 连线 / 回到总览）：栏框不动，旧内容让开淡出、新内容淡入（见 {@link swapIn}），
 * 方向按两者在画布上的左右（`at` 是横坐标）：选了右边的，新内容从右边进来。
 *
 * 两种情况都接得住：
 * - 面板按选中项挂键、每换一个就重新挂一块（编辑页的几种面板）：旧面板卸掉时拍下它的样子，
 *   同一帧里挂上的新面板拿它当影子；
 * - 面板一直挂着、只是内容换了（实例视图的右栏）：`key` 变了的那次渲染里 DOM 还是旧的，在那里拍。
 *
 * `key` 两边要用同一种写法。`view` 是同一项的第几个面（实例视图里「运行」0、「编辑」1）：
 * 来回切时标题栏原地不动，只有下面的内容按先后方向换（见 {@link swapIn}）。
 * 只放 Web Animation（transform / opacity），不重新挂载，焦点、输入都留着。
 */
export function useSwap<E extends HTMLElement>(key: string, at: number, view = 0): RefObject<E> {
  const ref = useRef<E>(null)
  /** 屏幕上现在是哪一项、哪一面。 */
  const shown = useRef({ key, at, view })
  const pending = useRef<Snapshot | null>(null)
  // 渲染阶段 DOM 还没换：拍旧内容只能在这里（提交之后就已经是新的了）。
  const live = ref.current
  if (
    live !== null &&
    (key !== shown.current.key || view !== shown.current.view) &&
    pending.current === null &&
    REDUCED?.matches !== true
  ) {
    pending.current = snapshot(live, shown.current.key, shown.current.at, shown.current.view)
    // 里面的子组件（选中块、列表）先于这里的 layout effect 跑：在这儿就记下"正在换内容"。
    // 只换面时里面的东西没换（选中块该滑还是滑）。
    if (key !== shown.current.key) swappedAt = performance.now()
  }
  useLayoutEffect(() => {
    const panel = ref.current
    if (panel === null) return
    const recent = gone
    gone = null
    if (
      recent !== null &&
      recent.panel !== panel &&
      (recent.snap.key !== shown.current.key || recent.snap.view !== shown.current.view) &&
      performance.now() - recent.time < 50
    ) {
      swapIn(
        panel,
        recent.snap,
        shown.current.at,
        shown.current.view,
        recent.snap.key === shown.current.key,
      )
    }
    return () => {
      if (REDUCED?.matches === true) return
      // 这时栏框（面板的父元素）还在页面上：React 先跑子树的清理、最后才摘 DOM。
      const frame = panel.parentElement
      // 栏框的父元素也要现在记下：微任务里栏框已经被摘掉，`parentNode` 是 null 了。
      const host = frame?.parentNode ?? null
      const entry = {
        panel,
        snap: snapshot(panel, shown.current.key, shown.current.at, shown.current.view),
        time: performance.now(),
      }
      gone = entry
      // 同一次提交里没有新面板来接（新面板的 layout effect 在微任务之前就跑完了）：是关掉右栏。
      queueMicrotask(() => {
        if (gone !== entry) return
        gone = null
        if (frame !== null && host !== null) closeOut(frame, host, entry.snap)
      })
    }
  }, [])
  useLayoutEffect(() => {
    const snap = pending.current
    pending.current = null
    const was = shown.current
    shown.current = { key, at, view }
    const panel = ref.current
    if (snap !== null && panel !== null && (was.key !== key || was.view !== view)) {
      swapIn(panel, snap, at, view, was.key === key)
    }
  }, [key, at, view])
  return ref as RefObject<E>
}

// ─────────────────────────────────────────────────────────────
// 切换工作流：旧图多留一会、顶栏左边的药丸展开收缩
// ─────────────────────────────────────────────────────────────

/** 切换时旧图至少压暗多久再换新的（和 shell.module.css 里压暗的过渡一致）。 */
export const SWITCH_HOLD_MS = 170

/**
 * 换一份内容（切换工作流）时，新的还没到、或到得太快，旧的先多留一会儿：
 * `live` 是当前该显示的东西（`key` 变了 = 换了一份）；`loading` 是正在换。
 * 返回 `view`（这一刻真正该画的）与 `dim`（旧的在等新的，外面把它压暗、别让人点）。
 * 新的到了但离开始换还不到 `ms`，就再等到够 `ms`：先压暗、再换内容、再亮回来，是一次完整的呼吸，不是一闪。
 * 同一份内容里的编辑（`key` 不变）原样透传，不等。
 */
export function useSwapHold<V extends { key: string }>(
  live: V | null,
  loading: boolean,
  ms: number,
): { view: V | null; dim: boolean } {
  const shown = useRef<V | null>(null)
  /** 开始换的时刻；null = 这一轮没经过「正在换」（直接换，不等）。 */
  const began = useRef<number | null>(null)
  const [released, setReleased] = useState<string | null>(null)
  if (loading && began.current === null) began.current = performance.now()

  const held = shown.current
  let view: V | null
  let dim = false
  if (live === null) {
    view = loading ? held : null
    dim = loading && view !== null
  } else if (
    held === null ||
    held.key === live.key ||
    released === live.key ||
    began.current === null ||
    REDUCED?.matches === true
  ) {
    view = live
  } else {
    view = held
    dim = true
  }
  shown.current = view

  const waiting = dim && live !== null ? live.key : null
  useEffect(() => {
    if (waiting === null) return
    const left = Math.max(0, ms - (performance.now() - (began.current ?? 0)))
    const id = setTimeout(() => setReleased(waiting), left)
    return () => clearTimeout(id)
  }, [waiting, ms])
  // 新的已经画上去了：这一轮结束。
  useEffect(() => {
    if (!loading && live !== null && view === live) began.current = null
  })
  return { view, dim }
}
