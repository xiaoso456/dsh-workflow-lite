/**
 * dsh-workflow-lite — 色板一排：九个色点，选中的外面一圈环（换颜色时滑过去、环色交叉淡过去），点了就换。
 *
 * 步骤、资源卡的「图标与颜色」浮层（{@link LookPicker}）和工作流标签的颜色菜单共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/panel/ColorSwatches
 */

import { STEP_COLORS, type StepColor } from '../../../shared/appearance.ts'
import type { LocaleKey, T } from '../../i18n.ts'
import { Icon } from '../kit/Icon.tsx'
import { PickThumb } from '../motion/thumb.tsx'
import css from './appearance.module.css'

export function ColorSwatches(props: {
  t: T
  value: StepColor
  /** 每个色点 `${testId}-<色>`。 */
  testId: string
  onPick(color: StepColor): void
}): React.JSX.Element {
  const { t } = props
  return (
    <div className={css.colors} role="radiogroup" aria-label={t('look.color')}>
      <PickThumb
        layout={props.value}
        className={css.ring}
        tone={{ list: STEP_COLORS, on: props.value, attr: 'data-color', className: css.ringTone }}
      />
      {STEP_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={props.value === color}
          className={css.swatch}
          data-color={color}
          data-tip={t(`look.c.${color}` as LocaleKey)}
          aria-label={t(`look.c.${color}` as LocaleKey)}
          data-testid={`${props.testId}-${color}`}
          onClick={() => props.onPick(color)}
        >
          <Icon name="check" size={12} />
        </button>
      ))}
    </div>
  )
}
