/**
 * dsh-workflow-lite — 定时规则下面不带标题的一排常用值：只列现在这种规则（间隔 / 时刻 / Cron）的，点一下直接改上面几行；
 * 和上面几行对上的那一颗亮起来，改了数、单位或时刻之后对不上的自然不亮（没有「自定义」）。
 *
 * 间隔的常用写成「1 分钟」「15 分钟」，和上面一行的「每隔」连着念；时刻的常用连星期一起换（星期一行的快捷只换星期）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/SchedulePresets
 */

import type { TriggerSchedule } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { spanText } from '../../../model/triggerText.ts'
import { cx } from '../../kit/cx.ts'
import { FadeText } from '../../motion/marks.tsx'
import row from '../trigger.module.css'
import presets from './presets.module.css'

type Kind = TriggerSchedule['kind']

const WORKDAYS = [1, 2, 3, 4, 5]

interface Preset {
  id: string
  /** 名字；间隔的不给，按秒数说（「15 分钟」）。 */
  label?: LocaleKey
  schedule: TriggerSchedule
}

/** 间隔的常用几档（秒）。 */
export const EVERY_PRESETS = [60, 900, 3600, 86_400] as const

/** 各种规则的常用值（`id` 全局不重复，是测试锚点的一段）。 */
export const SCHEDULE_PRESETS: Readonly<Record<Kind, readonly Preset[]>> = {
  every: EVERY_PRESETS.map((seconds) => ({
    id: `every-${String(seconds)}`,
    schedule: { kind: 'every', seconds },
  })),
  daily: [
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
  ],
  cron: [
    {
      id: 'cron-workdays',
      label: 'trigger.preset.workdays',
      schedule: { kind: 'cron', expression: '0 9 * * 1-5' },
    },
    {
      id: 'cron-work-hours',
      label: 'trigger.preset.workHours',
      schedule: { kind: 'cron', expression: '*/15 9-18 * * 1-5' },
    },
    {
      id: 'cron-monthly',
      label: 'trigger.preset.monthly',
      schedule: { kind: 'cron', expression: '0 9 1 * *' },
    },
  ],
}

/** 两条规则是不是同一条（键的先后不算）。 */
export function sameSchedule(a: TriggerSchedule, b: TriggerSchedule): boolean {
  const key = (value: TriggerSchedule): string =>
    JSON.stringify(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)))
  return key(a) === key(b)
}

function presetLabel(t: T, preset: Preset): string {
  if (preset.label !== undefined) return t(preset.label)
  return preset.schedule.kind === 'every' ? spanText(t, preset.schedule.seconds) : ''
}

export function SchedulePresets(props: {
  t: T
  schedule: TriggerSchedule
  onChange(schedule: TriggerSchedule): void
}): React.JSX.Element {
  const { t, schedule } = props
  return (
    <div className={row.row}>
      <span className={row.lead} aria-hidden="true" />
      <span className={cx(presets.line, presets.stack)} data-testid="wl-trigger-presets">
        {SCHEDULE_PRESETS[schedule.kind].map((preset) => {
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
              <FadeText text={presetLabel(t, preset)} on={on} />
            </button>
          )
        })}
      </span>
    </div>
  )
}
