/**
 * dsh-workflow-lite — 一句话描述的输入框（步骤、资源卡、步骤库条目共用）。
 *
 * 属性面板（`Inspector`）、步骤面板（`StepPanel`）、资源面板（`resources/ResourcePanel`）都要放它，
 * 单独成文件，让资源面板不必回头 import 属性面板。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/panel/DescriptionField
 */

import { MAX_TEXT_CODEPOINTS } from '../../../shared/limits.ts'
import { checkText } from '../../../shared/naming.ts'
import type { T } from '../../i18n.ts'
import ui from '../kit/ui.module.css'
import { Presence } from '../motion/exits.tsx'
import css from './panel.module.css'

/** 一句话描述（给人看：步骤库条目、画布卡片），不进计划。 */
export function DescriptionField(props: {
  t: T
  value: string
  /** 缺省是步骤、资源卡那句占位。 */
  placeholder?: string
  onChange(value: string): void
  onBlur?: () => void
}): React.JSX.Element {
  const { t } = props
  const problem = checkText(props.value, t('ins.description'))
  return (
    <section className={css.field}>
      <div className={css.label}>
        <span>{t('ins.description')}</span>
      </div>
      <input
        className={ui.input}
        value={props.value}
        placeholder={props.placeholder ?? t('ins.descriptionPlaceholder')}
        aria-label={t('ins.description')}
        aria-invalid={problem !== null}
        maxLength={MAX_TEXT_CODEPOINTS}
        data-testid="wl-description"
        // 描述是一行字：换行直接不让打进来。
        onChange={(event) => props.onChange(event.currentTarget.value.replace(/[\r\n]+/gu, ' '))}
        onBlur={props.onBlur}
      />
      <Presence show={problem !== null}>
        {problem !== null && <p className={css.error}>{problem.message}</p>}
      </Presence>
    </section>
  )
}
