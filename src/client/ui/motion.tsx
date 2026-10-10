/**
 * dsh-workflow-lite — 列表的动效：选中底块滑过去（{@link ListThumb}）、增删筛选时其余项滑到新位置（{@link useFlip}）、
 * 某一项展开收起时后面的项跟着滑（{@link useResizeFlip}）。
 *
 * 守 `ui.module.css` 开头那条规矩：只动 `transform` / `opacity`，交给合成器。
 * JS 只在列表内容变了的那一次渲染里读一遍各项的 `offsetTop`，动画本身不占主线程
 * （CSS transition / Web Animations 的 transform 都在合成器上跑）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/motion
 */

import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon.tsx'
import { cx, type Ghost, ghostClone } from './primitives.tsx'
import ui from './ui.module.css'

interface Place {
  top: number
  left: number
  width: number
  height: number
  /** 选中的项暂时不在（比如正在改名换成了输入框行）：底块原地淡掉，回来时再从这里滑。 */
  hidden: boolean
}

/** 「减少动态效果」：查询对象只建一次，读它的实时值。 */
const REDUCED = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null

/**
 * 项在列表里的纵向位置（相对列表本身，不是相对页面）。
 *
 * `offsetTop` 是相对最近的定位祖先算的：列表没定位时，列表上面的东西（标题、状态行、刚读完的提示）
 * 一变高，所有项的 `offsetTop` 都跟着变，可它们在列表里根本没动——拿这个比会让整列先往上蹿再滑回来。
 */
function topIn(list: HTMLElement, child: HTMLElement): number {
  return child.offsetParent === list ? child.offsetTop : child.offsetTop - list.offsetTop
}

const FLIP_MS = 240
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'

/** 正在滑的项：位置又变了时，从它此刻看上去的地方接着滑，不是先跳回上一次的起点。 */
const sliding = new WeakMap<HTMLElement, Animation>()

/** 让一项看上去还在 `offset`（新位置之上多少像素）的地方，再滑到新位置。 */
function slide(child: HTMLElement, offset: number): void {
  const running = sliding.get(child)
  let from = offset
  if (running !== undefined && running.playState === 'running') {
    // 还在半路：把它此刻的位移加上（读的是动画的当前值，不是起点）。
    from += new DOMMatrixReadOnly(getComputedStyle(child).transform).m42
    running.cancel()
  }
  if (Math.abs(from) < 0.5) return
  sliding.set(
    child,
    child.animate([{ transform: `translateY(${from}px)` }, { transform: 'none' }], {
      duration: FLIP_MS,
      easing: EASE,
    }),
  )
}

const ENTER_MS = 240
/** 第一次挂上时各项错开多少、最多错开几项（再往后的和第 12 项一起出来）。 */
const STAGGER_MS = 22
const STAGGER_MAX = 12

/**
 * 列表里带 `data-flip`（值是项的键）的直接子项：`layout`（各项的键连起来）变了，
 * 留下来的项从旧位置滑到新位置；`enter` 时新出现的项从左边淡入——第一次挂上时依次错开。
 * 键没变的项换了个样子（比如改名时换成输入框行）不算新项，不放入场。
 */
export function useFlip(
  ref: RefObject<HTMLElement | null>,
  layout: string,
  options: { enter?: boolean } = {},
): void {
  const tops = useRef<Map<string, number> | null>(null)
  const enter = options.enter === true
  // 只在列表内容变了时量（layout 就是为这个给的）。
  useLayoutEffect(() => {
    const list = ref.current
    if (list === null) return
    const first = tops.current === null
    const still = REDUCED?.matches === true
    const next = new Map<string, number>()
    let index = 0
    for (const child of list.children) {
      if (!(child instanceof HTMLElement)) continue
      const key = child.dataset.flip
      if (key === undefined) continue
      const top = topIn(list, child)
      next.set(key, top)
      const was = tops.current?.get(key)
      if (still) continue
      if (was === undefined) {
        if (enter) {
          child.animate(
            [
              { opacity: 0, transform: 'translateX(-6px)' },
              { opacity: 1, transform: 'none' },
            ],
            {
              duration: ENTER_MS,
              easing: EASE,
              delay: first ? Math.min(index, STAGGER_MAX) * STAGGER_MS : 0,
              fill: 'backwards',
            },
          )
        }
      } else if (was !== top) {
        slide(child, was - top)
      }
      index += 1
    }
    tops.current = next
  }, [layout])
}

/**
 * 列表里有一项变高变矮（展开、收起、内容换了）或增删了项：它后面的项从旧位置滑到新位置。
 * 和 {@link useFlip} 一样只动 transform，不同的是不用给 `layout`——ResizeObserver 看着每一项，
 * 尺寸一变（布局之后、绘制之前）就比一遍各项的 `offsetTop`。
 *
 * 返回一个回调 ref，挂到列表上（列表可以晚挂上、可以换）。项要有不透明的底色：
 * 往下滑的项像帘子一样盖着、再露出上面刚展开的内容。
 */
export function useResizeFlip(): (list: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  return useCallback((list: HTMLElement | null) => {
    stop.current?.()
    stop.current = null
    if (list === null || typeof ResizeObserver === 'undefined') return
    const measure = (): Map<HTMLElement, number> => {
      const tops = new Map<HTMLElement, number>()
      for (const child of list.children) {
        if (child instanceof HTMLElement) tops.set(child, topIn(list, child))
      }
      return tops
    }
    let tops = measure()
    const settle = (): void => {
      const next = measure()
      if (REDUCED?.matches !== true) {
        for (const [child, top] of next) {
          const was = tops.get(child)
          if (was === undefined || was === top) continue
          slide(child, was - top)
        }
      }
      tops = next
    }
    const sizes = new ResizeObserver(settle)
    const watch = (): void => {
      for (const child of list.children) sizes.observe(child)
    }
    sizes.observe(list)
    watch()
    const children = new MutationObserver(watch)
    children.observe(list, { childList: true })
    stop.current = () => {
      sizes.disconnect()
      children.disconnect()
    }
  }, [])
}

/**
 * 换内容是一次快速交接：旧内容（影子）往外让一点、很快淡掉，新内容同时从另一侧淡入、滑到位。
 * 旧的走得比新的快，两层叠在一起的只有开头一小段，而且那时旧的已经很淡——不糊；
 * 新内容一开始就在走，不会先空一下再冒出来——不闪。不用 blur（糊、也费 GPU），只动 transform / opacity。
 */
const SWAP_IN_MS = 320
const SWAP_OUT_MS = 160
const SWAP_SHIFT = 16
/** 「平滑减速」：一开始就走得快，尾巴轻轻落定。 */
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)'

/** 内容此刻的样子（上一次还没换完时是半路上的样子），影子从这里接着走。 */
interface Pose {
  x: number
  opacity: number
}

/** 换内容之前面板里是什么：哪一项、它在画布上的横坐标、此刻的样子。 */
interface Snapshot {
  key: string
  at: number
  ghost: Ghost
  pose: Pose
}

/** 刚卸掉的那块面板：紧接着又挂上一块（同一帧里），就是"换内容"，不是"新打开"。 */
let gone: { panel: HTMLElement; snap: Snapshot; time: number } | null = null
/** 新内容正在进来的动画：又换了一次从它此刻的样子接着走。 */
const entering = new WeakMap<Element, Animation>()

function snapshot(panel: HTMLElement, key: string, at: number): Snapshot {
  const first = panel.firstElementChild
  const running = first === null ? undefined : entering.get(first)
  let pose: Pose = { x: 0, opacity: 1 }
  if (first !== null && running?.playState === 'running') {
    const style = getComputedStyle(first)
    pose = { x: new DOMMatrixReadOnly(style.transform).m41, opacity: Number(style.opacity) }
  }
  return { key, at, ghost: ghostClone(panel), pose }
}

/**
 * 旧内容（影子）往外让、快速淡出，新内容从目标那一侧淡入，两层同时起步。
 * 方向：新内容在画布上更靠右，就从右边进来、旧的往左让。
 * 影子放完自己删；连点几下时前几个影子各自淡完，不中途拿掉（拿掉会跳一下）。
 */
function swapIn(panel: HTMLElement, snap: Snapshot, at: number): void {
  const parent = panel.parentNode
  if (parent === null || REDUCED?.matches === true) return
  const dir = at >= snap.at ? 1 : -1
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
    out = child.animate(
      [
        { transform: `translateX(${pose.x}px)`, opacity: pose.opacity },
        { transform: `translateX(${pose.x - dir * SWAP_SHIFT}px)`, opacity: 0 },
      ],
      { duration: SWAP_OUT_MS, easing: EASE_OUT, fill: 'forwards' },
    )
  }
  for (const child of panel.children) {
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
  const drop = (): void => ghost.remove()
  if (out === null) drop()
  else out.finished.then(drop, drop)
}

/** 换字、换图标时旧的留多久（和 ui.module.css 的 swapOut / iconOut 一致）。 */
const SWAP_TEXT_MS = 160
const SWAP_ICON_MS = 240

/** 记住上一个值：变了的那次渲染里把旧值、换了几次一起记下，过一会儿把旧值清掉。 */
function useLast<V>(value: V, ms: number): { was: V | null; n: number } {
  const [state, setState] = useState<{ value: V; was: V | null; n: number }>({
    value,
    was: null,
    n: 0,
  })
  if (value !== state.value) setState({ value, was: state.value, n: state.n + 1 })
  const { was, n } = state
  useEffect(() => {
    if (was === null) return
    const id = setTimeout(() => setState((s) => (s.n === n ? { ...s, was: null } : s)), ms)
    return () => clearTimeout(id)
  }, [was, n, ms])
  return { was, n }
}

/**
 * 原地换一段字（「保存中… → 已保存」「没有问题 → 3 个问题」、数字）：旧字往上让开淡掉，新字从下面浮上来。
 * 旧字画在 `::after` 里（`content: attr(data-was)`），不进 DOM 文本——读 `innerText` 的地方只看到新字。
 * `pop`：数字用，新数字带一点回弹。
 * `reserve`：会换到的所有字。给了就按最长的那段占宽，换字时外面的按钮不变宽变窄（点一下就换字的按钮要给）。
 */
export function SwapText(props: {
  text: string
  pop?: boolean
  reserve?: readonly string[]
}): React.JSX.Element {
  const { was, n } = useLast(props.text, SWAP_TEXT_MS)
  return (
    <span
      // 每换一次重新挂：两段动画都从头放。
      key={n}
      className={ui.swapText}
      data-was={was ?? undefined}
      data-fresh={n > 0 || undefined}
      data-pop={props.pop === true || undefined}
    >
      {props.reserve?.map((text) => (
        <span key={text} className={ui.swapSizer} data-text={text} aria-hidden="true" />
      ))}
      <span className={ui.swapNow}>{props.text}</span>
    </span>
  )
}

/** 原地换图标（复制 → ✓、对 ↔ 警告、太阳 ↔ 月亮）：两枚叠在同一格，新的从小放大淡入，旧的缩小淡出。 */
export function SwapIcon(props: { name: IconName; size?: number }): React.JSX.Element {
  const { was, n } = useLast(props.name, SWAP_ICON_MS)
  return (
    <span className={ui.swapIcon}>
      {was !== null && (
        <span key={`out-${n}`} className={ui.iconOut}>
          <Icon name={was} size={props.size} />
        </span>
      )}
      <span key={`in-${n}`} className={n > 0 ? ui.iconIn : undefined}>
        <Icon name={props.name} size={props.size} />
      </span>
    </span>
  )
}

/** 轻提示 / 提示条退场：往哪边走、走多久。 */
const EXITS = {
  /** 底部轻提示：往下沉、略缩。 */
  down: { frames: 'translateY(8px) scale(0.97)', ms: 220 },
  /** 顶部提示条：往上收。 */
  up: { frames: 'translateY(-8px) scale(0.98)', ms: 200 },
} as const

/**
 * 卸掉时留个影子放退场的一块（轻提示、提示条）：调用方照常按条件挂、按 key 换，不用等动画。
 * 动的是里面那一层——外面这层常带着居中用的 `translateX(-50%)`，两个 transform 不打架。
 * 换了一条（key 变了）时旧的影子往外走、新的照常浮进来，两条错开。
 */
export function ExitSeat(props: {
  className: string
  exit: keyof typeof EXITS
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { exit } = props
  useLayoutEffect(() => {
    const node = ref.current
    const parent = node?.parentNode ?? null
    return () => {
      if (node === null || parent === null || REDUCED?.matches === true) return
      const ghost = ghostClone(node)
      ghost.place(parent)
      const target = ghost.node.firstElementChild ?? ghost.node
      const { frames, ms } = EXITS[exit]
      const out = target.animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: frames },
        ],
        { duration: ms, easing: EASE_OUT, fill: 'forwards' },
      )
      const drop = (): void => ghost.node.remove()
      out.finished.then(drop, drop)
    }
  }, [exit])
  return (
    <div ref={ref} className={props.className}>
      {props.children}
    </div>
  )
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

/**
 * 右栏换了内容（选中了另一个节点 / 连线 / 回到总览）：栏框不动，旧内容让开淡出、新内容淡入（见 {@link swapIn}），
 * 方向按两者在画布上的左右（`at` 是横坐标）：选了右边的，新内容从右边进来。
 *
 * 两种情况都接得住：
 * - 面板按选中项挂键、每换一个就重新挂一块（编辑页的几种面板）：旧面板卸掉时拍下它的样子，
 *   同一帧里挂上的新面板拿它当影子；
 * - 面板一直挂着、只是内容换了（实例视图的右栏）：`key` 变了的那次渲染里 DOM 还是旧的，在那里拍。
 *
 * `key` 两边要用同一种写法：实例视图里「运行 / 编辑」来回切，选中的还是同一项，不滑（标题栏要原地不动）。
 * 只放 Web Animation（transform / opacity），不重新挂载，焦点、输入都留着。
 */
export function useSwap<E extends HTMLElement>(key: string, at: number): RefObject<E> {
  const ref = useRef<E>(null)
  /** 屏幕上现在是哪一项。 */
  const shown = useRef({ key, at })
  const pending = useRef<Snapshot | null>(null)
  // 渲染阶段 DOM 还没换：拍旧内容只能在这里（提交之后就已经是新的了）。
  const live = ref.current
  if (
    live !== null &&
    key !== shown.current.key &&
    pending.current === null &&
    REDUCED?.matches !== true
  ) {
    pending.current = snapshot(live, shown.current.key, shown.current.at)
  }
  useLayoutEffect(() => {
    const panel = ref.current
    if (panel === null) return
    const recent = gone
    gone = null
    if (
      recent !== null &&
      recent.panel !== panel &&
      recent.snap.key !== shown.current.key &&
      performance.now() - recent.time < 50
    ) {
      swapIn(panel, recent.snap, shown.current.at)
    }
    return () => {
      if (REDUCED?.matches === true) return
      // 这时栏框（面板的父元素）还在页面上：React 先跑子树的清理、最后才摘 DOM。
      const frame = panel.parentElement
      // 栏框的父元素也要现在记下：微任务里栏框已经被摘掉，`parentNode` 是 null 了。
      const host = frame?.parentNode ?? null
      const entry = {
        panel,
        snap: snapshot(panel, shown.current.key, shown.current.at),
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
    shown.current = { key, at }
    const panel = ref.current
    if (snap !== null && panel !== null && was.key !== key) swapIn(panel, snap, at)
  }, [key, at])
  return ref as RefObject<E>
}

/**
 * 选中底块：列表里 `data-selected="true"` 的那一项底下垫一块，换选中时滑过去（不是这块灭、那块亮）。
 * 放在列表的第一个子位置（列表要 `position: relative`）；项自己不再画选中底色。
 * `layout` 同 {@link useFlip}：选中项、列表内容变了才重新量。
 *
 * 列表是自己的父元素（不收外面的 ref）：外面那个 ref 在子组件的 layout effect 跑的时候还没挂上。
 */
export function ListThumb(props: { layout: string; className?: string }): React.JSX.Element {
  const ref = useRef<HTMLSpanElement>(null)
  const [place, setPlace] = useState<Place | null>(null)
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
    setPlace((was) => {
      if (item == null) return was === null ? null : { ...was, hidden: true }
      const next = {
        top: item.offsetTop,
        left: item.offsetLeft,
        width: item.offsetWidth,
        height: item.offsetHeight,
        hidden: false,
      }
      return was !== null && Object.entries(next).every(([k, v]) => was[k as keyof Place] === v)
        ? was
        : next
    })
  }, [props.layout, resized])
  useLayoutEffect(() => {
    if (place === null || live) return
    const frame = requestAnimationFrame(() => setLive(true))
    return () => cancelAnimationFrame(frame)
  }, [place, live])
  return (
    <span
      ref={ref}
      aria-hidden="true"
      className={cx(ui.listThumb, props.className)}
      data-live={live}
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
