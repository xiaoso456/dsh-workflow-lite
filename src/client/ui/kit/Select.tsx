/**
 * dsh-workflow-lite — 下拉选择（单选）：一个输入框样子的触发块，点开是一张和别处菜单一样的浮层。
 *
 * 不用原生 `<select>`：原生下拉的列表由系统画，颜色、字号、圆角都跟不上主题。
 * 选中项带底色和钩；打开时焦点落在选中项上，上下键在项之间走，Esc / 点外面收起，选了收起并把焦点还给触发块。
 *
 * 浮层不越出所在的滚动区（属性面板、对话框、设置页）：
 * - 打开时量一下触发块上下各有多少地方，往宽的那边开，列表高度封顶在那边放得下的高度，多的在列表里滚；
 *   不会被滚动区裁掉，也不会把滚动区撑长、把页面顶下去（收起时页面再弹回来，还会收掉随后浮出的确认小卡）。
 * - 项多（{@link SEARCH_FROM} 项以上，比如选会话）或给了 `search` 时顶上带一个搜索框（和切换工作流的同一个样子），
 *   菜单里面见 {@link SelectMenu}。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/Select
 */

import { useRef, useState } from 'react'
import type { T } from '../../i18n.ts'
import { cx } from './cx.ts'
import { Icon } from './Icon.tsx'
import { Popover } from './Popover.tsx'
import { type MenuOption, SelectMenu } from './SelectMenu.tsx'
import css from './select.module.css'
import ui from './ui.module.css'

/** 多少项起带搜索框。 */
export const SEARCH_FROM = 8
/** 菜单一项的高（`ui.menuItem` 的最小高）、搜索框连下边距的高、菜单上下内边距与离触发块的间距。 */
const ITEM_HEIGHT = 34
/** 带一行说明的项的高（`select.module.css` 的 `.twoLine`，连上下内边距）。 */
export const TWO_LINE_HEIGHT = 46
const SEARCH_HEIGHT = 38
const MENU_CHROME = 16
/** 列表最高多少；地方再小也至少给这么高（宁可在滚动区里滚，也别只露一两项）。 */
const LIST_MAX = 320
const LIST_MIN = 120
/** 浮层离滚动区边缘留的空。 */
const EDGE = 8

export type SelectOption<V extends string> = MenuOption<V>

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
  /** 不带自己的框和底（放在已经有框的列表行里，见 trigger/SummaryRow 的 SummaryField）。 */
  plain?: boolean
  /** 项少也带搜索框（要 `t`）。 */
  search?: boolean
}): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState<MenuPlace>({ up: false, list: LIST_MAX })
  const trigger = useRef<HTMLButtonElement>(null)
  const current = props.options.find((option) => option.value === props.value)
  const searchable =
    t !== undefined && (props.search === true || props.options.length >= SEARCH_FROM)

  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }
  const pick = (value: V): void => {
    if (value !== props.value) props.onChange(value)
    close()
  }

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
            className={cx(ui.input, css.trigger, props.plain === true && css.plain)}
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
              setPlace(
                menuPlace(
                  trigger.current,
                  props.options.length,
                  searchable,
                  props.options.some((option) => option.desc !== undefined)
                    ? TWO_LINE_HEIGHT
                    : ITEM_HEIGHT,
                ),
              )
              setOpen(true)
            }}
          >
            <span className={css.value}>
              {current?.label ?? ''}
              {current?.desc !== undefined && <span className={css.valueDesc}>{current.desc}</span>}
            </span>
            <span className={css.chevron} aria-hidden="true">
              <Icon name="chevronDown" size={14} />
            </span>
          </button>
        }
      >
        <SelectMenu<V>
          open={open}
          label={props.label}
          options={props.options}
          value={props.value}
          searchable={searchable}
          {...(t === undefined ? {} : { t })}
          {...(props.testId === undefined ? {} : { testId: props.testId })}
          listMax={place.list}
          onPick={pick}
        />
      </Popover>
    </div>
  )
}

/** 往哪边开、列表最高多少。 */
export interface MenuPlace {
  up: boolean
  list: number
}

/** 触发块在所在滚动区（没有就是窗口）里上下各有多少地方（别的浮层定往哪边开也用）。 */
export function roomAround(element: HTMLElement): { above: number; below: number } {
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
  return { above: rect.top - top, below: bottom - rect.bottom }
}

/**
 * 量触发块上下各有多少地方（{@link roomAround}）：下面放得下就往下，否则往宽的那边；
 * 列表高度封顶在那边放得下的高度。
 */
export function menuPlace(
  element: HTMLElement | null,
  count: number,
  searchable: boolean,
  itemHeight = ITEM_HEIGHT,
): MenuPlace {
  if (element === null) return { up: false, list: LIST_MAX }
  return placeMenu({ ...roomAround(element), count, searchable, itemHeight })
}

/** {@link menuPlace} 的算术部分（单测用）。 */
export function placeMenu(room: {
  below: number
  above: number
  count: number
  searchable: boolean
  /** 一项多高（缺省一行的）。 */
  itemHeight?: number
}): MenuPlace {
  const chrome = MENU_CHROME + (room.searchable ? SEARCH_HEIGHT : 0) + EDGE
  const want = Math.min(room.count * (room.itemHeight ?? ITEM_HEIGHT), LIST_MAX)
  const cap = (space: number): number => Math.max(LIST_MIN, Math.min(LIST_MAX, space - chrome))
  if (room.below - chrome >= want) return { up: false, list: cap(room.below) }
  const up = room.above > room.below
  return { up, list: cap(up ? room.above : room.below) }
}
