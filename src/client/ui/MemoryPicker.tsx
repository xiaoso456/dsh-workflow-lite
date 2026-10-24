/**
 * dsh-workflow-lite — 加记忆时弹出的小菜单：第一行「新建一条」，下面是记忆库里同类型的记忆（名称、几个工作流在用）。
 *
 * 选了已有的就引用它；新建由调用方去建（id 按工作流名、步骤取默认的）。库里没有同类型的时候调用方不弹它，直接新建。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/MemoryPicker
 */

import { useEffect, useRef } from 'react'
import { type MemoryEntry, memoryTitle } from '../../shared/memoryLib.ts'
import { idKey } from '../../shared/model.ts'
import type { MemoryType } from '../../shared/types.ts'
import type { T } from '../i18n.ts'
import { Icon } from './Icon.tsx'
import mem from './memory.module.css'
import { cx } from './primitives.tsx'
import ui from './ui.module.css'

/** 菜单宽度（贴着锚点弹出时据此让开右边）。 */
export const MEMORY_PICKER_W = 300

/** 「N 个工作流在用」/「没被用」。 */
export function usedByText(t: T, entry: MemoryEntry): string {
  return entry.usedBy.length === 0
    ? t('mem.unused')
    : t('mem.usedBy').replace('{n}', String(entry.usedBy.length))
}

export function MemoryPicker(props: {
  t: T
  /** 弹出的位置；`width` 给了就按它的宽度（和锚点那一块一样宽），不给是 {@link MEMORY_PICKER_W}。 */
  at: { x: number; y: number; width?: number }
  type: MemoryType
  /** 同类型的记忆（已按名称排好）。 */
  entries: readonly MemoryEntry[]
  /** 换一条时现在引用的那条：标成选中。 */
  current?: string
  busy: boolean
  onPick(entry: MemoryEntry): void
  onCreate(): void
  onClose(): void
}): React.JSX.Element {
  const { t } = props
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (event: PointerEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) props.onClose()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') props.onClose()
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [props.onClose])
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus()
  }, [])
  const step = props.type === 'step'
  return (
    <div
      ref={ref}
      className={cx(ui.panel, mem.picker, ui.stagger)}
      style={{ left: props.at.x, top: props.at.y, width: props.at.width ?? MEMORY_PICKER_W }}
      role="menu"
      aria-label={t(step ? 'mem.pick.step' : 'mem.pick.workflow')}
      data-testid="wl-memory-picker"
    >
      <p className={ui.menuTitle}>{t(step ? 'mem.pick.step' : 'mem.pick.workflow')}</p>
      <button
        type="button"
        role="menuitem"
        className={ui.menuItem}
        disabled={props.busy}
        data-testid="wl-memory-new"
        onClick={props.onCreate}
      >
        <Icon name="plus" size={14} />
        <span className={ui.menuLabel}>
          {t(step ? 'mem.pick.newStep' : 'mem.pick.newWorkflow')}
        </span>
      </button>
      <div className={ui.menuSep} />
      <div className={mem.pickList}>
        {props.entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="menuitemradio"
            aria-checked={props.current !== undefined && idKey(props.current) === idKey(entry.id)}
            className={ui.menuItem}
            data-active={props.current !== undefined && idKey(props.current) === idKey(entry.id)}
            disabled={props.busy}
            data-testid="wl-memory-option"
            data-memory-id={entry.id}
            {...(entry.description.trim() === '' ? {} : { 'data-tip': entry.description })}
            onClick={() => props.onPick(entry)}
          >
            <Icon name="memory" size={14} />
            <span className={ui.menuLabel}>{memoryTitle(entry)}</span>
            <span className={cx(ui.menuMeta, mem.pickMeta)}>{usedByText(t, entry)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
