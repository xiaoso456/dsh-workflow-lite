import { type MutableRefObject, useLayoutEffect, useRef } from 'react'
import { ghostClone } from '../../kit/ghost.ts'
import { slideFrom, slideOffset } from '../../motion/flip.ts'
import { REDUCED } from '../../motion/shared.ts'

const EXIT_MS = 120
const MOVE_MS = 160
/** 新标签长出来：从六成大、透明，带一点回弹到原样（只动 `scale` / `opacity`）。 */
const ENTER_MS = 280
const ENTER_EASE = 'cubic-bezier(0.34, 1.45, 0.64, 1)'

interface Box {
  left: number
  top: number
  width: number
  height: number
}

interface TagSpot extends Box {
  tag: HTMLElement
  visible: boolean
  chip: boolean
}

function overlaps(first: Box, second: Box): boolean {
  return (
    first.left < second.left + second.width &&
    second.left < first.left + first.width &&
    first.top < second.top + second.height &&
    second.top < first.top + first.height
  )
}

function swept(from: Box, to: Box): Box {
  const left = Math.min(from.left, to.left)
  const top = Math.min(from.top, to.top)
  return {
    left,
    top,
    width: Math.max(from.left + from.width, to.left + to.width) - left,
    height: Math.max(from.top + from.height, to.top + to.height) - top,
  }
}

interface TagMove {
  from: Box
  to: TagSpot
  path: Box
}

function staysApart(first: TagMove, second: TagMove): boolean {
  return (
    (first.from.left + first.from.width <= second.from.left &&
      first.to.left + first.to.width <= second.to.left) ||
    (first.from.top + first.from.height <= second.from.top &&
      first.to.top + first.to.height <= second.to.top)
  )
}

/**
 * `ready = false`：这一次排出来的样子还不作数（标签刚换、放得下几个还没重量）——不量、不动，
 * 等重量完那一次再拿上一次真正排好的样子比，新标签才从对的地方长出来、后面的从原处滑开。
 */
export function useTagMotion(
  layout: string,
  ready = true,
): MutableRefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  const previous = useRef<Map<string, TagSpot> | null>(null)
  const arrivals = useRef(new WeakMap<HTMLElement, Animation>())
  useLayoutEffect(() => {
    const row = ref.current
    const layer = row?.querySelector('[data-fit="ghosts"]')
    if (!ready || row === null || layer == null) return
    const box = (element: HTMLElement): Box => ({
      left: row.offsetLeft + element.offsetLeft,
      top: row.offsetTop + element.offsetTop,
      width: element.offsetWidth,
      height: element.offsetHeight,
    })
    const measure = (): Map<string, TagSpot> => {
      const spots = new Map<string, TagSpot>()
      for (const tag of row.children) {
        if (!(tag instanceof HTMLElement)) continue
        const kind = tag.dataset.fit
        const key =
          kind === 'chip' && tag.dataset.value !== undefined
            ? `tag:${tag.dataset.value.toLocaleLowerCase()}`
            : kind === 'more' || kind === 'add'
              ? kind
              : null
        if (key === null) continue
        spots.set(key, {
          tag,
          chip: kind === 'chip',
          visible: tag.dataset.rowHidden !== 'true',
          ...box(tag),
        })
      }
      return spots
    }
    const next = measure()
    const prior = previous.current
    if (prior !== null && REDUCED?.matches !== true) {
      layer.replaceChildren()
      const fixed: Box[] = []
      const moves: TagMove[] = []
      const entering: TagSpot[] = []
      for (const [key, to] of next) {
        if (!to.visible) continue
        const before = prior.get(key)
        const arrival = arrivals.current.get(to.tag)
        // 刚出现、或上一次还藏着（换了一张工作流时先按旧的条数排，这一次才放得下）的标签：长出来。
        if (
          to.chip &&
          (before === undefined ||
            !before.visible ||
            arrival?.effect?.getComputedTiming().progress === 0)
        ) {
          arrival?.cancel()
          entering.push(to)
          continue
        }
        const [across, down] = slideOffset(to.tag)
        const from = {
          ...to,
          left: Math.max(row.offsetLeft, (before?.left ?? to.left) + across),
          top: (before?.top ?? to.top) + down,
        }
        const path = swept(from, to)
        const moved = from.left !== to.left || from.top !== to.top
        const canSlide = before?.visible === true && moved
        if (canSlide) moves.push({ from, to, path })
        else {
          if (across !== 0 || down !== 0) slideFrom(to.tag, 0, 0, MOVE_MS)
          fixed.push(to)
        }
      }
      const crosses = moves.some(
        (move, index) =>
          fixed.some((item) => overlaps(item, move.path)) ||
          moves
            .slice(index + 1)
            .some(
              (other) =>
                overlaps(move.path, other.path) &&
                !staysApart(move, other) &&
                !staysApart(other, move),
            ),
      )
      if (crosses) {
        for (const { to } of moves) {
          slideFrom(to.tag, 0, 0, MOVE_MS)
          fixed.push(to)
        }
        moves.length = 0
      }
      const occupied = [...fixed, ...moves.map((move) => move.from)]
      const leaving = [...prior.values()].filter(
        (before) =>
          before.chip &&
          before.visible &&
          before.left >= row.offsetLeft &&
          !before.tag.isConnected &&
          arrivals.current.get(before.tag)?.playState !== 'running' &&
          !occupied.some((item) => overlaps(item, before)),
      )
      for (const before of leaving) {
        const ghost = ghostClone(before.tag)
        Object.assign(ghost.node.style, {
          position: 'absolute',
          left: `${before.left - row.offsetLeft}px`,
          top: `${before.top - row.offsetTop}px`,
          width: `${before.width}px`,
          height: `${before.height}px`,
        })
        ghost.place(layer)
        const exit = ghost.node.animate(
          [
            { opacity: 1, scale: '1' },
            { opacity: 0, scale: '0.7' },
          ],
          { duration: EXIT_MS, easing: 'cubic-bezier(0.4, 0, 1, 1)', fill: 'forwards' },
        )
        const drop = (): void => ghost.node.remove()
        void exit.finished.then(drop, drop)
      }
      const delay = moves.some(({ path }) => leaving.some((before) => overlaps(before, path)))
        ? EXIT_MS
        : 0
      for (const { from, to } of moves) {
        slideFrom(to.tag, from.top - to.top, from.left - to.left, MOVE_MS, delay)
      }
      for (const spot of entering) {
        const waitsForMove = moves.some(({ path }) => overlaps(path, spot))
        const waitsForExit = leaving.some((before) => overlaps(before, spot))
        arrivals.current.set(
          spot.tag,
          spot.tag.animate(
            [
              { opacity: 0, scale: '0.6' },
              { opacity: 1, scale: '1' },
            ],
            {
              duration: ENTER_MS,
              easing: ENTER_EASE,
              // 让位的标签滑到一半就开始长：空当一边打开一边被填上，不先空一下。
              delay: waitsForMove ? delay + MOVE_MS / 2 : waitsForExit ? EXIT_MS : 0,
              fill: 'backwards',
            },
          ),
        )
      }
    }
    previous.current = next
    const sizes = new ResizeObserver(() => {
      previous.current = measure()
    })
    sizes.observe(row)
    for (const spot of next.values()) sizes.observe(spot.tag)
    return () => sizes.disconnect()
  }, [layout, ready])
  return ref
}
