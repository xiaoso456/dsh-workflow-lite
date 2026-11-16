/**
 * dsh-workflow-lite — 「画布」页签那张小图的平移：不缩放（字一直是原大），按住空白处或卡片拖着走，没有滚动条。
 *
 * - 排好、换实例时把选中的那一步（没点过是正在做的那步）摆到框正中，不动画；换选中的一步时滑过去。
 * - 图比框小的那个方向不能拖，就居中；大的那个方向拖到边就停，不会拖出一片空。
 * - 拖动只改 transform 和点阵底的位置（直接写在元素上，不经 React），不插拔元素；拖过了（挪了几个像素以上）那一下松手不算点卡片。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/useMapPan
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { REDUCED } from '../../motion/shared.ts'
import { MAP_CARD, type RunMap } from './runMap.ts'

/** 挪过这么多像素才算拖（再少是手抖，照常点）。 */
const DRAG_SLOP = 4
/** 换选中的一步时滑过去用多久。 */
const GLIDE_MS = 280

interface Point {
  x: number
  y: number
}

export interface MapPan {
  /** 框（量宽高、接指针）。 */
  box: React.RefObject<HTMLDivElement>
  /** 挪动的那一层（transform 写在它上面）。 */
  stage: React.RefObject<HTMLDivElement>
  handlers: {
    onPointerDown(event: React.PointerEvent<HTMLDivElement>): void
    onPointerMove(event: React.PointerEvent<HTMLDivElement>): void
    onPointerUp(event: React.PointerEvent<HTMLDivElement>): void
    onPointerCancel(event: React.PointerEvent<HTMLDivElement>): void
    onClickCapture(event: React.MouseEvent<HTMLDivElement>): void
  }
}

export function useMapPan(map: RunMap | null, focus: string | undefined): MapPan {
  const box = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const pan = useRef<Point>({ x: 0, y: 0 })
  const drag = useRef<{ pointer: number; start: Point; from: Point; moved: boolean } | null>(null)
  /** 刚拖完：接下来那一下 click 不算点卡片。 */
  const dragged = useRef(false)

  /** 一个方向上：图比框小就居中，大就夹在两头之间。 */
  const clamp = useCallback(
    (to: Point): Point => {
      const el = box.current
      if (el === null || map === null) return to
      const within = (value: number, view: number, content: number): number =>
        content <= view ? (view - content) / 2 : Math.min(0, Math.max(view - content, value))
      return {
        x: within(to.x, el.clientWidth, map.width),
        y: within(to.y, el.clientHeight, map.height),
      }
    },
    [map],
  )

  const apply = useCallback((to: Point, glide: boolean): void => {
    const el = stage.current
    pan.current = to
    if (el === null) return
    el.style.transition =
      glide && REDUCED?.matches !== true ? `transform ${String(GLIDE_MS)}ms var(--wl-ease)` : 'none'
    el.style.transform = `translate(${String(to.x)}px, ${String(to.y)}px)`
    // 点阵底跟着挪，看着是整块画布在动（只是重画背景，不排版）。
    const frame = box.current
    if (frame !== null) frame.style.backgroundPosition = `${String(to.x)}px ${String(to.y)}px`
  }, [])

  /** 把选中的那一步摆到框正中（夹在能拖的范围里）。 */
  const center = useCallback(
    (glide: boolean): void => {
      const el = box.current
      if (el === null || map === null) return
      const card = map.cards.find((item) => item.id === focus)
      const to =
        card === undefined
          ? pan.current
          : {
              x: el.clientWidth / 2 - (card.x + MAP_CARD.w / 2),
              y: el.clientHeight / 2 - (card.y + MAP_CARD.h / 2),
            }
      apply(clamp(to), glide)
    },
    [map, focus, apply, clamp],
  )

  // 新排的图：直接摆好；同一张图上换了选中的一步：滑过去。
  const placedMap = useRef<RunMap | null>(null)
  useLayoutEffect(() => {
    if (map === null) return
    const fresh = placedMap.current !== map
    placedMap.current = map
    center(!fresh)
  }, [map, center])

  // 框宽变了：当前位置重新夹一次。
  useEffect(() => {
    const el = box.current
    if (el === null || typeof ResizeObserver === 'undefined') return
    const sizes = new ResizeObserver(() => apply(clamp(pan.current), false))
    sizes.observe(el)
    return () => sizes.disconnect()
  }, [apply, clamp])

  const end = (event: React.PointerEvent<HTMLDivElement>): void => {
    const now = drag.current
    if (now === null || now.pointer !== event.pointerId) return
    drag.current = null
    dragged.current = now.moved
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return {
    box,
    stage,
    handlers: {
      onPointerDown(event) {
        if (event.button !== 0) return
        // 右上角的按钮不拖。
        if ((event.target as HTMLElement).closest('[data-no-pan]') !== null) return
        dragged.current = false
        drag.current = {
          pointer: event.pointerId,
          start: { x: event.clientX, y: event.clientY },
          from: pan.current,
          moved: false,
        }
      },
      onPointerMove(event) {
        const now = drag.current
        if (now === null || now.pointer !== event.pointerId) return
        const dx = event.clientX - now.start.x
        const dy = event.clientY - now.start.y
        if (!now.moved) {
          if (Math.hypot(dx, dy) < DRAG_SLOP) return
          now.moved = true
          event.currentTarget.setPointerCapture(event.pointerId)
        }
        apply(clamp({ x: now.from.x + dx, y: now.from.y + dy }), false)
      },
      onPointerUp: end,
      onPointerCancel: end,
      onClickCapture(event) {
        if (!dragged.current) return
        dragged.current = false
        event.stopPropagation()
        event.preventDefault()
      },
    },
  }
}
