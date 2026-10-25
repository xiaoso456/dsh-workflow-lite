/**
 * dsh-workflow-lite — 就地添加步骤的小菜单。
 *
 * 三个入口共用它：右键点画布空白处、点步骤右侧的「＋」、把连线拖到空白处松手。
 * 后两种会把新步骤顺手连在来源后面。从步骤出发时前两项是「产出文件」（放着这一步写的文件的资源卡）和
 * 「用户输入」（执行前问用户、回答交给这一步）；从资源卡、输入卡拖出来时只列步骤（新步骤读它）；
 * 在空白处还能放一张空的资源卡或输入卡。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/QuickAdd
 */

import { useLayoutEffect, useState } from 'react'
import { appearanceOf, presetAppearance } from '../../shared/appearance.ts'
import type { TemplateEntry } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { PRESETS, type StepSource } from '../model/library.ts'
import { Icon } from './Icon.tsx'
import { useExit } from './motion.tsx'
import css from './overlay.module.css'
import { cx, useDismiss } from './primitives.tsx'
import { StepMark } from './StepMark.tsx'
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
  /** 从哪儿来：步骤的「＋」/ 资源卡、输入卡拖出来的线 / 空白处。 */
  origin: 'step' | 'resource' | 'input' | 'none'
  /** 列出「记忆」：从步骤来是给它开记忆（已经开着就不列），从空白处来是全局记忆。实例视图里不给。 */
  memory?: boolean
  onPick(source: StepSource): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  // 关掉（选了一项、Esc、点别处）时原地缩回、淡出。
  const ref = useExit<HTMLDivElement>('shrink')
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
      {props.origin === 'step' && (
        <>
          <button
            type="button"
            role="menuitem"
            className={ui.menuItem}
            data-testid="wl-quick-output"
            onClick={() => props.onPick({ kind: 'resource' })}
          >
            <span className={cx(ui.kind, css.quickKind, css.quickFile)}>
              <Icon name="file" size={13} />
            </span>
            <span className={cx(ui.menuLabel, css.quickLabel)}>{t('quick.output')}</span>
            <span className={cx(ui.menuMeta, css.quickMeta)}>{t('quick.outputDesc')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            className={ui.menuItem}
            data-testid="wl-quick-input"
            onClick={() => props.onPick({ kind: 'input' })}
          >
            <span className={cx(ui.kind, css.quickKind, css.quickInput)}>
              <Icon name="ask" size={13} />
            </span>
            <span className={cx(ui.menuLabel, css.quickLabel)}>{t('quick.input')}</span>
            <span className={cx(ui.menuMeta, css.quickMeta)}>{t('quick.inputDesc')}</span>
          </button>
          {props.memory === true && (
            <button
              type="button"
              role="menuitem"
              className={ui.menuItem}
              data-testid="wl-quick-memory"
              onClick={() => props.onPick({ kind: 'memory' })}
            >
              <span className={cx(ui.kind, css.quickKind, css.quickMemory)}>
                <Icon name="memory" size={13} />
              </span>
              <span className={cx(ui.menuLabel, css.quickLabel)}>{t('quick.memory')}</span>
              <span className={cx(ui.menuMeta, css.quickMeta)}>{t('quick.memoryDesc')}</span>
            </button>
          )}
          <div className={ui.menuSep} />
        </>
      )}
      <button
        type="button"
        role="menuitem"
        className={ui.menuItem}
        data-testid="wl-quick-blank"
        onClick={() => props.onPick({ kind: 'blank' })}
      >
        <StepMark look={presetAppearance('blank')} size={13} className={css.quickKind} />
        <span className={cx(ui.menuLabel, css.quickLabel)}>{t('lib.blank')}</span>
      </button>
      {props.origin === 'none' && (
        <button
          type="button"
          role="menuitem"
          className={ui.menuItem}
          data-testid="wl-quick-resource"
          onClick={() => props.onPick({ kind: 'resource' })}
        >
          <span className={cx(ui.kind, css.quickKind, css.quickFile)}>
            <Icon name="layers" size={13} />
          </span>
          <span className={cx(ui.menuLabel, css.quickLabel)}>{t('quick.resource')}</span>
          <span className={cx(ui.menuMeta, css.quickMeta)}>{t('quick.resourceDesc')}</span>
        </button>
      )}
      {props.origin === 'none' && (
        <button
          type="button"
          role="menuitem"
          className={ui.menuItem}
          data-testid="wl-quick-input"
          onClick={() => props.onPick({ kind: 'input' })}
        >
          <span className={cx(ui.kind, css.quickKind, css.quickInput)}>
            <Icon name="ask" size={13} />
          </span>
          <span className={cx(ui.menuLabel, css.quickLabel)}>{t('quick.looseInput')}</span>
          <span className={cx(ui.menuMeta, css.quickMeta)}>{t('quick.looseInputDesc')}</span>
        </button>
      )}
      {props.origin === 'none' && props.memory === true && (
        <button
          type="button"
          role="menuitem"
          className={ui.menuItem}
          data-testid="wl-quick-global-memory"
          onClick={() => props.onPick({ kind: 'memory' })}
        >
          <span className={cx(ui.kind, css.quickKind, css.quickMemory)}>
            <Icon name="memory" size={13} />
          </span>
          <span className={cx(ui.menuLabel, css.quickLabel)}>{t('quick.globalMemory')}</span>
          <span className={cx(ui.menuMeta, css.quickMeta)}>{t('quick.globalMemoryDesc')}</span>
        </button>
      )}
      {PRESETS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          role="menuitem"
          className={ui.menuItem}
          data-testid={`wl-quick-${preset.id}`}
          onClick={() => props.onPick({ kind: 'preset', id: preset.id })}
        >
          <StepMark look={presetAppearance(preset.id)} size={13} className={css.quickKind} />
          <span className={cx(ui.menuLabel, css.quickLabel)}>{t(preset.labelKey)}</span>
          <span className={cx(ui.menuMeta, css.quickMeta)}>{t(preset.descKey)}</span>
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
          {entry.icon === undefined && entry.color === undefined ? (
            <span className={cx(ui.kind, css.quickKind)}>
              <Icon name="bookmark" size={13} />
            </span>
          ) : (
            <StepMark look={appearanceOf(entry.name, entry)} size={13} className={css.quickKind} />
          )}
          <span className={cx(ui.menuLabel, css.quickLabel)}>{entry.name}</span>
        </button>
      ))}
    </div>
  )
}
