/**
 * dsh-workflow-lite — 展示卡的各轮产出：这份产出每一轮存下的样子（见 `model/outputHistory.ts`）。至少有两版才有。
 *
 * 两块，和标题行右边的按钮一样，悬停卡片或选中时才出来：
 * - 卡片底边外一条和卡片等宽的刻度轴：一根细线从第一版画到最新，一版一道刻度。卡里显示的那一版上停着一枚钟表滑块，
 *   表圈走到「第几版 / 共几版」（三版里第一版走 1/3、最新走满一圈）；换版时整枚表像轮子一样沿着轴滚过去
 *   （往右顺时针，转多少按走多远算、跨得远时封顶），表圈和身后走过的一段跟着伸缩。
 *   悬停时那道刻度变高，下面一行说明（判定、哪一版、存于何时）跟着滑过去。
 *   悬停到哪道刻度就换到哪一版、钉住（移开不回退，回最新点标题行的 ✕ 或滑回最右）；按住拖、方向键、Home / End 也行。
 * - 标题行里写出看的是哪一版（「第 2 轮 · 审查后 3/6」），跟着时间线上悬停的那一点换字；点它下拉出各版列表
 *   （新的在上），悬停一项卡里临时换成那一版，点一下钉住。
 *   钉在旧版时换强调色、旁边一个 ✕ 回到最新。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HistoryBar
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { T } from '../i18n.ts'
import { dotIndex, type HistoryLine, versionName } from '../model/outputHistory.ts'
import { shortTime } from '../model/time.ts'
import css from './display.module.css'
import { Icon } from './Icon.tsx'
import { SwapText, useTrend } from './motion.tsx'
import { cx, FLOAT_EXIT_MS, useFloat } from './primitives.tsx'
import ui from './ui.module.css'

/**
 * 钟表像轮子一样滚：转过的角度 = 走过的距离 ÷ 半径（表盘 20px 宽）。跨得远时封顶——
 * 再多每帧转的角度太大，看着像倒着转（车轮效应）。停下来表针朝哪都行。
 */
const ROLL_RADIUS = 10
const ROLL_MAX_DEG = 600

/** 各版列表的宽度。 */
const MENU_W = 248

export function HistoryBar(props: {
  t: T
  /** 标题行里留给「看的是哪一版」的位置。 */
  slot: HTMLElement | null
  /** 卡片底边外留给时间线的位置。 */
  rail: HTMLElement | null
  line: HistoryLine
  names: Readonly<Record<string, string>>
  /** 卡片里现在显示的是哪一版（`null` = 最新）。 */
  shown: number | null
  /** 现在显示的是悬停预览。 */
  previewing: boolean
  /** 钉住的那一版；没钉是 `null`。 */
  pinned: number | null
  /** 钉着的时候又来了新的一版。 */
  newer: boolean
  /** 悬停预览：给 `undefined` 是不预览了。 */
  onPreview(v: number | null | undefined): void
  onPin(v: number | null): void
}): React.JSX.Element | null {
  const { t, line, names, onPreview } = props
  const count = line.dots.length
  const current = dotIndex(line, props.shown)
  const pinnedAt = props.pinned === null ? count - 1 : dotIndex(line, props.pinned)
  const old = props.pinned !== null
  const dir = useTrend(current)
  const currentDot = line.dots[current]
  const track = useRef<HTMLDivElement>(null)
  // 钟表滚过的总角度：往右换版顺时针、往左逆时针。一格多宽从轨道量（不受画布缩放影响）。
  const [roll, setRoll] = useState({ at: current, deg: 0 })
  if (roll.at !== current) {
    const cell = (track.current?.offsetWidth ?? 0) / count
    const distance = Math.abs(current - roll.at) * cell
    const deg = Math.min(ROLL_MAX_DEG, Math.max(90, ((distance / ROLL_RADIUS) * 180) / Math.PI))
    setRoll({ at: current, deg: roll.deg + Math.sign(current - roll.at) * deg })
  }
  const dragging = useRef(false)
  /** 每一点在标题行里叫什么：最后一点（现在的文件）叫「最新」。 */
  const labels = line.dots.map((dot, index) =>
    index === count - 1 ? t('history.live') : versionName(t, dot.version, names),
  )

  // 方向键换了版：焦点跟着到钉住的那一点上（一组里只有钉住的那点能 Tab 到）。
  useEffect(() => {
    const box = track.current
    if (box === null || !box.contains(document.activeElement)) return
    box.querySelector<HTMLElement>(`[data-tick="${pinnedAt}"]`)?.focus()
  }, [pinnedAt])

  const pinAt = (index: number): void => {
    const target = line.dots[Math.max(0, Math.min(count - 1, index))]
    if (target !== undefined) props.onPin(target.v)
  }
  /** 指针下是第几点（整格都算；不在格子上是 `null`）。 */
  const tickAt = (event: React.PointerEvent): number | null => {
    const element = document.elementFromPoint(event.clientX, event.clientY)
    const tick = element?.closest<HTMLElement>('[data-tick]')
    if (tick === null || tick === undefined || track.current?.contains(tick) !== true) return null
    return Number(tick.dataset.tick)
  }
  const stop = (event: React.SyntheticEvent): void => event.stopPropagation()

  // 各版列表：新的在上。悬停、方向键走到一项，卡里临时换成那一版；收起时不预览了。
  const menu = useFloat<HTMLButtonElement>({
    openMs: 0,
    closeMs: 0,
    width: MENU_W,
    exitMs: FLOAT_EXIT_MS,
  })
  const open = menu.state !== 'off'
  const items = useRef<(HTMLButtonElement | null)[]>([])
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open) onPreview(undefined)
    wasOpen.current = open
  }, [open, onPreview])
  const order = line.dots.map((_, index) => count - 1 - index)

  if (props.slot === null || props.rail === null) return null
  return (
    <>
      {createPortal(
        <span
          className={css.history}
          data-old={old || undefined}
          data-preview={props.previewing || undefined}
          data-open={open || undefined}
          data-testid="wl-display-history"
        >
          <button
            ref={menu.anchorRef}
            type="button"
            className={cx(css.historyPick, 'nodrag')}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`${t('history.title')}：${labels[current] ?? ''}`}
            data-testid="wl-display-history-pick"
            onClick={(event) => {
              event.stopPropagation()
              menu.setState(open ? 'off' : 'pinned')
              // 打开后焦点落在钉住的那一项上，上下键接着挑。
              requestAnimationFrame(() =>
                items.current[count - 1 - pinnedAt]?.focus({ preventScroll: true }),
              )
            }}
            onDoubleClick={stop}
            onKeyDown={menu.onKeyDown}
          >
            <Icon name="history" size={12} />
            <span className={css.historyChipText} data-testid="wl-display-history-label">
              <SwapText text={labels[current] ?? ''} dir={dir} />
            </span>
            <span className={css.historyCount}>
              {current + 1}/{count}
            </span>
            <span className={css.historyCaret} aria-hidden="true">
              <Icon name="chevronDown" size={11} />
            </span>
          </button>
          {old && (
            <button
              type="button"
              className={cx(css.historyBack, 'nodrag')}
              data-new={props.newer || undefined}
              data-tip={props.newer ? t('history.newer') : t('history.back')}
              aria-label={t('history.back')}
              data-testid="wl-display-history-back"
              onClick={(event) => {
                event.stopPropagation()
                props.onPin(null)
              }}
              onDoubleClick={stop}
            >
              <Icon name="x" size={11} />
            </button>
          )}
        </span>,
        props.slot,
      )}
      {menu.render({
        className: cx(ui.confirmPop, css.historyMenu),
        role: 'menu',
        label: t('history.title'),
        testId: 'wl-display-history-menu',
        children: (
          // 指针离开整张列表才不预览（项与项之间的缝里不来回跳）。
          <div className={css.historyList} onPointerLeave={() => onPreview(undefined)}>
            {order.map((index, row) => {
              const dot = line.dots[index]
              if (dot === undefined) return null
              const at = dot.version?.at
              return (
                <span key={dot.key} className={css.historyRow}>
                  {/* 最老那版前面省略过几版：写在它上面。 */}
                  {index === 0 && line.dropped > 0 && (
                    <span className={css.historyDropped}>
                      {t('history.dropped').replace('{n}', String(line.dropped))}
                    </span>
                  )}
                  <button
                    ref={(element) => {
                      items.current[row] = element
                    }}
                    type="button"
                    role="menuitemradio"
                    aria-checked={index === pinnedAt}
                    className={cx(ui.menuItem, css.historyItem)}
                    data-active={index === pinnedAt}
                    data-tone={dot.tone ?? undefined}
                    data-live={dot.v === null || undefined}
                    data-shown={index === current || undefined}
                    data-testid="wl-display-history-item"
                    style={{ '--i': row } as React.CSSProperties}
                    onPointerEnter={() => onPreview(dot.v)}
                    onFocus={() => onPreview(dot.v)}
                    onClick={() => {
                      props.onPin(dot.v)
                      menu.setState('off')
                      menu.anchorRef.current?.focus({ preventScroll: true })
                    }}
                    onKeyDown={(event) => {
                      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
                      if (step === 0) return
                      event.preventDefault()
                      items.current[(row + step + count) % count]?.focus()
                    }}
                  >
                    <span className={css.historyItemDot} />
                    <span className={ui.menuLabel}>{labels[index]}</span>
                    {at !== undefined && (
                      <span className={css.historyItemTime}>{shortTime(at)}</span>
                    )}
                    <span className={css.historyItemCheck} aria-hidden="true">
                      {index === pinnedAt && <Icon name="check" size={13} />}
                    </span>
                  </button>
                </span>
              )
            })}
          </div>
        ),
      })}
      {createPortal(
        // 时间线在节点里：点击、双击、按键都别落到卡片上（会改选中、打开查看框、挪卡片）。
        // biome-ignore lint/a11y/noStaticElementInteractions: 只是截住冒泡
        <div
          className={cx(css.historyTimeline, 'nodrag', 'nopan')}
          data-testid="wl-display-history-timeline"
          onClick={stop}
          onDoubleClick={stop}
          onKeyDown={(event) => {
            // Ctrl/⌘+S（保存实例里的改动）照常往外走。
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') return
            event.stopPropagation()
            const step: Record<string, number> = {
              ArrowLeft: pinnedAt - 1,
              ArrowRight: pinnedAt + 1,
              Home: 0,
              End: count - 1,
            }
            const next = step[event.key]
            if (next === undefined) return
            // 方向键别冒到画布上（会挪选中的卡片）。
            event.preventDefault()
            pinAt(next)
          }}
        >
          <div
            ref={track}
            className={css.historyTrack}
            role="radiogroup"
            aria-label={t('history.title')}
            style={
              {
                gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
                '--n': count,
                '--at': current,
              } as React.CSSProperties
            }
            data-testid="wl-display-history-track"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              const index = tickAt(event)
              if (index === null) return
              dragging.current = true
              event.currentTarget.setPointerCapture(event.pointerId)
              pinAt(index)
            }}
            // 悬停到哪道刻度就换到哪一版（按住拖也一样）；移开不回退。
            onPointerMove={(event) => {
              const index = tickAt(event)
              if (index !== null && index !== pinnedAt) pinAt(index)
            }}
            onPointerUp={(event) => {
              dragging.current = false
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId)
              }
            }}
            onPointerCancel={() => {
              dragging.current = false
            }}
          >
            {/* 轴线和走过的一段：都从第一版的刻度画到最新那道。 */}
            <span className={css.historyAxis} aria-hidden="true" />
            <span className={css.historyFill} aria-hidden="true" />
            {line.dots.map((dot, index) => (
              <button
                key={dot.key}
                type="button"
                role="radio"
                aria-checked={index === pinnedAt}
                aria-label={labels[index]}
                tabIndex={index === pinnedAt ? 0 : -1}
                className={css.historyTick}
                data-tick={index}
                data-edge={index === 0 ? 'first' : index === count - 1 ? 'last' : undefined}
                data-tone={dot.tone ?? undefined}
                data-live={dot.v === null || undefined}
                data-reach={index < current ? 'past' : index === current ? 'at' : undefined}
                data-shown={index === current || undefined}
                data-kept={(index === pinnedAt && index !== current) || undefined}
                data-new={(props.newer && dot.v === null) || undefined}
                data-testid="wl-display-history-dot"
                // 键盘上回车、空格（指针在按下时就钉住了，这里再钉一次也一样）。
                onClick={() => props.onPin(dot.v)}
              >
                <span className={css.historyMajor} />
              </button>
            ))}
            {/* 滑块：一格宽、按 --at 横移，钟表在格子中间。 */}
            <span className={css.historyThumb} aria-hidden="true">
              <svg
                className={css.historyClock}
                viewBox="0 0 24 24"
                width="20"
                height="20"
                aria-hidden="true"
              >
                <g className={css.historyRoll} style={{ transform: `rotate(${roll.deg}deg)` }}>
                  <circle className={css.historyClockBack} cx="12" cy="12" r="11.5" />
                  <circle className={css.historyClockTrack} cx="12" cy="12" r="9" />
                  {/* 表圈走了几分之几：第几版 / 共几版，从十二点顺时针。 */}
                  <circle
                    className={css.historyClockRing}
                    cx="12"
                    cy="12"
                    r="9"
                    pathLength={1}
                    style={{ strokeDashoffset: 1 - (current + 1) / count }}
                  />
                  <path className={css.historyClockHands} d="M12 7.5V12l3 2" />
                </g>
              </svg>
            </span>
            {/* 说明：滑到显示的那一段下面（头尾两段贴边对齐）。 */}
            <span
              className={css.historyCaption}
              style={{ '--at': current } as React.CSSProperties}
              data-edge={current === 0 ? 'first' : current === count - 1 ? 'last' : undefined}
              aria-hidden="true"
            >
              <span
                className={css.historyCaptionText}
                data-tone={currentDot?.tone ?? undefined}
                data-testid="wl-display-history-caption"
              >
                <span className={css.historyCaptionDot} />
                <span className={css.historyCaptionName}>{labels[current]}</span>
                {currentDot?.version != null && (
                  <span className={css.historyCaptionTime}>{shortTime(currentDot.version.at)}</span>
                )}
              </span>
            </span>
          </div>
        </div>,
        props.rail,
      )}
    </>
  )
}
