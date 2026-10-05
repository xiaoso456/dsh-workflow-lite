/**
 * dsh-workflow-lite — 选步骤的图标与颜色：点面板标题左边的图标块，弹出色板与图标库。
 *
 * 画布上的步骤（属性面板）与「我的步骤」（步骤库详情）共用。选了就改，不用确认；
 * 「恢复默认」清掉两项，回到按 id 猜的样子。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/AppearancePicker
 */

import { useState } from 'react'
import {
  type Appearance,
  STEP_COLORS,
  STEP_ICONS,
  type StepColor,
  type StepIcon,
} from '../../shared/appearance.ts'
import type { LocaleKey, T } from '../i18n.ts'
import css from './appearance.module.css'
import { Icon } from './Icon.tsx'
import { cx, Popover } from './primitives.tsx'
import { StepMark } from './StepMark.tsx'
import ui from './ui.module.css'

/** `undefined` = 清掉这一项（回到按 id 猜）。 */
export interface AppearancePatch {
  icon?: StepIcon | undefined
  color?: StepColor | undefined
}

export function AppearancePicker(props: {
  t: T
  look: Appearance
  /** 存了样子（不是猜的）：才有「恢复默认」。 */
  custom: boolean
  size?: number
  onChange(patch: AppearancePatch): void
}): React.JSX.Element {
  const { t, look } = props
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={t('look.title')}
      className={css.pop}
      trigger={
        <button
          type="button"
          className={css.trigger}
          data-tip={t('look.change')}
          aria-label={t('look.change')}
          aria-expanded={open}
          data-testid="wl-look"
          onClick={() => setOpen(!open)}
        >
          <StepMark look={look} size={props.size ?? 16} />
          <span className={css.badge} aria-hidden="true">
            <Icon name="palette" size={9} />
          </span>
        </button>
      }
    >
      <div className={css.head}>
        <span className={css.title}>{t('look.title')}</span>
        {props.custom && (
          <button
            type="button"
            className={cx(ui.btn, ui.small, css.reset)}
            data-testid="wl-look-reset"
            onClick={() => props.onChange({ icon: undefined, color: undefined })}
          >
            {t('look.reset')}
          </button>
        )}
      </div>
      <p className={css.group}>{t('look.color')}</p>
      <div className={css.colors} role="radiogroup" aria-label={t('look.color')}>
        {STEP_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={look.color === color}
            className={css.swatch}
            data-color={color}
            data-tip={t(`look.c.${color}` as LocaleKey)}
            aria-label={t(`look.c.${color}` as LocaleKey)}
            data-testid={`wl-look-color-${color}`}
            onClick={() => props.onChange({ color })}
          >
            <Icon name="check" size={12} />
          </button>
        ))}
      </div>
      <p className={css.group}>{t('look.icon')}</p>
      <div
        className={css.icons}
        role="radiogroup"
        aria-label={t('look.icon')}
        data-color={look.color}
      >
        {STEP_ICONS.map((icon) => (
          <button
            key={icon}
            type="button"
            role="radio"
            aria-checked={look.icon === icon}
            aria-label={icon}
            className={css.icon}
            data-testid={`wl-look-icon-${icon}`}
            onClick={() => props.onChange({ icon })}
          >
            <Icon name={icon} size={16} />
          </button>
        ))}
      </div>
    </Popover>
  )
}
