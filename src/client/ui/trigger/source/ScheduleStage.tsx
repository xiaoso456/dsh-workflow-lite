/**
 * dsh-workflow-lite — 「触发方式」对话框里定时的设置：设置行是规则表单（`ScheduleField`：规则、这种规则的常用、规则自己的几行），
 * 工作台是接下来 7 天的时间轴，底栏写下一次和 7 天内还要执行几次。
 *
 * 时间轴每换一次要重排上百个点：规则连着在变（数字框上连滚、按住 + 连着走）时等停下了只排一次，
 * 单独改一下（点常用、滚一格）当场跟上（{@link useSettled} 的 `leading`）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/ScheduleStage
 */

import { scheduleIssue } from '../../../../shared/schedule.ts'
import type { TriggerSchedule } from '../../../../shared/types.ts'
import { useSettled } from '../../../app/useSettled.ts'
import type { T } from '../../../i18n.ts'
import { zoneText } from '../../../model/triggerUpcoming.ts'
import { weekOf } from '../../../model/triggerWeek.ts'
import { SwapText } from '../../motion/swapText.tsx'
import { ScheduleField } from '../ScheduleField.tsx'
import { Bench, benchAside } from './Bench.tsx'
import { StageRows } from './StageRow.tsx'
import { WeekStrip } from './WeekStrip.tsx'

/** 规则停下多久之后时间轴才跟上（连滚时一格大约隔 50–100ms）。 */
const WEEK_SETTLE_MS = 250

export function ScheduleStage(props: {
  t: T
  schedule: TriggerSchedule
  /** 卡片开着时宿主排好的下一次。 */
  live?: number | undefined
  onChange(schedule: TriggerSchedule): void
}): React.JSX.Element {
  const { t } = props
  /** 时间轴照着排的规则：连着在变时等停下。 */
  const schedule = useSettled(props.schedule, WEEK_SETTLE_MS, { leading: true })
  const now = Date.now()
  const week = weekOf(schedule, now, props.live)
  const valid = scheduleIssue(schedule) === null
  return (
    <>
      <StageRows>
        <ScheduleField t={t} schedule={props.schedule} onChange={props.onChange} />
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
