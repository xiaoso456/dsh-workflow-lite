/**
 * dsh-workflow-lite — 连接清单的一行（模板的属性面板与实例的右栏共用）。
 *
 * 上面一行：方向箭头、对面那一步的图标与名字、回头线的环、条件小标，行尾可放一样东西
 * （实例里是对面那一步的状态）；下面一行是这条线交了什么。整行点下去选中这条线。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/editor/LinkRow
 */

import { edgeWhen } from '../../../shared/graph.ts'
import { isStep } from '../../../shared/model.ts'
import type { WorkflowEdge, WorkflowNode } from '../../../shared/types.ts'
import type { T } from '../../i18n.ts'
import { whenKind } from '../../model/whenKind.ts'
import { Icon } from '../kit/Icon.tsx'
import { stepName } from '../kit/resourceUi.ts'
import { lookOf, StepMark } from '../kit/StepMark.tsx'
import { HandoffChip } from './Handoff.tsx'
import css from './linkrow.module.css'

/** 条件的小标（和画布上那条线同色）；`always` 时只有要求才画。 */
export function WhenChip(props: {
  t: T
  when: string | undefined
  always?: boolean
}): React.JSX.Element | null {
  const { t, when } = props
  if (when === undefined) {
    return props.always === true ? (
      <span className={css.whenChip} data-when="always">
        {t('edge.always')}
      </span>
    ) : null
  }
  return (
    <span className={css.whenChip} data-when={whenKind(when)} data-tip={when}>
      {when === 'pass' ? t('edge.pass') : when === 'fail' ? t('edge.fail') : when}
    </span>
  )
}

export function LinkRow(props: {
  t: T
  edge: WorkflowEdge
  direction: 'in' | 'out'
  /** 对面那个节点（找不到时按 id 显示）。 */
  other: WorkflowNode | undefined
  otherId: string
  back: boolean
  /** 这次走过没有（实例里）；不给 = 不表态。 */
  taken?: boolean | undefined
  takenLabel?: string | undefined
  end?: React.ReactNode
  testId: string
  onPick(): void
}): React.JSX.Element {
  const { t, edge, other } = props
  const data = other !== undefined && isStep(other) ? other.data : undefined
  return (
    <button
      type="button"
      className={css.row}
      data-testid={props.testId}
      data-id={edge.id}
      data-taken={props.taken}
      data-tip={props.takenLabel}
      onClick={props.onPick}
    >
      <span className={css.lead}>
        <span className={css.dir} data-in={props.direction === 'in'} data-taken={props.taken}>
          <Icon name="arrowRight" size={12} />
        </span>
        <StepMark look={lookOf(props.otherId, data)} size={13} />
      </span>
      <span className={css.name}>
        <span className={css.nameText}>{stepName(other, props.otherId)}</span>
        {props.back && <Icon name="loop" size={12} />}
        <WhenChip t={t} when={edgeWhen(edge)} />
      </span>
      <span className={css.end}>{props.end}</span>
      <span className={css.sub}>
        <HandoffChip t={t} edge={edge} />
      </span>
    </button>
  )
}
