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
import { cx, type Ghost, ghostClone, ghostFade } from './primitives.tsx'
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

/** 一项在列表里占的地方（相对列表的内边距框）：删掉后影子照这个摆回去。 */
interface Slot {
  top: number
  left: number
  width: number
  height: number
}

/** 删掉的项留下的影子：列表再量各项时跳过它们。 */
const leaving = new WeakSet<Element>()

const LEAVE_MS = 180

/**
 * 退场：位移、缩放缓出，透明度匀速——透明度也缓出的话一开始就掉光，看着像一下没了。
 * 返回透明度那段（放完就看不见了，拿它当删影子的时机）。
 */
function fadeAway(
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

/**
 * 删掉的一项：照它被删前的样子复制一份，按原来的位置绝对定位放回列表，原地淡出、略缩，放完就删。
 * 列表要是定位元素（`position: relative`），不然摆不回原处，就不放。
 */
function leaveAt(list: HTMLElement, node: HTMLElement, slot: Slot): void {
  if (getComputedStyle(list).position === 'static') return
  const ghost = ghostClone(node)
  ghost.node.removeAttribute('data-flip')
  ghost.node.removeAttribute('data-selected')
  Object.assign(ghost.node.style, {
    position: 'absolute',
    top: `${slot.top}px`,
    left: `${slot.left}px`,
    width: `${slot.width}px`,
    height: `${slot.height}px`,
    margin: '0',
    boxSizing: 'border-box',
  })
  leaving.add(ghost.node)
  ghost.place(list)
  const out = fadeAway(ghost.node, { opacity: 1, transform: 'none' }, 'scale(0.97)', LEAVE_MS)
  const drop = (): void => ghost.node.remove()
  out.finished.then(drop, drop)
}

/** 新加的一项：从左边一点淡入（和 {@link useFlip} 的入场一样）。 */
function enterIn(child: Element): void {
  child.animate(
    [
      { opacity: 0, transform: 'translateX(-6px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: ENTER_MS, easing: EASE, fill: 'backwards' },
  )
}

/** 右栏刚换了内容（{@link swapIn}）：这时列表里的整批增删是换内容，不是有人删了一项，不放增删动画。 */
let swappedAt = Number.NEGATIVE_INFINITY

/**
 * 列表里有一项变高变矮（展开、收起、内容换了）或增删了项：它后面的项从旧位置滑到新位置。
 * 和 {@link useFlip} 一样只动 transform，不同的是不用给 `layout`——ResizeObserver 看着每一项，
 * 尺寸一变（布局之后、绘制之前）就比一遍各项的 `offsetTop`；项按元素本身认（React 按 key 留着同一个元素）。
 *
 * - `exit`：删掉的项留个影子原地淡出（见 {@link leaveAt}），列表要 `position: relative`；
 * - `enter`：新加的项从左边淡入（项自己带入场动画的不用开）。
 *
 * 返回一个回调 ref，挂到列表上（列表可以晚挂上、可以换）。项要有不透明的底色：
 * 往下滑的项像帘子一样盖着、再露出上面刚展开的内容。
 */
export function useResizeFlip(
  options: { exit?: boolean; enter?: boolean } = {},
): (list: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null)
  const exit = options.exit === true
  const enter = options.enter === true
  useEffect(() => () => stop.current?.(), [])
  return useCallback(
    (list: HTMLElement | null) => {
      stop.current?.()
      stop.current = null
      if (list === null || typeof ResizeObserver === 'undefined') return
      const measure = (): Map<HTMLElement, Slot> => {
        const slots = new Map<HTMLElement, Slot>()
        for (const child of list.children) {
          if (
            !(child instanceof HTMLElement) ||
            leaving.has(child) ||
            child.hasAttribute('data-no-flip')
          )
            continue
          slots.set(child, {
            top: topIn(list, child),
            left: child.offsetLeft,
            width: child.offsetWidth,
            height: child.offsetHeight,
          })
        }
        return slots
      }
      let slots = measure()
      const settle = (): void => {
        const next = measure()
        if (REDUCED?.matches !== true) {
          for (const [child, slot] of next) {
            const was = slots.get(child)
            if (was === undefined || was.top === slot.top) continue
            slide(child, was.top - slot.top)
          }
        }
        slots = next
      }
      const sizes = new ResizeObserver(settle)
      const watch = (): void => {
        for (const child of list.children) {
          if (!leaving.has(child) && !child.hasAttribute('data-no-flip')) sizes.observe(child)
        }
      }
      sizes.observe(list)
      watch()
      const children = new MutationObserver((records) => {
        const still = REDUCED?.matches === true || performance.now() - swappedAt < 80
        if (!still && (exit || enter)) {
          for (const record of records) {
            if (exit) {
              for (const node of record.removedNodes) {
                // 挪了位置（删了又插回来）的不算删。
                if (!(node instanceof HTMLElement) || node.isConnected || leaving.has(node))
                  continue
                const slot = slots.get(node)
                if (slot !== undefined) leaveAt(list, node, slot)
              }
            }
            if (enter) {
              for (const node of record.addedNodes) {
                if (node instanceof HTMLElement && !leaving.has(node) && !slots.has(node)) {
                  enterIn(node)
                }
              }
            }
          }
        }
        watch()
        // 删掉一项时其余项的尺寸没变、列表也可能是定高的：ResizeObserver 不一定叫，这里补一次。
        settle()
      })
      children.observe(list, { childList: true })
      stop.current = () => {
        sizes.disconnect()
        children.disconnect()
      }
    },
    [exit, enter],
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
  const drop = (): void => ghost.remove()
  if (out === null) drop()
  else out.finished.then(drop, drop)
}

/** 换字、换图标时旧的留多久（和 ui.module.css 的 swapOut / iconOut 一致）。 */
const SWAP_TEXT_MS = 160
const SWAP_ICON_MS = 240

/** 记住上一个值：变了的那次渲染里把旧值、换了几次一起记下，过一会儿把旧值清掉。 */
export function useLast<V>(value: V, ms: number): { was: V | null; n: number } {
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

/**
 * 原地换图标（复制 → ✓、对 ↔ 警告、太阳 ↔ 月亮）：两枚叠在同一格，新的从小放大淡入，旧的缩小淡出。
 * ✓ 一律用「成功」的绿色（复制路径、从磁盘重新加载等「已完成」的反馈都走这里），退场的那枚也一样。
 */
export function SwapIcon(props: { name: IconName; size?: number }): React.JSX.Element {
  const { was, n } = useLast(props.name, SWAP_ICON_MS)
  return (
    <span className={ui.swapIcon}>
      {was !== null && (
        <span key={`out-${n}`} className={ui.iconOut} data-ok={was === 'check' || undefined}>
          <Icon name={was} size={props.size} />
        </span>
      )}
      <span
        key={`in-${n}`}
        className={n > 0 ? ui.iconIn : undefined}
        data-ok={props.name === 'check' || undefined}
      >
        <Icon name={props.name} size={props.size} />
      </span>
    </span>
  )
}

/** 退场：往哪边走、走多久（都是入场的反方向）。 */
const EXITS = {
  /** 底部轻提示、草稿栏：往下沉、略缩。 */
  down: { frames: 'translateY(8px) scale(0.97)', ms: 220 },
  /** 顶部提示条：往上收。 */
  up: { frames: 'translateY(-8px) scale(0.98)', ms: 200 },
  /** 就地弹出的菜单：原地缩回、淡出（缩向 CSS 里的 transform-origin）。 */
  shrink: { frames: 'scale(0.95)', ms: 140 },
  /** 从右边拉出来的抽屉：退回右边。 */
  right: { frames: 'translateX(16px)', ms: 180 },
} as const

type Exit = keyof typeof EXITS

/**
 * 卸掉时留个影子放退场：照它此刻的样子复制一份放回原处（定位方式由它自己的类决定），动完就删。
 * `inner`：动里面那一层——外面那层带着定位用的 transform（居中的 `translateX(-50%)`）时用，两个 transform 不打架。
 * 不动里面那层时，从它此刻的 transform、透明度接着走（入场还没放完就关也不跳）。
 */
function leave(node: HTMLElement, parent: Node, exit: Exit, inner: boolean): void {
  if (REDUCED?.matches === true || !parent.isConnected) return
  const live = inner ? (node.firstElementChild ?? node) : node
  const style = getComputedStyle(live)
  const base = style.transform === 'none' ? '' : `${style.transform} `
  const opacity = Number(style.opacity)
  const ghost = ghostClone(node)
  ghost.place(parent)
  const target = inner ? (ghost.node.firstElementChild ?? ghost.node) : ghost.node
  const { frames, ms } = EXITS[exit]
  const out = fadeAway(
    target,
    { opacity, transform: base === '' ? 'none' : base },
    `${base}${frames}`,
    ms,
  )
  const drop = (): void => ghost.node.remove()
  out.finished.then(drop, drop)
}

/**
 * 给按条件挂的一块加退场（就地菜单、抽屉、草稿栏）：返回的 ref 挂到它的根上，卸掉时留影子放 `exit`。
 * 调用方照常按条件挂，不用等动画。
 */
export function useExit<E extends HTMLElement>(
  exit: Exit,
  options: { inner?: boolean } = {},
): RefObject<E> {
  const ref = useRef<E>(null)
  const inner = options.inner === true
  useLayoutEffect(() => {
    const node = ref.current
    const parent = node?.parentNode ?? null
    return () => {
      if (node !== null && parent !== null) leave(node, parent, exit, inner)
    }
  }, [exit, inner])
  return ref as RefObject<E>
}

/**
 * 卸掉时留个影子放退场的一块（轻提示、提示条）：调用方照常按条件挂、按 key 换，不用等动画。
 * 动的是里面那一层——外面这层常带着居中用的 `translateX(-50%)`，两个 transform 不打架。
 * 换了一条（key 变了）时旧的影子往外走、新的照常浮进来，两条错开。
 */
export function ExitSeat(props: {
  className: string
  exit: Exit
  children: React.ReactNode
}): React.JSX.Element {
  const ref = useExit<HTMLDivElement>(props.exit, { inner: true })
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
    running.current = thumb.animate(
      [{ transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` }, { transform: 'none' }],
      { duration: PICK_MS, easing: EASE_OUT },
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

/**
 * 随选中态变色的字：本身透明（只占宽度、给读屏和测试读），上面叠两层同样的字——灰的和强调色的，
 * `on` 变了交叉淡过去（只动 opacity，不是颜色瞬切）。
 * 颜色由外面的自定义属性给：`--wl-off`（没选中，默认 text-2）、`--wl-on`（选中，默认 text）。
 * `pop`：选中时字弹一下（要在 PickThumb 所在的组里，见 `popIn`）。
 */
export function FadeText(props: {
  text: string
  on: boolean
  pop?: boolean
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cx(ui.fadeText, props.className)}
      data-text={props.text}
      data-on={props.on}
      data-pick-pop={props.pop === true ? '0.9' : undefined}
    >
      {props.text}
    </span>
  )
}

/**
 * 随选中态变色的图标 / 小标记：灰、强调色两枚叠在同一格，`on` 变了交叉淡过去；强调色那枚同时弹一下。
 * 颜色同 {@link FadeText}：没选中时继承外面的字色，选中时 `--wl-on`（默认 accent-text）。
 */
export function FadeMark(props: {
  on: boolean
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <span className={cx(ui.fadeMark, props.className)} data-on={props.on}>
      <span className={ui.fadeMarkOff}>{props.children}</span>
      <span className={ui.fadeMarkOn} data-pick-pop="">
        {props.children}
      </span>
    </span>
  )
}

/**
 * 「是 / 否」的小状态（经过没有、生成没有）：圆点 + 一段字，是时点实心变绿，否时空心灰圈，
 * 点和字都是两层交叉淡（FadeMark / FadeText），不是颜色瞬切。`dot` 是点本身的类（大小、描边）。
 */
export function DotState(props: {
  on: boolean
  text: string
  dot: string
  className?: string
  testId?: string
}): React.JSX.Element {
  return (
    <span
      className={cx(ui.dotState, props.className)}
      data-on={props.on}
      data-testid={props.testId}
    >
      <FadeMark on={props.on}>
        <span className={props.dot} />
      </FadeMark>
      <FadeText text={props.text} on={props.on} />
    </span>
  )
}

/** 描边层换色时旧的留多久（同 ui.module.css 的 ringOut）。 */
const RING_MS = 220

/**
 * 随状态换色的描边（卡片的运行态边框、角色边框、执行位置的外圈）：一个状态一层，
 * 换状态时旧的一层淡出、新的一层淡入（只动 opacity），不是 `border-color` 瞬切。
 * 层本身的样子由调用方的 `className` + `[data-ring="状态名"]` 给；`ring` 为空 = 没有描边（旧的淡出）。
 * 父元素要 `position: relative`；平时不占 DOM（没有状态就没有层）。
 */
export function FadeRing(props: {
  ring: string | undefined
  className: string
}): React.JSX.Element {
  const { was, n } = useLast(props.ring ?? null, RING_MS)
  return (
    <>
      {was !== null && (
        <span
          key={`out-${n}`}
          className={cx(props.className, ui.ringOut)}
          data-ring={was}
          aria-hidden="true"
        />
      )}
      {props.ring !== undefined && (
        <span
          key={`in-${props.ring}`}
          className={cx(props.className, ui.ringIn)}
          data-ring={props.ring}
          aria-hidden="true"
        />
      )}
    </>
  )
}

const VANISH_MS = 200

/**
 * 画布上删掉的步骤、资源、连线：留个影子原地退场（步骤卡缩小淡出，连线和线上的小牌子淡出），不是一下没了。
 *
 * 只在"同一份文档里少了几个 id"时放（`loadKey` 没变）：换工作流、换实例时整张图换掉，不放。
 * React Flow 删 DOM 的时机由它自己定（可能晚一次提交），所以这里先记下哪些 id 没了，
 * 再用 MutationObserver 等那些元素真的被摘掉，照它们最后的样子复制影子放回原处。
 *
 * 认元素：节点外壳、连线 `<g>` 上的 `data-id`（React Flow 加的），线上小牌子写 `data-vanish`。
 */
export function useCanvasExits(
  root: RefObject<HTMLElement | null>,
  loadKey: string,
  ids: readonly string[],
): void {
  const last = useRef<{ loadKey: string; ids: Set<string> } | null>(null)
  const armed = useRef<{ ids: Set<string>; until: number } | null>(null)
  useLayoutEffect(() => {
    const now = new Set(ids)
    const was = last.current
    last.current = { loadKey, ids: now }
    if (was === null || was.loadKey !== loadKey) return
    const gone = [...was.ids].filter((id) => !now.has(id))
    if (gone.length > 0) armed.current = { ids: new Set(gone), until: performance.now() + 500 }
  }, [loadKey, ids])
  useEffect(() => {
    const host = root.current
    if (host === null) return
    const watch = new MutationObserver((records) => {
      const arm = armed.current
      if (arm === null) return
      if (performance.now() > arm.until) {
        armed.current = null
        return
      }
      if (REDUCED?.matches === true) return
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof Element) || node.isConnected || leaving.has(node)) continue
          const id =
            node.getAttribute('data-id') ??
            node.getAttribute('data-vanish') ??
            node.querySelector(':scope > [data-id]')?.getAttribute('data-id') ??
            null
          if (id === null || !arm.ids.has(id)) continue
          vanish(node, record.target, record.nextSibling)
        }
      }
    })
    watch.observe(host, { childList: true, subtree: true })
    return () => watch.disconnect()
  }, [root])
}

/** 照摘掉的元素复制一份放回原处（还在原来的兄弟之间），放退场，放完删。 */
function vanish(node: Element, parent: Node, before: Node | null): void {
  const ghost = ghostClone(node as HTMLElement)
  ghost.node.removeAttribute('data-id')
  ghost.node.removeAttribute('data-vanish')
  leaving.add(ghost.node)
  ghost.place(parent)
  if (before !== null && before.parentNode === parent) parent.insertBefore(ghost.node, before)
  // 节点外壳带着定位用的 translate：缩放放在里面那张卡上。
  const card = node.classList.contains('react-flow__node')
    ? (ghost.node.firstElementChild ?? ghost.node)
    : null
  const out =
    card === null
      ? ghost.node.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: VANISH_MS,
          easing: 'linear',
          fill: 'forwards',
        })
      : fadeAway(card, { opacity: 1, transform: 'none' }, 'scale(0.92)', VANISH_MS)
  const drop = (): void => ghost.node.remove()
  out.finished.then(drop, drop)
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

/** 药丸变宽 / 变窄的时长；变窄前先等一会（名字换了、状态字换了，别马上缩，等视线落稳再收）。 */
const GLIDE_GROW_MS = 280
const GLIDE_SHRINK_MS = 340
const GLIDE_HOLD_MS = 260

/**
 * 宽度随内容变的药丸（顶栏左边：名字、状态字一换，宽度就变）：不让宽度跳，只靠 transform 展开收缩。
 * 药丸里放一块 `data-glide-surface`（绝对定位铺满、左边为原点的底面：边框、底色、阴影都画在它上面），
 * 以及要跟着挪的 `data-glide` 小件（被挤到新位置的图标、状态按钮）：
 * 宽度一变，底面从旧宽度 `scaleX` 过渡到新宽度，小件从旧位置 `translateX` 滑到新位置；
 * 变宽立刻展开，变窄先停 `hold`（默认 {@link GLIDE_HOLD_MS}）毫秒再收；宽度是被布局挤变的、
 * 没有"等视线落稳"的需要时传 0（缩放条：右面板一开图例就收成按钮）。上一段还没放完就变了，从看上去的地方接着走。
 * 返回回调 ref，挂到药丸上。
 */
export function useGlide(hold: number = GLIDE_HOLD_MS): (pill: HTMLElement | null) => void {
  const stop = useRef<(() => void) | null>(null)
  useEffect(() => () => stop.current?.(), [])
  return useCallback(
    (pill: HTMLElement | null) => {
      stop.current?.()
      stop.current = null
      if (pill === null || typeof ResizeObserver === 'undefined') return
      let width = pill.offsetWidth
      /** 各小件上次落定的位置（相对药丸左边）。 */
      let spots = new Map<HTMLElement, number>()
      const running = new Map<HTMLElement, Animation>()
      const surface = (): HTMLElement | null => pill.querySelector('[data-glide-surface]')
      const items = (): HTMLElement[] => [...pill.querySelectorAll<HTMLElement>('[data-glide]')]
      const leftOf = (el: HTMLElement, origin: number): number =>
        el.getBoundingClientRect().left - origin
      const remember = (): void => {
        const origin = pill.getBoundingClientRect().left
        spots = new Map(items().map((el) => [el, leftOf(el, origin)]))
      }
      remember()

      const sizes = new ResizeObserver(() => {
        const next = pill.offsetWidth
        if (next === width) return
        const was = width
        width = next
        const base = surface()
        if (REDUCED?.matches === true || base === null) {
          remember()
          return
        }
        const origin = pill.getBoundingClientRect().left
        // 先读旧动画此刻的位移 / 缩放，再清掉它。起点是「旧布局 + 此刻的位移」：
        // 布局已经是新的了，直接量元素现在的位置会把新布局也算进去（宽度会被放大）。
        const shift = (el: HTMLElement): number =>
          running.has(el) ? new DOMMatrixReadOnly(getComputedStyle(el).transform).m41 : 0
        const seen = new Map<HTMLElement, number>()
        for (const el of items()) {
          const before = spots.get(el)
          if (before !== undefined) seen.set(el, before + shift(el))
        }
        const seenWidth = running.has(base)
          ? new DOMMatrixReadOnly(getComputedStyle(base).transform).a * was
          : was
        for (const anim of running.values()) anim.cancel()
        running.clear()

        const shrink = seenWidth > next
        const timing = {
          duration: shrink ? GLIDE_SHRINK_MS : GLIDE_GROW_MS,
          delay: shrink ? hold : 0,
          easing: EASE,
          fill: 'backwards' as const,
        }
        if (Math.abs(seenWidth / next - 1) > 0.002) {
          running.set(
            base,
            base.animate(
              [{ transform: `scaleX(${seenWidth / next})` }, { transform: 'none' }],
              timing,
            ),
          )
        }
        const fresh = new Map<HTMLElement, number>()
        for (const el of items()) {
          const now = leftOf(el, origin)
          fresh.set(el, now)
          const from = seen.get(el) ?? spots.get(el)
          if (from === undefined || Math.abs(from - now) < 0.5) continue
          running.set(
            el,
            el.animate(
              [{ transform: `translateX(${from - now}px)` }, { transform: 'none' }],
              timing,
            ),
          )
        }
        spots = fresh
        for (const [el, anim] of running) {
          const forget = (): void => {
            if (running.get(el) === anim) running.delete(el)
          }
          anim.finished.then(forget, forget)
        }
      })
      sizes.observe(pill)
      stop.current = () => {
        sizes.disconnect()
        for (const anim of running.values()) anim.cancel()
      }
    },
    [hold],
  )
}

/**
 * 画布这一整块要被卸掉时（模板编辑 ↔ 实例视图）：留一个影子在原处淡出，新画布同时淡入，两边交叉过去。
 * 影子放进视图根（`data-workflow-lite-view`），不放在父节点里——实例视图的外壳跟着一起卸掉，放里面就看不到了。
 */
export function useViewGhost(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    const root = el?.closest('[data-workflow-lite-view]') ?? null
    return () => {
      if (el !== null) ghostFade(el, root)
    }
  }, [ref])
}
