/**
 * dsh-workflow-lite — 工作流中心右栏的页签（「触发」「运行实例」两页共用）：一排字，下面一条下划线。
 *
 * 下划线滑到新的一页（只动 transform）；←/→ 在页签之间走。页签可以带一个数（时间线有几条），
 * 也可以在右上角亮一个红点（有还没看过的失败），红点不占宽度，有没有都不挤动下划线。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/pane/PaneTabs
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { slide } from '../../motion/flip.ts'
import { REDUCED } from '../../motion/shared.ts'
import css from './paneTabs.module.css'

export interface PaneTab<K extends string> {
  id: K
  label: string
  /** 写在字后面的数；没有或 0 不写。 */
  count?: number | undefined
  /** 右上角的红点：`on` 时亮，`label` 是读屏念的。 */
  dot?: { on: boolean; label: string }
}

function PaneTabButton<K extends string>({
  tab,
  selected,
  testId,
  onSelect,
  updateLayout,
}: {
  tab: PaneTab<K>
  selected: boolean
  testId: string
  onSelect(tab: K): void
  updateLayout(): void
}): React.JSX.Element {
  const count = tab.count !== undefined && tab.count > 0 ? String(tab.count) : undefined
  const dotOn = tab.dot?.on
  const dot = useRef<HTMLSpanElement>(null)
  const [heldCount, setHeldCount] = useState(count)
  const countSize = dotOn === undefined ? count : heldCount
  const visibleCount =
    count !== undefined && count.length <= (countSize?.length ?? 0) ? count : null

  useLayoutEffect(() => {
    if (dotOn === undefined || heldCount === count) return
    const fade =
      dotOn === false && REDUCED?.matches !== true
        ? dot.current
            ?.getAnimations()
            .find(
              (animation) =>
                animation instanceof CSSTransition && animation.transitionProperty === 'opacity',
            )
        : undefined
    if (fade === undefined) {
      setHeldCount(count)
      return
    }
    let active = true
    const release = (): void => {
      if (active) setHeldCount(count)
    }
    void fade.finished.then(release, release)
    return () => {
      active = false
    }
  }, [count, dotOn, heldCount])

  useLayoutEffect(updateLayout, [countSize, updateLayout])

  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={css.tab}
      data-tab={tab.id}
      data-testid={testId}
      onClick={() => onSelect(tab.id)}
    >
      {/* 选中时字变粗：先按粗体占好宽度，换选中时不挤动旁边的页签。 */}
      <span className={css.tabText} data-text={tab.label}>
        {tab.label}
      </span>
      {(tab.dot !== undefined || countSize !== undefined) && (
        <span className={css.count} data-count-size={countSize}>
          <span className={css.countValue}>{visibleCount}</span>
        </span>
      )}
      {tab.dot !== undefined && (
        <span
          ref={dot}
          className={css.dot}
          data-on={tab.dot.on}
          role="img"
          aria-label={tab.dot.label}
          aria-hidden={!tab.dot.on}
        />
      )}
    </button>
  )
}

export function PaneTabs<K extends string>(props: {
  tabs: readonly PaneTab<K>[]
  value: K
  /** 整排页签读屏念的名字。 */
  label: string
  /** 各页签的 testId 是 `<testId>-<id>`。 */
  testId: string
  onChange(tab: K): void
}): React.JSX.Element {
  const { tabs, value } = props
  const bar = useRef<HTMLDivElement>(null)
  const ink = useRef<HTMLSpanElement>(null)
  const positions = useRef(new WeakMap<HTMLElement, number>())

  // 下划线挪到选中那一格：位置、宽度都写成 transform（宽度用 scaleX，下划线本身 100px 宽）。
  // 刚挂上时直接摆到位，不从最左边滑过来。
  const placed = useRef(false)
  const updateLayout = useCallback(() => {
    const list = bar.current
    const line = ink.current
    if (list === null || line === null) return
    const on = list.querySelector<HTMLElement>('[aria-selected="true"]')
    if (on === null) return
    const transform = `translateX(${String(on.offsetLeft)}px) scaleX(${String(on.offsetWidth / 100)})`
    const slots = Array.from(list.querySelectorAll<HTMLElement>('[data-tab]'), (button) => ({
      button,
      left: button.offsetLeft,
    }))
    for (const { button, left } of slots) {
      const previous = positions.current.get(button)
      positions.current.set(button, left)
      if (previous !== undefined && previous !== left && REDUCED?.matches !== true) {
        slide(button, 0, previous - left, 260)
      }
    }
    if (line.style.transform === transform) return
    if (!placed.current) {
      placed.current = true
      line.style.transition = 'none'
      line.style.transform = transform
      void line.offsetWidth
      line.style.transition = ''
      return
    }
    line.style.transform = transform
  }, [])
  useLayoutEffect(updateLayout)

  const move = (step: 1 | -1): void => {
    const at = tabs.findIndex((tab) => tab.id === value)
    const next = tabs[(at + step + tabs.length) % tabs.length]
    if (next === undefined) return
    props.onChange(next.id)
    bar.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus()
  }

  return (
    <div
      ref={bar}
      className={css.tabs}
      role="tablist"
      aria-label={props.label}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          move(event.key === 'ArrowRight' ? 1 : -1)
        }
      }}
    >
      {tabs.map((tab) => (
        <PaneTabButton
          key={tab.id}
          tab={tab}
          selected={tab.id === value}
          testId={`${props.testId}-${tab.id}`}
          onSelect={props.onChange}
          updateLayout={updateLayout}
        />
      ))}
      <span ref={ink} className={css.ink} aria-hidden="true" />
    </div>
  )
}
