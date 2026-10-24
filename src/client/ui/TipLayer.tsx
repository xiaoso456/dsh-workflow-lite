/**
 * dsh-workflow-lite — 悬停提示：整个视图共用一个浮层。
 *
 * 元素上写 `data-tip="…"` 就有提示，不用包组件、也不用加类名（不用原生 `title`：
 * 浏览器自带的提示样子、延迟都和插件对不上）。
 *
 * - 浮层挂在视图根上：不被滚动区、对话框裁掉；画布缩放时字号也不跟着变。
 * - 悬停一会儿或键盘聚焦才出来；刚收起一个又指向下一个时立刻出来，扫一排按钮不用每个都等。
 * - 文字比窗口还高、上下都放不下：放在空处大的一边，截到放得下为止，末尾淡出。
 * - 默认在元素正下方居中，下面放不下翻到上方，左右夹在视图里；长文字折行，`\n` 换行。
 *   窄栏里的短字配长提示（比如工作区名配完整路径）写 `data-tip-align="start"`：和元素左边对齐、往右展开，不越出栏外。
 * - 按下指针、滚动、滚轮、Esc 都收起；按过的那个元素在指针离开前不再弹，点完按钮不挡视线。
 * - `data-tip` 变了（比如「复制路径」→「已复制」）跟着换字；元素没了就收起。
 * - 亮着时指向相邻的元素（扫一排工具按钮）：提示滑到新位置、换字，不先收再弹；
 *   中途划过按钮之间的空隙，稍等一下再收，接得上下一个。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/TipLayer
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ui from './ui.module.css'

/** 悬停多久才出来。 */
const OPEN_MS = 380
/** 收起后这么久之内指向下一个，立刻出来。 */
const WARM_MS = 400
/** 浮层与元素、视图边缘的间距。 */
const GAP = 8
/** 指针离开带提示的元素后，提示再留多久：这段时间里指向下一个就滑过去。 */
const LINGER_MS = 90

interface Place {
  seq: number
  left: number
  top: number
  up: boolean
  glide: boolean
  /** 文字比空处还高时截到这个高度；放得下就是 `null`。 */
  clip: number | null
}

/** 收起时留下的影子：最后一次显示的字和位置。 */
interface Leaving {
  text: string
  left: number
  top: number
  up: boolean
  clip: number | null
}

/** 提示淡出的时长（和 ui.module.css 的 tipOut 一致）。 */
const LEAVE_MS = 110

interface Shown {
  /** 每换一个元素加一：入场动画只在换元素时放。 */
  seq: number
  target: HTMLElement
  text: string
}

/** 指针 / 焦点所在处最近的、带非空提示的元素。 */
function tipOf(node: EventTarget | null, root: HTMLElement): HTMLElement | null {
  if (!(node instanceof Element)) return null
  const element = node.closest<HTMLElement>('[data-tip]')
  if (element === null || !root.contains(element)) return null
  return (element.dataset.tip ?? '') === '' ? null : element
}

export function TipLayer(props: { root: HTMLElement | null }): React.ReactNode {
  const { root } = props
  const [shown, setShown] = useState<Shown | null>(null)
  /**
   * 量好的位置。`seq` 记是给哪一次弹出量的：新弹出的提示拿不到上一个的位置。
   * `glide`：这一次弹出之前已经摆好过（是从上一个元素移过来的），换位置时滑过去；
   * 刚弹出那一下不滑——不然会从左上角（还没量时的 0, 0）滑进来。
   */
  const [place, setPlace] = useState<Place | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (root === null) return
    const host = root
    let timer = 0
    let seq = 0
    /** 正显示或等着显示的元素。 */
    let current: HTMLElement | null = null
    let visible = false
    let hiddenAt = Number.NEGATIVE_INFINITY
    /** 刚按过的元素：指针离开它之前不弹。 */
    let muted: HTMLElement | null = null

    const watch = new MutationObserver(() => {
      if (current === null || !visible) return
      const target = current
      const text = target.dataset.tip ?? ''
      if (!target.isConnected || text === '') hide()
      else setShown((was) => (was === null || was.text === text ? was : { ...was, text }))
    })

    function hide(): void {
      window.clearTimeout(timer)
      if (visible) hiddenAt = performance.now()
      visible = false
      current = null
      watch.disconnect()
      setShown(null)
    }
    function show(target: HTMLElement): void {
      visible = true
      seq += 1
      setShown({ seq, target, text: target.dataset.tip ?? '' })
      watch.observe(host, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['data-tip'],
      })
    }
    function aim(target: HTMLElement | null): void {
      if (target === current) return
      window.clearTimeout(timer)
      if (visible) {
        current = target
        // 亮着：指向别的就滑过去；指向空处稍等再收。
        if (target === null) timer = window.setTimeout(hide, LINGER_MS)
        else setShown({ seq, target, text: target.dataset.tip ?? '' })
        return
      }
      const warm = performance.now() - hiddenAt < WARM_MS
      hide()
      if (target === null) return
      current = target
      if (warm) show(target)
      else timer = window.setTimeout(() => show(target), OPEN_MS)
    }

    const onOver = (event: PointerEvent): void => {
      if (event.pointerType === 'touch') return
      const target = tipOf(event.target, root)
      if (target !== muted) muted = null
      aim(target === muted ? null : target)
    }
    const onOut = (event: PointerEvent): void => {
      const next = event.relatedTarget
      if (!(next instanceof Node) || !root.contains(next)) {
        muted = null
        aim(null)
      }
    }
    const onDown = (event: PointerEvent): void => {
      muted = tipOf(event.target, root)
      hide()
    }
    const onFocusIn = (event: FocusEvent): void => {
      const target = tipOf(event.target, root)
      if (target !== null && target === event.target && target !== muted) {
        if (target.matches(':focus-visible')) aim(target)
      }
    }
    const onFocusOut = (event: FocusEvent): void => {
      if (event.target === current) aim(null)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide()
    }

    root.addEventListener('pointerover', onOver)
    root.addEventListener('pointerout', onOut)
    root.addEventListener('pointerdown', onDown, true)
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    root.addEventListener('keydown', onKey, true)
    root.addEventListener('scroll', hide, true)
    root.addEventListener('wheel', hide, { capture: true, passive: true })
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(timer)
      watch.disconnect()
      root.removeEventListener('pointerover', onOver)
      root.removeEventListener('pointerout', onOut)
      root.removeEventListener('pointerdown', onDown, true)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
      root.removeEventListener('keydown', onKey, true)
      root.removeEventListener('scroll', hide, true)
      root.removeEventListener('wheel', hide, { capture: true })
      window.removeEventListener('blur', hide)
    }
  }, [root])

  useLayoutEffect(() => {
    const tip = tipRef.current
    if (shown === null || root === null || tip === null) {
      setPlace(null)
      return
    }
    const box = shown.target.getBoundingClientRect()
    const area = root.getBoundingClientRect()
    const width = tip.offsetWidth
    // `scrollHeight`：上一次截过的话 `offsetHeight` 是截后的，这里要量全文有多高。
    const height = tip.scrollHeight
    const start =
      shown.target.dataset.tipAlign === 'start'
        ? box.left - area.left
        : box.left + box.width / 2 - area.left - width / 2
    const left = Math.max(GAP, Math.min(start, area.width - width - GAP))
    const below = box.bottom - area.top + GAP
    const roomBelow = area.height - GAP - below
    const roomAbove = box.top - area.top - GAP - GAP
    // 下面放得下就在下面；不然上面放得下就在上面；都放不下取空处大的一边、截到放得下。
    const up = height > roomBelow && (height <= roomAbove || roomAbove > roomBelow)
    const room = Math.max(up ? roomAbove : roomBelow, 0)
    const clip = height > room ? room : null
    const top = up ? box.top - area.top - GAP - (clip ?? height) : below
    const seq = shown.seq
    setPlace((was) => ({ seq, left, top, up, clip, glide: was?.seq === seq }))
  }, [shown, root])

  // 收起：留一个不接指针、没有 testid 的影子原地淡出（和出来时对称），弹出新的提示就立刻收掉影子。
  const resting = useRef<Leaving | null>(null)
  const [leaving, setLeaving] = useState<Leaving | null>(null)
  const gone = shown === null
  useEffect(() => {
    if (!gone) {
      setLeaving(null)
      return
    }
    if (resting.current === null) return
    setLeaving(resting.current)
    resting.current = null
    const id = window.setTimeout(() => setLeaving(null), LEAVE_MS)
    return () => window.clearTimeout(id)
  }, [gone])

  if (shown === null || root === null) {
    if (leaving === null || root === null) return null
    return createPortal(
      <div
        className={ui.tipSeat}
        aria-hidden="true"
        style={{ transform: `translate(${leaving.left}px, ${leaving.top}px)` }}
      >
        <div
          className={ui.tipLayer}
          data-up={leaving.up}
          data-leaving="true"
          data-clipped={leaving.clip === null ? undefined : true}
          style={leaving.clip === null ? undefined : { maxHeight: leaving.clip }}
        >
          {leaving.text}
        </div>
      </div>,
      root,
    )
  }
  // 只有给这一次量过的位置才算数：新弹出时（换了 seq）先藏着量，量好直接出现在原地；
  // 不然会带着上一个提示的位置（或者还没量时的左上角）滑过来。
  const placed = place !== null && place.seq === shown.seq ? place : null
  if (placed !== null) {
    resting.current = {
      text: shown.text,
      left: placed.left,
      top: placed.top,
      up: placed.up,
      clip: placed.clip,
    }
  }
  return createPortal(
    <div
      key={shown.seq}
      ref={tipRef}
      className={ui.tipSeat}
      data-glide={placed?.glide === true}
      style={{
        transform: `translate(${placed?.left ?? 0}px, ${placed?.top ?? 0}px)`,
        // 第一帧还没量好位置：先藏着量尺寸，摆好了再出现。
        visibility: placed === null ? 'hidden' : 'visible',
      }}
    >
      <div
        className={ui.tipLayer}
        role="tooltip"
        data-up={placed?.up === true}
        data-clipped={placed === null || placed.clip === null ? undefined : true}
        style={placed === null || placed.clip === null ? undefined : { maxHeight: placed.clip }}
        data-testid="wl-tip"
      >
        {shown.text}
      </div>
    </div>,
    root,
  )
}
