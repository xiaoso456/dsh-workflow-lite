import { type MutableRefObject, useRef } from 'react'
import { flushSync } from 'react-dom'
import { REDUCED } from './shared.ts'

type Direction = -1 | 0 | 1
type ScopedElement = HTMLElement & {
  startViewTransition?: (options: { update(): void; types: string[] }) => ViewTransition
}

export function tabDirection<T>(tabs: readonly T[], current: T, next: T): Direction | null {
  if (current === next) return null
  return tabs.indexOf(next) > tabs.indexOf(current) ? 1 : -1
}

export function usePaneTransition(): {
  scope: MutableRefObject<HTMLDivElement | null>
  change(update: () => void, direction?: Direction | null): void
} {
  const scope = useRef<HTMLDivElement | null>(null)
  const current = useRef<ViewTransition | null>(null)
  const revision = useRef(0)

  const change = (update: () => void, direction: Direction | null = 0): void => {
    const request = ++revision.current
    const previous = current.current
    current.current = null
    previous?.skipTransition()
    const target: ScopedElement | null = scope.current
    if (
      direction === null ||
      target?.isConnected !== true ||
      REDUCED?.matches ||
      !target.startViewTransition
    ) {
      update()
      return
    }
    const types = ['wl-pane']
    if (direction !== 0) types.push(direction > 0 ? 'wl-forward' : 'wl-backward')
    const apply = (): void => {
      if (revision.current === request && target === scope.current && target.isConnected) {
        flushSync(update)
      }
    }
    let transition: ViewTransition
    try {
      transition = target.startViewTransition({ update: apply, types })
    } catch {
      update()
      return
    }
    current.current = transition
    const clear = (): void => {
      if (current.current === transition) current.current = null
    }
    void transition.ready.catch(() => {})
    void transition.finished.then(clear, clear)
  }

  return { scope, change }
}
