/**
 * dsh-workflow-lite — 实例里的一份文件：看 `stat` 决定读不读，按种类分给图、图片墙、日志、表格、文本。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/RunFileView
 */

import { useEffect, useRef, useState } from 'react'
import { textWraps } from '../../../../shared/display.ts'
import { extensionOf } from '../../../../shared/fileKind.ts'
import type { ResourceItem, TableView } from '../../../../shared/types.ts'
import { displayKey } from '../../../app/useDisplayStats.ts'
import { useRunFile, useRunImages } from '../../../app/useRunFile.ts'
import { useRunLines } from '../../../app/useRunLines.ts'
import type { T } from '../../../i18n.ts'
import type { Display } from '../../../model/display.ts'
import { fileBaseName, formatBytes } from '../../../model/fileKind.ts'
import { activeFilter, linesFrom } from '../../../model/logLines.ts'
import { tableFormat } from '../../../model/textShape.ts'
import { DisplaySketch } from '../DisplaySketch.tsx'
import css from '../display.module.css'
import type { DisplayEnv } from '../displayEnv.ts'
import { DisplayState } from './DisplayState.tsx'
import { GalleryView } from './GalleryView.tsx'
import { ImageView } from './ImageView.tsx'
import { CARD_LINES, LogFlow, matchSummary } from './LogView.tsx'
import { type TableEnv, TableLines } from './TableView.tsx'
import { TextView } from './TextView.tsx'
import { useDisplayImage } from './useDisplayImage.ts'

/** 读回来的一份内容：读新的时上一份留着（不闪空），`version` 变了才重读。 */
function useHeld<V>(value: V | null): V | null {
  const [held, setHeld] = useState<V | null>(value)
  useEffect(() => {
    if (value !== null) setHeld(value)
  }, [value])
  return value ?? held
}

/**
 * 实例里的一份文件：在不在看 `stat`，修改时间变了重读。`kept` 给了就显示存下的那一版（不看现在的文件在不在）。
 * 现在的文件更新了（读回来的修改时间变了）告诉外面一声（`onFresh`：卡片右上角说「刚更新」）。
 */
export function RunFileView(props: {
  t: T
  run: NonNullable<DisplayEnv['run']>
  node: string
  item: ResourceItem
  display: Display
  interactive: boolean
  writing: boolean
  kept?: number | null
  onFresh?: () => void
  /** 打开这一项（文件夹的话直接看里面的某一份）。 */
  onOpen?: ((sub: string) => void) | undefined
  /** 日志筛着看时匹配了多少（卡片左上角写出来）；不筛是 `null`。 */
  onMatch?: (text: string | null) => void
  /** 进了交互点表头排序：写回设置。 */
  onTable?: ((table: TableView | undefined) => void) | undefined
}): React.JSX.Element {
  const { t, run, node, display } = props
  const kept = props.kept ?? null
  const stat = run.stats[displayKey(node, display.item)]
  const live = stat?.exists === true ? stat.mtime : null
  // 什么时候重读：旧版只读一次（它不会再变），现在的文件跟着修改时间。
  const signal = kept === null ? live : `v${kept}`
  const name = fileBaseName(props.item.value)
  // 日志、纯文本（.log、.txt、.jsonl）和 CSV / TSV 按行读：只拿要显示的那几百行，文件变了只续读新追加的。
  // UTF-16 的不按行读，退回整份读（太大时读最后一截）。
  const table = display.kind === 'text' ? tableFormat(props.item.value) : null
  const tail = display.kind === 'text' && (table !== null || textWraps(props.item.value))
  const filter = table === null ? activeFilter(display.lines.filter) : undefined
  const from = linesFrom(table === null ? display.lines : display.table, {
    log: extensionOf(props.item.value) === 'log',
    writing: props.writing && kept === null,
    size: stat?.size ?? 0,
  })
  const target = tail
    ? { node, item: display.item, ...(kept === null ? {} : { version: kept }) }
    : null
  // 表格从头看时表头就是第一行，多要一行。
  const limit = table !== null && from === 'start' ? CARD_LINES + 1 : CARD_LINES
  const lines = useRunLines(run.rpc, run.instance, target, { from, limit, filter }, signal)
  // 表格看末尾：表头（文件第一行）另读。
  const headLine = useRunLines(
    run.rpc,
    run.instance,
    table !== null && from === 'end' ? target : null,
    { from: 'start', limit: 1, filter: undefined },
    signal,
  )
  const byLines = tail && lines.kind !== 'utf16'
  const tableEnv: TableEnv = { headKey: displayKey(node, display.item), onTable: props.onTable }
  const image = useDisplayImage(
    run.rpc,
    run.instance,
    node,
    display.item,
    kept,
    display.kind === 'image' ? signal : null,
  )
  const loaded = useRunFile(
    run.rpc,
    run.instance,
    display.kind === 'image' || display.kind === 'gallery' || byLines || signal === null
      ? null
      : {
          node,
          item: display.item,
          ...(kept === null ? {} : { version: kept }),
          ...(tail && table === null ? { tail: true } : {}),
        },
    signal ?? 0,
  )
  const shot = useHeld(image.url === null ? null : image)
  const file = useHeld(loaded.file)
  const images = useRunImages(run.rpc, run.instance, { node, item: display.item })

  // 现在的文件读回来一份新的（不是第一份、不是从旧版切回来）：告诉外面。
  const fresh =
    kept !== null
      ? null
      : display.kind === 'image'
        ? image.at
        : display.kind === 'gallery'
          ? live
          : byLines
            ? lines.win?.mtime
            : loaded.file?.mtime
  const lastFresh = useRef<unknown>(null)
  const onFresh = useRef(props.onFresh)
  onFresh.current = props.onFresh
  useEffect(() => {
    if (fresh == null) {
      lastFresh.current = null
      return
    }
    if (lastFresh.current !== null && lastFresh.current !== fresh) onFresh.current?.()
    lastFresh.current = fresh
  }, [fresh])

  // 筛着看：匹配了多少交给外面（写在卡片左上角）。
  const matchText =
    byLines && filter !== undefined && lines.win !== null
      ? matchSummary(t, lines.win, filter, from)
      : null
  const onMatch = useRef(props.onMatch)
  onMatch.current = props.onMatch
  useEffect(() => {
    onMatch.current?.(matchText)
  }, [matchText])
  useEffect(() => () => onMatch.current?.(null), [])

  if (kept === null && stat === undefined) return <div className={css.loading} aria-busy="true" />
  if (kept === null && stat?.exists !== true) {
    return (
      <DisplaySketch
        display={display}
        icon={props.writing ? 'hourglass' : 'clock'}
        title={props.writing ? t('display.writing') : t('display.missing')}
        sub={name}
        busy={props.writing}
      />
    )
  }
  if (display.kind === 'gallery') {
    return (
      <GalleryView
        t={t}
        run={run}
        node={node}
        display={display}
        interactive={props.interactive}
        signal={live ?? 0}
        onOpen={props.onOpen}
      />
    )
  }
  if (display.kind === 'image') {
    if (shot?.url != null) {
      // 图更新了：新图读回来再换一层、淡入（读的时候上一张留着）。
      return (
        <div key={shot.at} className={css.fresh}>
          <ImageView name={name} url={shot.url} display={display} />
        </div>
      )
    }
    if (image.error !== null) {
      return (
        <DisplayState icon="alert" title={t('display.failed')} sub={image.error} tone="error" />
      )
    }
    return <div className={css.loading} aria-busy="true" />
  }
  if (byLines) {
    if (lines.error !== null) {
      return (
        <DisplayState icon="alert" title={t('display.failed')} sub={lines.error} tone="error" />
      )
    }
    if (lines.kind === 'binary')
      return <DisplayState icon="file" title={t('file.binary')} tone="error" />
    const win = lines.win
    if (win === null) return <div className={css.loading} aria-busy="true" />
    if (table !== null) {
      const head = from === 'end' ? (headLine.win?.lines[0] ?? null) : null
      if (from === 'end' && headLine.win === null) {
        return <div className={css.loading} aria-busy="true" />
      }
      if (win.lines.length === 0) return <DisplayState icon="file" title={t('file.empty')} />
      return (
        <div className={css.fresh}>
          <TableLines
            t={t}
            win={win}
            head={head}
            format={table}
            display={display}
            interactive={props.interactive}
            tail={from === 'end'}
            env={tableEnv}
          />
        </div>
      )
    }
    if (win.lines.length === 0 && win.pending === undefined) {
      if (filter === undefined) return <DisplayState icon="file" title={t('file.empty')} />
      return (
        <DisplayState
          icon="search"
          title={t('display.noMatch')}
          sub={
            win.stopped !== undefined
              ? t('display.noMatchRecent').replace('{size}', formatBytes(win.end - win.start))
              : filter.pattern
          }
        />
      )
    }
    return (
      <div className={css.fresh}>
        <LogFlow
          t={t}
          win={win}
          display={display}
          interactive={props.interactive}
          tail={from === 'end'}
          wrap
          filter={filter}
        />
      </div>
    )
  }
  if (file?.exists) {
    // 网页更新是重新载入一个页面：换一层、淡入。文字原地换（新的几行亮一下）。换一版由外面滑着换（SlideSwap）。
    const layer = display.kind === 'html' ? file.mtime : 'text'
    return (
      <div key={layer} className={css.fresh}>
        <TextView
          t={t}
          file={file}
          path={props.item.value}
          display={display}
          interactive={props.interactive}
          image={images}
          writing={props.writing && kept === null}
          table={tableEnv}
        />
      </div>
    )
  }
  if (loaded.error !== null) {
    return <DisplayState icon="alert" title={t('display.failed')} sub={loaded.error} tone="error" />
  }
  return <div className={css.loading} aria-busy="true" />
}
