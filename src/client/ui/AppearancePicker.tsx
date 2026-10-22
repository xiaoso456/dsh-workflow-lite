/**
 * dsh-workflow-lite — 选图标与颜色：点面板标题左边的图标块，弹出色板与图标库。
 *
 * {@link LookPicker} 是那块浮层本身：上面一排颜色，下面一格格图标（悬停看名字）。
 * - 步骤（{@link AppearancePicker}）：图标库里随便挑，画布上的步骤（属性面板）与「我的步骤」（步骤库详情）共用；
 * - 资源卡（`ResourcePresets.tsx`）：下面一格是一种类型（资源、记忆……），点了就换类型，换不了的置灰、悬停说原因。
 *
 * 选了就改，不用确认；「恢复默认」只清颜色和图标这类外观（步骤回到按 id 猜的样子，资源回到类型的颜色）。
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
import { Icon, type IconName } from './Icon.tsx'
import { PickThumb } from './motion.tsx'
import { cx, Popover } from './primitives.tsx'
import { StepMark } from './StepMark.tsx'
import ui from './ui.module.css'

/** 下面一格：一个值、画哪个图标；`tip` 是悬停的字，`disabled` 是点不了（`tip` 里写原因）。 */
export interface LookIcon<V extends string> {
  value: V
  icon: IconName
  tip?: string
  disabled?: boolean
}

export function LookPicker<V extends string>(props: {
  t: T
  /** 浮层标题、图标那一组的小标题、触发块悬停的字。 */
  title: string
  iconTitle: string
  change: string
  /** 触发块里画的东西（步骤 / 资源的图标块）。 */
  mark: React.ReactNode
  color: StepColor
  icon: V
  icons: readonly LookIcon<V>[]
  /** 存了外观（不是默认的）：才有「恢复默认」。 */
  custom: boolean
  /** 触发块的 testid；颜色 `${testId}-color-<色>`、图标 `${testId}-icon-<值>`、恢复默认 `${testId}-reset`。 */
  testId: string
  onColor(color: StepColor): void
  onIcon(icon: V): void
  onReset(): void
}): React.JSX.Element {
  const { t } = props
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      label={props.title}
      className={css.pop}
      trigger={
        <button
          type="button"
          className={css.trigger}
          data-tip={props.change}
          aria-label={props.change}
          aria-expanded={open}
          data-testid={props.testId}
          onClick={() => setOpen(!open)}
        >
          {props.mark}
          <span className={css.badge} aria-hidden="true">
            <Icon name="palette" size={9} />
          </span>
        </button>
      }
    >
      <div className={css.head}>
        <span className={css.title}>{props.title}</span>
        {props.custom && (
          <button
            type="button"
            className={cx(ui.btn, ui.small, css.reset)}
            data-testid={`${props.testId}-reset`}
            onClick={props.onReset}
          >
            {t('look.reset')}
          </button>
        )}
      </div>
      <p className={css.group}>{t('look.color')}</p>
      <div className={css.colors} role="radiogroup" aria-label={t('look.color')}>
        {/* 选中的一圈环：滑到新选的颜色，环的颜色跟着交叉淡过去。 */}
        <PickThumb
          layout={props.color}
          className={css.ring}
          tone={{ list: STEP_COLORS, on: props.color, attr: 'data-color', className: css.ringTone }}
        />
        {STEP_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={props.color === color}
            className={css.swatch}
            data-color={color}
            data-tip={t(`look.c.${color}` as LocaleKey)}
            aria-label={t(`look.c.${color}` as LocaleKey)}
            data-testid={`${props.testId}-color-${color}`}
            onClick={() => props.onColor(color)}
          >
            <Icon name="check" size={12} />
          </button>
        ))}
      </div>
      <p className={css.group}>{props.iconTitle}</p>
      <div
        className={css.icons}
        role="radiogroup"
        aria-label={props.iconTitle}
        data-color={props.color}
      >
        {/* 选中图标的浅色底：滑到新选的图标；换颜色时底色交叉淡过去。 */}
        <PickThumb
          layout={props.icon}
          className={css.iconThumb}
          tone={{ list: STEP_COLORS, on: props.color, attr: 'data-color', className: css.iconTone }}
        />
        {props.icons.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={props.icon === item.value}
            aria-disabled={item.disabled === true ? true : undefined}
            aria-label={item.tip ?? item.value}
            data-tip={item.tip}
            className={css.icon}
            data-testid={`${props.testId}-icon-${item.value}`}
            onClick={() => {
              if (item.disabled !== true) props.onIcon(item.value)
            }}
          >
            <span className={css.glyph} data-pick-pop="">
              <Icon name={item.icon} size={16} />
            </span>
          </button>
        ))}
      </div>
    </Popover>
  )
}

/** `undefined` = 清掉这一项（回到按 id 猜）。 */
export interface AppearancePatch {
  icon?: StepIcon | undefined
  color?: StepColor | undefined
}

const STEP_ICON_ITEMS: readonly LookIcon<StepIcon>[] = STEP_ICONS.map((icon) => ({
  value: icon,
  icon,
}))

/** 步骤的图标与颜色。 */
export function AppearancePicker(props: {
  t: T
  look: Appearance
  /** 存了样子（不是猜的）：才有「恢复默认」。 */
  custom: boolean
  size?: number
  onChange(patch: AppearancePatch): void
}): React.JSX.Element {
  const { t, look } = props
  return (
    <LookPicker
      t={t}
      title={t('look.title')}
      iconTitle={t('look.icon')}
      change={t('look.change')}
      mark={<StepMark look={look} size={props.size ?? 16} />}
      color={look.color}
      icon={look.icon}
      icons={STEP_ICON_ITEMS}
      custom={props.custom}
      testId="wl-look"
      onColor={(color) => props.onChange({ color })}
      onIcon={(icon) => props.onChange({ icon })}
      onReset={() => props.onChange({ icon: undefined, color: undefined })}
    />
  )
}
