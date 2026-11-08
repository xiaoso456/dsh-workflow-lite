/**
 * dsh-workflow-lite — 模态框：遮罩 + 居中的一张卡，挂载点上下文，以及弹窗从触发控件长出来 / 缩回去的进出场。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/Modal
 */

import {
  createContext,
  type RefObject,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import { createPortal } from 'react-dom'
import { cx } from './cx.ts'
import { ghostOut, REDUCED_MOTION } from './ghost.ts'
import overlay from './overlay.module.css'
import ui from './ui.module.css'

/**
 * 模态框挂到哪里：视图根节点。
 *
 * 面板里打开的模态框不能就地渲染——面板自己带着入场动画（`transform`），会变成里面
 * `position: absolute` 的定位参照，遮罩就只盖住面板那一条。挂回视图根，遮罩盖住整个视图，
 * 设计令牌照常继承，也不会跑出视图去盖宿主页面。
 */
export const ModalHost = createContext<HTMLElement | null>(null)
export const ModalHostProvider = ModalHost.Provider

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])'

/**
 * 模态框：遮罩 + 居中的一张卡。
 *
 * - 键盘事件一律在这里截住：React 的合成事件会顺着组件树（而不是 DOM 树）冒泡，不截的话
 *   在模态框里按 Delete / Esc 会冒到视图根，删掉画布上选中的步骤。
 * - Esc 与点遮罩都走 `onDismiss`；调用方据此决定"有没写完的改动时不关"。
 * - 只有按下与松开都落在遮罩上才算点遮罩：在输入框里拖选文字、松手落在外面，不该把框关掉。
 * - Tab 在框内循环；关掉后焦点还给打开它的那个按钮。
 */
export function Modal(props: {
  label: string
  onDismiss(): void
  children: React.ReactNode
  className?: string
  testId?: string
}): React.JSX.Element {
  const host = useContext(ModalHost)
  const ref = useRef<HTMLDivElement>(null)
  const downOnScrim = useRef(false)
  const scrimRef = useRef<HTMLDivElement>(null)
  useSheetMotion(scrimRef, ref)

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    if (dialog !== null && !dialog.contains(document.activeElement)) dialog.focus()
    return () => {
      if (opener?.isConnected === true) opener.focus({ preventScroll: true })
    }
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    // Ctrl / ⌘ + S 留给打开它的那块（「我的步骤」在弹窗里改提示词时照样能存）。
    const save = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's'
    if (!save) event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      props.onDismiss()
      return
    }
    if (event.key !== 'Tab') return
    const items = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
    const first = items[0]
    const last = items[items.length - 1]
    if (first === undefined || last === undefined) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const tree = (
    <div
      ref={scrimRef}
      className={overlay.scrim}
      onPointerDown={(event) => {
        downOnScrim.current = event.target === event.currentTarget
      }}
      onPointerUp={(event) => {
        if (downOnScrim.current && event.target === event.currentTarget) props.onDismiss()
        downOnScrim.current = false
      }}
    >
      <div
        ref={ref}
        className={cx(ui.panel, overlay.sheet, props.className)}
        role="dialog"
        aria-modal="true"
        aria-label={props.label}
        tabIndex={-1}
        data-testid={props.testId}
        onKeyDown={onKeyDown}
      >
        {props.children}
      </div>
    </div>
  )
  return host === null ? tree : createPortal(tree, host)
}

/** 触发弹窗的那个控件的位置和大小（视口坐标）。 */
interface Source {
  x: number
  y: number
  w: number
  h: number
}

/** 最近一次按下指针：落在哪个控件上（记下当时的矩形——点完菜单会收起，之后就量不到了）。 */
let lastPress: { box: Source; at: number } | null = null
if (typeof document !== 'undefined') {
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target instanceof Element ? event.target : null
      const control =
        target?.closest('button, a, [role="button"], [role="menuitem"], [role="option"]') ?? null
      const rect = control?.getBoundingClientRect()
      lastPress =
        rect !== undefined && rect.width > 0 && rect.height > 0
          ? {
              box: { x: rect.left, y: rect.top, w: rect.width, h: rect.height },
              at: performance.now(),
            }
          : {
              box: { x: event.clientX - 16, y: event.clientY - 16, w: 32, h: 32 },
              at: performance.now(),
            }
    },
    true,
  )
}

/**
 * 弹窗从哪个控件长出来：刚按下指针（1.5 秒内）取按下的那个控件；不是点开的（键盘打开）取当前焦点所在的元素；
 * 都没有（焦点在 body 上、过了很久才弹出来）返回 `null`，弹窗从自己的中心浮起。
 */
function openSource(): Source | null {
  if (lastPress !== null && performance.now() - lastPress.at < 1500) return lastPress.box
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused !== document.body) {
    const rect = focused.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) {
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height }
    }
  }
  return null
}

/** 弹窗缩进触发控件时的样子：中心对中心，缩到刚好装进控件里（缩放不小于 0.08、不大于 0.5）。 */
function foldedTransform(source: Source, dialog: HTMLElement, scrim: HTMLElement): string {
  const frame = scrim.getBoundingClientRect()
  // offsetLeft / offsetTop / offsetWidth 不受正在放的变换影响（getBoundingClientRect 受）。
  const centerX = frame.left + dialog.offsetLeft + dialog.offsetWidth / 2
  const centerY = frame.top + dialog.offsetTop + dialog.offsetHeight / 2
  const scale = Math.min(
    0.5,
    Math.max(0.08, Math.min(source.w / dialog.offsetWidth, source.h / dialog.offsetHeight)),
  )
  const dx = source.x + source.w / 2 - centerX
  const dy = source.y + source.h / 2 - centerY
  return `translate(${dx}px, ${dy}px) scale(${scale})`
}

/** 入场的弹簧：读视图根的 `--wl-spring` 令牌（老内核上是贝塞尔）。 */
function springOf(element: Element): string {
  return (
    getComputedStyle(element).getPropertyValue('--wl-spring').trim() ||
    'cubic-bezier(0.34, 1.3, 0.64, 1)'
  )
}

/**
 * 弹窗的进出场（模态框、计划对话框共用）——「从点的那个控件里长出来、缩回那个控件里」（iOS 打开 App、macOS 最小化的路数）：
 * - 打开：量出触发控件的位置，弹窗先缩成控件那么小、叠在控件上，再用弹簧放大到位（淡入只在前三成，先看到一小块从控件里冒出来）；
 * - 关掉：留一个"影子"，缩回同一个控件的位置、淡出（见 ghostOut）；调用方直接卸掉弹窗，不用等动画；
 * - 找不到触发控件（过了很久才弹出来、不是点开的）：用样式里的 `dialogIn`，从中心浮起。
 */
export function useSheetMotion(
  scrimRef: RefObject<HTMLElement | null>,
  dialogRef: RefObject<HTMLElement | null>,
): void {
  const folded = useRef<string | null>(null)
  useLayoutEffect(() => {
    const scrim = scrimRef.current
    const parent = scrim?.parentNode ?? null
    return () => {
      if (scrim !== null) ghostOut(scrim, parent, folded.current)
    }
  }, [scrimRef])

  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const scrim = scrimRef.current
    // 合成层一直留着：放大动画一结束浏览器就把弹窗内容按真实大小重画一遍，里面的文字、图标会整体错位一两个像素（缩放不是整数的屏幕上最明显）。
    if (dialog !== null) dialog.style.willChange = 'transform'
    const source = openSource()
    if (dialog === null || scrim === null || source === null || REDUCED_MOTION?.matches === true) {
      return
    }
    const from = foldedTransform(source, dialog, scrim)
    folded.current = from
    // 样式里那条 dialogIn 让位：这一条是按触发控件量出来的。
    dialog.style.animation = 'none'
    dialog.animate(
      [
        { transform: from, opacity: 0 },
        { opacity: 1, offset: 0.3 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 560, easing: springOf(dialog), fill: 'backwards' },
    )
  }, [scrimRef, dialogRef])
}
