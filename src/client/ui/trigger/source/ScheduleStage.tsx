/**
 * dsh-workflow-lite — 「触发方式」对话框里定时的设置：设置行是规则表单（`ScheduleField`：规则、这种规则的常用、规则自己的几行），
 * 工作台是接下来 7 天的时间轴，底栏写下一次和 7 天内还要执行几次。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/ScheduleStage
 */

import { scheduleIssue } from '../../../../shared/schedule.ts'
import type { TriggerSchedule } from '../../../../shared/types.ts'
import type { T } from '../../../i18n.ts'
import { zoneText } from '../../../model/triggerUpcoming.ts'
import { weekOf } from '../../../model/triggerWeek.ts'
import { SwapText } from '../../motion/swapText.tsx'
import { ScheduleField } from '../ScheduleField.tsx'
import { Bench, benchAside } from './Bench.tsx'
import { StageRows } from './StageRow.tsx'
import { WeekStrip } from './WeekStrip.tsx'

export function ScheduleStage(props: {
  t: T
  schedule: TriggerSchedule
  /** 卡片开着时宿主排好的下一次。 */
  live?: number | undefined
  onChange(schedule: TriggerSchedule): void
}): React.JSX.Element {
  const { t, schedule } = props
  const now = Date.now()
  const week = weekOf(schedule, now, props.live)
  const valid = scheduleIssue(schedule) === null
  return (
    <>
      <StageRows>
        <ScheduleField t={t} schedule={schedule} onChange={props.onChange} />
      </StageRows>
      <Bench
        icon="clock"
        title={t('trigger.week')}
        tools={
          <span className={benchAside}>
            <SwapText
              text={[
                valid ? t('trigger.week.total').replace('{n}', String(week.upcoming)) : '',
                t('trigger.upcoming.zone').replace('{zone}', zoneText(now)),
              ]
                .filter((part) => part !== '')
                .join(' · ')}
            />
          </span>
        }
      >
        <WeekStrip t={t} week={week} valid={valid} />
      </Bench>
    </>
  )
}
