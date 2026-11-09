/**
 * dsh-workflow-lite — 连接清单里一条步骤间的线交了什么：交执行结果 / 交接说明 / 只管先后。
 *
 * 属性面板（模板）与实例右栏的连接清单（{@link LinkRow}）共用；交接开关本身在 `editor/Handoff.tsx`。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/panel/HandoffChip
 */

import { resolveHandoff } from '../../../shared/resources.ts'
import type { WorkflowEdge } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import css from './handoffChip.module.css'

/** 一条步骤间的线交了什么（属性面板的连接清单里用）。 */
export function HandoffChip(props: { t: T; edge: WorkflowEdge }): React.JSX.Element {
  const { t } = props
  const handoff = resolveHandoff(props.edge.data?.handoff)
  if (!handoff.result) {
    return <span className={cx(css.chip, css.chipMuted)}>{t('hand.flowOnly')}</span>
  }
  return (
    <span className={css.chips}>
      <span className={css.chip} data-result="true">
        <Icon name="result" size={11} />
        <span className={css.chipText}>{t('hand.resultShort')}</span>
      </span>
      {handoff.note !== undefined && (
        <span className={css.chip} data-tip={handoff.note}>
          <Icon name="pencil" size={11} />
          <span className={css.chipText}>{handoff.note}</span>
        </span>
      )}
    </span>
  )
}
