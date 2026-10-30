/**
 * dsh-workflow-lite — 展示卡左下角的一排点：这份产出每一轮存下的样子（见 `model/outputHistory.ts`）。
 *
 * 平时藏着，悬停卡片才淡入；至少有两点（存过一版、现在又变了，或存过两版）才有。
 * - 悬停一点：卡片里临时换成那一版，移开回到原来显示的那版；
 * - 点一下：钉住那一版（卡片一直显示它，点条一直露着，带「回到最新」）；钉着时又来了新的一版，最新那点上亮一个小点；
 * - 方向键在各点之间走、Home / End 到头尾、Esc 回到最新。
 * 点按判定着色：把流程领回去重做的是「不通过」的线色，往下走的是「通过」的线色。
 * 条贴左边：名字长短变了只往右伸缩，指针下面的点不跟着挪。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/HistoryBar
 */

import { Fragment, useRef } from 'react'
import type { T } from '../i18n.ts'
import { dotIndex, type HistoryLine, versionName, versionTip } from '../model/outputHistory.ts'
import css from './display.module.css'
import { Icon } from './Icon.tsx'
import { cx } from './primitives.tsx'

export function HistoryBar(props: {
  t: T
  line: HistoryLine
  names: Readonly<Record<string, string>>
  /** 卡片里现在显示的是哪一版（`null` = 最新）。 */
  shown: number | null
  /** 钉住的那一版；没钉是 `null`。 */
  pinned: number | null
  /** 钉着的时候又来了新的一版。 */
  newer: boolean
  /** 悬停预览：给 `undefined` 是不预览了。 */
  onPreview(v: number | null | undefined): void
  onPin(v: number | null): void
}): React.JSX.Element {
  const { t, line, names } = props
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const current = dotIndex(line, props.shown)
  const pinnedAt = props.pinned === null ? line.dots.length - 1 : dotIndex(line, props.pinned)
  const label = versionName(t, line.dots[current]?.version ?? null, names)

  const go = (index: number): void => {
    const dot = line.dots[Math.max(0, Math.min(line.dots.length - 1, index))]
    if (dot === undefined) return
    props.onPin(dot.v)
    buttons.current[line.dots.indexOf(dot)]?.focus()
  }

  return (
    // 条在节点里：点击、双击、按键都别落到卡片上（会改选中、打开查看框、挪卡片）。
    // biome-ignore lint/a11y/noStaticElementInteractions: 只是截住冒泡
    <div
      className={cx(css.history, 'nodrag', 'nopan')}
      data-pinned={props.pinned !== null || undefined}
      data-testid="wl-display-history"
      onDoubleClick={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // Ctrl/⌘+S（保存实例里的改动）照常往外走。
        if (!((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')) {
          event.stopPropagation()
        }
      }}
    >
      <div
        className={css.historyTrack}
        role="radiogroup"
        aria-label={t('history.rounds')}
        onPointerLeave={() => props.onPreview(undefined)}
        onKeyDown={(event) => {
          const step: Record<string, number> = {
            ArrowLeft: pinnedAt - 1,
            ArrowUp: pinnedAt - 1,
            ArrowRight: pinnedAt + 1,
            ArrowDown: pinnedAt + 1,
            Home: 0,
            End: line.dots.length - 1,
          }
          const next = step[event.key]
          if (next === undefined && event.key !== 'Escape') return
          // 方向键别冒到画布上（会挪选中的卡片）。
          event.preventDefault()
          event.stopPropagation()
          go(next ?? line.dots.length - 1)
        }}
      >
        {line.dots.map((dot, index) => {
          const tip = versionTip(t, dot, names)
          return (
            <Fragment key={dot.key}>
              {index === 1 && line.dropped > 0 && (
                <span
                  className={css.historyGap}
                  data-tip={t('history.dropped').replace('{n}', String(line.dropped))}
                  aria-hidden="true"
                />
              )}
              <button
                ref={(element) => {
                  buttons.current[index] = element
                }}
                type="button"
                role="radio"
                className={css.historyDot}
                aria-checked={index === pinnedAt}
                aria-label={tip}
                tabIndex={index === pinnedAt ? 0 : -1}
                data-tip={tip}
                data-shown={index === current || undefined}
                data-tone={dot.tone ?? undefined}
                data-live={dot.v === null || undefined}
                data-new={(props.newer && dot.v === null) || undefined}
                data-testid="wl-display-history-dot"
                onPointerEnter={() => props.onPreview(dot.v)}
                onClick={() => props.onPin(dot.v)}
              />
            </Fragment>
          )
        })}
      </div>
      <span className={css.historyLabel} data-testid="wl-display-history-label">
        {label}
      </span>
      {props.pinned !== null && (
        <button
          type="button"
          className={css.historyBack}
          data-tip={props.newer ? t('history.newer') : t('history.back')}
          aria-label={t('history.back')}
          data-testid="wl-display-history-back"
          onClick={() => props.onPin(null)}
        >
          <Icon name="restore" size={12} />
        </button>
      )}
    </div>
  )
}
