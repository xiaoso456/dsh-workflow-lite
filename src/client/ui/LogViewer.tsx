/**
 * dsh-workflow-lite — 查看框里看日志、纯文本（`.log`、`.txt`、`.jsonl`）：按字节分段读，几 GB 的也翻得动。
 *
 * 页面里最多留 {@link WINDOW_LINES} 行：滚到顶读前面一段（{@link PAGE_LINES} 行），滚到底读后面一段，
 * 多出来的从另一头扔掉（扔掉的那头变成「还有」，滚过去再读回来）。换段时看着的那一行不动。
 * 读到了末尾就每隔一会儿续读新追加的（人在底下就跟着走）；「开头」「末尾」两个按钮直接跳过去。
 *
 * 顶上一条筛选（Ctrl+F 到这里）：和卡片上的「只看」一样的写法，只在这次查看里有效；打开时带着卡片的筛选。
 * 筛着看时点一行，回到全文、停在这一行上（前后各读一段），那一行亮一下。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/LogViewer
 */

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { extensionOf } from '../../shared/fileKind.ts'
import type { LineFilter } from '../../shared/types.ts'
import type { RunLinesRequest, RunLinesResponse } from '../../shared/wire.ts'
import type { LinesTarget } from '../app/useRunLines.ts'
import type { T } from '../i18n.ts'
import { formatBytes } from '../model/fileKind.ts'
import {
  activeFilter,
  appendWindow,
  extendWindow,
  type LineWindow,
  lineLevel,
  prependWindow,
  splitHits,
  windowOf,
} from '../model/logLines.ts'
import { errorMessage, type WorkflowLiteRpc } from '../rpc.ts'
import { FilterField } from './DisplayContent.tsx'
import css from './display.module.css'
import files from './files.module.css'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

/** 页面里最多留几行。 */
const WINDOW_LINES = 5000
/** 一次往前 / 往后读几行。 */
const PAGE_LINES = 500
/** 离顶 / 底这么近就去读下一段。 */
const EDGE_PX = 400
/** 读到末尾后隔多久续读一次。 */
const FOLLOW_MS = 1500

type Request = Omit<RunLinesRequest, 'id' | 'node' | 'item' | 'sub' | 'version'>

/** 换段前看着的那一行在哪（换完把它放回原处）。 */
interface Anchor {
  at: number
  top: number
}

export function LogViewer(props: {
  t: T
  rpc: WorkflowLiteRpc
  instance: string
  target: LinesTarget
  /** 文件名（`.log` 打开就在末尾，别的从头）。 */
  name: string
  /** 卡片上的筛选（打开时带上）。 */
  filter?: LineFilter | undefined
  /** 读回来的元信息（标题行写大小、修改时间，「用其他程序打开」要路径）。 */
  onMeta?: (response: RunLinesResponse) => void
}): React.JSX.Element {
  const { t, rpc, instance, target } = props
  const [filter, setFilter] = useState<LineFilter | undefined>(props.filter)
  const active = activeFilter(filter)
  const [win, setWin] = useState<LineWindow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'before' | 'after' | 'jump' | null>('jump')
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const winRef = useRef(win)
  winRef.current = win
  const busyRef = useRef(busy)
  busyRef.current = busy
  const anchor = useRef<Anchor | null>(null)
  /** 换段之后要停到底（跳到末尾、跟着往下走）。 */
  const toBottom = useRef(false)
  /** 换段之后要停到这一行（在全文中定位）。 */
  const toLine = useRef<number | null>(null)
  /** 每次重来（换了筛选、跳开头末尾）加一：晚到的旧结果扔掉。 */
  const epoch = useRef(0)
  const onMeta = useRef(props.onMeta)
  onMeta.current = props.onMeta
  const kept = target.version !== undefined

  const call = useCallback(
    async (request: Request): Promise<RunLinesResponse> => {
      const response = await rpc.call('run/lines', {
        id: instance,
        ...target,
        ...request,
        ...(active === undefined ? {} : { filter: active }),
      })
      onMeta.current?.(response)
      return response
    },
    // target 的身份是这几个字段。
    [rpc, instance, target.node, target.item, target.sub, target.version, active],
  )
  const scroller = (): HTMLElement | null =>
    root.current?.closest<HTMLElement>(`.${files.viewerBody}`) ?? null
  /** 记下现在看着的那一行（屏幕上第一行），换段后放回去。 */
  const keepAnchor = (): void => {
    const box = scroller()
    if (box === null) return
    const top = box.getBoundingClientRect().top
    for (const element of box.querySelectorAll<HTMLElement>('[data-at]')) {
      const rect = element.getBoundingClientRect()
      if (rect.bottom > top) {
        anchor.current = { at: Number(element.dataset.at), top: rect.top - top }
        return
      }
    }
  }

  /** 从头来一份：`end` 末尾、`start` 开头，或者停在某一行附近。 */
  const jump = useCallback(
    async (where: 'end' | 'start' | { at: number }): Promise<void> => {
      epoch.current += 1
      const mine = epoch.current
      setBusy('jump')
      setError(null)
      try {
        let next: LineWindow
        if (typeof where === 'object') {
          const [up, down] = await Promise.all([
            call({ mode: 'tail', before: where.at, limit: PAGE_LINES / 2 }),
            call({ mode: 'head', from: where.at, limit: PAGE_LINES / 2 }),
          ])
          next = extendWindow(windowOf(up, 'tail'), down, WINDOW_LINES)
          next = { ...next, fresh: new Set([where.at]), parity: 0 }
          toLine.current = where.at
        } else if (where === 'end') {
          next = windowOf(await call({ mode: 'tail', limit: PAGE_LINES }), 'tail')
          toBottom.current = true
        } else {
          next = windowOf(await call({ mode: 'head', from: 0, limit: PAGE_LINES }), 'head')
          toLine.current = -1
        }
        if (mine !== epoch.current) return
        setWin(next)
      } catch (reason) {
        if (mine === epoch.current) setError(errorMessage(reason))
      } finally {
        if (mine === epoch.current) setBusy(null)
      }
    },
    [call],
  )

  // 打开、换了筛选：日志从末尾、别的从头；是筛着看时点了一行（清掉了筛选）的话停在那一行上。
  const log = extensionOf(props.name) === 'log'
  const locate = useRef<number | null>(null)
  useEffect(() => {
    const at = locate.current
    locate.current = null
    void jump(at !== null ? { at } : log ? 'end' : 'start')
  }, [jump, log])

  /** 往前 / 往后读一段，接在窗口那头。 */
  const page = useCallback(
    async (side: 'before' | 'after'): Promise<void> => {
      const current = winRef.current
      if (current === null || busyRef.current !== null) return
      if (side === 'before' ? !current.before : !current.after) return
      const mine = epoch.current
      setBusy(side)
      try {
        const response =
          side === 'before'
            ? await call({ mode: 'tail', before: current.start, limit: PAGE_LINES })
            : await call({ mode: 'head', from: current.end, limit: PAGE_LINES })
        if (mine !== epoch.current) return
        keepAnchor()
        setWin((last) =>
          last === null
            ? last
            : side === 'before'
              ? prependWindow(last, response, WINDOW_LINES)
              : extendWindow(last, response, WINDOW_LINES),
        )
      } catch (reason) {
        if (mine === epoch.current) setError(errorMessage(reason))
      } finally {
        if (mine === epoch.current) setBusy(null)
      }
    },
    [call],
  )

  // 读到了末尾：隔一会儿续读新追加的（存下的旧版不会再变，不续）。
  const atEnd = win !== null && !win.after
  useEffect(() => {
    if (!atEnd || kept) return
    let alive = true
    const tick = async (): Promise<void> => {
      const current = winRef.current
      if (current === null || current.after || busyRef.current !== null || document.hidden) return
      const mine = epoch.current
      try {
        const response = await call({
          mode: 'follow',
          from: current.end,
          tag: current.tag,
          limit: PAGE_LINES,
          ...(current.owed > 0 ? { owed: current.owed } : {}),
        })
        if (!alive || mine !== epoch.current) return
        if (
          response.appended === true &&
          response.lines.length === 0 &&
          response.pending?.text === current.pending?.text
        ) {
          return
        }
        const box = scroller()
        const bottom = box !== null && box.scrollHeight - box.scrollTop - box.clientHeight < 32
        if (bottom) toBottom.current = true
        else keepAnchor()
        setWin((last) => (last === null ? last : appendWindow(last, response, WINDOW_LINES)))
      } catch {
        // 续读失败（文件被删了这类）：下一回再试。
      }
    }
    const timer = window.setInterval(() => void tick(), FOLLOW_MS)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [atEnd, kept, call])

  // 换段之后：停到底、停到某一行，或者把看着的那一行放回原处。
  useLayoutEffect(() => {
    const box = scroller()
    if (box === null || win === null) return
    if (toBottom.current) {
      toBottom.current = false
      anchor.current = null
      box.scrollTop = box.scrollHeight
      return
    }
    if (toLine.current !== null) {
      const at = toLine.current
      toLine.current = null
      anchor.current = null
      if (at < 0) {
        box.scrollTop = 0
        return
      }
      const element = box.querySelector<HTMLElement>(`[data-at="${at}"]`)
      if (element !== null) {
        box.scrollTop +=
          element.getBoundingClientRect().top -
          box.getBoundingClientRect().top -
          box.clientHeight / 3
      }
      return
    }
    const kept = anchor.current
    anchor.current = null
    if (kept === null) return
    const element = box.querySelector<HTMLElement>(`[data-at="${kept.at}"]`)
    if (element === null) return
    box.scrollTop +=
      element.getBoundingClientRect().top - box.getBoundingClientRect().top - kept.top
  }, [win])

  // 滚到顶 / 底附近：读下一段。
  useEffect(() => {
    const box = scroller()
    if (box === null) return
    const onScroll = (): void => {
      if (box.scrollTop < EDGE_PX) void page('before')
      else if (box.scrollHeight - box.scrollTop - box.clientHeight < EDGE_PX) void page('after')
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [page])
  // 内容不够一屏、前后还有：接着读，直到排满或读完。
  useEffect(() => {
    const box = scroller()
    if (box === null || win === null || busy !== null) return
    if (box.scrollHeight <= box.clientHeight + EDGE_PX) {
      if (win.before) void page('before')
      else if (win.after) void page('after')
    }
  }, [win, busy, page])

  // Ctrl+F：到筛选框。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const context = (active?.context ?? 0) > 0
  const count =
    active === undefined || win === null
      ? null
      : t(active.invert ? 'display.shown' : 'display.matched').replace(
          '{n}',
          `${win.matched.toLocaleString()}${win.before || win.after ? '+' : ''}`,
        )

  return (
    <div ref={root} className={css.logView} data-testid="wl-log-viewer">
      <div className={css.logBar}>
        <FilterField
          t={t}
          value={filter}
          onChange={setFilter}
          inline
          inputRef={input}
          extra={
            <span className={css.logBarEnd}>
              {count !== null && (
                <span className={css.logCount} data-testid="wl-log-count">
                  {count}
                </span>
              )}
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.small)}
                data-tip={t('file.logTop')}
                aria-label={t('file.logTop')}
                data-testid="wl-log-top"
                onClick={() => void jump('start')}
              >
                <Icon name="chevronUp" size={14} />
              </button>
              <button
                type="button"
                className={cx(ui.btn, ui.icon, ui.small)}
                data-tip={t('file.logEnd')}
                aria-label={t('file.logEnd')}
                data-testid="wl-log-end"
                onClick={() => void jump('end')}
              >
                <Icon name="chevronDown" size={14} />
              </button>
            </span>
          }
        />
      </div>
      {error !== null && <p className={css.logError}>{error}</p>}
      {win !== null && (
        <div className={css.logBody} aria-busy={busy !== null || undefined}>
          <p className={css.logEdge}>
            {busy === 'before'
              ? t('file.logLoading')
              : win.before
                ? t('file.logEarlier').replace('{size}', formatBytes(win.start))
                : t('file.logStart')}
          </p>
          {win.lines.length === 0 && win.pending === undefined ? (
            <p className={css.logEmpty}>
              {active === undefined
                ? t('file.empty')
                : win.stopped !== undefined
                  ? `${t('display.noMatch')} · ${t('display.noMatchRecent').replace('{size}', formatBytes(win.end - win.start))}`
                  : t('display.noMatch')}
            </p>
          ) : (
            <pre className={cx(css.pre, css.logPre)} data-wrap>
              {win.lines.map((line, index) => (
                <Fragment key={line.at}>
                  {context && index > 0 && (line.skip ?? 0) > 0 && (
                    <span className={css.skip}>
                      {t('display.skipped').replace('{n}', (line.skip ?? 0).toLocaleString())}
                    </span>
                  )}
                  <ViewerLine
                    t={t}
                    text={line.text}
                    hits={line.hits}
                    long={line.long === true}
                    ctx={line.ctx === true}
                    at={line.at}
                    fresh={win.fresh?.has(line.at) === true ? win.parity : undefined}
                    onLocate={
                      active === undefined
                        ? undefined
                        : () => {
                            locate.current = line.at
                            setFilter(undefined)
                          }
                    }
                  />
                </Fragment>
              ))}
              {win.pending !== undefined && (
                <ViewerLine
                  t={t}
                  text={win.pending.text}
                  hits={win.pending.hits}
                  long={win.pending.long === true}
                  ctx={false}
                  at={win.pending.at}
                  fresh={win.fresh?.has(win.pending.at) === true ? win.parity : undefined}
                  pending
                />
              )}
            </pre>
          )}
          <p className={css.logEdge}>
            {busy === 'after'
              ? t('file.logLoading')
              : win.after
                ? t('file.logLater').replace('{size}', formatBytes(Math.max(0, win.size - win.end)))
                : kept
                  ? t('file.logEndKept')
                  : t('file.logLive')}
          </p>
        </div>
      )}
      {win === null && error === null && <div className={css.logSkeleton} aria-busy="true" />}
    </div>
  )
}

/** 查看框里的一行：和卡片上一样着色、标命中；筛着看时点一下回到全文停在这里。 */
function ViewerLine(props: {
  t: T
  text: string
  hits: number[] | undefined
  long: boolean
  ctx: boolean
  at: number
  fresh: 0 | 1 | undefined
  pending?: boolean
  onLocate?: (() => void) | undefined
}): React.JSX.Element {
  const level = lineLevel(props.text)
  const parts = splitHits(props.text, props.hits)
  const Tag = props.onLocate === undefined ? 'span' : 'button'
  return (
    <Tag
      {...(Tag === 'button'
        ? {
            type: 'button' as const,
            onClick: props.onLocate,
            'data-tip': props.t('file.logLocate'),
          }
        : {})}
      className={css.line}
      data-at={props.at}
      data-level={level ?? undefined}
      data-ctx={props.ctx || undefined}
      data-new={props.fresh}
      data-pending={props.pending || undefined}
      data-locate={Tag === 'button' || undefined}
    >
      {parts.map(([text, hit], index) =>
        hit ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: 一行里的第几段，内容一变整行重排
          <mark key={index} className={css.hit}>
            {text}
          </mark>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: 同上
          <Fragment key={index}>{text}</Fragment>
        ),
      )}
      {props.long && <span className={css.longMark}>…</span>}
    </Tag>
  )
}
