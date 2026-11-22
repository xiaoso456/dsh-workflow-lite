/**
 * dsh-workflow-lite — 工作流中心右栏的页签（「触发」「运行实例」两页共用）：一排字，下面一条下划线。
 *
 * 下划线滑到新的一页（只动 transform）；←/→ 在页签之间走。页签可以带一个数（时间线有几条），
 * 也可以在右上角亮一个红点（有还没看过的失败），红点不占宽度，有没有都不挤动下划线。
 * 数变了原地滚着换（和别处的数字一样，变大往上、变小往下）；从没有到有淡入长出来，没了缩小淡出，
 * 页签跟着变宽变窄时后面的页签、下划线滑过去。
 *
 * 各页签的位置在版面算好之后量（ResizeObserver 的回调里，读是现成的），记下来；换选中时下划线直接用记下的。
 * 不在提交里量：左栏换一项时右栏整块换了内容，这时一读位置就逼整页样式、排版当场算一遍。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/pane/PaneTabs
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { slide } from '../../motion/flip.ts'
import { afterPaint, REDUCED } from '../../motion/shared.ts'
import { SwapText, useTrend } from '../../motion/swapText.tsx'
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
}: {
  tab: PaneTab<K>
  selected: boolean
  testId: string
  onSelect(tab: K): void
}): React.JSX.Element {
  const count = tab.count !== undefined && tab.count > 0 ? String(tab.count) : undefined
  const self = useRef<HTMLButtonElement>(null)
  const trend = useTrend(tab.count ?? 0)
  // 数没了的时候还写着最后那个数（淡出时看得见）；数从没有变成有（不是刚挂上）时放一次进场。
  const [seen, setSeen] = useState({ count, last: count, arrive: false })
  if (count !== seen.count) {
    setSeen({
      count,
      last: count ?? seen.last,
      arrive: seen.arrive || (seen.count === undefined && count !== undefined),
    })
  }
  // 占的宽度：变宽立刻让开（后面的页签、下划线滑过去，数再淡入）；
  // 变窄、没了先留着，等字和红点退完再收——收的时候后面的页签再滑回来，不压在还没退完的字上。
  const [held, setHeld] = useState(count)
  const grows = count !== undefined && (held === undefined || count.length >= held.length)
  if (grows && held !== count) setHeld(count)
  const countSize = grows ? count : held

  // 画完再看在退的动画（这时读是现成的；提交里调 getAnimations 会逼整页样式当场重算），等它们放完再收。
  useEffect(() => {
    if (held === count) return
    if (REDUCED?.matches === true) {
      setHeld(count)
      return
    }
    let active = true
    const release = (): void => {
      if (active) setHeld(count)
    }
    const cancel = afterPaint(() => {
      const leaving = self.current?.getAnimations({ subtree: true }) ?? []
      // 有动画被取消时，仍要等同一页签里的其余动画结束。
      void Promise.allSettled(leaving.map((animation) => animation.finished)).then(release)
    })
    return () => {
      active = false
      cancel()
    }
  }, [count, held])

  return (
    <button
      ref={self}
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
        <span
          className={css.count}
          data-count-size={countSize}
          data-gone={count === undefined || undefined}
          data-arrive={seen.arrive || undefined}
        >
          <span className={css.countValue}>
            <SwapText text={count ?? seen.last ?? ''} pop dir={trend} />
          </span>
        </span>
      )}
      {tab.dot !== undefined && (
        <span
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
  /** 各页签上次量到的位置、宽度。 */
  const boxes = useRef(new WeakMap<HTMLElement, { left: number; width: number }>())

  // 下划线挪到选中那一格：位置、宽度都写成 transform（宽度用 scaleX，下划线本身 100px 宽）。
  // 刚挂上时直接摆到位，不从最左边滑过来（这一帧不带过渡，画完再开）。
  const placed = useRef(false)
  const placeInk = useCallback((box: { left: number; width: number }) => {
    const line = ink.current
    if (line === null) return
    const transform = `translateX(${String(box.left)}px) scaleX(${String(box.width / 100)})`
    if (line.style.transform === transform) return
    line.style.transform = transform
    if (placed.current) return
    placed.current = true
    line.style.transition = 'none'
    afterPaint(() => {
      line.style.transition = ''
    })
  }, [])
  const selected = (): HTMLElement | null =>
    bar.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null
  /** 量各页签（挪了的从原处滑过去）、摆下划线。 */
  const measure = useCallback(() => {
    const list = bar.current
    if (list === null) return
    for (const button of list.querySelectorAll<HTMLElement>('[data-tab]')) {
      const box = { left: button.offsetLeft, width: button.offsetWidth }
      const previous = boxes.current.get(button)
      boxes.current.set(button, box)
      if (previous !== undefined && previous.left !== box.left && REDUCED?.matches !== true) {
        slide(button, 0, previous.left - box.left, 260)
      }
    }
    const on = list.querySelector<HTMLElement>('[aria-selected="true"]')
    const box = on === null ? undefined : boxes.current.get(on)
    if (box !== undefined) placeInk(box)
  }, [placeInk])
  // 页签变宽变窄（数变了、字换了、整排变宽）：版面算好之后量。
  useEffect(() => {
    const list = bar.current
    if (list === null || typeof ResizeObserver === 'undefined') return
    const sizes = new ResizeObserver(measure)
    sizes.observe(list)
    for (const button of list.querySelectorAll('[data-tab]')) sizes.observe(button)
    return () => sizes.disconnect()
  }, [measure, tabs.length])
  // 换了选中：下划线用记下的位置（页签不会因为选中挪动：选中的粗体先占好了宽度）；还没量过就当场量。
  useLayoutEffect(() => {
    const on = selected()
    const box = on === null ? undefined : boxes.current.get(on)
    if (box !== undefined) placeInk(box)
    else measure()
  }, [value, measure, placeInk])

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
        />
      ))}
      <span ref={ink} className={css.ink} aria-hidden="true" />
    </div>
  )
}
