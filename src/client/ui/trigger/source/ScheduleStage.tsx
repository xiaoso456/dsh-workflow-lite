/**
 * dsh-workflow-lite — 「触发方式」对话框里定时的设置：一排常用规则（点一下整条换掉）、规则表单（`ScheduleField`）、
 * 接下来 7 天的时间轴。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/ScheduleStage
 */

import { scheduleIssue } from '../../../../shared/schedule.ts'
import type { TriggerSchedule } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { Icon } from '../../kit/Icon.tsx'
import { ScheduleField } from '../ScheduleField.tsx'
import presets from './presets.module.css'
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
  return (
    <>
      <section className={stage.section}>
        <p className={stage.head}>{t('trigger.presets')}</p>
        <div className={presets.row}>
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
      </section>
      <section className={stage.section}>
        <ScheduleField t={t} schedule={schedule} onChange={props.onChange} />
      </section>
      <WeekStrip
        t={t}
        schedule={schedule}
        valid={scheduleIssue(schedule) === null}
        live={props.live}
      />
    </>
  )
}
