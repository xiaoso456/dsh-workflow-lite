/**
 * dsh-workflow-lite — 「触发方式」卡头的触发方式按钮：「定时 ▾」，点开一张菜单，每种方式带图标、主动 / 被动和一句说明。
 *
 * 选了直接换（交给调用方改图，能撤销），不弹对话框；详细设置点卡头的「编辑」。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/KindMenu
 */

import { useRef, useState } from 'react'
import type { TriggerSourceKind } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import { triggerMode } from '../../model/triggerGlance.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import { Popover } from '../kit/Popover.tsx'
import ui from '../kit/ui.module.css'
import { useRadioMenu } from '../kit/useRadioMenu.ts'
import { KIND_DESC, SOURCE_KINDS } from './source/kinds.ts'
import { TriggerMark } from './TriggerMark.tsx'
import css from './whenCard.module.css'

export function KindMenu(props: {
  t: T
  value: TriggerSourceKind
  onPick(kind: TriggerSourceKind): void
}): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const onKeyDown = useRadioMenu(open, list)
  const close = (): void => {
    setOpen(false)
    trigger.current?.focus()
  }
  const current = SOURCE_KINDS.find((kind) => kind.value === props.value)
  const name = current === undefined ? '' : t(current.label)
  return (
    <Popover
      open={open}
      onClose={close}
      label={t('trigger.pickKind')}
      className={css.menu}
      trigger={
        <button
          ref={trigger}
          type="button"
          className={css.kind}
          aria-label={`${t('trigger.pickKind')}: ${name}`}
          aria-haspopup="menu"
          aria-expanded={open}
          data-open={open || undefined}
          data-testid="wl-trigger-pick"
          onClick={() => setOpen(!open)}
        >
          {name}
          <span className={css.chevron} aria-hidden="true">
            <Icon name="chevronDown" size={13} />
          </span>
        </button>
      }
    >
      <div ref={list} role="menu" aria-label={t('trigger.pickKind')} onKeyDown={onKeyDown}>
        {SOURCE_KINDS.map((kind) => {
          const on = kind.value === props.value
          const mode = triggerMode(kind.value)
          return (
            <button
              key={kind.value}
              type="button"
              role="menuitemradio"
              aria-checked={on}
              className={cx(ui.menuItem, css.item)}
              data-active={on}
              data-testid={`wl-trigger-pick-${kind.value}`}
              onClick={() => {
                if (!on) props.onPick(kind.value)
                close()
              }}
            >
              <TriggerMark kind={kind.value} size={14} />
              <span className={css.itemText}>
                <span className={css.itemName}>
                  {t(kind.label)}
                  <span className={css.itemMode}>
                    {t(mode === 'active' ? 'trigger.mode.active' : 'trigger.mode.passive')}
                  </span>
                </span>
                <span className={css.itemDesc}>{t(KIND_DESC[kind.value])}</span>
              </span>
              <span className={css.check} aria-hidden="true">
                <Icon name="check" size={13} />
              </span>
            </button>
          )
        })}
      </div>
    </Popover>
  )
}
