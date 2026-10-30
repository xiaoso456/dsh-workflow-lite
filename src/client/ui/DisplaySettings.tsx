/**
 * dsh-workflow-lite — 「画布展示」：面板里一个开关加一行摘要，细项收在一张浮层里（{@link DisplayOptions}）。
 *
 * 开了之后资源卡在画布上变成一块展示区（见 Canvas 的展示卡与 ResourceDisplay）。
 * 面板里只留开关和「大 448×256 · 100% · 柔边镂空」这样一行，点「调整」浮出细项；画布上选中展示卡，
 * 标题行的齿轮打开同一张浮层，摆在卡片旁边（卡片往右下长大也碰不到它），改什么卡片当场跟着变。
 *
 * 细项分四组：内容（多项时才有）、大小（三档、宽高、缩放；图片多一个摆放）、外观（五张小样：跟随设置和四种样子，
 * 见 app/displayLook.ts；下面一个「隐藏标题」）、适配（展示的是文件时：写它的步骤的任务描述里带上卡片尺寸）。说明都收进提示里。
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
import { displayKey } from '../app/useDisplayStats.ts'
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
} from '../model/display.ts'
import { ContentOptions, GroupHead } from './DisplayContent.tsx'
import css from './display.module.css'
import { Icon } from './Icon.tsx'
import inp from './input.module.css'
import ins from './inspector.module.css'
import { FadeText, PickThumb, SwapText, SwitchTrack, useExit } from './motion.tsx'
import { RollInput, Stepper } from './NumberStep.tsx'
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

/** 有缩放可调吗：图片只在「原大」时缩放（适应、填满跟着卡片走）；图墙的格子跟着卡片走，不缩放。 */
const zoomable = (display: Display): boolean =>
  display.kind === 'gallery' ? false : display.kind !== 'image' || display.fit === 'actual'

/** 摆放方式的缺省值（和 `displayOf` 一致）：图墙铺满，单张图适应。 */
const defaultFit = (display: Display): ViewFit => (display.kind === 'gallery' ? 'cover' : 'contain')

/** 面板里那一行摘要：「大 448×256 · 100% · 柔边镂空」，没让模型适配时末尾带一句。 */
export function displaySummary(t: T, display: Display, file: boolean): string {
  const size = sizeKeyOf(display.kind, display.width, display.height)
  const parts = [
    `${size === 'custom' ? '' : `${t(SIZE_NAME[size])} `}${display.width}×${display.height}`,
  ]
  const files = display.kind === 'gallery' && display.gallery.show === 'files'
  if (display.kind === 'image' || (display.kind === 'gallery' && !files)) {
    parts.push(t(`display.fit.${display.fit}`))
  }
  if (zoomable(display)) parts.push(`${display.zoom}%`)
  parts.push(display.look === undefined ? t('display.look.auto') : t(LOOK_NAME[display.look]))
  if (display.hideTitle) parts.push(t('display.hideTitle'))
  const filter = display.lines.filter
  if (filter !== undefined) {
    const short = filter.pattern.length > 14 ? `${filter.pattern.slice(0, 13)}…` : filter.pattern
    parts.push(t('display.summaryFilter').replace('{pattern}', short))
  }
  if (display.table.sort !== undefined) {
    parts.push(t('display.summarySort').replace('{column}', display.table.sort.column))
  }
  if (display.table.hide !== undefined) {
    parts.push(t('display.summaryHide').replace('{n}', String(display.table.hide.length)))
  }
  const folder = display.gallery
  if (files) parts.push(t('display.show.files'))
  else {
    if (folder.show === 'images') parts.push(t('display.show.images'))
    if (folder.layout !== undefined) parts.push(t(`display.layout.${folder.layout}`))
    if (folder.grid !== undefined && folder.layout === undefined) {
      parts.push(`${folder.grid.columns}×${folder.grid.rows}`)
    }
  }
  if (folder.match !== undefined) {
    parts.push(t('display.summaryFilter').replace('{pattern}', folder.match))
  }
  if (file && !display.adapt) parts.push(t('display.adaptOff'))
  return parts.join(' · ')
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
  /** 展示的那一项的路径（日志、表格、文件夹有自己的「内容」一组）。 */
  path: string
  /** 卡片读到的列名记在哪（{@link useTableHead}）。 */
  headKey: string
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
        <GroupHead label={t('display.sizeGroup')} />
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
        {/* 文件夹的摆放是每一格的事，放在「文件夹」那组里。 */}
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
                onChange={(fit) => set({ fit: fit === defaultFit(display) ? undefined : fit })}
              />
            </div>
          </div>
        )}
        {/* 缩放：图片不是「原大」时灰着、提示里说为什么（切摆放时下面的东西不跳）；文件夹的格子跟着卡片走，没有这一行。 */}
        {display.kind !== 'gallery' && (
          <div className={css.optLine}>
            <span className={css.optLabel}>{t('display.zoom')}</span>
            <Stepper
              label={t('display.zoom')}
              value={display.zoom}
              min={VIEW_LIMITS.zoom[0]}
              max={VIEW_LIMITS.zoom[1]}
              unit="%"
              next={(zoom, dir) => stepZoom(zoom, dir)}
              lessLabel={t('display.zoomOut')}
              moreLabel={t('display.zoomIn')}
              disabled={!zoomable(display)}
              tip={zoomable(display) ? undefined : t('display.zoomImage')}
              testId="wl-display-zoom"
              onChange={(zoom) =>
                set({ zoom: zoom === DEFAULT_ZOOM[display.kind] ? undefined : zoom })
              }
            />
          </div>
        )}
      </section>

      <ContentOptions
        t={t}
        display={display}
        view={view}
        path={props.path}
        headKey={props.headKey}
        set={set}
      />

      <section className={css.optGroup}>
        <GroupHead label={t('display.look')} tip={t('display.lookHint')} />
        <LookPicker t={t} value={display.look} onChange={(look) => set({ look })} />
        <button
          type="button"
          role="switch"
          aria-checked={display.hideTitle}
          className={css.optSwitch}
          data-tip={t('display.hideTitleTip')}
          data-testid="wl-display-hide-title"
          onClick={() => set({ hideTitle: display.hideTitle ? undefined : true })}
        >
          <SwitchTrack on={display.hideTitle} />
          <span>{t('display.hideTitle')}</span>
        </button>
      </section>

      {props.file && (
        <section className={css.optGroup}>
          <GroupHead label={t('display.modelGroup')} />
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
        </section>
      )}
    </div>
  )
}

/** 「调整」按钮 + 浮层，或画布卡片上的齿轮 + 浮层：同一套开关、摆位、收起规则（见 useFloat）。 */
export function useDisplayFloat<A extends HTMLElement>(
  beside?: React.RefObject<HTMLElement | null>,
  besideTop?: 'beside' | 'anchor',
): ReturnType<typeof useFloat<A>> {
  return useFloat<A>({
    openMs: 0,
    closeMs: 0,
    width: OPTIONS_WIDTH,
    align: 'end',
    exitMs: FLOAT_EXIT_MS,
    ...(beside === undefined ? {} : { beside }),
    ...(besideTop === undefined ? {} : { besideTop }),
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
  /** 资源卡的 id（表格挑列要用卡片读到的列名）。 */
  node: string
  data: ResourceData
  onChange(view: ResourceView | undefined): void
}): React.JSX.Element {
  const { t, data } = props
  const view = data.view
  const display = displayOf(data)
  const choices = displayableItems(data.items)
  const on = view !== undefined && display !== null
  // 浮层摆在整条右栏的左边、和这一块齐平：栏窄、选项多，挂在下面放不下（上下都会被裁）。
  // 不在栏里（找不到外面的 aside）时照旧挂在这一块下面。
  const side = useRef<HTMLElement | null>(null)
  const float = useDisplayFloat<HTMLDivElement>(side, 'anchor')
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
  // 文件、文件夹由步骤写出来，才有「让模型适配」。
  const file =
    display !== null &&
    (data.items[display.item]?.kind === 'file' || data.items[display.item]?.kind === 'folder')
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
              onClick={() => {
                side.current = float.anchorRef.current?.closest('aside') ?? null
                float.setState(open ? 'off' : 'pinned')
              }}
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
                path={data.items[display.item]?.value ?? ''}
                headKey={displayKey(props.node, display.item)}
                items={{
                  options: choices.map((index) => ({
                    value: String(index),
                    label:
                      itemName(data.items[index] as (typeof data.items)[number]) || `#${index + 1}`,
                  })),
                  onPick: (item) => {
                    const kind = displayKindOf(data.items[item] as (typeof data.items)[number])
                    // 换成另一种内容：尺寸、缩放换成那一种的缺省（网页和图片的合适大小差得多），外观、藏不藏标题留着。
                    if (kind !== null && kind !== display.kind) {
                      const fresh = defaultView(kind, item)
                      props.onChange({
                        ...fresh,
                        ...(display.adapt ? {} : { adapt: false }),
                        ...(view.look === undefined ? {} : { look: view.look }),
                        ...(view.hideTitle === true ? { hideTitle: true as const } : {}),
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
