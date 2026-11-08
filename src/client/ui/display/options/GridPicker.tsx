/**
 * dsh-workflow-lite — 文件夹图片墙的张数：8 × 6 的小方格，指针扫过去预览，点一下定下。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/options/GridPicker
 */

import { useRef, useState } from 'react'
import { GALLERY_GRID_MAX } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import shared from '../display.module.css'
import css from './gridPicker.module.css'

type Grid = { columns: number; rows: number }

/**
 * 挑几列几行：8 × 6 的小方格，指针扫过去预览（亮起左上角那一块），点一下定下；方向键一格一格改。
 * 第一张放大时左上角两列两行深一档（那一块是一张）。
 */
export function GridPicker(props: {
  t: T
  value: Grid
  hero: boolean
  onChange(grid: Grid): void
}): React.JSX.Element {
  const { t, value } = props
  const [preview, setPreview] = useState<Grid | null>(null)
  const shown = preview ?? value
  const cells = useRef(new Map<string, HTMLButtonElement>())
  const hero = props.hero && shown.columns >= 3 && shown.rows >= 2
  const count = shown.columns * shown.rows - (hero ? 3 : 0)
  const move = (columns: number, rows: number): void => {
    const next = {
      columns: Math.min(GALLERY_GRID_MAX.columns, Math.max(1, columns)),
      rows: Math.min(GALLERY_GRID_MAX.rows, Math.max(1, rows)),
    }
    if (next.columns === value.columns && next.rows === value.rows) return
    props.onChange(next)
    cells.current.get(`${next.columns}x${next.rows}`)?.focus()
  }
  const steps: Record<string, [number, number]> = {
    ArrowRight: [1, 0],
    ArrowLeft: [-1, 0],
    ArrowDown: [0, 1],
    ArrowUp: [0, -1],
  }
  return (
    <div className={css.gridPick}>
      <div
        className={css.gridCells}
        role="group"
        aria-label={t('display.count')}
        onPointerLeave={() => setPreview(null)}
        data-testid="wl-display-grid"
      >
        {Array.from({ length: GALLERY_GRID_MAX.rows }, (_, row) =>
          Array.from({ length: GALLERY_GRID_MAX.columns }, (_, column) => {
            const at = { columns: column + 1, rows: row + 1 }
            const key = `${at.columns}x${at.rows}`
            const current = at.columns === value.columns && at.rows === value.rows
            return (
              <button
                key={key}
                ref={(element) => {
                  if (element === null) cells.current.delete(key)
                  else cells.current.set(key, element)
                }}
                type="button"
                className={css.gridCell}
                tabIndex={current ? 0 : -1}
                aria-label={t('display.grid')
                  .replace('{columns}', String(at.columns))
                  .replace('{rows}', String(at.rows))}
                aria-pressed={current}
                data-on={(column < shown.columns && row < shown.rows) || undefined}
                data-hero={(hero && column < 2 && row < 2) || undefined}
                data-testid={`wl-display-grid-${key}`}
                onPointerEnter={() => setPreview(at)}
                onClick={() => {
                  setPreview(null)
                  props.onChange(at)
                }}
                onKeyDown={(event) => {
                  const step = steps[event.key]
                  if (step === undefined) return
                  event.preventDefault()
                  move(value.columns + step[0], value.rows + step[1])
                }}
              />
            )
          }),
        )}
      </div>
      <span className={shared.optNote} aria-live="polite">
        {t('display.countPick')
          .replace('{columns}', String(shown.columns))
          .replace('{rows}', String(shown.rows))
          .replace('{n}', String(count))}
      </span>
    </div>
  )
}
