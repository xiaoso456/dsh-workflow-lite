/**
 * dsh-workflow-lite — 资源面板里的「画布展示」：开关、展示哪一项、大小、缩放（图片是摆放方式）。
 *
 * 开了之后资源卡在画布上变成一块展示区（见 Canvas 的展示卡与 ResourceDisplay）。
 * 大小三档按内容种类各一套，也能直接填宽高、在画布上拖卡片右下角；网页的缩放决定先按多宽排版。
 * 实例视图里改的只是这个实例（和挪卡片一样进草稿栏，存的时候不通知模型）。
 * 展示的是文件时多一个「让模型适配」（缺省开）：写它的步骤的任务描述里带上卡片尺寸和怎么写才好看。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/DisplaySettings
 */

import { useState } from 'react'
import type { ResourceData, ResourceView, ViewFit } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import {
  type DisplayKind,
  defaultView,
  displayableItems,
  displayKindOf,
  displayOf,
  snapView,
  stepZoom,
  VIEW_SIZES,
  ZOOM_STEPS,
} from '../model/display.ts'
import css from './display.module.css'
import { Icon } from './Icon.tsx'
import inp from './input.module.css'
import ins from './inspector.module.css'
import { SwitchTrack } from './motion.tsx'
import { cx } from './primitives.tsx'
import { itemName } from './resourceUi.ts'
import { Segmented } from './Segmented.tsx'
import ui from './ui.module.css'

type SizeKey = 's' | 'm' | 'l' | 'custom'

function sizeKeyOf(kind: DisplayKind, width: number, height: number): SizeKey {
  const sizes = VIEW_SIZES[kind]
  for (const key of ['s', 'm', 'l'] as const) {
    if (sizes[key][0] === width && sizes[key][1] === height) return key
  }
  return 'custom'
}

/** 宽或高：输入时只是草稿，回车、失焦才写进去（夹进范围、按 8 取整）。 */
function SizeInput(props: {
  label: string
  value: number
  onCommit(value: number): void
  testId: string
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    if (draft === null) return
    const value = Number.parseInt(draft, 10)
    if (Number.isFinite(value) && value !== props.value) props.onCommit(value)
    setDraft(null)
  }
  return (
    <input
      className={cx(ui.input, css.sizeInput)}
      inputMode="numeric"
      aria-label={props.label}
      value={draft ?? String(props.value)}
      onChange={(event) => setDraft(event.target.value.replace(/[^\d]/gu, ''))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') setDraft(null)
      }}
      data-testid={props.testId}
    />
  )
}

export function DisplaySettings(props: {
  t: T
  data: ResourceData
  onChange(view: ResourceView | undefined): void
}): React.JSX.Element {
  const { t, data } = props
  const view = data.view
  const display = displayOf(data)
  const choices = displayableItems(data.items)
  const on = view !== undefined && display !== null
  const set = (patch: Partial<ResourceView>): void => {
    if (view === undefined) return
    const next: ResourceView = { ...view, ...patch }
    for (const key of Object.keys(patch) as (keyof ResourceView)[]) {
      if (patch[key] === undefined) delete next[key]
    }
    props.onChange(next)
  }
  const toggle = (): void => {
    if (on) {
      props.onChange(undefined)
      return
    }
    const first = choices[0]
    if (first === undefined) return
    const kind = displayKindOf(data.items[first] as (typeof data.items)[number]) as DisplayKind
    props.onChange(defaultView(kind))
  }

  return (
    <section className={ins.field} data-testid="wl-display-settings">
      <div className={ins.label}>
        <span>{t('display.title')}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        className={inp.required}
        disabled={choices.length === 0}
        data-testid="wl-display-toggle"
        onClick={toggle}
      >
        <SwitchTrack on={on} />
        <span className={inp.requiredText}>
          <span className={inp.requiredTitle}>{t('display.toggle')}</span>
          <span className={inp.requiredDesc}>
            {choices.length === 0 ? t('display.none') : t('display.toggleDesc')}
          </span>
        </span>
      </button>

      {on && display !== null && (
        <div className={css.panelBox}>
          {choices.length > 1 && (
            <div className={css.panelRow}>
              <span className={css.panelLabel}>{t('display.item')}</span>
              <select
                className={cx(ui.input, css.panelGrow)}
                value={display.item}
                aria-label={t('display.item')}
                data-testid="wl-display-item"
                onChange={(event) => {
                  const item = Number(event.target.value)
                  const kind = displayKindOf(data.items[item] as (typeof data.items)[number])
                  // 换成另一种内容：尺寸、缩放换成那一种的缺省（网页和图片的合适大小差得多）。
                  if (kind !== null && kind !== display.kind) {
                    const fresh = defaultView(kind, item)
                    props.onChange(display.adapt ? fresh : { ...fresh, adapt: false })
                  } else set({ item })
                }}
              >
                {choices.map((index) => (
                  <option key={index} value={index}>
                    {itemName(data.items[index] as (typeof data.items)[number]) || `#${index + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={css.panelRow}>
            <span className={css.panelLabel}>{t('display.size')}</span>
            <div className={css.panelGrow}>
              <Segmented<SizeKey>
                label={t('display.size')}
                value={sizeKeyOf(display.kind, display.width, display.height)}
                options={[
                  { value: 's', label: t('display.size.s') },
                  { value: 'm', label: t('display.size.m') },
                  { value: 'l', label: t('display.size.l') },
                  { value: 'custom', label: t('display.size.custom') },
                ]}
                testId="wl-display-size"
                onChange={(key) => {
                  if (key === 'custom') return
                  const [width, height] = VIEW_SIZES[display.kind][key]
                  set({ width, height })
                }}
              />
            </div>
          </div>
          <div className={css.panelRow}>
            <span className={css.panelLabel} />
            <span className={css.sizeInputs}>
              <SizeInput
                label={t('display.width')}
                value={display.width}
                testId="wl-display-width"
                onCommit={(width) => set(snapView(width, display.height))}
              />
              ×
              <SizeInput
                label={t('display.height')}
                value={display.height}
                testId="wl-display-height"
                onCommit={(height) => set(snapView(display.width, height))}
              />
            </span>
          </div>

          {display.kind === 'image' && (
            <div className={css.panelRow}>
              <span className={css.panelLabel}>{t('display.fit')}</span>
              <div className={css.panelGrow}>
                <Segmented<ViewFit>
                  label={t('display.fit')}
                  value={display.fit}
                  options={[
                    { value: 'contain', label: t('display.fit.contain') },
                    { value: 'cover', label: t('display.fit.cover') },
                    { value: 'actual', label: t('display.fit.actual') },
                  ]}
                  testId="wl-display-fit"
                  onChange={(fit) => set({ fit: fit === 'contain' ? undefined : fit })}
                />
              </div>
            </div>
          )}

          {(display.kind !== 'image' || display.fit === 'actual') && (
            <div className={css.panelRow}>
              <span className={css.panelLabel}>{t('display.zoom')}</span>
              <span className={css.stepper}>
                <button
                  type="button"
                  className={cx(ui.btn, ui.icon, ui.small)}
                  aria-label={t('display.zoomOut')}
                  data-tip={t('display.zoomOut')}
                  disabled={display.zoom <= ZOOM_STEPS[0]}
                  data-testid="wl-display-zoom-out"
                  onClick={() => set({ zoom: stepZoom(display.zoom, -1) })}
                >
                  <Icon name="minus" size={14} />
                </button>
                <span className={css.stepperValue} data-testid="wl-display-zoom">
                  {display.zoom}%
                </span>
                <button
                  type="button"
                  className={cx(ui.btn, ui.icon, ui.small)}
                  aria-label={t('display.zoomIn')}
                  data-tip={t('display.zoomIn')}
                  disabled={display.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
                  data-testid="wl-display-zoom-in"
                  onClick={() => set({ zoom: stepZoom(display.zoom, 1) })}
                >
                  <Icon name="plus" size={14} />
                </button>
              </span>
            </div>
          )}

          {data.items[display.item]?.kind === 'file' && (
            <button
              type="button"
              role="switch"
              aria-checked={display.adapt}
              className={inp.required}
              data-testid="wl-display-adapt"
              onClick={() => set({ adapt: display.adapt ? false : undefined })}
            >
              <SwitchTrack on={display.adapt} />
              <span className={inp.requiredText}>
                <span className={inp.requiredTitle}>{t('display.adapt')}</span>
                <span className={inp.requiredDesc}>{t('display.adaptDesc')}</span>
              </span>
            </button>
          )}

          {display.kind === 'html' && (
            <p className={ins.help}>
              {t('display.zoomHint.html').replace(
                '{w}',
                String(Math.round((display.width * 100) / display.zoom)),
              )}
            </p>
          )}
          <p className={ins.help}>{t('display.hint')}</p>
        </div>
      )}
    </section>
  )
}
