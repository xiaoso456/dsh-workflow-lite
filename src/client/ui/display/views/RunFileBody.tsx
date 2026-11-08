/**
 * dsh-workflow-lite — 实例视图里的一份文件连同它存下的各版：卡片底下的时间线、标题行里的状态签。
 * 实例视图里存过几版的（循环迭代时每一轮存一版，见 `host/runs/history.ts`），悬停卡片时底下出现一条时间线，
 * 标题行写出看的是哪一版（{@link HistoryBar}）：悬停预览、点一下钉住。钉住的那版只在这张卡上，不存进图里。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/RunFileBody
 */

import { useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ResourceItem, TableView } from '../../../../shared/types.ts'
import { displayKey } from '../../../app/useDisplayStats.ts'
import { useRunHistory } from '../../../app/useRunFile.ts'
import type { T } from '../../../i18n.ts'
import type { Display } from '../../../model/display.ts'
import { dotIndex, historyLine } from '../../../model/outputHistory.ts'
import { Icon } from '../../kit/Icon.tsx'
import { SlideSwap } from '../../motion/stage.tsx'
import { useTrend } from '../../motion/swapText.tsx'
import css from '../display.module.css'
import { type DisplayEnv, HistorySlotContext } from '../displayEnv.ts'
import { HistoryBar } from '../HistoryBar.tsx'
import { RunFileView } from './RunFileView.tsx'

/** 「刚更新」亮多久（淡入、停留、淡出一共）。 */
const FRESH_MS = 4000

/**
 * 实例视图里的一份文件，连同它存下的各版：至少两版时卡片底下一条时间线、标题行写出看的是哪一版（{@link HistoryBar}）。
 * 悬停预览的那版优先，其次钉住的那版，都没有就是现在的文件。
 * 右上角一枚小签：写它的步骤在跑时「生成中」，现在的文件更新了「刚更新」（几秒后淡出）。
 */
export function RunFileBody(props: {
  t: T
  run: NonNullable<DisplayEnv['run']>
  frame: React.ComponentProps<'div'> & { ref: React.RefObject<HTMLDivElement> }
  seen: boolean
  node: string
  item: ResourceItem
  display: Display
  interactive: boolean
  writing: boolean
  onOpen?: ((sub: string) => void) | undefined
  onTable?: ((table: TableView | undefined) => void) | undefined
}): React.JSX.Element {
  const { t, run, node, display } = props
  const slot = useContext(HistorySlotContext)
  // 状态签：卡片标题行里有位置就挂过去（不压在展示区上），没有（查看框之类）才浮在展示区右上角。
  const chips = (content: React.ReactNode): React.ReactNode =>
    slot?.status ? createPortal(<span className={css.chips}>{content}</span>, slot.status) : content
  const stat = run.stats[displayKey(node, display.item)]
  const history = useRunHistory(
    run.rpc,
    run.instance,
    props.seen ? { node, item: display.item } : null,
    stat?.revision ?? 0,
  )
  const line = historyLine(history, stat)
  /** 钉住的那版，连同钉住时最新的是哪一点（之后又来了新的，最新那点上亮个小点）。 */
  const [pinned, setPinned] = useState<{ v: number; latest: string } | null>(null)
  const [preview, setPreview] = useState<number | null | undefined>(undefined)
  const latestKey = line.dots.at(-1)?.key ?? ''
  // 钉住的那版被删了（超了上限从中间删掉的、存储页清空了）：回到最新。
  const lost =
    pinned !== null &&
    history !== null &&
    !line.dots.some((dot) => dot.version?.v === pinned.v && dot.v !== null)
  useEffect(() => {
    if (lost) setPinned(null)
  }, [lost])
  const pinnedV = pinned === null || lost ? null : pinned.v
  const shown = line.dots.length < 2 ? null : preview !== undefined ? preview : pinnedV
  // 显示的是最新那点：读现在的文件（最新那点也可能就是存下的最后一版，读哪个都一样，读现在的）。
  const kept = shown === null ? null : (line.dots[dotIndex(line, shown)]?.v ?? null)
  // 换一版：新的从行进方向滑进来（往后的版从右边进）。
  const layer = kept === null ? 'live' : `v${kept}`
  const dir = useTrend(line.dots.length < 2 ? 0 : dotIndex(line, shown))
  const showing = useRef(layer)
  showing.current = layer
  // 现在的文件刚更新：右上角「刚更新」亮一会儿（每次更新从头来）；写它的步骤在跑时一直是「生成中」。
  const [fresh, setFresh] = useState(0)
  useEffect(() => {
    if (fresh === 0) return
    const timer = window.setTimeout(() => setFresh(0), FRESH_MS)
    return () => window.clearTimeout(timer)
  }, [fresh])
  const live = props.writing && kept === null && stat?.exists === true
  const [match, setMatch] = useState<string | null>(null)
  const filter = props.display.lines.filter

  return (
    <>
      <div {...props.frame}>
        {props.seen ? (
          <SlideSwap id={layer} dir={dir}>
            {(id) => (
              <RunFileView
                t={t}
                run={run}
                node={node}
                item={props.item}
                display={display}
                interactive={props.interactive}
                writing={props.writing}
                kept={id === 'live' ? null : Number(id.slice(1))}
                onFresh={() => setFresh(Date.now())}
                onOpen={props.onOpen}
                // 只听要显示的那一版（滑走的那层卸下时会报个空）。
                onMatch={(text) => {
                  if (id === showing.current) setMatch(text)
                }}
                onTable={props.onTable}
              />
            )}
          </SlideSwap>
        ) : (
          <div className={css.loading} />
        )}
      </div>
      {chips(
        <>
          {match !== null && filter !== undefined && (
            <span
              className={css.chip}
              data-side="left"
              data-tip={t('display.filterTip').replace('{pattern}', filter.pattern)}
              data-testid="wl-display-match"
            >
              <Icon name="search" size={11} />
              {match}
            </span>
          )}
          {live ? (
            <span className={css.chip} data-live data-testid="wl-display-live">
              <span className={css.chipDot} />
              {t('display.live')}
            </span>
          ) : (
            fresh !== 0 && (
              <span key={fresh} className={css.chip} data-fresh data-testid="wl-display-fresh">
                <span className={css.chipDot} />
                {t('display.updated')}
              </span>
            )
          )}
        </>,
      )}
      {line.dots.length >= 2 && (
        <HistoryBar
          t={t}
          slot={slot?.slot ?? null}
          rail={slot?.rail ?? null}
          line={line}
          names={run.names ?? {}}
          shown={shown}
          previewing={preview !== undefined}
          pinned={pinnedV}
          newer={pinned !== null && pinned.latest !== latestKey}
          onPreview={setPreview}
          onPin={(v) => {
            setPreview(undefined)
            setPinned(v === null ? null : { v, latest: latestKey })
          }}
        />
      )}
    </>
  )
}
