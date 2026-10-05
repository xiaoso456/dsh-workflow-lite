/**
 * dsh-workflow-lite — 左下角的缩放条：缩放、看全图、快捷键说明，加上线条图例
 * （放不下时收成一个「图例」按钮）。模板编辑与实例视图共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Dock
 */

import { useReactFlow, useViewport } from '@xyflow/react'
import { useState } from 'react'
import type { LocaleKey, T } from '../i18n.ts'
import { Icon } from './Icon.tsx'
import { cx, Popover } from './primitives.tsx'
import css from './shell.module.css'
import ui from './ui.module.css'

const SHORTCUTS: readonly { key: LocaleKey; combos: readonly string[] }[] = [
  { key: 'keys.add', combos: [] },
  { key: 'keys.undo', combos: ['Ctrl', 'Z'] },
  { key: 'keys.redo', combos: ['Ctrl', 'Shift', 'Z'] },
  { key: 'keys.duplicate', combos: ['Ctrl', 'D'] },
  { key: 'keys.delete', combos: ['Delete'] },
  { key: 'keys.deselect', combos: ['Esc'] },
  { key: 'keys.fit', combos: ['F'] },
  { key: 'keys.tidy', combos: ['L'] },
]

// ─────────────────────────────────────────────────────────────
// 左下角：缩放与快捷键
// ─────────────────────────────────────────────────────────────

export function ZoomDock(props: {
  t: T
  keysOpen: boolean
  setKeysOpen: (open: boolean) => void
  onFit: () => void
}): React.JSX.Element {
  const { t } = props
  const flow = useReactFlow()
  const { zoom } = useViewport()
  const [legendOpen, setLegendOpen] = useState(false)
  return (
    <div className={cx(ui.panel, css.dock)}>
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small)}
        data-tip={t('tool.zoomOut')}
        aria-label={t('tool.zoomOut')}
        onClick={() => void flow.zoomOut({ duration: 200 })}
      >
        <Icon name="minus" size={15} />
      </button>
      <span className={css.zoom}>{Math.round(zoom * 100)}%</span>
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small)}
        data-tip={t('tool.zoomIn')}
        aria-label={t('tool.zoomIn')}
        onClick={() => void flow.zoomIn({ duration: 200 })}
      >
        <Icon name="plus" size={15} />
      </button>
      <button
        type="button"
        className={cx(ui.btn, ui.icon, ui.small)}
        data-tip={`${t('tool.fit')}  F`}
        aria-label={t('tool.fit')}
        data-testid="wl-fit"
        onClick={props.onFit}
      >
        <Icon name="fit" size={15} />
      </button>
      <span className={ui.divider} />
      <Popover
        open={props.keysOpen}
        onClose={() => props.setKeysOpen(false)}
        up
        label={t('keys.title')}
        className={css.keys}
        trigger={
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small)}
            data-tip={t('tool.keys')}
            aria-label={t('tool.keys')}
            aria-expanded={props.keysOpen}
            onClick={() => props.setKeysOpen(!props.keysOpen)}
          >
            <Icon name="keyboard" size={15} />
          </button>
        }
      >
        <p className={css.keysTitle}>{t('keys.title')}</p>
        {SHORTCUTS.map((row) => (
          <div key={row.key} className={css.keysRow}>
            <span>{t(row.key)}</span>
            <span>
              {row.combos.length === 0 ? (
                <span className={ui.kbd}>{t('keys.addCombo')}</span>
              ) : (
                row.combos.map((combo) => (
                  <kbd key={combo} className={ui.kbd}>
                    {combo}
                  </kbd>
                ))
              )}
            </span>
          </div>
        ))}
      </Popover>
      <span className={ui.divider} />
      <LineLegend t={t} />
      {/* 放不下整排图例时（左右两边的面板都开着、窗口又窄）收成一个按钮，点开看同一份图例。 */}
      <span className={css.legendCompact}>
        <Popover
          open={legendOpen}
          onClose={() => setLegendOpen(false)}
          up
          label={t('legend.title')}
          className={css.legendPop}
          trigger={
            <button
              type="button"
              className={cx(ui.btn, ui.small, css.legendToggle)}
              aria-expanded={legendOpen}
              data-testid="wl-legend-toggle"
              onClick={() => setLegendOpen(!legendOpen)}
            >
              <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
                <line x1="1" y1="2" x2="13" y2="2" data-line="always" />
                <line x1="1" y1="6" x2="13" y2="6" data-line="produce" />
                <line x1="1" y1="10" x2="13" y2="10" data-line="read" />
              </svg>
              {t('legend.short')}
            </button>
          }
        >
          <LegendSheet t={t} />
        </Popover>
      </span>
    </div>
  )
}

type LegendLine = 'always' | 'pass' | 'fail' | 'custom' | 'produce' | 'update' | 'read' | 'ask'

/**
 * 图例里的八种线，按两组排：流程线的四种条件；读写线的三种加上交回答（输入 → 步骤）。
 * 样本的线型、颜色、箭头与画布上一致。
 */
const LEGEND: readonly (readonly { key: LegendLine; label: LocaleKey; tip: LocaleKey }[])[] = [
  [
    { key: 'always', label: 'edge.always', tip: 'legend.alwaysTip' },
    { key: 'pass', label: 'edge.pass', tip: 'legend.passTip' },
    { key: 'fail', label: 'edge.fail', tip: 'legend.failTip' },
    { key: 'custom', label: 'edge.custom', tip: 'legend.customTip' },
  ],
  [
    { key: 'produce', label: 'file.produce', tip: 'legend.produceTip' },
    { key: 'update', label: 'file.update', tip: 'legend.updateTip' },
    { key: 'read', label: 'file.read', tip: 'legend.readTip' },
    { key: 'ask', label: 'file.ask', tip: 'legend.askTip' },
  ],
]

/** 一种线的小样本：线型、颜色、箭头与画布上一致（颜色和虚线由外层的 `data-line` 给）。 */
function LineSample(props: { line: LegendLine }): React.JSX.Element {
  return (
    <svg width="20" height="10" viewBox="0 0 20 10" aria-hidden="true">
      <line x1="1" y1="5" x2="14" y2="5" />
      <path d="M13 1.8 L19 5 L13 8.2 Z" />
      {props.line === 'update' && <path d="M7 1.8 L1 5 L7 8.2 Z" />}
    </svg>
  )
}

/** 收起时点开的图例：两组线各一个小标题，每种线一行，解释直接写出来（不用再悬停）。 */
function LegendSheet(props: { t: T }): React.JSX.Element {
  const { t } = props
  const heads: readonly LocaleKey[] = ['legend.groupFlow', 'legend.groupFile']
  return (
    <div data-testid="wl-legend-sheet">
      {LEGEND.map((group, index) => (
        <section key={heads[index]} className={css.legendGroup}>
          <p className={css.legendHead}>{t(heads[index] ?? 'legend.title')}</p>
          {group.map((item) => (
            <div key={item.key} className={css.legendRow} data-line={item.key}>
              <LineSample line={item.key} />
              <span className={css.legendName}>{t(item.label)}</span>
              <span className={css.legendTip}>{t(item.tip)}</span>
            </div>
          ))}
        </section>
      ))}
      <p className={css.legendFoot}>{t('legend.portsTip')}</p>
    </div>
  )
}

/** 左下角常驻的线条图例：八种线各一个小样本，悬停看一句解释；最后是入口 / 出口两种连接点。 */
function LineLegend(props: { t: T }): React.JSX.Element {
  const { t } = props
  return (
    <ul className={css.legend} aria-label={t('legend.title')} data-testid="wl-legend">
      {LEGEND.map((group) => [
        ...group.map((item) => (
          <li key={item.key} className={css.legendItem} data-line={item.key} data-tip={t(item.tip)}>
            <LineSample line={item.key} />
            <span>{t(item.label)}</span>
          </li>
        )),
        <li key={`${group[0]?.key}-sep`} className={css.legendSep} aria-hidden="true" />,
      ])}
      <li className={css.legendItem} data-port="in" data-tip={t('legend.inTip')}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="3.6" />
        </svg>
        <span>{t('legend.in')}</span>
      </li>
      <li className={css.legendItem} data-port="out" data-tip={t('legend.outTip')}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="3.6" />
        </svg>
        <span>{t('legend.out')}</span>
      </li>
    </ul>
  )
}
