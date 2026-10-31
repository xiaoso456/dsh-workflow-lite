/**
 * dsh-workflow-lite — 展示设置浮层里的「内容」一组：按展示的东西不同给不同的几项（见 {@link DisplayOptions}）。
 *
 * - 日志、纯文本：位置（自动 / 末尾 / 开头）、只看（筛选：普通文字或正则、区分大小写、反选、前后带几行、
 *   两个现成的筛选）、错误警告着色。
 * - CSV / TSV：位置、列（点一下隐藏）、排序、数字列画条。
 * - 文件夹（图墙）：排法、张数（自动或固定几列几行）、顺序、最新一张放大。
 *
 * 改什么卡片当场跟着变；筛选框打字时停一下才生效（每敲一个字就去主机找一遍不值当）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/DisplayContent
 */

import { useEffect, useRef, useState } from 'react'
import { contentKindOf, galleryGrid } from '../../shared/display.ts'
import { extensionOf } from '../../shared/fileKind.ts'
import { LINE_CONTEXT_MAX } from '../../shared/model.ts'
import {
  FOLDER_MATCH_MAX,
  type FolderShow,
  GALLERY_GRID_MAX,
  type GalleryLayoutKind,
  type GalleryView,
  type LineFilter,
  type LineView,
  type ResourceView,
  type TableView,
  type ViewFit,
  type ViewFrom,
} from '../../shared/types.ts'
import { useFolderFacts, useTableHead } from '../app/cardFacts.ts'
import type { T } from '../i18n.ts'
import type { Display } from '../model/display.ts'
import { fileBaseName } from '../model/fileKind.ts'
import { FILTER_PRESETS, type FilterPreset, filterProblem } from '../model/logLines.ts'
import css from './display.module.css'
import { FileTag } from './FileTag.tsx'
import { Icon } from './Icon.tsx'
import { SwitchTrack } from './motion.tsx'
import { Stepper } from './NumberStep.tsx'
import { cx } from './primitives.tsx'
import { patchTable } from './ResourceDisplay.tsx'
import { Segmented } from './Segmented.tsx'
import { Select } from './Select.tsx'

/** 这一项有没有「内容」一组。 */
export function contentKind(display: Display, path: string): 'lines' | 'table' | 'gallery' | null {
  return contentKindOf(display.kind, path)
}

/** 筛选框停手多久才生效。 */
const FILTER_DELAY = 320

type FromChoice = ViewFrom | 'auto'

/** 「位置」三选一：自动 / 末尾 / 开头。 */
function FromPicker(props: {
  t: T
  value: ViewFrom | undefined
  tip: string
  onChange(from: ViewFrom | undefined): void
}): React.JSX.Element {
  const { t } = props
  return (
    <div className={css.optLine}>
      <span className={css.optLabel} data-tip={props.tip}>
        {t('display.from')}
      </span>
      <div className={css.optGrow}>
        <Segmented<FromChoice>
          label={t('display.from')}
          value={props.value ?? 'auto'}
          options={[
            { value: 'auto', label: t('display.from.auto') },
            { value: 'end', label: t('display.from.end') },
            { value: 'start', label: t('display.from.start') },
          ]}
          testId="wl-display-from"
          onChange={(from) => props.onChange(from === 'auto' ? undefined : from)}
        />
      </div>
    </div>
  )
}

/** 筛选框边上的小开关（正则、大小写、反选）：按下去是强调色。 */
function FlagButton(props: {
  label: string
  on: boolean
  glyph: string
  testId: string
  onToggle(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={css.flag}
      aria-pressed={props.on}
      aria-label={props.label}
      data-tip={props.label}
      data-testid={props.testId}
      onClick={props.onToggle}
    >
      {props.glyph}
    </button>
  )
}

/**
 * 筛选：一个输入框（打字停一下才生效，回车立刻生效，Esc 撤回这次输入）、三个小开关、两个现成的、前后带几行。
 * 正则写错了框子底线变红、下面说原因，卡片上还是上一次对的结果。
 */
export function FilterField(props: {
  t: T
  value: LineFilter | undefined
  onChange(filter: LineFilter | undefined): void
  /** 查看框顶上那一条：不带「只看」两个字，一行排开。 */
  inline?: boolean
  inputRef?: React.Ref<HTMLInputElement>
  /** 排在「前后带」后面的（查看框里写匹配了多少）。 */
  extra?: React.ReactNode
}): React.JSX.Element {
  const { t } = props
  const value = props.value
  const [draft, setDraft] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const latest = useRef(value)
  latest.current = value
  const text = draft ?? value?.pattern ?? ''
  // 还没写字时按下的开关先记在这里（没写字就是不筛，存不进设置里）。
  const [loose, setLoose] = useState({
    regex: false,
    caseSensitive: false,
    invert: false,
    context: 0,
  })
  const flags =
    value === undefined
      ? loose
      : {
          regex: value.regex === true,
          caseSensitive: value.caseSensitive === true,
          invert: value.invert === true,
          context: value.context ?? 0,
        }
  /** 拼一个筛选：没写字就是不筛（开关的状态也不留，下次从头来）。 */
  const make = (pattern: string, patch: Partial<typeof flags> = {}): LineFilter | undefined => {
    const next = { ...flags, ...patch }
    if (pattern === '') return undefined
    return {
      pattern,
      ...(next.regex ? { regex: true } : {}),
      ...(next.caseSensitive ? { caseSensitive: true } : {}),
      ...(next.invert ? { invert: true } : {}),
      ...(next.context > 0 ? { context: next.context } : {}),
    }
  }
  const cancel = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const commit = (pattern: string, patch: Partial<typeof flags> = {}): void => {
    cancel()
    setDraft(null)
    if (pattern === '') setLoose({ ...flags, ...patch })
    const next = make(pattern, patch)
    if (JSON.stringify(next) !== JSON.stringify(latest.current)) props.onChange(next)
  }
  useEffect(() => cancel, [])
  const problem = filterProblem(make(text))
  // 前后各带几行：没写字时灰着（不筛就没有「前后」），提示里说先写字。
  const context = (
    <Stepper
      label={t('display.context')}
      value={flags.context}
      min={0}
      max={LINE_CONTEXT_MAX}
      unit={t('display.contextUnit')}
      lessLabel={t('display.contextLess')}
      moreLabel={t('display.contextMore')}
      disabled={text === ''}
      tip={text === '' ? t('display.contextOff') : t('display.contextTip')}
      testId="wl-display-context"
      onChange={(count) => commit(text, { context: count })}
    />
  )
  return (
    <div className={css.filter} data-inline={props.inline || undefined}>
      <div className={css.optLine}>
        {props.inline !== true && <span className={css.optLabel}>{t('display.filter')}</span>}
        <div className={css.filterBox} aria-invalid={problem !== null || undefined}>
          <Icon name="search" size={13} />
          <input
            ref={props.inputRef}
            className={css.filterInput}
            value={text}
            placeholder={t('display.filterPlaceholder')}
            aria-label={t('display.filter')}
            aria-invalid={problem !== null || undefined}
            spellCheck={false}
            maxLength={500}
            data-testid="wl-display-filter"
            onChange={(event) => {
              const next = event.currentTarget.value
              setDraft(next)
              cancel()
              timer.current = window.setTimeout(() => commit(next), FILTER_DELAY)
            }}
            onBlur={() => {
              if (draft !== null) commit(draft)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commit(text)
              if (event.key === 'Escape' && draft !== null) {
                // 只撤掉这次输入，不连带收起浮层。
                event.stopPropagation()
                cancel()
                setDraft(null)
              }
            }}
          />
          {text !== '' && (
            <button
              type="button"
              className={css.clearFilter}
              aria-label={t('display.filter.clear')}
              data-tip={t('display.filter.clear')}
              data-testid="wl-display-filter-clear"
              onClick={() => commit('')}
            >
              <Icon name="x" size={12} />
            </button>
          )}
          <FlagButton
            label={t('display.filter.regex')}
            glyph=".*"
            on={flags.regex}
            testId="wl-display-filter-regex"
            onToggle={() => commit(text, { regex: !flags.regex })}
          />
          <FlagButton
            label={t('display.filter.case')}
            glyph="Aa"
            on={flags.caseSensitive}
            testId="wl-display-filter-case"
            onToggle={() => commit(text, { caseSensitive: !flags.caseSensitive })}
          />
          <FlagButton
            label={t('display.filter.invert')}
            glyph="≠"
            on={flags.invert}
            testId="wl-display-filter-invert"
            onToggle={() => commit(text, { invert: !flags.invert })}
          />
        </div>
      </div>
      {problem !== null && (
        <p className={css.filterProblem} role="alert">
          {t('display.filterBad').replace('{reason}', problem)}
        </p>
      )}
      <div className={css.filterMore}>
        <span className={css.presets}>
          {(Object.keys(FILTER_PRESETS) as FilterPreset[]).map((preset) => (
            <button
              key={preset}
              type="button"
              className={css.preset}
              aria-pressed={value?.regex === true && value.pattern === FILTER_PRESETS[preset]}
              data-testid={`wl-display-preset-${preset}`}
              onClick={() =>
                commit(FILTER_PRESETS[preset], { regex: true, caseSensitive: false, invert: false })
              }
            >
              {t(`display.preset.${preset}`)}
            </button>
          ))}
        </span>
        {props.inline === true && (
          <span className={css.context}>
            <span>{t('display.context')}</span>
            {context}
          </span>
        )}
        {props.extra}
      </div>
      {props.inline !== true && (
        <div className={css.optLine}>
          <span className={css.optLabel}>{t('display.context')}</span>
          {context}
        </div>
      )}
    </div>
  )
}

/** 一个开关一行（和「隐藏标题」一个样子）。 */
function OptSwitch(props: {
  on: boolean
  label: string
  tip?: string
  testId: string
  onToggle(): void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.on}
      className={css.optSwitch}
      data-tip={props.tip}
      data-testid={props.testId}
      onClick={props.onToggle}
    >
      <SwitchTrack on={props.on} />
      <span>{props.label}</span>
    </button>
  )
}

/** 日志、纯文本的那几项。 */
function LinesOptions(props: {
  t: T
  value: LineView
  onChange(lines: LineView | undefined): void
}): React.JSX.Element {
  const { t, value } = props
  const set = (patch: Partial<LineView>): void => {
    const next: LineView = { ...value, ...patch }
    for (const key of Object.keys(patch) as (keyof LineView)[]) {
      if (patch[key] === undefined) delete next[key]
    }
    props.onChange(Object.keys(next).length === 0 ? undefined : next)
  }
  return (
    <>
      <FromPicker
        t={t}
        value={value.from}
        tip={t('display.fromTip')}
        onChange={(from) => set({ from })}
      />
      <FilterField t={t} value={value.filter} onChange={(filter) => set({ filter })} />
      <OptSwitch
        on={value.levels !== false}
        label={t('display.levels')}
        tip={t('display.levelsTip')}
        testId="wl-display-levels"
        onToggle={() => set({ levels: value.levels === false ? undefined : false })}
      />
    </>
  )
}

/** 排序那一格里「原顺序」的值（列名不会是空串）。 */
const NO_SORT = ''

/**
 * 表格的那几项：位置、列（一列一个小药丸，点一下藏起来 / 露出来，至少留一列）、排序（选一列 + 方向）、数字列画条。
 * 列名是卡片读到的（还没读到时只列已经藏起来的）。文件里已经没有的列，藏着的也列出来，好放出来。
 */
function TableOptions(props: {
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
      <div className={css.optLine} data-align="top">
        <span className={css.optLabel} data-tip={t('display.columnsTip')}>
          {t('display.columns')}
        </span>
        {names.length === 0 ? (
          <span className={css.optNote}>{t('display.columnsNone')}</span>
        ) : (
          <span className={css.columns} data-testid="wl-display-columns">
            {names.map((name) => {
              const off = hidden.has(name)
              // 只剩这一列露着：不让藏（一列都没有的表没法看）。
              const last = !off && shown.length <= 1
              return (
                <button
                  key={name}
                  type="button"
                  className={css.preset}
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
      <div className={css.optLine}>
        <span className={css.optLabel} data-tip={t('display.sortTip')}>
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

type Grid = { columns: number; rows: number }

/**
 * 挑几列几行：8 × 6 的小方格，指针扫过去预览（亮起左上角那一块），点一下定下；方向键一格一格改。
 * 第一张放大时左上角两列两行深一档（那一块是一张）。
 */
function GridPicker(props: {
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
      <span className={css.optNote} aria-live="polite">
        {t('display.countPick')
          .replace('{columns}', String(shown.columns))
          .replace('{rows}', String(shown.rows))
          .replace('{n}', String(count))}
      </span>
    </div>
  )
}

/** 名字筛选框停手多久才生效。 */
const MATCH_DELAY = 320

/**
 * 文件夹的「只看」：按名字筛（`*.png, report-*`），打字停一下生效，回车立刻生效，Esc 撤回这次输入，× 清掉。
 */
function MatchField(props: {
  t: T
  value: string | undefined
  onChange(match: string | undefined): void
}): React.JSX.Element {
  const { t } = props
  const [draft, setDraft] = useState<string | null>(null)
  const timer = useRef<number | null>(null)
  const text = draft ?? props.value ?? ''
  const cancel = (): void => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }
  const commit = (next: string): void => {
    cancel()
    setDraft(null)
    const value = next.trim() === '' ? undefined : next.trim()
    if (value !== props.value) props.onChange(value)
  }
  useEffect(() => cancel, [])
  return (
    <div className={css.optLine}>
      <span className={css.optLabel} data-tip={t('display.matchTip')}>
        {t('display.filter')}
      </span>
      <div className={css.filterBox}>
        <Icon name="search" size={13} />
        <input
          className={css.filterInput}
          value={text}
          placeholder={t('display.matchPlaceholder')}
          aria-label={t('display.filter')}
          spellCheck={false}
          maxLength={FOLDER_MATCH_MAX}
          data-testid="wl-display-match-input"
          onChange={(event) => {
            const next = event.currentTarget.value
            setDraft(next)
            cancel()
            timer.current = window.setTimeout(() => commit(next), MATCH_DELAY)
          }}
          onBlur={() => {
            if (draft !== null) commit(draft)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit(text)
            if (event.key === 'Escape' && draft !== null) {
              event.stopPropagation()
              cancel()
              setDraft(null)
            }
          }}
        />
        {text !== '' && (
          <button
            type="button"
            className={css.clearFilter}
            aria-label={t('display.filter.clear')}
            data-tip={t('display.filter.clear')}
            onClick={() => commit('')}
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
    </div>
  )
}

/** 一行「标签 + 分段选择」。 */
function SegLine<V extends string>(props: {
  label: string
  tip?: string
  value: V
  options: readonly { value: V; label: string }[]
  testId: string
  onChange(value: V): void
}): React.JSX.Element {
  return (
    <div className={css.optLine}>
      <span className={css.optLabel} data-tip={props.tip}>
        {props.label}
      </span>
      <div className={css.optGrow}>
        <Segmented<V>
          label={props.label}
          value={props.value}
          options={props.options}
          testId={props.testId}
          onChange={props.onChange}
        />
      </div>
    </div>
  )
}

type FolderShowChoice = FolderShow | 'auto'
type FolderOrder = NonNullable<GalleryView['order']> | 'newest'

/**
 * 文件夹的那几项。先挑「展示」：自动（有图片就排成图片墙，没有就列文件；下面一句说现在是哪种）、图片墙、文件列表；
 * 下面只出这一种用得上的：
 * - 图片墙：排法（图墙 / 大图 + 胶片 / 最新一张）、图墙的张数（自动或固定几列几行）、每格怎么摆、第一张放大；
 * - 文件列表：一行一项还是格子、带不带修改时间。
 * 两种都有的：只看（按名字筛）、顺序（最新 / 名字 / 大小）。
 * 张数从「自动」换到「固定」时，先定在现在自动排出来的那个格子上（看到的不跳）。
 */
function FolderOptions(props: {
  t: T
  display: Display
  value: GalleryView
  headKey: string
  onChange(gallery: GalleryView | undefined): void
  onFit(fit: ViewFit | undefined): void
}): React.JSX.Element {
  const { t, value, display } = props
  const facts = useFolderFacts(props.headKey)
  const set = (patch: Partial<GalleryView>): void => {
    const next: GalleryView = { ...value, ...patch }
    for (const key of Object.keys(patch) as (keyof GalleryView)[]) {
      if (patch[key] === undefined) delete next[key]
    }
    props.onChange(Object.keys(next).length === 0 ? undefined : next)
  }
  const shows =
    value.show ?? (facts === null || facts.images > 0 ? ('images' as const) : ('files' as const))
  const layout = value.layout ?? 'wall'
  const { grid: _fixed, ...rest } = value
  const auto = galleryGrid(display.width, display.height, rest)
  const autoNote =
    facts === null
      ? t('display.showAutoTip')
      : facts.images > 0
        ? t('display.showAutoImages').replace('{n}', facts.images.toLocaleString())
        : t('display.showAutoFiles').replace('{n}', facts.entries.toLocaleString())
  return (
    <>
      <SegLine<FolderShowChoice>
        label={t('display.show')}
        value={value.show ?? 'auto'}
        options={[
          { value: 'auto', label: t('display.show.auto') },
          { value: 'images', label: t('display.show.images') },
          { value: 'files', label: t('display.show.files') },
        ]}
        testId="wl-display-show"
        onChange={(show) => set({ show: show === 'auto' ? undefined : show })}
      />
      {value.show === undefined && (
        <div className={css.optIndent}>
          <span className={css.optNote} data-testid="wl-display-show-note">
            {autoNote}
          </span>
        </div>
      )}
      <MatchField t={t} value={value.match} onChange={(match) => set({ match })} />
      {shows === 'images' ? (
        <>
          <SegLine<GalleryLayoutKind>
            label={t('display.layout')}
            value={layout}
            options={(['wall', 'strip', 'single'] as const).map((kind) => ({
              value: kind,
              label: t(`display.layout.${kind}`),
            }))}
            testId="wl-display-layout"
            onChange={(next) => set({ layout: next === 'wall' ? undefined : next })}
          />
          {layout === 'wall' && (
            <>
              <SegLine<'auto' | 'fixed'>
                label={t('display.count')}
                tip={t('display.countTip')}
                value={value.grid === undefined ? 'auto' : 'fixed'}
                options={[
                  { value: 'auto', label: t('display.count.auto') },
                  { value: 'fixed', label: t('display.count.fixed') },
                ]}
                testId="wl-display-count"
                onChange={(mode) =>
                  set({
                    grid:
                      mode === 'auto'
                        ? undefined
                        : {
                            columns: Math.min(GALLERY_GRID_MAX.columns, auto.columns),
                            rows: Math.min(GALLERY_GRID_MAX.rows, auto.rows),
                          },
                  })
                }
              />
              <div className={css.optIndent}>
                {value.grid === undefined ? (
                  <span className={css.optNote}>
                    {t('display.countAuto').replace('{n}', String(auto.slots))}
                  </span>
                ) : (
                  <GridPicker
                    t={t}
                    value={value.grid}
                    hero={value.hero !== false}
                    onChange={(grid) => set({ grid })}
                  />
                )}
              </div>
            </>
          )}
          <SegLine<'contain' | 'cover'>
            label={t('display.fit')}
            value={display.fit === 'contain' ? 'contain' : 'cover'}
            options={[
              { value: 'contain', label: t('display.fit.contain') },
              { value: 'cover', label: t('display.fit.cover') },
            ]}
            testId="wl-display-fit"
            onChange={(fit) => props.onFit(fit === 'cover' ? undefined : fit)}
          />
        </>
      ) : (
        <SegLine<'rows' | 'grid'>
          label={t('display.layout')}
          value={value.list === 'grid' ? 'grid' : 'rows'}
          options={[
            { value: 'rows', label: t('display.list.rows') },
            { value: 'grid', label: t('display.list.grid') },
          ]}
          testId="wl-display-list"
          onChange={(list) => set({ list: list === 'grid' ? 'grid' : undefined })}
        />
      )}
      <SegLine<FolderOrder>
        label={t('display.order')}
        value={value.order ?? 'newest'}
        options={[
          { value: 'newest', label: t('display.order.newest') },
          { value: 'name', label: t('display.order.name') },
          { value: 'size', label: t('display.order.size') },
        ]}
        testId="wl-display-order"
        onChange={(order) => set({ order: order === 'newest' ? undefined : order })}
      />
      {shows === 'images' && layout === 'wall' && (
        <OptSwitch
          on={value.hero !== false}
          label={t('display.hero')}
          tip={t('display.heroTip')}
          testId="wl-display-hero"
          onToggle={() => set({ hero: value.hero === false ? undefined : false })}
        />
      )}
      {shows === 'files' && (
        <OptSwitch
          on={value.time === true}
          label={t('display.time')}
          testId="wl-display-time"
          onToggle={() => set({ time: value.time === true ? undefined : true })}
        />
      )}
    </>
  )
}

/**
 * 一组的标题：粗一档的字，前面可带一个小记号（内容那组是文件类型），后面可带淡色的补充（文件名）和一枚「i」，悬停看说明。
 * 组和组之间一道细线（见 `.options > .optGroup`）。
 */
export function GroupHead(props: {
  label: string
  tip?: string | undefined
  lead?: React.ReactNode
  sub?: string | undefined
}): React.JSX.Element {
  return (
    <div className={css.optHead}>
      {props.lead}
      <span className={css.optHeadText}>{props.label}</span>
      {props.sub !== undefined && props.sub !== '' && (
        <span className={css.optHeadSub}>{props.sub}</span>
      )}
      {props.tip !== undefined && (
        <span className={css.optTip} data-tip={props.tip} aria-label={props.tip} role="img">
          <Icon name="info" size={12} />
        </span>
      )}
    </div>
  )
}

/** 内容那组叫什么：`.log` 是日志，别的按行看的是文本。 */
const CONTENT_NAME = {
  lines: 'display.kind.text',
  log: 'display.kind.log',
  table: 'display.kind.table',
  gallery: 'display.kind.folder',
} as const

/**
 * 内容那一组（这一项没有可调的就不出现）：标题写明是什么（日志 / 文本 / 表格 / 文件夹）和是哪一份，
 * 下面是这一种自己的几项。
 */
export function ContentOptions(props: {
  t: T
  display: Display
  view: ResourceView
  /** 展示的那一项的路径（按扩展名定是日志、表格还是别的）。 */
  path: string
  headKey: string
  set(patch: Partial<ResourceView>): void
}): React.JSX.Element | null {
  const { t, display } = props
  const kind = contentKind(display, props.path)
  if (kind === null) return null
  const name =
    kind === 'lines' && extensionOf(props.path) === 'log' ? CONTENT_NAME.log : CONTENT_NAME[kind]
  return (
    <section className={cx(css.optGroup, css.content)} data-testid="wl-display-content">
      <GroupHead
        label={t(name)}
        sub={fileBaseName(props.path.replace(/[\\/]+$/u, ''))}
        tip={kind === 'lines' ? t('display.filterHint') : undefined}
        lead={
          kind === 'gallery' ? (
            <span className={css.optHeadIcon}>
              <Icon name="folder" size={12} />
            </span>
          ) : (
            <FileTag path={props.path} />
          )
        }
      />
      {kind === 'lines' && (
        <LinesOptions t={t} value={display.lines} onChange={(lines) => props.set({ lines })} />
      )}
      {kind === 'gallery' && (
        <FolderOptions
          t={t}
          display={display}
          value={display.gallery}
          headKey={props.headKey}
          onChange={(gallery) => props.set({ gallery })}
          onFit={(fit) => props.set({ fit })}
        />
      )}
      {kind === 'table' && (
        <TableOptions
          t={t}
          value={display.table}
          headKey={props.headKey}
          onChange={(table) => props.set({ table })}
        />
      )}
    </section>
  )
}
