/**
 * dsh-workflow-lite — 悬浮提示。
 *
 * 它替掉原生 `title`：原生提示延迟约一秒、样式跟不了主题（暗色下是一块系统白板）、
 * 不能换行，而且**键盘焦点上根本不出现**。这里要的三件事它一件都给不了。
 *
 * **只包叶子控件**（按钮 / 图标 / 状态点）。两条理由：
 * 1. 它在外面加一层宿主 `<span>`，作为 flex 子项时布局就从"控件"挪到了"宿主的包装"上——
 *    拿它包一整个 section，那一段的 flex 行为就变了；
 * 2. 宿主越大，`pointerenter` 越容易在"只是路过"时触发，提示会退化成噪音。
 * 所以：包按钮可以，包面板 / 包画布容器不行（画布容器那句提示仍留在原生 `title` 上）。
 *
 * **浮层留在原地，靠 `position: fixed` 逃逸裁剪**：顶栏与画布工具条都是横向滚动容器
 *（`overflow-x: auto`），提示只要是"参与它们布局"的后代就会被裁在那 41px 里。而 `fixed` 盒
 * 的包含块是**视口**（在包含块之外的祖先裁不到它），所以不需要 `createPortal` 就能浮出来——
 * 这一点很要紧：`--wl-*` 令牌都声明在画布根节点 `.root` 上，**portal 到 `document.body` 就继承不到**
 *（那样的浮层会是一块没有底色、没有圆角、没有内边距的裸盒子）。代价是：祖先里若有人写
 * `transform` / `filter` / `contain`，包含块会变成那一层、几何随之失效——本视图的祖先链上
 * 没有这种东西（会话外壳那两个滚动容器只声明了 `overflow` 与 `position`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/components/Tooltip
 */
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import css from './Tooltip.module.css'

/** 悬停多久才显示：太短会在扫过一排按钮时闪成一片，太长等于没有。 */
const DELAY_MS = 350
/** 提示与宿主之间的竖向留白。 */
const GAP = 4
/** 距视口边缘的最小留白（夹紧用）。 */
const EDGE = 8

export interface TooltipProps {
  /** 提示文字。空串 = 不显示（调用方不必再包一层条件）。 */
  label: string
  children: ReactNode
}

interface Position {
  left: number
  top: number
}

/**
 * 把提示摆到宿主上方（顶上放不下就翻到下方），并横向夹进视口。
 *
 * 宽度必须**量过**才知道（文案长度不定），所以调用方先渲染再回来纠一次坐标。
 * @param host - 宿主控件的矩形。
 * @param box - 提示自身的矩形。
 * @returns 视口坐标（`fixed` 定位用）。
 */
function place(host: DOMRect, box: DOMRect): Position {
  const viewportW = window.innerWidth
  const viewportH = window.innerHeight
  const above = host.top - GAP - box.height
  const below = host.bottom + GAP
  // 上面放得下就放上面；上面放不下、下面放得下就翻下去；两边都放不下留在下面并夹住。
  const top = above >= EDGE ? above : Math.min(below, viewportH - EDGE - box.height)
  const centered = host.left + host.width / 2 - box.width / 2
  const left = Math.min(Math.max(EDGE, centered), Math.max(EDGE, viewportW - EDGE - box.width))
  return { left: Math.round(left), top: Math.round(Math.max(EDGE, top)) }
}

/**
 * 悬停 / 聚焦时显示一段说明。
 * @param props - 提示文字与它包住的控件。
 */
export function Tooltip(props: TooltipProps): React.JSX.Element {
  const { label, children } = props
  const hostRef = useRef<HTMLSpanElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [shown, setShown] = useState(false)
  const [position, setPosition] = useState<Position | null>(null)

  const clearTimer = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  /** 收起并归零坐标：下次显示重新量一次（宿主可能挪过位置）。 */
  const hide = useCallback((): void => {
    clearTimer()
    setShown(false)
    setPosition(null)
  }, [clearTimer])

  const show = useCallback((): void => {
    if (label === '') return
    clearTimer()
    timer.current = setTimeout(() => {
      timer.current = null
      setShown(true)
    }, DELAY_MS)
  }, [clearTimer, label])

  // 卸载时别把定时器留在那（它到点会 setState 到一个已经没了的组件上）。
  useEffect(() => clearTimer, [clearTimer])

  /*
   * 量一次再摆。
   *
   * 用 `useLayoutEffect` 而不是 `useEffect`：这一帧就把坐标定下来，不会先闪在 (0,0) 上
   * （第一次渲染的 `position` 是 `null`，那时浮层是 `visibility: hidden` 的，量得到尺寸、
   * 看不见人）。
   */
  useLayoutEffect(() => {
    if (!shown) return
    const host = hostRef.current
    const tip = tipRef.current
    if (host === null || tip === null) return
    const next = place(host.getBoundingClientRect(), tip.getBoundingClientRect())
    setPosition((current) =>
      current !== null && current.left === next.left && current.top === next.top ? current : next,
    )
  }, [shown])

  /*
   * 显示期间滚一下、改一下窗口尺寸，`fixed` 坐标就失效了。这里选择**直接收起来**而不是
   * 跟随：提示是瞬时的，跟着滚反而像一块甩不掉的贴纸（原生 title 也是这么做的）。
   */
  useEffect(() => {
    if (!shown) return
    const dismiss = (): void => hide()
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    return () => {
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
    }
  }, [shown, hide])

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 宿主只是命中区与定位锚点，语义在包住的控件上；它不接受焦点、也不吞任何键
    <span
      className={css.host}
      ref={hostRef}
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {shown && (
        <div
          className={css.tip}
          data-testid="wl-tooltip"
          role="tooltip"
          ref={tipRef}
          style={{
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            // 坐标量到之前先占位不显示：量尺寸需要它已经在树上。
            visibility: position === null ? 'hidden' : 'visible',
          }}
        >
          {label}
        </div>
      )}
    </span>
  )
}
