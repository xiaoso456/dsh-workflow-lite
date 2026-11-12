/**
 * dsh-workflow-lite — 展示卡的各轮产出：这份产出每一轮存下的样子（见 `model/outputHistory.ts`）。至少有两版才有。
 *
 * 两块，和标题行右边的按钮一样，悬停卡片或选中时才出来：
 * - 卡片底边外的刻度盘（{@link HistoryDial}）：正中对着显示的那一版，悬停预览、点击 / 拖动 / 滚轮 / 方向键换版钉住。
 * - 标题行里写出看的是哪一版（「第 2 轮 · 审查后 3/6」），跟着刻度盘上悬停的那一点换字；点它下拉出各版列表
 *   （新的在上），悬停一项卡里临时换成那一版，点一下钉住。
 *   钉在旧版时旁边多一个 ✕ 回到最新（颜色不变）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/display/HistoryBar
 */

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { T } from '../../i18n.ts'
import { dotIndex, type HistoryLine, versionName } from '../../model/outputHistory.ts'
import { shortTime } from '../../model/time.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import { FLOAT_EXIT_MS, useFloat } from '../kit/useFloat.tsx'
import { SwapText, useTrend } from '../motion/swapText.tsx'
import shared from './display.module.css'
import { HistoryDial } from './HistoryDial.tsx'
import css from './historyBar.module.css'

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
  /** 每一点在标题行里叫什么：最后一点（现在的文件）叫「最新」。 */
  const labels = line.dots.map((dot, index) =>
    index === count - 1 ? t('history.live') : versionName(t, dot.version, names),
  )

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
          className={shared.history}
          data-preview={props.previewing || undefined}
          data-open={open || undefined}
          data-testid="wl-display-history"
        >
          <button
            ref={menu.anchorRef}
            type="button"
            className={cx(shared.historyPick, 'nodrag')}
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
            <span className={shared.historyCaret} aria-hidden="true">
              <Icon name="chevronDown" size={11} />
            </span>
          </button>
          {old && (
            <button
              type="button"
              className={cx(shared.historyBack, 'nodrag')}
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
        <HistoryDial
          t={t}
          line={line}
          labels={labels}
          current={current}
          previewing={props.previewing}
          pinnedAt={pinnedAt}
          newer={props.newer}
          onPreview={onPreview}
          onPin={props.onPin}
        />,
        props.rail,
      )}
    </>
  )
}
