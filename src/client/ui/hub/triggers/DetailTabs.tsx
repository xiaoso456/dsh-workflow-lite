/**
 * dsh-workflow-lite — 「触发」页右栏的四个页签：概览、时间线、按触发方式换名字的那一页（输出 / 调用 / 日程 / 上游）、设置。
 *
 * 下划线滑到新的一页（只动 transform）；←/→ 在页签之间走。时间线上写着有几条记录，有失败时旁边一个红点。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/DetailTabs
 */

import { useLayoutEffect, useRef } from 'react'
import type { TriggerSourceKind } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import css from './tabs.module.css'

export type DetailTab = 'overview' | 'timeline' | 'live' | 'settings'
export const DETAIL_TABS: readonly DetailTab[] = ['overview', 'timeline', 'live', 'settings']

/** 第三页按触发方式叫什么。 */
const LIVE_NAME: Record<TriggerSourceKind, LocaleKey> = {
  schedule: 'hub.trgTab.schedule',
  poll: 'hub.trgTab.output',
  listen: 'hub.trgTab.output',
  http: 'hub.trgTab.call',
  after: 'hub.trgTab.upstream',
}

export function DetailTabs(props: {
  t: T
  kind: TriggerSourceKind
  value: DetailTab
  /** 时间线上的记录条数（还没读到不写）。 */
  count: number | undefined
  /** 有还没看过的失败（时间线页签上亮红点）。 */
  failed: boolean
  onChange(tab: DetailTab): void
}): React.JSX.Element {
  const { t, value } = props
  const bar = useRef<HTMLDivElement>(null)
  const ink = useRef<HTMLSpanElement>(null)
  const label = (tab: DetailTab): string =>
    tab === 'live' ? t(LIVE_NAME[props.kind]) : t(`hub.trgTab.${tab}` as LocaleKey)

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
    const at = DETAIL_TABS.indexOf(value)
    const next = DETAIL_TABS[(at + step + DETAIL_TABS.length) % DETAIL_TABS.length] as DetailTab
    props.onChange(next)
    bar.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus()
  }

  return (
    <div
      ref={bar}
      className={css.tabs}
      role="tablist"
      aria-label={t('hub.trgTabs')}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault()
          move(event.key === 'ArrowRight' ? 1 : -1)
        }
      }}
    >
      {DETAIL_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === value}
          tabIndex={tab === value ? 0 : -1}
          className={css.tab}
          data-tab={tab}
          data-testid={`wl-hub-trg-tab-${tab}`}
          onClick={() => props.onChange(tab)}
        >
          {/* 选中时字变粗：先按粗体占好宽度，换选中时不挤动旁边的页签。 */}
          <span className={css.tabText} data-text={label(tab)}>
            {label(tab)}
          </span>
          {tab === 'timeline' && props.count !== undefined && props.count > 0 && (
            <span className={css.count}>{props.count}</span>
          )}
          {tab === 'timeline' && (
            <span
              className={css.failed}
              data-on={props.failed}
              role="img"
              aria-label={t('hub.trgFailedDot')}
              aria-hidden={!props.failed}
            />
          )}
        </button>
      ))}
      <span ref={ink} className={css.ink} aria-hidden="true" />
    </div>
  )
}
