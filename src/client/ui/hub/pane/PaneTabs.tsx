/**
 * dsh-workflow-lite — 工作流中心右栏的页签（「触发」「运行实例」两页共用）：一排字，下面一条下划线。
 *
 * 下划线滑到新的一页（只动 transform）；←/→ 在页签之间走。页签可以带一个数（时间线有几条），
 * 也可以在右上角亮一个红点（有还没看过的失败），红点不占宽度，有没有都不挤动下划线。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/pane/PaneTabs
 */

import { useLayoutEffect, useRef } from 'react'
import css from './paneTabs.module.css'

export interface PaneTab<K extends string> {
  id: K
  label: string
  /** 写在字后面的数；没有或 0 不写。 */
  count?: number | undefined
  /** 右上角的红点：`on` 时亮，`label` 是读屏念的。 */
  dot?: { on: boolean; label: string }
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

  // 下划线挪到选中那一格：位置、宽度都写成 transform（宽度用 scaleX，下划线本身 100px 宽）。
  // 刚挂上时直接摆到位，不从最左边滑过来。
  const placed = useRef(false)
  useLayoutEffect(() => {
    const on = bar.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    const line = ink.current
    if (on === null || on === undefined || line === null) return
    const transform = `translateX(${String(on.offsetLeft)}px) scaleX(${String(on.offsetWidth / 100)})`
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
  })

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
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          tabIndex={tab.id === value ? 0 : -1}
          className={css.tab}
          data-tab={tab.id}
          data-testid={`${props.testId}-${tab.id}`}
          onClick={() => props.onChange(tab.id)}
        >
          {/* 选中时字变粗：先按粗体占好宽度，换选中时不挤动旁边的页签。 */}
          <span className={css.tabText} data-text={tab.label}>
            {tab.label}
          </span>
          {tab.count !== undefined && tab.count > 0 && (
            <span className={css.count}>{tab.count}</span>
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
      ))}
      <span ref={ink} className={css.ink} aria-hidden="true" />
    </div>
  )
}
