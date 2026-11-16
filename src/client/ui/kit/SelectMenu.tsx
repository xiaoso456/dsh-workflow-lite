/**
 * dsh-workflow-lite — 下拉菜单的里面：（可选的）搜索框 + 一列选项。下拉选择（{@link Select}）和
 * 别处点开挑一项的按钮（命令模板）共用，长得、用起来都一样。
 *
 * - 带搜索框时焦点落在框里，打字即筛，命中的字高亮（名字和说明都搜）；下键进列表，Enter 选第一个命中的。
 * - 选项可以带一行说明（名字下面一行灰字）。
 * - 有 `value` 是单选（选中项带底色和钩）；有 `checked` 是多选（勾着的带底色和钩，点一下勾上 / 去掉，菜单不收）；
 *   都没有是一列动作（点了就做，不记哪个选过）。
 * - 带 `create` 时，搜索框里的字不是已有的一项就在列表末尾多一项「新建……」（打标签：搜不到就新建一个）。
 *
 * 挂在 Popover 里，收起后卸掉：搜索的字随之清空，下次打开从头来。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/kit/SelectMenu
 */

import { useRef, useState } from 'react'
import type { T } from '../../i18n.ts'
import { matchRange, normalizeNeedle } from '../../model/switcherSearch.ts'
import { cx } from './cx.ts'
import { Highlight } from './Highlight.tsx'
import { Icon } from './Icon.tsx'
import css from './select.module.css'
import ui from './ui.module.css'
import { useRadioMenu } from './useRadioMenu.ts'

export interface MenuOption<V extends string> {
  value: V
  label: string
  /** 名字下面一行灰字。 */
  desc?: string
  /** 写在项右边的数（标签：几个工作流在用）。 */
  count?: number
  /** 名字前面的记号（标签：带颜色的标签图标）。 */
  lead?: React.ReactNode
}

/** 搜索框里的字不是已有的一项时，末尾多出来的那一项。 */
export interface MenuCreate {
  /** 那一项上写什么（「新建标签「周报」」）。 */
  label(text: string): string
  /** 这个字已经是一项了（不再给「新建」）。 */
  exists(text: string): boolean
  onCreate(text: string): void
}

export function SelectMenu<V extends string>(props: {
  open: boolean
  label: string
  options: readonly MenuOption<V>[]
  /** 单选时选中的那一项；一列动作时不给。 */
  value?: V
  /** 多选时勾着的那几项（和 `value` 二选一）。 */
  checked?: ReadonlySet<V>
  /** 搜不到时可以新建（要搜索框）。 */
  create?: MenuCreate
  /** 搜索框的占位字（缺省「搜索」）。 */
  placeholder?: string
  /** 一项都没有、也没在搜时的那句话（缺省「没有匹配项」）。 */
  emptyText?: string
  /** 带不带搜索框（要 `t`）。 */
  searchable: boolean
  t?: T
  /** 每一项是 `${testId}-${value}`，搜索框是 `${testId}-search`。 */
  testId?: string
  /** 列表最高多少（见 Select 的 `menuPlace`）。 */
  listMax: number
  onPick(value: V): void
}): React.JSX.Element {
  const { t } = props
  const [query, setQuery] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const searchable = props.searchable && t !== undefined
  const radio = props.value !== undefined
  const checked = props.checked
  const needle = searchable ? normalizeNeedle(query) : ''
  const typed = query.trim()
  const create =
    searchable && props.create !== undefined && typed !== '' && !props.create.exists(typed)
      ? props.create
      : undefined
  const make = (): void => {
    if (create === undefined) return
    create.onCreate(typed)
    setQuery('')
  }
  const shown =
    needle === ''
      ? props.options
      : props.options.filter(
          (option) =>
            matchRange(option.label, needle) !== null ||
            (option.desc !== undefined && matchRange(option.desc, needle) !== null),
        )
  const onKeyDown = useRadioMenu(props.open, list, !searchable)
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 搜索框和列表共用一套上下键
    <div onKeyDown={onKeyDown}>
      {searchable && (
        <div className={ui.menuSearch}>
          <Icon name="search" size={14} />
          <input
            className={ui.menuSearchInput}
            value={query}
            placeholder={props.placeholder ?? t('common.search')}
            aria-label={props.placeholder ?? t('common.search')}
            data-testid={props.testId === undefined ? undefined : `${props.testId}-search`}
            // biome-ignore lint/a11y/noAutofocus: 打开带搜索框的下拉多半是为了找一项
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const first = shown[0]
              if (first !== undefined) props.onPick(first.value)
              else make()
            }}
          />
        </div>
      )}
      <div
        ref={list}
        role="menu"
        aria-label={props.label}
        className={css.list}
        style={{ maxHeight: props.listMax }}
      >
        {shown.map((option) => {
          const on = checked?.has(option.value) ?? option.value === props.value
          return (
            <button
              key={option.value}
              type="button"
              {...(checked !== undefined
                ? { role: 'menuitemcheckbox', 'aria-checked': on }
                : radio
                  ? { role: 'menuitemradio', 'aria-checked': on }
                  : { role: 'menuitem' })}
              className={cx(ui.menuItem, option.desc !== undefined && css.twoLine)}
              data-active={(radio || checked !== undefined) && on}
              data-testid={
                props.testId === undefined ? undefined : `${props.testId}-${option.value}`
              }
              onClick={() => props.onPick(option.value)}
            >
              {option.lead}
              <span className={css.text}>
                <span className={cx(ui.menuLabel, option.desc !== undefined && css.name)}>
                  <Highlight text={option.label} needle={needle} />
                </span>
                {option.desc !== undefined && (
                  <span className={css.desc}>
                    <Highlight text={option.desc} needle={needle} />
                  </span>
                )}
              </span>
              {option.count !== undefined && <span className={css.count}>{option.count}</span>}
              {(radio || checked !== undefined) && (
                <span className={css.check} aria-hidden="true">
                  <Icon name="check" size={13} />
                </span>
              )}
            </button>
          )
        })}
        {create !== undefined && (
          <button
            type="button"
            role="menuitem"
            className={cx(ui.menuItem, css.create)}
            data-testid={props.testId === undefined ? undefined : `${props.testId}-create`}
            onClick={make}
          >
            <Icon name="plus" size={14} />
            <span className={ui.menuLabel}>{create.label(typed)}</span>
          </button>
        )}
        {shown.length === 0 && create === undefined && t !== undefined && (
          <p className={ui.menuEmpty}>
            {typed === '' && props.emptyText !== undefined ? props.emptyText : t('common.noMatch')}
          </p>
        )}
      </div>
    </div>
  )
}
