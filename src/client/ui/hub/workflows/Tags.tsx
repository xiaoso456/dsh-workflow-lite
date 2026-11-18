/**
 * dsh-workflow-lite — 工作流标签的样子：左栏一行里的小标签（{@link RowTags}），右栏标题行里名字后面的一排（{@link TagRow}）。
 *
 * 每个标签一种颜色（步骤的色板）：浅一层的底，字和标签图标同色；没挑过的按名字算（`autoTagColor`）。
 * - 左栏最多写两个，多的写成「+N」，悬停看全部；紧凑行高时行尾只画色块（{@link RowTagDots}），最多四个。
 * - 右栏点一个标签开它的小菜单（{@link TagChip}）：换颜色（对所有工作流上的这个标签都生效）、从这个工作流去掉。
 *   ✕ 平时不占位，悬停（或键盘移进来、菜单开着）时标签变宽、✕ 淡入，点了直接去掉；
 *   变宽只靠 transform（底面 `useGlide` 展开，后面的标签 `useRowSlide` 滑开），宽度不逐帧变。
 *   末尾「+ 标签」开 {@link TagPicker}。
 * - 右栏那一排和名字同一行，放不下的后面几个收成「+N」（`tagFit.ts`），点它整排展开折行、再点收起。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/workflows/Tags
 */

import { useCallback, useLayoutEffect, useState } from 'react'
import { type TagColor, tagColorOf } from '../../../../shared/tags.ts'
import type { T } from '../../../i18n.ts'
import type { TagUse } from '../../../model/workflowList.ts'
import { cx } from '../../kit/cx.ts'
import { Icon } from '../../kit/Icon.tsx'
import { TintChip } from '../../kit/TintChip.tsx'
import ui from '../../kit/ui.module.css'
import { FLOAT_EXIT_MS, useFloat } from '../../kit/useFloat.tsx'
import { useGlide, useRowSlide } from '../../motion/exits.tsx'
import { ColorSwatches } from '../../panel/ColorSwatches.tsx'
import { type TagColors, tagStyle } from './TagMark.tsx'
import { TagPicker, toggleTag } from './TagPicker.tsx'
import { useTagFit } from './tagFit.ts'
import { useTagMotion } from './tagMotion.ts'
import css from './tags.module.css'

/** 左栏一行里最多写几个标签。 */
const ROW_TAGS = 2
/** 紧凑行高时行尾最多画几个色块。 */
const ROW_DOTS = 4
const MENU_W = 236

export function RowTags(props: {
  tags: readonly string[]
  colors: TagColors
}): React.JSX.Element | null {
  const { tags } = props
  if (tags.length === 0) return null
  const rest = tags.length - ROW_TAGS
  return (
    <span className={css.chips} data-tip={rest > 0 ? tags.join('、') : undefined}>
      {tags.slice(0, ROW_TAGS).map((tag) => (
        <TintChip
          key={tag}
          color={tagColorOf(props.colors, tag)}
          icon="tag"
          label={tag}
          testId="wl-hub-wf-tag"
        />
      ))}
      {rest > 0 && <span className={css.more}>+{rest}</span>}
    </span>
  )
}

/** 紧凑行高时行尾的标签：每个一个小色块（名字在悬停提示里）。 */
export function RowTagDots(props: {
  tags: readonly string[]
  colors: TagColors
}): React.JSX.Element {
  return (
    <span className={css.dots} aria-hidden="true">
      {props.tags.slice(0, ROW_DOTS).map((tag) => (
        <span key={tag} className={css.dot} style={tagStyle(tagColorOf(props.colors, tag))} />
      ))}
    </span>
  )
}

export function TagRow(props: {
  t: T
  name: string
  tags: readonly string[]
  catalog: readonly TagUse[]
  colors: TagColors
  onChange(next: string[]): void
  onColor(tag: string, color: TagColor): void
}): React.JSX.Element {
  const { t, tags } = props
  const slide = useRowSlide()
  const fit = useTagFit(tags.join('\n'), tags.length, slide)
  const [expandedFor, setExpandedFor] = useState<string | null>(null)
  /** 一行放不下、收起来的几个。 */
  const folded = tags.length - fit.shown
  const open = expandedFor === props.name && folded > 0
  const motion = useTagMotion(`${props.name}\n${tags.join('\n')}\n${fit.shown}:${String(open)}`)
  const fitRef = fit.ref
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      fitRef(node)
      motion.current = node
    },
    [fitRef, motion],
  )
  const moreTip = open
    ? t('hub.tagsLess')
    : t('hub.tagsMore').replace('{tags}', tags.slice(fit.shown).join('、'))
  return (
    <div ref={attach} className={css.row} data-expanded={open} data-testid="wl-hub-wf-tags">
      {tags.map((tag, index) => (
        <TagChip
          key={tag.toLocaleLowerCase()}
          t={t}
          tag={tag}
          workflow={props.name}
          hidden={!open && index >= fit.shown}
          color={tagColorOf(props.colors, tag)}
          onColor={(color) => props.onColor(tag, color)}
          onRemove={() => props.onChange(toggleTag(tags, tag))}
        />
      ))}
      {/* 一直挂着（量得到宽）；没有收起的就藏着。 */}
      <button
        type="button"
        className={css.moreTags}
        data-fit="more"
        data-row-hidden={folded === 0}
        aria-expanded={open}
        aria-label={moreTip}
        data-tip={moreTip}
        data-testid="wl-hub-wf-tags-more"
        onClick={() => setExpandedFor(open ? null : props.name)}
      >
        {open ? <Icon name="chevronUp" size={12} /> : `+${folded}`}
      </button>
      <TagPicker
        key={props.name}
        t={t}
        catalog={props.catalog}
        colors={props.colors}
        value={tags}
        label={`${t('hub.addTagTip')}：${props.name}`}
        testId="wl-hub-wf-tag-add"
        onChange={props.onChange}
      />
      <span className={css.tagGhosts} data-fit="ghosts" aria-hidden="true" />
    </div>
  )
}

/** 右栏的一个标签：点名字开小菜单（换颜色、去掉），悬停露出 ✕。 */
function TagChip(props: {
  t: T
  tag: string
  workflow: string
  /** 一行放不下、收在「+N」里：挪出排版藏起来（不卸掉，宽度照样量得到）。 */
  hidden: boolean
  color: TagColor
  onColor(color: TagColor): void
  onRemove(): void
}): React.JSX.Element {
  const { t, tag } = props
  const menu = useFloat<HTMLButtonElement>({
    openMs: 0,
    closeMs: 0,
    width: MENU_W,
    align: 'start',
    exitMs: FLOAT_EXIT_MS,
    // 打开时焦点落在当前颜色上：键盘接着能挑，Esc 只收菜单。
    initialFocus: '[aria-checked="true"]',
  })
  const open = menu.state !== 'off'
  const close = menu.setState
  useLayoutEffect(() => close('off'), [close, props.workflow])
  const glide = useGlide(0)
  const remove = t('hub.tagRemove').replace('{tag}', tag)
  return (
    <span
      ref={glide}
      className={css.tag}
      style={tagStyle(props.color)}
      data-value={tag}
      data-color={props.color}
      data-opened={open}
      data-fit="chip"
      data-row-hidden={props.hidden}
    >
      <span className={css.tagSurface} data-glide-surface="" />
      <button
        ref={menu.anchorRef}
        type="button"
        className={css.tagName}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-tip={open ? undefined : t('hub.tagMenuTip')}
        data-testid="wl-hub-wf-tag-chip"
        onClick={() => menu.setState(open ? 'off' : 'pinned')}
        onKeyDown={menu.onKeyDown}
      >
        <Icon name="tag" size={12} />
        <span className={css.tagText}>{tag}</span>
      </button>
      <button
        type="button"
        className={css.tagRemove}
        data-glide=""
        aria-label={remove}
        data-tip={remove}
        data-testid="wl-hub-wf-tag-remove"
        onClick={props.onRemove}
      >
        <Icon name="x" size={11} />
      </button>
      {menu.render({
        className: cx(ui.confirmPop, css.tagMenu),
        role: 'dialog',
        label: tag,
        testId: 'wl-hub-wf-tag-menu',
        children: (
          <>
            <p className={css.tagMenuHead}>{t('hub.tagColor')}</p>
            <p className={css.tagMenuHint}>{t('hub.tagColorHint')}</p>
            <ColorSwatches
              t={t}
              value={props.color}
              testId="wl-hub-wf-tag-color"
              onPick={props.onColor}
            />
            <div className={css.tagMenuSep} />
            <button
              type="button"
              className={ui.menuItem}
              data-testid="wl-hub-wf-tag-menu-remove"
              onClick={() => {
                menu.setState('off')
                props.onRemove()
              }}
            >
              <Icon name="x" size={14} />
              <span className={ui.menuLabel}>{t('hub.tagRemoveHere')}</span>
            </button>
          </>
        ),
      })}
    </span>
  )
}
