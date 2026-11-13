/**
 * dsh-workflow-lite — 下拉选择（单选）：一个输入框样子的触发块，点开是一张和别处菜单一样的浮层。
 *
 * 不用原生 `<select>`：原生下拉的列表由系统画，颜色、字号、圆角都跟不上主题。
 * 选中项带底色和钩；打开时焦点落在选中项上，上下键在项之间走，Esc / 点外面收起，选了收起并把焦点还给触发块。
 *
 * 浮层不越出所在的滚动区（属性面板、对话框、设置页）：
 * - 打开时量一下触发块上下各有多少地方，往宽的那边开，列表高度封顶在那边放得下的高度，多的在列表里滚；
 *   不会被滚动区裁掉，也不会把滚动区撑长、把页面顶下去（收起时页面再弹回来，还会收掉随后浮出的确认小卡）。
 * - 项多（{@link SEARCH_FROM} 项以上，比如选会话）时顶上带一个搜索框（和切换工作流的同一个样子），焦点落在框里，
 *   打字即筛，命中的字高亮；下键进列表，Enter 选第一个命中的。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/Select
 */

import { useRef, useState } from 'react'
import type { T } from '../../i18n.ts'
import { matchRange, normalizeNeedle } from '../../model/switcherSearch.ts'
import { cx } from './cx.ts'
import { Highlight } from './Highlight.tsx'
import { Icon } from './Icon.tsx'
import { Popover } from './Popover.tsx'
import css from './select.module.css'
import ui from './ui.module.css'
import { useRadioMenu } from './useRadioMenu.ts'

/** 多少项起带搜索框。 */
export const SEARCH_FROM = 8
/** 菜单一项的高（`ui.menuItem` 的最小高）、搜索框连下边距的高、菜单上下内边距与离触发块的间距。 */
const ITEM_HEIGHT = 34
const SEARCH_HEIGHT = 38
const MENU_CHROME = 16
/** 列表最高多少；地方再小也至少给这么高（宁可在滚动区里滚，也别只露一两项）。 */
const LIST_MAX = 320
const LIST_MIN = 120
/** 浮层离滚动区边缘留的空。 */
const EDGE = 8

export interface SelectOption<V extends string> {
  value: V
  label: string
}

export function Select<V extends string>(props: {
  label: string
  value: V
  options: readonly SelectOption<V>[]
  onChange: (value: V) => void
  className?: string
  /** 触发块的 testid；每一项是 `${testId}-${value}`，搜索框是 `${testId}-search`。 */
  testId?: string
  /** 带搜索框时要（搜索框的占位字、搜不到时的一行）；不给就不带搜索框。 */
  t?: T
}): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<MenuPlace>({ up: false, list: LIST_MAX })
  const [query, setQuery] = useState('')
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const current = props.options.find((option) => option.value === props.value)
  const searchable = t !== undefined && props.options.length >= SEARCH_FROM
  const needle = searchable ? normalizeNeedle(query) : ''
  const shown =
    needle === ''
      ? props.options
      : props.options.filter((option) => matchRange(option.label, needle) !== null)

  const close = (): void => {
    setOpen(false)
    setQuery('')
    trigger.current?.focus()
  }
  const pick = (value: V): void => {
    if (value !== props.value) props.onChange(value)
    close()
  }
  const onKeyDown = useRadioMenu(open, list, !searchable)

  return (
    <div className={cx(css.wrap, props.className)}>
      <Popover
        open={open}
        onClose={close}
        label={props.label}
        className={cx(css.pop, place.up && css.popUp)}
        up={place.up}
        trigger={
          <button
            ref={trigger}
            type="button"
            className={cx(ui.input, css.trigger)}
            aria-label={props.label}
            aria-haspopup="menu"
            aria-expanded={open}
            data-open={open || undefined}
            data-testid={props.testId}
            onClick={() => {
              if (open) {
                close()
                return
              }
              setPlace(menuPlace(trigger.current, props.options.length, searchable))
              setOpen(true)
            }}
          >
            <span className={css.value}>{current?.label ?? ''}</span>
            <span className={css.chevron} aria-hidden="true">
              <Icon name="chevronDown" size={14} />
            </span>
          </button>
        }
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions: 搜索框和列表共用一套上下键 */}
        <div onKeyDown={onKeyDown}>
          {searchable && (
            <div className={ui.menuSearch}>
              <Icon name="search" size={14} />
              <input
                className={ui.menuSearchInput}
                value={query}
                placeholder={t('common.search')}
                aria-label={t('common.search')}
                data-testid={props.testId === undefined ? undefined : `${props.testId}-search`}
                // biome-ignore lint/a11y/noAutofocus: 项多时打开下拉多半是为了找一项
                autoFocus
                onChange={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  const first = shown[0]
                  if (first !== undefined) pick(first.value)
                }}
              />
            </div>
          )}
          <div
            ref={list}
            role="menu"
            aria-label={props.label}
            className={css.list}
            style={{ maxHeight: place.list }}
          >
            {shown.map((option) => (
              <button
                key={option.value}
                type="button"
                role="menuitemradio"
                aria-checked={option.value === props.value}
                className={ui.menuItem}
                data-active={option.value === props.value}
                data-testid={
                  props.testId === undefined ? undefined : `${props.testId}-${option.value}`
                }
                onClick={() => pick(option.value)}
              >
                <span className={ui.menuLabel}>
                  <Highlight text={option.label} needle={needle} />
                </span>
                <span className={css.check} aria-hidden="true">
                  <Icon name="check" size={13} />
                </span>
              </button>
            ))}
            {shown.length === 0 && t !== undefined && (
              <p className={ui.menuEmpty}>{t('common.noMatch')}</p>
            )}
          </div>
        </div>
      </Popover>
    </div>
  )
}

/** 往哪边开、列表最高多少。 */
export interface MenuPlace {
  up: boolean
  list: number
}

/**
 * 量触发块在所在滚动区（没有就是窗口）里上下各有多少地方：下面放得下就往下，否则往宽的那边；
 * 列表高度封顶在那边放得下的高度。
 */
export function menuPlace(
  element: HTMLElement | null,
  count: number,
  searchable: boolean,
): MenuPlace {
  if (element === null) return { up: false, list: LIST_MAX }
  let top = 0
  let bottom = window.innerHeight
  for (let node = element.parentElement; node !== null; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') {
      const box = node.getBoundingClientRect()
      top = Math.max(top, box.top)
      bottom = Math.min(bottom, box.bottom)
      break
    }
  }
  const rect = element.getBoundingClientRect()
  return placeMenu({
    below: bottom - rect.bottom,
    above: rect.top - top,
    count,
    searchable,
  })
}

/** {@link menuPlace} 的算术部分（单测用）。 */
export function placeMenu(room: {
  below: number
  above: number
  count: number
  searchable: boolean
}): MenuPlace {
  const chrome = MENU_CHROME + (room.searchable ? SEARCH_HEIGHT : 0) + EDGE
  const want = Math.min(room.count * ITEM_HEIGHT, LIST_MAX)
  const cap = (space: number): number => Math.max(LIST_MIN, Math.min(LIST_MAX, space - chrome))
  if (room.below - chrome >= want) return { up: false, list: cap(room.below) }
  const up = room.above > room.below
  return { up, list: cap(up ? room.above : room.below) }
}
