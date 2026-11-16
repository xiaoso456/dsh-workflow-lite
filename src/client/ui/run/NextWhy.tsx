/**
 * dsh-workflow-lite — 下一步为什么是它：从头开始、改回待执行、用户指定的，或者接在哪一步后面（循环回来的带个圈）。
 *
 * 画布实例视图的「执行位置」和工作流中心「运行实例」页的「现在」共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/run/NextWhy
 */

import type { NextStep } from '../../../shared/runCursor.ts'
import type { T } from '../../i18n.ts'
import { Icon } from '../kit/Icon.tsx'

export function NextWhy(props: {
  t: T
  step: NextStep
  nameOf(id: string): string
}): React.JSX.Element {
  const { t, step } = props
  if (step.reason === 'start') return <>{t('run.nextStart')}</>
  if (step.reason === 'reset') return <>{t('run.nextReset')}</>
  if (step.reason === 'pinned') {
    return (
      <>
        <Icon name="flag" size={12} />
        {t('run.nextPinned')}
      </>
    )
  }
  const from = props.nameOf(step.from ?? '')
  if (step.loop !== true) return <>{t('run.nextFrom').replace('{step}', from)}</>
  return (
    <>
      <Icon name="loop" size={12} />
      {t('run.nextLoop').replace('{step}', from)}
    </>
  )
}
