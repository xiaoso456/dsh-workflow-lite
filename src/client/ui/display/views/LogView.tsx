/**
 * dsh-workflow-lite — 展示区里按行读的日志、纯文本：只排读回来的那几百行，筛选命中的字垫强调色。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/views/LogView
 */

import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { LineFilter } from '../../../../shared/types.ts'
import type { RunLine } from '../../../../shared/wire.ts'
import type { T } from '../../../i18n.ts'
import type { Display } from '../../../model/display.ts'
import { formatBytes } from '../../../model/fileKind.ts'
import { type LineWindow, lineLevel, splitHits } from '../../../model/logLines.ts'
import { Icon } from '../../kit/Icon.tsx'
import css from '../display.module.css'
import { softBreaks } from './Flow.tsx'
import { useOverflow } from './follow.ts'

/** 展示卡按行读时要多少行：一屏看得到几十行，留些余量（筛的时候是匹配的行数）。 */
export const CARD_LINES = 200

/** 一行日志：命中的几段垫一层强调色，错误、警告行着色；太长被截掉的末尾带个省略号。 */
function LogLine(props: {
  line: RunLine
  wrap: boolean
  levels: boolean
  fresh: 0 | 1 | undefined
  pending?: boolean
}): React.JSX.Element {
  const { line } = props
  const level = props.levels ? lineLevel(line.text) : null
  const parts = splitHits(line.text, line.hits)
  return (
    <span
      className={css.line}
      data-level={level ?? undefined}
      data-ctx={line.ctx || undefined}
      data-new={props.fresh}
      data-pending={props.pending || undefined}
    >
      {parts.map(([text, hit], index) =>
        hit ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 一行里的第几段，内容一变整行重排
          <mark key={index} className={css.hit}>
            {text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: 同上
          <Fragment key={index}>{props.wrap ? softBreaks(text) : text}</Fragment>
        ),
      )}
      {line.long && <span className={css.longMark}>…</span>}
    </span>
  )
}

/**
 * 日志、纯文本按行看（`run/lines` 读回来的窗口）：只排读回来的那几百行。
 * 停在末尾时上边淡出、最上面写前面还有多少；从头看时写后面还有多少。筛的时候只有匹配的行（带上下文时
 * 不挨着的两段之间一道「跳过 N 行」），命中的字垫一层强调色。新追加的行亮一下再淡。
 * 进了交互、停在末尾的：往上翻着看时新内容不拽人回去，底下浮出「回到最新」（来了几行新的也写上）。
 */
export function LogFlow(props: {
  t: T
  win: LineWindow
  display: Display
  interactive: boolean
  /** 停在末尾（跟着往下走）。 */
  tail: boolean
  wrap: boolean
  filter: LineFilter | undefined
}): React.JSX.Element {
  const { t, win, display } = props
  const interactive = props.interactive
  const [clip, over] = useOverflow(props.tail && !interactive)
  const filtered = props.filter !== undefined
  const context = (props.filter?.context ?? 0) > 0
  const levels = display.lines.levels !== false
  const fresh = win.fresh
  const away = useFollowAway(clip, props.tail, interactive, win)
  const earlier =
    props.tail && win.before && !filtered
      ? t('display.earlierBytes').replace('{size}', formatBytes(win.start))
      : null
  const later =
    !props.tail && win.after
      ? t('display.laterBytes').replace('{size}', formatBytes(Math.max(0, win.size - win.end)))
      : null
  return (
    <div
      ref={clip}
      className={css.flowClip}
      data-over-x={over.x || undefined}
      data-over-y={over.y || undefined}
      data-tail={props.tail || undefined}
    >
      <div className={css.flow} style={{ zoom: display.zoom / 100 }} data-kind="text">
        {earlier !== null && <p className={css.earlier}>{earlier}</p>}
        <pre className={css.pre} data-wrap={props.wrap || undefined} data-testid="wl-display-lines">
          {win.lines.map((line, index) => (
            <Fragment key={line.at}>
              {context && index > 0 && (line.skip ?? 0) > 0 && (
                <span className={css.skip}>
                  {t('display.skipped').replace('{n}', (line.skip ?? 0).toLocaleString())}
                </span>
              )}
              <LogLine
                line={line}
                wrap={props.wrap}
                levels={levels}
                fresh={fresh?.has(line.at) === true ? win.parity : undefined}
              />
            </Fragment>
          ))}
          {win.pending !== undefined && (
            <LogLine
              line={win.pending}
              wrap={props.wrap}
              levels={levels}
              fresh={fresh?.has(win.pending.at) === true ? win.parity : undefined}
              pending
            />
          )}
        </pre>
        {later !== null && <p className={css.moreLines}>{later}</p>}
        {away.count !== null && (
          <div className={css.jump}>
            <button
              type="button"
              className={css.jumpButton}
              onClick={away.jump}
              data-testid="wl-display-jump"
            >
              <Icon name="chevronDown" size={12} />
              {away.count > 0
                ? t('display.jumpNew').replace('{n}', away.count.toLocaleString())
                : t('display.jumpLatest')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * 进了交互、停在末尾的日志：人往上翻了（离底超过一点）就不再跟着走，`count` 是那之后来了几行新的
 * （没翻上去是 `null`，不显示「回到最新」）；`jump` 滚回底下、接着跟。
 */
function useFollowAway(
  clip: React.RefObject<HTMLDivElement>,
  tail: boolean,
  interactive: boolean,
  win: LineWindow,
): { count: number | null; jump(): void } {
  const [away, setAway] = useState(false)
  const awayRef = useRef(false)
  awayRef.current = away
  const [missed, setMissed] = useState(0)
  const scroller = (): HTMLElement | null =>
    interactive ? (clip.current?.closest<HTMLElement>(`.${css.body}`) ?? null) : clip.current
  useEffect(() => {
    if (!tail || !interactive) {
      setAway(false)
      return
    }
    const element = scroller()
    if (element === null) return
    const onScroll = (): void => {
      const far = element.scrollHeight - element.scrollTop - element.clientHeight > 24
      if (far !== awayRef.current) {
        setAway(far)
        if (!far) setMissed(0)
      }
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [tail, interactive])
  // 进出交互、开始跟随：回到底下。
  useLayoutEffect(() => {
    const element = scroller()
    if (tail && element !== null) element.scrollTop = element.scrollHeight
    setMissed(0)
  }, [tail, interactive])
  // 新内容来了：人在底下就跟，翻上去了就记一笔。
  useLayoutEffect(() => {
    const element = scroller()
    if (!tail || element === null) return
    if (!awayRef.current) element.scrollTop = element.scrollHeight
    else if (win.fresh !== null) setMissed((count) => count + (win.fresh?.size ?? 0))
  }, [win])
  return {
    count: tail && interactive && away ? missed : null,
    jump: () => {
      const element = scroller()
      if (element === null) return
      // 直接到底（几千像素的平滑滚动又慢、中途还会被新内容打断）。
      element.scrollTop = element.scrollHeight
      setMissed(0)
    },
  }
}

/** 筛着看时卡片左上角那句：「23 行匹配」「200+ 行匹配」「最近 64 MB 里 3 行匹配」；反选时是「显示 N 行」。 */
export function matchSummary(
  t: T,
  win: LineWindow,
  filter: LineFilter,
  from: 'end' | 'start',
): string {
  const count = win.matched.toLocaleString()
  const more = from === 'end' ? win.before : win.after
  if (win.stopped !== undefined && from === 'end') {
    return t(filter.invert ? 'display.shownRecent' : 'display.matchRecent')
      .replace('{size}', formatBytes(win.end - win.start))
      .replace('{n}', count)
  }
  return t(filter.invert ? 'display.shown' : 'display.matched').replace(
    '{n}',
    more ? `${count}+` : count,
  )
}
