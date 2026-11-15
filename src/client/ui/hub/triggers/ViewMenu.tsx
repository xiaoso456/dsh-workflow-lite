/**
 * dsh-workflow-lite — 「触发」页搜索框右边的「视图选项」：一张菜单分三段——分组方式、排序方式、筛选（每项带张数）。
 *
 * 点一项即生效，菜单留着（可以接着换别的一段）；Esc、点外面收起。筛选不是「全部」时按钮右上角一个蓝点。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/ViewMenu
 */

import { useRef, useState } from 'react'
import type { LocaleKey, T } from '../../../i18n.ts'
import {
  TRIGGER_GROUPS,
  TRIGGER_SHOWS,
  TRIGGER_SORTS,
  type TriggerGroupBy,
  type TriggerListView,
  type TriggerShow,
  type TriggerSortBy,
} from '../../../model/triggerList.ts'
import { cx } from '../../kit/cx.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import { Popover } from '../../kit/Popover.tsx'
import ui from '../../kit/ui.module.css'
import { useRadioMenu } from '../../kit/useRadioMenu.ts'
import css from './viewMenu.module.css'

const GROUP: Record<TriggerGroupBy, { label: LocaleKey; icon: IconName }> = {
  workflow: { label: 'hub.trgGroup.workflow', icon: 'hub' },
  state: { label: 'hub.trgGroup.state', icon: 'activity' },
  kind: { label: 'hub.trgGroup.kind', icon: 'bolt' },
  none: { label: 'hub.trgGroup.none', icon: 'overview' },
}

const SORT: Record<TriggerSortBy, { label: LocaleKey; icon: IconName }> = {
  name: { label: 'hub.trgSort.name', icon: 'font' },
  recent: { label: 'hub.trgSort.recent', icon: 'history' },
  next: { label: 'hub.trgSort.next', icon: 'clock' },
}

export const SHOW: Record<TriggerShow, { label: LocaleKey; icon: IconName }> = {
  all: { label: 'hub.trgShow.all', icon: 'overview' },
  on: { label: 'hub.trgShow.on', icon: 'play' },
  act: { label: 'hub.trgShow.act', icon: 'alert' },
}

export function ViewMenu(props: {
  t: T
  view: TriggerListView
  counts: Record<TriggerShow, number>
  onChange(change: Partial<TriggerListView>): void
}): React.JSX.Element {
  const { t, view } = props
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const onKeyDown = useRadioMenu(open, list)
  const close = (): void => {
    setOpen(false)
    button.current?.focus({ preventScroll: true })
  }
  const item = (
    key: keyof TriggerListView,
    value: string,
    label: LocaleKey,
    icon: IconName,
    count?: number,
  ): React.JSX.Element => {
    const on = view[key] === value
    return (
      <button
        key={`${key}-${value}`}
        type="button"
        role="menuitemradio"
        aria-checked={on}
        className={cx(ui.menuItem, css.item)}
        data-active={on}
        data-testid={`wl-hub-trg-view-${key}-${value}`}
        onClick={() => props.onChange({ [key]: value })}
      >
        <Icon name={icon} size={14} />
        <span className={ui.menuLabel}>{t(label)}</span>
        {count !== undefined && <span className={css.count}>{count}</span>}
        <span className={css.check} aria-hidden="true">
          <Icon name="check" size={13} />
        </span>
      </button>
    )
  }
  return (
    <Popover
      open={open}
      align="end"
      onClose={close}
      label={t('hub.trgView')}
      className={css.menu}
      trigger={
        <button
          ref={button}
          type="button"
          className={css.button}
          aria-label={t('hub.trgView')}
          aria-haspopup="menu"
          aria-expanded={open}
          data-tip={open ? undefined : t('hub.trgView')}
          data-filtered={view.show !== 'all' || undefined}
          data-testid="wl-hub-trg-view"
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Icon name="sliders" size={15} />
        </button>
      }
    >
      <div ref={list} role="menu" aria-label={t('hub.trgView')} onKeyDown={onKeyDown}>
        <p className={ui.menuTitle}>{t('hub.trgGroupBy')}</p>
        {TRIGGER_GROUPS.map((value) => item('group', value, GROUP[value].label, GROUP[value].icon))}
        <div className={ui.menuSep} />
        <p className={ui.menuTitle}>{t('hub.trgSortBy')}</p>
        {TRIGGER_SORTS.map((value) => item('sort', value, SORT[value].label, SORT[value].icon))}
        <div className={ui.menuSep} />
        <p className={ui.menuTitle}>{t('hub.trgShowBy')}</p>
        {TRIGGER_SHOWS.map((value) =>
          item('show', value, SHOW[value].label, SHOW[value].icon, props.counts[value]),
        )}
      </div>
    </Popover>
  )
}
