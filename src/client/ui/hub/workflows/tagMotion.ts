import { type MutableRefObject, useLayoutEffect, useRef } from 'react'
import { ghostClone } from '../../kit/ghost.ts'
import { slideFrom, slideOffset } from '../../motion/flip.ts'
import { REDUCED } from '../../motion/shared.ts'

const EXIT_MS = 90
const MOVE_MS = 160
const ENTER_MS = 100

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

export function useTagMotion(layout: string): MutableRefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement | null>(null)
  const previous = useRef<Map<string, TagSpot> | null>(null)
  const arrivals = useRef(new WeakMap<HTMLElement, Animation>())
  useLayoutEffect(() => {
    const row = ref.current
    const layer = row?.querySelector('[data-fit="ghosts"]')
    if (row === null || layer == null) return
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
        if (
          to.chip &&
          (before === undefined || arrival?.effect?.getComputedTiming().progress === 0)
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
        const exit = ghost.node.animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: EXIT_MS,
          fill: 'forwards',
        })
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
          spot.tag.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: ENTER_MS,
            delay: waitsForMove ? delay + MOVE_MS : waitsForExit ? EXIT_MS : 0,
            fill: 'backwards',
          }),
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
  }, [layout])
  return ref
}
