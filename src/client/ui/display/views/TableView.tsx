/**
 * dsh-workflow-lite — 展示区里的 CSV / TSV 表：表头钉在上面，按设置隐藏列、排序、画条，新加的行亮一下。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/TableView
 */

import { useCallback, useMemo } from 'react'
import type { TableView } from '../../../../shared/types.ts'
import type { RunLine } from '../../../../shared/wire/run.ts'
import { publishTableHead } from '../../../app/cardFacts.ts'
import type { T } from '../../../i18n.ts'
import type { Display } from '../../../model/display.ts'
import { formatBytes } from '../../../model/fileKind.ts'
import type { LineWindow } from '../../../model/logLines.ts'
import { delimiterOf, parseDelimited } from '../../../model/textShape.ts'
import { DataTable } from '../../kit/DataTable.tsx'
import css from '../display.module.css'
import { type Marks, useFollow, useMarks, useOverflow, WRAP_LINES } from './follow.ts'

/** 表格多了几行：新加的是后面那几行（中间改了的不细究——那种更新卡片右上角还是会说「刚更新」）。 */
function addedRows(before: string, after: string, format: 'csv' | 'tsv'): ReadonlySet<number> {
  const count = (text: string): number => parseDelimited(text, delimiterOf(format, text), 0).total
  const from = count(before)
  const to = count(after)
  const added = new Set<number>()
  for (let row = from; row < Math.min(to, WRAP_LINES); row += 1) added.add(row)
  return added
}

/** 卡片上的表：读到的列名记在哪（设置浮层挑列用），进了交互点表头排序写回哪。 */
export interface TableEnv {
  headKey: string
  onTable?: ((table: TableView | undefined) => void) | undefined
}

/** 改表格设置里的一项（`undefined` 是去掉）；全去掉了就是 `undefined`。 */
export function patchTable(view: TableView, patch: Partial<TableView>): TableView | undefined {
  const next: TableView = { ...view, ...patch }
  for (const key of Object.keys(patch) as (keyof TableView)[]) {
    if (patch[key] === undefined) delete next[key]
  }
  return Object.keys(next).length === 0 ? undefined : next
}

/**
 * CSV / TSV 排成表：表头钉在上面（进了交互滚着看也在），超出的那边淡出，新加的行亮一下。
 * 按设置隐藏几列、按一列排、数字列画条；进了交互点表头排序（写回设置）。
 * 只读了末尾一截的（`tail`）：没有行号（不知道是第几行），停在最底下跟着新加的行走；排了序就不跟。
 */
export function TableFlow(props: {
  t: T
  text: string
  format: 'csv' | 'tsv'
  display: Display
  interactive: boolean
  env: TableEnv | undefined
  /** 按行读的：新加的几行外面比好了给进来；不给就和上一份文字比。 */
  marks?: Marks | null
  tail?: boolean
  /** 表格下面那句（按行读的：前面 / 后面还有多少）；不给就数没排出来的行。 */
  note?: string | null
}): React.JSX.Element {
  const view = props.display.table
  const pin = props.tail === true && view.sort === undefined
  const [clip, over] = useOverflow(pin && !props.interactive)
  const own = useMarks(props.text, (before, after) => addedRows(before, after, props.format))
  useFollow(clip, pin, props.interactive, props.text)
  const headKey = props.env?.headKey
  const onHead = useCallback(
    (names: readonly string[]) => {
      if (headKey !== undefined) publishTableHead(headKey, names)
    },
    [headKey],
  )
  const onTable = props.env?.onTable
  return (
    <div
      ref={clip}
      className={css.flowClip}
      data-over-x={over.x || undefined}
      // 停在最底下的不淡上边：表头钉在那儿，上面滚走的行在表头后面。
      data-over-y={(over.y && !pin) || undefined}
    >
      <div className={css.sheet} style={{ zoom: props.display.zoom / 100 }}>
        <DataTable
          t={props.t}
          text={props.text}
          format={props.format}
          maxRows={WRAP_LINES}
          compact
          marks={props.marks !== undefined ? props.marks : own}
          moreText={props.t('display.moreLines')}
          {...(props.note === undefined ? {} : { note: props.note })}
          numbers={props.tail !== true}
          hide={view.hide}
          sort={view.sort}
          bars={view.bars}
          onSort={
            props.interactive && onTable !== undefined
              ? (sort) => onTable(patchTable(view, { sort }))
              : undefined
          }
          onHead={onHead}
        />
      </div>
    </div>
  )
}

/**
 * 按行读回来的表（`run/lines`）：表头是文件第一行（从头看时就是窗口第一行，看末尾时另读一行），
 * 表体是窗口里其余的行。新加的行 = 这一回窗口里多出来的行首位置（都在末尾）。
 */
export function TableLines(props: {
  t: T
  win: LineWindow
  /** 文件第一行（看末尾时另读的）。 */
  head: RunLine | null
  format: 'csv' | 'tsv'
  display: Display
  interactive: boolean
  tail: boolean
  env: TableEnv | undefined
}): React.JSX.Element {
  const { t, win } = props
  const body = win.lines.filter((line) => line.at !== 0)
  const head = props.tail ? props.head : (win.lines.find((line) => line.at === 0) ?? null)
  const text = useMemo(
    () => [head?.text ?? '', ...body.map((line) => line.text)].join('\n'),
    // 窗口就是内容的身份。
    [win, head?.text],
  )
  const marks = useMarks(win, (before, after) => {
    const seen = new Set(before.lines.map((line) => line.at))
    const rows = after.lines.filter((line) => line.at !== 0)
    const added = rows.filter((line) => !seen.has(line.at)).length
    // 整个换了（换了看的位置、文件被重写）不标。
    if (added === 0 || added >= rows.length) return new Set<number>()
    return new Set(Array.from({ length: added }, (_, index) => rows.length - added + index))
  })
  const more = props.tail ? win.before : win.after
  const bytes = props.tail
    ? t('display.earlierBytes').replace('{size}', formatBytes(win.start))
    : t('display.laterBytes').replace('{size}', formatBytes(Math.max(0, win.size - win.end)))
  const sorted =
    props.display.table.sort !== undefined
      ? t('table.sortedLoaded').replace('{n}', body.length.toLocaleString())
      : null
  const note = more ? [sorted, bytes].filter(Boolean).join(' · ') : null
  return (
    <TableFlow
      t={t}
      text={text}
      format={props.format}
      display={props.display}
      interactive={props.interactive}
      env={props.env}
      marks={marks}
      tail={props.tail}
      note={note}
    />
  )
}
