/**
 * dsh-workflow-lite — 「触发方式」对话框里定时的设置：设置行是一排常用规则（点一下整条换掉）和规则表单（`ScheduleField`），
 * 工作台是接下来 7 天的时间轴，底栏写下一次和 7 天内还要执行几次。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/ScheduleStage
 */

import { scheduleIssue } from '../../../../shared/schedule.ts'
import type { TriggerSchedule } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { zoneText } from '../../../model/triggerUpcoming.ts'
import { weekOf } from '../../../model/triggerWeek.ts'
import { Icon } from '../../kit/Icon.tsx'
import { ScheduleField } from '../ScheduleField.tsx'
import { Bench, benchAside } from './Bench.tsx'
import presets from './presets.module.css'
import { StageRow, StageRows } from './StageRow.tsx'
import stage from './sourceStage.module.css'
import { WeekStrip } from './WeekStrip.tsx'

const WORKDAYS = [1, 2, 3, 4, 5]

/** 常用的几条规则。 */
export const SCHEDULE_PRESETS: readonly {
  id: string
  label: LocaleKey
  schedule: TriggerSchedule
}[] = [
  { id: 'hourly', label: 'trigger.preset.hourly', schedule: { kind: 'every', minutes: 60 } },
  { id: 'morning', label: 'trigger.preset.morning', schedule: { kind: 'daily', time: '09:00' } },
  {
    id: 'workdays',
    label: 'trigger.preset.workdays',
    schedule: { kind: 'daily', time: '09:00', weekdays: WORKDAYS },
  },
  {
    id: 'twice',
    label: 'trigger.preset.twice',
    schedule: { kind: 'daily', time: '09:00', moreTimes: ['18:00'], weekdays: WORKDAYS },
  },
  {
    id: 'monday',
    label: 'trigger.preset.monday',
    schedule: { kind: 'daily', time: '09:00', weekdays: [1] },
  },
  { id: 'nightly', label: 'trigger.preset.nightly', schedule: { kind: 'daily', time: '23:00' } },
]

/** 两条规则是不是同一条（键的先后不算）。 */
function sameSchedule(a: TriggerSchedule, b: TriggerSchedule): boolean {
  const key = (value: TriggerSchedule): string =>
    JSON.stringify(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)))
  return key(a) === key(b)
}

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
        <StageRow label={t('trigger.presets')} top>
          <div className={stage.line}>
            {SCHEDULE_PRESETS.map((preset) => {
              const on = sameSchedule(preset.schedule, schedule)
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={presets.chip}
                  aria-pressed={on}
                  data-testid={`wl-trigger-preset-${preset.id}`}
                  onClick={() => props.onChange(preset.schedule)}
                >
                  <span className={presets.check} aria-hidden="true">
                    <Icon name="check" size={11} />
                  </span>
                  {t(preset.label)}
                </button>
              )
            })}
          </div>
        </StageRow>
        <ScheduleField t={t} schedule={schedule} onChange={props.onChange} />
      </StageRows>
      <Bench
        icon="clock"
        title={t('trigger.week')}
        tools={
          <span className={benchAside}>
            {[
              valid ? t('trigger.week.total').replace('{n}', String(week.upcoming)) : '',
              t('trigger.upcoming.zone').replace('{zone}', zoneText(now)),
            ]
              .filter((part) => part !== '')
              .join(' · ')}
          </span>
        }
      >
        <WeekStrip t={t} week={week} valid={valid} />
      </Bench>
    </>
  )
}
