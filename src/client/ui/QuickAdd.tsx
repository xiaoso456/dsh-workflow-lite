/**
 * dsh-workflow-lite — 就地添加步骤的小菜单。
 *
 * 三个入口共用它：双击画布空白处、点步骤右侧的「＋」、把连线拖到空白处松手。
 * 后两种会把新步骤顺手连在来源步骤后面。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/QuickAdd
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { TemplateEntry } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { PRESETS, type StepSource } from '../model/library.ts'
import { Icon } from './Icon.tsx'
import css from './overlay.module.css'
import { cx, useDismiss } from './primitives.tsx'
import ui from './ui.module.css'

/** 菜单的估算尺寸：用来在贴边时往回收，别伸出视图外。 */
const MENU_W = 260
const MENU_H = 380

export function QuickAdd(props: {
  t: T
  /** 相对视图根的坐标。 */
  at: { x: number; y: number }
  bounds: { width: number; height: number }
  templates: readonly TemplateEntry[]
  onPick(source: StepSource): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(true, ref, props.onClose)
  // 先按估算高度摆，挂上之后量一次真实高度再往回收（模板多少不定）。
  const [height, setHeight] = useState(MENU_H)

  useLayoutEffect(() => {
    const element = ref.current
    if (element === null) return
    setHeight(element.offsetHeight)
    element.querySelector<HTMLButtonElement>('button')?.focus()
  }, [])

  const left = Math.max(8, Math.min(props.at.x, props.bounds.width - MENU_W - 8))
  const top = Math.max(8, Math.min(props.at.y, props.bounds.height - height - 8))
  const templates = props.templates.filter((entry) => entry.invalid !== true)

  const move = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      props.onClose()
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1
    items[(next + items.length) % items.length]?.focus()
  }

  return (
    <div
      ref={ref}
      className={cx(ui.panel, css.quick)}
      style={{ left, top }}
      role="menu"
      aria-label={t('quick.title')}
      data-testid="wl-quick-add"
      onKeyDown={move}
    >
      <p className={ui.menuTitle}>{t('quick.title')}</p>
      <button
        type="button"
        role="menuitem"
        className={ui.menuItem}
        data-testid="wl-quick-blank"
        onClick={() => props.onPick({ kind: 'blank' })}
      >
        <span className={cx(ui.kind, css.quickKind)} data-kind="blank">
          <Icon name="blank" size={13} />
        </span>
        <span className={ui.menuLabel}>{t('lib.blank')}</span>
      </button>
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          role="menuitem"
          className={ui.menuItem}
          data-testid={`wl-quick-${preset.id}`}
          onClick={() => props.onPick({ kind: 'preset', id: preset.id })}
        >
          <span className={cx(ui.kind, css.quickKind)} data-kind={preset.kind}>
            <Icon name={preset.kind} size={13} />
          </span>
          <span className={ui.menuLabel}>{t(preset.labelKey)}</span>
          <span className={ui.menuMeta}>{t(preset.descKey)}</span>
        </button>
      ))}
      {templates.length > 0 && <div className={ui.menuSep} />}
      {templates.map((entry) => (
        <button
          key={entry.name}
          type="button"
          role="menuitem"
          className={ui.menuItem}
          onClick={() => props.onPick({ kind: 'template', name: entry.name })}
        >
          <span className={cx(ui.kind, css.quickKind)} data-kind="blank">
            <Icon name="bookmark" size={13} />
          </span>
          <span className={ui.menuLabel}>{entry.name}</span>
        </button>
      ))}
    </div>
  )
}
