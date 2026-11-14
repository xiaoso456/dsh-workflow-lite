/**
 * dsh-workflow-lite — 定时「常用」一行：只列现在这种规则（每隔 / 每天 / Cron）的常用值，点一下整条换掉；
 * 现在的规则对不上其中任何一条时，行尾的「自定义」亮起来（它只是个标记，不是按钮——改法就在下面几行）。
 *
 * 三种规则的常用各一层叠在同一格（{@link FadeStack}）：换规则时整排交叉淡，下面的东西不动。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/SchedulePresets
 */

import type { TriggerSchedule } from '../../../../shared/types.ts'
import type { LocaleKey, T } from '../../../i18n.ts'
import { cx } from '../../kit/cx.ts'
import { FadeText } from '../../motion/marks.tsx'
import { FadeStack } from '../../motion/stage.tsx'
import presets from './presets.module.css'

type Kind = TriggerSchedule['kind']

const WORKDAYS = [1, 2, 3, 4, 5]

interface Preset {
  id: string
  label: LocaleKey
  schedule: TriggerSchedule
}

/** 各种规则的常用值（`id` 全局不重复，是测试锚点的一段）。 */
export const SCHEDULE_PRESETS: Readonly<Record<Kind, readonly Preset[]>> = {
  every: [
    { id: 'every-5', label: 'trigger.preset.every5', schedule: { kind: 'every', minutes: 5 } },
    { id: 'every-15', label: 'trigger.preset.every15', schedule: { kind: 'every', minutes: 15 } },
    { id: 'every-30', label: 'trigger.preset.every30', schedule: { kind: 'every', minutes: 30 } },
    { id: 'hourly', label: 'trigger.preset.hourly', schedule: { kind: 'every', minutes: 60 } },
    { id: 'every-6h', label: 'trigger.preset.every6h', schedule: { kind: 'every', minutes: 360 } },
  ],
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

const KINDS: readonly Kind[] = ['every', 'daily', 'cron']

/** 两条规则是不是同一条（键的先后不算）。 */
function sameSchedule(a: TriggerSchedule, b: TriggerSchedule): boolean {
  const key = (value: TriggerSchedule): string =>
    JSON.stringify(Object.entries(value).sort(([x], [y]) => x.localeCompare(y)))
  return key(a) === key(b)
}

export function SchedulePresets(props: {
  t: T
  schedule: TriggerSchedule
  onChange(schedule: TriggerSchedule): void
  className?: string
}): React.JSX.Element {
  const { t, schedule } = props
  return (
    <FadeStack
      at={schedule.kind}
      className={cx(presets.stack, props.className)}
      items={KINDS.map((kind) => {
        const list = SCHEDULE_PRESETS[kind]
        const current = schedule.kind === kind
        const custom = current && !list.some((preset) => sameSchedule(preset.schedule, schedule))
        return {
          key: kind,
          node: (
            <span className={presets.line}>
              {list.map((preset) => {
                const on = current && sameSchedule(preset.schedule, schedule)
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={presets.chip}
                    aria-pressed={on}
                    tabIndex={current ? undefined : -1}
                    data-testid={`wl-trigger-preset-${preset.id}`}
                    onClick={() => props.onChange(preset.schedule)}
                  >
                    <FadeText text={t(preset.label)} on={on} />
                  </button>
                )
              })}
              <span
                className={cx(presets.chip, presets.tag)}
                data-on={custom}
                data-testid={`wl-trigger-preset-custom-${kind}`}
              >
                <FadeText text={t('trigger.preset.custom')} on={custom} />
              </span>
            </span>
          ),
        }
      })}
    />
  )
}
