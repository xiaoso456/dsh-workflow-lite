/**
 * dsh-workflow-lite — 步骤库（左侧浮动面板）。
 *
 * 两种手势，各管一件事：
 * - **拖**：拖到画布上哪里，步骤就落在哪里。往图里加东西只有这一条路（和右侧面板里那个
 *   明确写着「添加到画布」的按钮）——单击加节点落点不明确，容易误加。
 * - **点**：在右侧面板里看它。常用步骤只读；我的步骤可以改、可以删。
 *
 * 「常用步骤」「我的步骤」两节都能收起，收起状态记在本机。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/Library
 */

import { useState } from 'react'
import type { TemplateEntry } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import {
  DND_MIME,
  encodeStepSource,
  type LibraryFocus,
  PRESETS,
  type StepSource,
} from '../model/library.ts'
import { Icon, type IconName } from './Icon.tsx'
import css from './library.module.css'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

type Section = 'builtin' | 'custom'

const SECTIONS_KEY = 'workflow-lite.library.collapsed'

function readCollapsed(): Section[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SECTIONS_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((value): value is Section => value === 'builtin' || value === 'custom')
      : []
  } catch {
    // 读不懂或读不了：全展开。折叠状态是便利不是事实，不该为它让整栏打不开。
    return []
  }
}

function writeCollapsed(collapsed: readonly Section[]): void {
  try {
    window.localStorage.setItem(SECTIONS_KEY, JSON.stringify(collapsed))
  } catch {
    // 偏好持久化是尽力而为。
  }
}

function Item(props: {
  source: StepSource
  icon: IconName
  kind: string
  title: string
  desc: string
  active: boolean
  /** 坏了的模板拖不进图，但还能点开来看、来改。 */
  draggable?: boolean
  testId: string
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={css.item}
      draggable={props.draggable !== false}
      data-broken={props.draggable === false}
      data-testid={props.testId}
      data-active={props.active}
      aria-pressed={props.active}
      onDragStart={(event) => {
        event.dataTransfer.setData(DND_MIME, encodeStepSource(props.source))
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={props.onClick}
    >
      <span className={ui.kind} data-kind={props.kind}>
        <Icon name={props.icon} size={15} />
      </span>
      <span className={css.itemText}>
        <span className={css.itemTitle}>{props.title}</span>
        <span className={css.itemDesc}>{props.desc}</span>
      </span>
      <span className={css.grip} aria-hidden="true">
        ⋮⋮
      </span>
    </button>
  )
}

function SectionHead(props: {
  label: string
  open: boolean
  onToggle: () => void
  testId: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={css.sectionHead}>
      <button
        type="button"
        className={css.sectionToggle}
        aria-expanded={props.open}
        data-testid={props.testId}
        onClick={props.onToggle}
      >
        <Icon name="chevronDown" size={13} />
        <span>{props.label}</span>
      </button>
      {props.action}
    </div>
  )
}

export function Library(props: {
  t: T
  templates: readonly TemplateEntry[]
  focus: LibraryFocus | null
  onFocus: (focus: LibraryFocus) => void
  onNewStep: () => void
  onClose: () => void
}): React.JSX.Element {
  const { t, focus } = props
  const [hinting, setHinting] = useState(0)
  const [nudge, setNudge] = useState(0)
  const [collapsed, setCollapsed] = useState<Section[]>(readCollapsed)

  const toggle = (section: Section): void => {
    setCollapsed((current) => {
      const next = current.includes(section)
        ? current.filter((value) => value !== section)
        : [...current, section]
      writeCollapsed(next)
      return next
    })
  }
  const open = (section: Section): boolean => !collapsed.includes(section)

  return (
    <section className={cx(ui.panel, css.library)} aria-label={t('lib.title')}>
      <header className={css.head}>
        <span className={css.title}>{t('lib.title')}</span>
        {/* 换 key 重新挂载 = 重播一次高亮。 */}
        <span className={css.hint} data-flash={hinting > 0} key={hinting}>
          {t('lib.hint')}
        </span>
        <button
          type="button"
          className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
          data-tip={t('lib.collapse')}
          aria-label={t('lib.collapse')}
          onClick={props.onClose}
        >
          <Icon name="chevronLeft" size={15} />
        </button>
      </header>

      <div className={css.scroll}>
        {/* 空白步骤没有什么可看的：点它只提示"拖过去"。 */}
        <button
          type="button"
          className={css.item}
          draggable
          data-testid="wl-lib-blank"
          data-nudge={nudge === 0 ? undefined : nudge % 2}
          onDragStart={(event) => {
            event.dataTransfer.setData(DND_MIME, encodeStepSource({ kind: 'blank' }))
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => {
            setNudge((value) => value + 1)
            setHinting((value) => value + 1)
          }}
        >
          <span className={ui.kind} data-kind="blank">
            <Icon name="blank" size={15} />
          </span>
          <span className={css.itemText}>
            <span className={css.itemTitle}>{t('lib.blank')}</span>
            <span className={css.itemDesc}>{t('lib.blankDesc')}</span>
          </span>
          <span className={css.grip} aria-hidden="true">
            ⋮⋮
          </span>
        </button>

        {/* 文件卡：和空白步骤一样只能拖。拖到画布上是一张独立的文件卡，再连到步骤上。 */}
        <button
          type="button"
          className={css.item}
          draggable
          data-testid="wl-lib-file"
          onDragStart={(event) => {
            event.dataTransfer.setData(DND_MIME, encodeStepSource({ kind: 'file' }))
            event.dataTransfer.effectAllowed = 'copy'
          }}
          onClick={() => setHinting((value) => value + 1)}
        >
          <span className={cx(ui.kind, css.fileKind)}>
            <Icon name="file" size={15} />
          </span>
          <span className={css.itemText}>
            <span className={css.itemTitle}>{t('lib.file')}</span>
            <span className={css.itemDesc}>{t('lib.fileDesc')}</span>
          </span>
          <span className={css.grip} aria-hidden="true">
            ⋮⋮
          </span>
        </button>

        <SectionHead
          label={t('lib.builtin')}
          open={open('builtin')}
          testId="wl-lib-section-builtin"
          onToggle={() => toggle('builtin')}
        />
        {open('builtin') && (
          <div className={css.group}>
            {PRESETS.map((preset) => (
              <Item
                key={preset.id}
                source={{ kind: 'preset', id: preset.id }}
                icon={preset.kind}
                kind={preset.kind}
                title={t(preset.labelKey)}
                desc={t(preset.descKey)}
                active={focus?.kind === 'preset' && focus.id === preset.id}
                testId={`wl-lib-preset-${preset.id}`}
                onClick={() => props.onFocus({ kind: 'preset', id: preset.id })}
              />
            ))}
          </div>
        )}

        <SectionHead
          label={t('lib.custom')}
          open={open('custom')}
          testId="wl-lib-section-custom"
          onToggle={() => toggle('custom')}
          action={
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small, ui.tip, ui.tipEnd)}
              data-tip={t('lib.newCustom')}
              aria-label={t('lib.newCustom')}
              data-testid="wl-lib-new"
              data-on={focus?.kind === 'new'}
              onClick={props.onNewStep}
            >
              <Icon name="plus" size={15} />
            </button>
          }
        />
        {open('custom') && (
          <div className={css.group}>
            {props.templates.length === 0 ? (
              <p className={css.emptyNote}>{t('lib.customEmpty')}</p>
            ) : (
              props.templates.map((entry) => (
                <Item
                  key={entry.name}
                  source={{ kind: 'template', name: entry.name }}
                  icon="bookmark"
                  kind="blank"
                  title={entry.name}
                  desc={
                    entry.invalid === true
                      ? (entry.reason ?? t('lib.broken'))
                      : (entry.description ?? t('lib.noDescription'))
                  }
                  active={focus?.kind === 'template' && focus.name === entry.name}
                  draggable={entry.invalid !== true}
                  testId={`wl-lib-template-${entry.name}`}
                  onClick={() => props.onFocus({ kind: 'template', name: entry.name })}
                />
              ))
            )}
          </div>
        )}
      </div>
    </section>
  )
}
