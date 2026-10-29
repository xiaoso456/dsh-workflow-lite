/**
 * dsh-workflow-lite — 「画布展示」：面板里一个开关加一行摘要，细项收在一张浮层里（{@link DisplayOptions}）。
 *
 * 开了之后资源卡在画布上变成一块展示区（见 Canvas 的展示卡与 ResourceDisplay）。
 * 面板里只留开关和「大 448×256 · 100% · 柔边镂空」这样一行，点「调整」浮出细项；画布上选中展示卡，
 * 标题行的齿轮打开同一张浮层，摆在卡片旁边（卡片往右下长大也碰不到它），改什么卡片当场跟着变。
 *
 * 细项分四组：内容（多项时才有）、大小（三档、宽高、缩放；图片多一个摆放）、外观（五张小样：跟随设置和四种样子，
 * 见 app/displayLook.ts）、适配（展示的是文件时：写它的步骤的任务描述里带上卡片尺寸）。说明都收进提示里。
 * 实例视图里改的只是这个实例（和挪卡片一样进草稿栏，存的时候不通知模型）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/DisplaySettings
 */

import { useRef, useState } from 'react'
import {
  type ResourceData,
  type ResourceView,
  VIEW_LIMITS,
  VIEW_LOOKS,
  type ViewFit,
  type ViewLook,
} from '../../shared/types.ts'
import { LOOK_NAME, useDisplayLook } from '../app/displayLook.ts'
import type { LocaleKey, T } from '../i18n.ts'
import {
  DEFAULT_ZOOM,
  type Display,
  type DisplayKind,
  defaultView,
  displayableItems,
  displayFootprint,
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
import { FadeText, PickThumb, SwapText, SwitchTrack, useExit, useTrend } from './motion.tsx'
import { cx, FLOAT_EXIT_MS, useFloat } from './primitives.tsx'
import { itemName } from './resourceUi.ts'
import { Segmented } from './Segmented.tsx'
import { Select } from './Select.tsx'
import ui from './ui.module.css'

type SizeKey = 's' | 'm' | 'l' | 'custom'

/** 浮层宽度：五张外观小样排一行刚好。 */
const OPTIONS_WIDTH = 320

const SIZE_NAME: Record<SizeKey, LocaleKey> = {
  s: 'display.size.s',
  m: 'display.size.m',
  l: 'display.size.l',
  custom: 'display.size.custom',
}

function sizeKeyOf(kind: DisplayKind, width: number, height: number): SizeKey {
  const sizes = VIEW_SIZES[kind]
  for (const key of ['s', 'm', 'l'] as const) {
    if (sizes[key][0] === width && sizes[key][1] === height) return key
  }
  return 'custom'
}

/** 有缩放可调吗：图片只在「原大」时缩放（适应、填满跟着卡片走）。 */
const zoomable = (display: Display): boolean => display.kind !== 'image' || display.fit === 'actual'

/** 面板里那一行摘要：「大 448×256 · 100% · 柔边镂空」，没让模型适配时末尾带一句。 */
export function displaySummary(t: T, display: Display, file: boolean): string {
  const size = sizeKeyOf(display.kind, display.width, display.height)
  const parts = [
    `${size === 'custom' ? '' : `${t(SIZE_NAME[size])} `}${display.width}×${display.height}`,
  ]
  if (display.kind === 'image') parts.push(t(`display.fit.${display.fit}`))
  if (zoomable(display)) parts.push(`${display.zoom}%`)
  parts.push(display.look === undefined ? t('display.look.auto') : t(LOOK_NAME[display.look]))
  if (file && !display.adapt) parts.push(t('display.adaptOff'))
  return parts.join(' · ')
}

/**
 * 能直接改的数字（宽、高、缩放）：输入时只是草稿，回车、失焦才交给 `onCommit`（夹进范围、取整由调用方定）；
 * 上下键按 `step` 走一下，当场生效。
 * 没在改的时候，数字画在上面一层的 SwapText 里：点三档、按 − / + 时旧数字让开、新数字滚进来（变大往上、变小往下），
 * 不是一下跳过去；点进去改时那一层藏起来，露出输入框里的字。
 */
function RollInput(props: {
  label: string
  value: number
  onCommit(value: number): void
  step(up: boolean, big: boolean): number
  testId: string
  className: string
  disabled?: boolean
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const trend = useTrend(props.value)
  const commit = (): void => {
    if (draft === null) return
    const value = Number.parseInt(draft, 10)
    if (Number.isFinite(value) && value !== props.value) props.onCommit(value)
    setDraft(null)
  }
  return (
    <span className={css.roll}>
      <input
        className={cx(css.rollInput, props.className)}
        inputMode="numeric"
        aria-label={props.label}
        disabled={props.disabled}
        value={draft ?? String(props.value)}
        onChange={(event) => setDraft(event.target.value.replace(/[^\d]/gu, ''))}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const base = draft === null ? props.value : Number.parseInt(draft, 10) || props.value
            setDraft(null)
            props.onCommit(base + props.step(event.key === 'ArrowUp', event.shiftKey))
          }
          if (event.key === 'Escape' && draft !== null) {
            // 只撤掉这次输入，不连带收起浮层。
            event.stopPropagation()
            setDraft(null)
          }
        }}
        data-testid={props.testId}
      />
      <span className={css.rollShow} aria-hidden="true">
        {/* 占宽由输入框定（它比数字宽），这一层只按字宽、居中放：三位数、四位数都在正中。 */}
        <SwapText text={String(props.value)} dir={trend} />
      </span>
    </span>
  )
}

/** 一组的小标题，后面可带一枚「i」，悬停看说明。 */
function GroupHead(props: { label: string; tip?: string }): React.JSX.Element {
  return (
    <div className={css.optHead}>
      <span>{props.label}</span>
      {props.tip !== undefined && (
        <span className={css.optTip} data-tip={props.tip} aria-label={props.tip} role="img">
          <Icon name="info" size={12} />
        </span>
      )}
    </div>
  )
}

/** 外观小样：一小块画布（带点），上面按那种样子画一张迷你卡。「跟随设置」画的是设置里现在选的那种（提示里写着是哪种）。 */
function LookPicker(props: {
  t: T
  value: ViewLook | undefined
  onChange(look: ViewLook | undefined): void
}): React.JSX.Element {
  const { t } = props
  const fallback = useDisplayLook()
  const options: { value: ViewLook | 'auto'; art: ViewLook; label: string }[] = [
    { value: 'auto', art: fallback, label: t('display.look.auto') },
    ...VIEW_LOOKS.map((value) => ({ value, art: value, label: t(LOOK_NAME[value]) })),
  ]
  const current = props.value ?? 'auto'
  return (
    <div className={css.looks} role="radiogroup" aria-label={t('display.look')}>
      {/* 选中圈：一块描边滑到新选的那张小样上（不是旧的熄掉、新的亮起）。 */}
      <PickThumb layout={current} part={`.${css.lookArt}`} className={css.lookRing} />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === current}
          className={css.lookTile}
          data-tip={
            option.value === 'auto'
              ? t('display.look.autoTip').replace('{look}', t(LOOK_NAME[fallback]))
              : undefined
          }
          data-testid={`wl-display-look-${option.value}`}
          onClick={() => {
            if (option.value !== current)
              props.onChange(option.value === 'auto' ? undefined : option.value)
          }}
        >
          <span className={css.lookArt} data-art={option.art} aria-hidden="true">
            <span className={css.lookMini}>
              <span />
              <span />
              <span />
            </span>
          </span>
          <FadeText className={css.lookName} text={option.label} on={option.value === current} />
        </button>
      ))}
    </div>
  )
}

/**
 * 展示的细项（浮层的内容）。面板和画布上的齿轮共用；`items` 只有面板给（画布上的卡不知道资源里有哪几项）。
 */
export function DisplayOptions(props: {
  t: T
  view: ResourceView
  display: Display
  /** 展示的是文件（才有「让模型适配」）。 */
  file: boolean
  items?: { options: readonly { value: string; label: string }[]; onPick(index: number): void }
  onChange(view: ResourceView): void
}): React.JSX.Element {
  const { t, view, display } = props
  const set = (patch: Partial<ResourceView>): void => {
    const next: ResourceView = { ...view, ...patch }
    for (const key of Object.keys(patch) as (keyof ResourceView)[]) {
      if (patch[key] === undefined) delete next[key]
    }
    props.onChange(next)
  }
  const footprint = displayFootprint(display)
  const sizeTip =
    display.kind === 'html'
      ? t('display.sizeTip.html').replace('{size}', `${footprint.width}×${footprint.height}`)
      : t('display.sizeTip')

  return (
    <div className={css.options} data-testid="wl-display-options">
      {props.items !== undefined && props.items.options.length > 1 && (
        <section className={css.optGroup}>
          <GroupHead label={t('display.item')} />
          <Select<string>
            label={t('display.item')}
            value={String(display.item)}
            options={props.items.options}
            testId="wl-display-item"
            onChange={(value) => props.items?.onPick(Number(value))}
          />
        </section>
      )}

      <section className={css.optGroup}>
        {/* 三档和宽高并排：宽高不是三档之一时三档都不亮，框里的数就是自定义的尺寸。 */}
        <div className={css.optLine}>
          <span className={css.optLabel}>{t('display.size')}</span>
          <div className={css.optGrow}>
            <Segmented<SizeKey>
              label={t('display.size')}
              value={sizeKeyOf(display.kind, display.width, display.height)}
              options={(['s', 'm', 'l'] as const).map((value) => ({
                value,
                label: t(SIZE_NAME[value]),
              }))}
              testId="wl-display-size"
              onChange={(key) => {
                if (key === 'custom') return
                const [width, height] = VIEW_SIZES[display.kind][key]
                set({ width, height })
              }}
            />
          </div>
          <span className={css.dims} data-tip={sizeTip}>
            <RollInput
              label={t('display.width')}
              value={display.width}
              testId="wl-display-width"
              className={css.sizeInput}
              step={(up, big) => (big ? 40 : 8) * (up ? 1 : -1)}
              onCommit={(width) => set(snapView(width, display.height))}
            />
            <span className={css.dimsX} aria-hidden="true">
              ×
            </span>
            <RollInput
              label={t('display.height')}
              value={display.height}
              testId="wl-display-height"
              className={css.sizeInput}
              step={(up, big) => (big ? 40 : 8) * (up ? 1 : -1)}
              onCommit={(height) => set(snapView(display.width, height))}
            />
          </span>
        </div>
        {display.kind === 'image' && (
          <div className={css.optLine}>
            <span className={css.optLabel}>{t('display.fit')}</span>
            <div className={css.optGrow}>
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
        {/* 缩放一直在（图片不是「原大」时灰着、提示里说为什么），切摆放时下面的东西不跳。 */}
        <div className={css.optLine}>
          <span className={css.optLabel}>{t('display.zoom')}</span>
          <span
            className={css.zoom}
            aria-disabled={!zoomable(display) || undefined}
            data-tip={zoomable(display) ? undefined : t('display.zoomImage')}
          >
            <button
              type="button"
              className={css.zoomStep}
              aria-label={t('display.zoomOut')}
              data-tip={t('display.zoomOut')}
              disabled={!zoomable(display) || display.zoom <= ZOOM_STEPS[0]}
              data-testid="wl-display-zoom-out"
              onClick={() => set({ zoom: stepZoom(display.zoom, -1) })}
            >
              <Icon name="minus" size={13} />
            </button>
            {/* 读数就是输入框：直接填（25–400），上下键一次 1%、按住 Shift 10%。 */}
            <span className={css.zoomValue}>
              <RollInput
                label={t('display.zoom')}
                value={display.zoom}
                testId="wl-display-zoom"
                className={css.zoomInput}
                disabled={!zoomable(display)}
                step={(up, big) => (big ? 10 : 1) * (up ? 1 : -1)}
                onCommit={(zoom) => {
                  const [lo, hi] = VIEW_LIMITS.zoom
                  const next = Math.min(hi, Math.max(lo, Math.round(zoom)))
                  set({ zoom: next === DEFAULT_ZOOM[display.kind] ? undefined : next })
                }}
              />
              <span className={css.zoomUnit}>%</span>
            </span>
            <button
              type="button"
              className={css.zoomStep}
              aria-label={t('display.zoomIn')}
              data-tip={t('display.zoomIn')}
              disabled={!zoomable(display) || display.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              data-testid="wl-display-zoom-in"
              onClick={() => set({ zoom: stepZoom(display.zoom, 1) })}
            >
              <Icon name="plus" size={13} />
            </button>
          </span>
        </div>
      </section>

      <section className={css.optGroup}>
        <GroupHead label={t('display.look')} tip={t('display.lookHint')} />
        <LookPicker t={t} value={display.look} onChange={(look) => set({ look })} />
      </section>

      {props.file && (
        <button
          type="button"
          role="switch"
          aria-checked={display.adapt}
          className={css.optSwitch}
          data-tip={t('display.adaptDesc')}
          data-testid="wl-display-adapt"
          onClick={() => set({ adapt: display.adapt ? false : undefined })}
        >
          <SwitchTrack on={display.adapt} />
          <span>{t('display.adapt')}</span>
        </button>
      )}
    </div>
  )
}

/** 「调整」按钮 + 浮层，或画布卡片上的齿轮 + 浮层：同一套开关、摆位、收起规则（见 useFloat）。 */
export function useDisplayFloat<A extends HTMLElement>(
  beside?: React.RefObject<HTMLElement | null>,
): ReturnType<typeof useFloat<A>> {
  return useFloat<A>({
    openMs: 0,
    closeMs: 0,
    width: OPTIONS_WIDTH,
    align: 'end',
    exitMs: FLOAT_EXIT_MS,
    ...(beside === undefined ? {} : { beside }),
  })
}

/** 「调整」的座位：贴着开关块右边、上下居中；卸掉时里面的按钮留个影子缩回去。 */
function AdjustSeat(props: { children: React.ReactNode }): React.JSX.Element {
  const ref = useExit<HTMLSpanElement>('shrink', { inner: true })
  return (
    <span ref={ref} className={css.adjustSeat}>
      {props.children}
    </span>
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
  // 浮层挂在整块下面（不是「调整」按钮下面），不压住这一块。
  const float = useDisplayFloat<HTMLDivElement>()
  const adjust = useRef<HTMLButtonElement>(null)
  const open = float.state !== 'off'
  const toggle = (): void => {
    if (on) {
      float.setState('off')
      props.onChange(undefined)
      return
    }
    const first = choices[0]
    if (first === undefined) return
    const kind = displayKindOf(data.items[first] as (typeof data.items)[number]) as DisplayKind
    props.onChange(defaultView(kind))
  }
  const file = display !== null && data.items[display.item]?.kind === 'file'
  // 「调整」只在这一次打开展示时长出来；面板刚挂上（刷新、换选中）时就在那。
  const [wasOn, setWasOn] = useState(on)
  const [grow, setGrow] = useState(false)
  if (wasOn !== on) {
    setWasOn(on)
    setGrow(on)
  }

  return (
    <section className={ins.field} data-testid="wl-display-settings">
      <div className={ins.label}>
        <span>{t('display.title')}</span>
      </div>
      {/* 开关和摘要同一块：开着时说明那行换成摘要，右边一个「调整」。 */}
      <div ref={float.anchorRef} className={css.toggleBox}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={cx(inp.required, css.toggleMain)}
          data-adjust={on || undefined}
          disabled={choices.length === 0}
          data-testid="wl-display-toggle"
          onClick={toggle}
        >
          <SwitchTrack on={on} />
          <span className={inp.requiredText}>
            <span className={inp.requiredTitle}>{t('display.toggle')}</span>
            {/* 开、关时说明和摘要在同一格里换；改了大小、外观，摘要也就地换字。 */}
            <span
              className={cx(inp.requiredDesc, on && css.summary)}
              data-testid={on ? 'wl-display-summary' : undefined}
            >
              <SwapText
                text={
                  display !== null && on
                    ? displaySummary(t, display, file)
                    : choices.length === 0
                      ? t('display.none')
                      : t('display.toggleDesc')
                }
              />
            </span>
          </span>
        </button>
        {/* 开的时候从右边长出来，关的时候原地缩回去（座位不动，动的是里面的按钮）。 */}
        {on && (
          <AdjustSeat>
            <button
              ref={adjust}
              type="button"
              className={cx(ui.btn, ui.small, css.adjust)}
              data-grow={grow || undefined}
              aria-haspopup="dialog"
              aria-expanded={open}
              data-active={open || undefined}
              data-testid="wl-display-adjust"
              onClick={() => float.setState(open ? 'off' : 'pinned')}
              onKeyDown={(event) => {
                float.onKeyDown(event)
                if (event.key === 'Escape') adjust.current?.focus()
              }}
            >
              <Icon name="sliders" size={13} />
              {t('display.adjust')}
            </button>
          </AdjustSeat>
        )}
      </div>
      {view !== undefined &&
        display !== null &&
        float.render({
          className: cx(ui.confirmPop, css.optionsPop),
          role: 'dialog',
          label: t('display.settings'),
          testId: 'wl-display-pop',
          children: (
            // Esc 收起时焦点回到「调整」（浮层挂在整块下面，整块本身拿不到焦点）。
            // biome-ignore lint/a11y/noStaticElementInteractions: 只是在收起前挪焦点
            <div
              onKeyDown={(event) => {
                if (event.key === 'Escape') adjust.current?.focus()
              }}
            >
              <DisplayOptions
                t={t}
                view={view}
                display={display}
                file={file}
                items={{
                  options: choices.map((index) => ({
                    value: String(index),
                    label:
                      itemName(data.items[index] as (typeof data.items)[number]) || `#${index + 1}`,
                  })),
                  onPick: (item) => {
                    const kind = displayKindOf(data.items[item] as (typeof data.items)[number])
                    // 换成另一种内容：尺寸、缩放换成那一种的缺省（网页和图片的合适大小差得多），外观留着。
                    if (kind !== null && kind !== display.kind) {
                      const fresh = defaultView(kind, item)
                      props.onChange({
                        ...fresh,
                        ...(display.adapt ? {} : { adapt: false }),
                        ...(view.look === undefined ? {} : { look: view.look }),
                      })
                    } else props.onChange({ ...view, item })
                  },
                }}
                onChange={props.onChange}
              />
            </div>
          ),
        })}
    </section>
  )
}
