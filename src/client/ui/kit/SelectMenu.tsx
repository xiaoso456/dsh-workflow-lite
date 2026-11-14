/**
 * dsh-workflow-lite — 下拉菜单的里面：（可选的）搜索框 + 一列选项。下拉选择（{@link Select}）和
 * 别处点开挑一项的按钮（命令模板）共用，长得、用起来都一样。
 *
 * - 带搜索框时焦点落在框里，打字即筛，命中的字高亮（名字和说明都搜）；下键进列表，Enter 选第一个命中的。
 * - 选项可以带一行说明（名字下面一行灰字）。
 * - 有 `value` 是单选（选中项带底色和钩）；没有是一列动作（点了就做，不记哪个选过）。
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
}

export function SelectMenu<V extends string>(props: {
  open: boolean
  label: string
  options: readonly MenuOption<V>[]
  /** 单选时选中的那一项；一列动作时不给。 */
  value?: V
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
  const needle = searchable ? normalizeNeedle(query) : ''
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
            placeholder={t('common.search')}
            aria-label={t('common.search')}
            data-testid={props.testId === undefined ? undefined : `${props.testId}-search`}
            // biome-ignore lint/a11y/noAutofocus: 打开带搜索框的下拉多半是为了找一项
            autoFocus
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              const first = shown[0]
              if (first !== undefined) props.onPick(first.value)
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
        {shown.map((option) => (
          <button
            key={option.value}
            type="button"
            {...(radio
              ? { role: 'menuitemradio', 'aria-checked': option.value === props.value }
              : { role: 'menuitem' })}
            className={cx(ui.menuItem, option.desc !== undefined && css.twoLine)}
            data-active={radio && option.value === props.value}
            data-testid={props.testId === undefined ? undefined : `${props.testId}-${option.value}`}
            onClick={() => props.onPick(option.value)}
          >
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
            {radio && (
              <span className={css.check} aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
            )}
          </button>
        ))}
        {shown.length === 0 && t !== undefined && (
          <p className={ui.menuEmpty}>{t('common.noMatch')}</p>
        )}
      </div>
    </div>
  )
}
