/**
 * dsh-workflow-lite — CSV / TSV 排成表（展示卡、查看框共用）。
 *
 * 第一行当表头、钉在上面；最左一列行号、横着滚时也钉着；数字列右对齐、等宽数字；隔行一层浅底。
 * 列宽跟着内容走，太长的格子截成省略号（悬停看全文）；格子里的换行显示成 ⏎，一行还是一行。
 * 只排前 `maxRows` 行，后面的说一句「还有 N 行」。文件更新后新加的行亮一下（`marks`）。
 * 展示卡还能按设置隐藏几列（`hide`）、按一列排（`sort`，只排读到的这些行）、数字列垫一条按大小比例的浅条（`bars`）；
 * 给了 `onSort` 表头能点：点一下从小到大，再点倒过来，第三下回到原顺序。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/DataTable
 */

import { useEffect, useMemo } from 'react'
import type { TableView } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import {
  columnName,
  delimiterOf,
  numberOf,
  numericColumns,
  parseDelimited,
  sortOrder,
} from '../model/textShape.ts'
import { Icon } from './Icon.tsx'
import css from './table.module.css'

/** 格子里超过这么多字就截（悬停看全文）。 */
const CELL_TIP = 24

type TableSort = NonNullable<TableView['sort']>

/** 点表头时下一步：没排 → 从小到大 → 从大到小 → 不排。 */
export function nextSort(sort: TableSort | undefined, column: string): TableSort | undefined {
  if (sort?.column !== column) return { column }
  return sort.desc === true ? undefined : { column, desc: true }
}

export function DataTable(props: {
  t: T
  text: string
  format: 'csv' | 'tsv'
  maxRows: number
  /** 卡片里：字小一号、行矮一点、不接悬停。 */
  compact?: boolean
  /** 表格下面那句「还有 N 行」怎么说（卡片里多一句「打开查看全部」）。 */
  moreText?: string
  /** 表格下面那句直接给（按行读的：「前面还有 1.3 MB」）；给了就不数行。 */
  note?: string | null
  /** 新加的几行（表体行号，从 0 起）：亮一下再淡下去；`parity` 每次更新换一个，高亮从头再来。 */
  marks?: { items: ReadonlySet<number>; parity: 0 | 1 } | null
  /** 左边的行号（只读了末尾一截时不知道是第几行，不排）。 */
  numbers?: boolean
  hide?: readonly string[] | undefined
  sort?: TableSort | undefined
  bars?: boolean | undefined
  /** 表头能点着排（展示卡进了交互）。 */
  onSort?: ((sort: TableSort | undefined) => void) | undefined
  /** 读到的列名（设置浮层里挑列用）。 */
  onHead?: ((names: readonly string[]) => void) | undefined
}): React.JSX.Element {
  const { t } = props
  const table = useMemo(
    () => parseDelimited(props.text, delimiterOf(props.format, props.text), props.maxRows),
    [props.text, props.format, props.maxRows],
  )
  const numeric = useMemo(() => numericColumns(table), [table])
  const names = useMemo(
    () => Array.from({ length: table.columns }, (_, column) => columnName(table.head, column)),
    [table],
  )
  const onHead = props.onHead
  useEffect(() => {
    if (names.length > 0) onHead?.(names)
  }, [names, onHead])
  const hidden = new Set(props.hide ?? [])
  const columns = names.flatMap((name, column) => (hidden.has(name) ? [] : [column]))
  const sortColumn = props.sort === undefined ? -1 : names.indexOf(props.sort.column)
  const order = useMemo(
    () =>
      sortColumn < 0
        ? null
        : sortOrder(
            table.rows,
            sortColumn,
            numeric[sortColumn] === true,
            props.sort?.desc === true,
          ),
    [table, numeric, sortColumn, props.sort?.desc],
  )
  // 数字列的条：按这一列（读到的这些行里）绝对值最大的那个比。
  const scale = useMemo(() => {
    if (props.bars !== true) return null
    return numeric.map((isNumber, column) => {
      if (!isNumber) return 0
      let max = 0
      for (const row of table.rows) max = Math.max(max, Math.abs(numberOf(row[column] ?? '') ?? 0))
      return max
    })
  }, [props.bars, numeric, table])
  const numbers = props.numbers !== false
  const rest = table.total - table.rows.length
  const note =
    props.note !== undefined
      ? props.note
      : rest > 0
        ? (props.moreText ?? t('table.more')).replace('{n}', rest.toLocaleString())
        : null

  const cell = (value: string, column: number): React.JSX.Element => {
    const shown = value.replace(/\r?\n/gu, ' ⏎ ')
    const max = scale?.[column] ?? 0
    const amount = max > 0 ? numberOf(value) : null
    return (
      <td
        key={column}
        data-num={numeric[column] || undefined}
        data-empty={value === '' || undefined}
        data-bar={amount !== null || undefined}
        style={
          amount === null
            ? undefined
            : ({ '--bar': (Math.abs(amount) / max).toFixed(3) } as React.CSSProperties)
        }
        data-tip={!props.compact && shown.length > CELL_TIP ? value : undefined}
      >
        {shown}
      </td>
    )
  }
  const head = (column: number): React.JSX.Element => {
    const raw = table.head[column] ?? ''
    const label = raw === '' ? t('table.column').replace('{n}', String(column + 1)) : raw
    const name = names[column] as string
    const sorted = props.sort?.column === name ? (props.sort.desc ? 'desc' : 'asc') : undefined
    const onSort = props.onSort
    return (
      <th
        key={column}
        data-num={numeric[column] || undefined}
        data-sorted={sorted}
        aria-sort={sorted === undefined ? undefined : sorted === 'asc' ? 'ascending' : 'descending'}
      >
        {onSort === undefined ? (
          <>
            {label}
            {sorted !== undefined && <SortMark desc={sorted === 'desc'} />}
          </>
        ) : (
          <button
            type="button"
            className={css.sortButton}
            data-tip={t(
              sorted === undefined
                ? 'table.sortAsc'
                : sorted === 'asc'
                  ? 'table.sortDesc'
                  : 'table.sortOff',
            )}
            data-testid="wl-table-sort"
            onClick={() => onSort(nextSort(props.sort, name))}
          >
            {label}
            <SortMark desc={sorted === 'desc'} off={sorted === undefined} />
          </button>
        )}
      </th>
    )
  }
  const rows = order ?? table.rows.map((_, index) => index)
  return (
    <div className={css.wrap} data-compact={props.compact || undefined} data-testid="wl-data-table">
      <table className={css.table}>
        <thead>
          <tr>
            {numbers && <th className={css.rowNo} aria-label={t('table.rowNo')} />}
            {columns.map(head)}
          </tr>
        </thead>
        <tbody>
          {rows.map((index) => {
            const row = table.rows[index] as string[]
            return (
              <tr
                // 排序后行跟着走：用原来的行号当身份（新加的行亮一下认的也是它）。
                key={index}
                data-new={props.marks?.items.has(index) === true ? props.marks.parity : undefined}
              >
                {numbers && <td className={css.rowNo}>{index + 1}</td>}
                {columns.map((column) => cell(row[column] ?? '', column))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {note !== null && <p className={css.more}>{note}</p>}
    </div>
  )
}

/** 表头上排序的小箭头（能点、还没排的时候悬停才露出来）。 */
function SortMark(props: { desc: boolean; off?: boolean }): React.JSX.Element {
  return (
    <span
      className={css.sortMark}
      data-desc={props.desc || undefined}
      data-off={props.off || undefined}
    >
      <Icon name="chevronDown" size={10} />
    </span>
  )
}

/** 表的大小说明：「128 行 × 6 列」（查看框标题行用）。 */
export function tableSize(t: T, text: string, format: 'csv' | 'tsv'): string {
  const table = parseDelimited(text, delimiterOf(format, text), 0)
  return t('table.size')
    .replace('{rows}', table.total.toLocaleString())
    .replace('{cols}', String(table.columns))
}
