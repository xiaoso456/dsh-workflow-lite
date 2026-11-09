/**
 * dsh-workflow-lite — 「内容」一组里 CSV / TSV 表的那几项。
 * 位置、列（点一下隐藏）、排序、数字列画条。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/options/TableOptions
 */

import type { TableView } from '../../../../shared/types.ts'
import { useTableHead } from '../../../app/cardFacts.ts'
import type { T } from '../../../i18n.ts'
import filterCss from '../../files/filterField.module.css'
import { Segmented } from '../../kit/Segmented.tsx'
import { Select } from '../../kit/Select.tsx'
import css from '../display.module.css'
import { patchTable } from '../views/TableView.tsx'
import { FromPicker, OptSwitch } from './optionParts.tsx'

/** 排序那一格里「原顺序」的值（列名不会是空串）。 */
const NO_SORT = ''

/**
 * 表格的那几项：位置、列（一列一个小药丸，点一下藏起来 / 露出来，至少留一列）、排序（选一列 + 方向）、数字列画条。
 * 列名是卡片读到的（还没读到时只列已经藏起来的）。文件里已经没有的列，藏着的也列出来，好放出来。
 */
export function TableOptions(props: {
  t: T
  value: TableView
  headKey: string
  onChange(table: TableView | undefined): void
}): React.JSX.Element {
  const { t, value } = props
  const head = useTableHead(props.headKey)
  const hidden = new Set(value.hide ?? [])
  const names = [...new Set([...(head ?? []), ...hidden])]
  const shown = names.filter((name) => !hidden.has(name))
  const set = (patch: Partial<TableView>): void => props.onChange(patchTable(value, patch))
  const toggle = (name: string): void => {
    const next = hidden.has(name)
      ? [...hidden].filter((other) => other !== name)
      : [...hidden, name]
    set({ hide: next.length === 0 ? undefined : next })
  }
  const sortable = head ?? (value.sort === undefined ? [] : [value.sort.column])
  return (
    <>
      <FromPicker
        t={t}
        value={value.from}
        tip={t('display.tableFromTip')}
        onChange={(from) => set({ from })}
      />
      <div className={filterCss.optLine} data-align="top">
        <span className={filterCss.optLabel} data-tip={t('display.columnsTip')}>
          {t('display.columns')}
        </span>
        {names.length === 0 ? (
          <span className={css.optNote}>{t('display.columnsNone')}</span>
        ) : (
          <span className={filterCss.columns} data-testid="wl-display-columns">
            {names.map((name) => {
              const off = hidden.has(name)
              // 只剩这一列露着：不让藏（一列都没有的表没法看）。
              const last = !off && shown.length <= 1
              return (
                <button
                  key={name}
                  type="button"
                  className={filterCss.preset}
                  aria-pressed={!off}
                  disabled={last}
                  data-off={off || undefined}
                  data-tip={off ? undefined : t('table.hideColumn')}
                  data-testid="wl-display-column"
                  onClick={() => toggle(name)}
                >
                  {name}
                </button>
              )
            })}
          </span>
        )}
      </div>
      <div className={filterCss.optLine}>
        <span className={filterCss.optLabel} data-tip={t('display.sortTip')}>
          {t('display.sort')}
        </span>
        <div className={css.optGrow}>
          <Select<string>
            label={t('display.sort')}
            value={value.sort?.column ?? NO_SORT}
            options={[
              { value: NO_SORT, label: t('display.sort.none') },
              ...sortable.map((name) => ({ value: name, label: name })),
            ]}
            testId="wl-display-sort"
            onChange={(column) =>
              set({
                sort:
                  column === NO_SORT
                    ? undefined
                    : { column, ...(value.sort?.desc === true ? { desc: true as const } : {}) },
              })
            }
          />
        </div>
        <Segmented<'asc' | 'desc'>
          label={t('display.sort')}
          value={value.sort?.desc === true ? 'desc' : 'asc'}
          disabled={value.sort === undefined}
          options={[
            { value: 'asc', label: '↑', tip: t('table.sortAsc') },
            { value: 'desc', label: '↓', tip: t('table.sortDesc') },
          ]}
          testId="wl-display-sort-dir"
          onChange={(dir) => {
            if (value.sort === undefined) return
            set({
              sort: { column: value.sort.column, ...(dir === 'desc' ? { desc: true } : {}) },
            })
          }}
        />
      </div>
      <OptSwitch
        on={value.bars === true}
        label={t('display.bars')}
        tip={t('display.barsTip')}
        testId="wl-display-bars"
        onToggle={() => set({ bars: value.bars === true ? undefined : true })}
      />
    </>
  )
}
