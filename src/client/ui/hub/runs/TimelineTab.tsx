/**
 * dsh-workflow-lite — 「运行实例」页的「时间线」：状态流水（谁、哪一步、什么事）和记到这个实例上的触发，从晚到早、一天一组，
 * 组头（哪天、日期、几条）滚动时钉在顶上；在自己的框里滚。
 *
 * - 流水一行和画布实例视图的时间线同一种（{@link RunEvent}），前面多一个按事件着色的圆点；点一行到「画布」页签看那一步。
 * - 触发一行：建出这个实例的那次「〈触发器〉触发，建了这个实例」，后来又发进来、模型接着这个实例做的「〈触发器〉又触发了一次，
 *   接着这个实例做」；点一下看那次触发的详情。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/runs/TimelineTab
 */

import { findNode } from '../../../../shared/model.ts'
import type { InstanceView } from '../../../../shared/runState.ts'
import type { FireRecord } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { dayHead } from '../../../model/fireView.ts'
import { nodeTitle } from '../../../model/nodeName.ts'
import { runTimeline } from '../../../model/runTimeline.ts'
import { clockTime } from '../../../model/time.ts'
import { Icon } from '../../kit/Icon.tsx'
import { EventList, EventRow, RunEvent } from '../../run/RunEvent.tsx'
import { FIRE_ICON } from '../../trigger/TriggerMark.tsx'
import css from './timelineTab.module.css'

export function TimelineTab(props: {
  t: T
  view: InstanceView
  fires: readonly FireRecord[]
  /** 到「画布」页签看这一步。 */
  onFocus(step: string): void
  onPickFire(record: FireRecord): void
}): React.JSX.Element {
  const { t, view } = props
  const days = runTimeline(view.state?.log ?? [], props.fires)
  const now = Date.now()
  const labelOf = (id: string): string => {
    const node = findNode(view.document, id)
    return node === undefined ? id : nodeTitle(node)
  }
  if (days.length === 0) {
    return (
      <p className={css.empty} data-testid="wl-hub-run-timeline">
        {t('run.noEvents')}
      </p>
    )
  }
  return (
    <div className={css.scroll} data-testid="wl-hub-run-timeline">
      {days.map((group) => {
        const head = dayHead(t, group.day, now)
        return (
          <section key={group.day}>
            <div className={css.head}>
              <span className={css.name}>{head.name}</span>
              <span className={css.date}>{head.date}</span>
              <span className={css.count}>
                {t('hub.runEvents').replace('{n}', String(group.items.length))}
              </span>
            </div>
            <EventList className={css.rows}>
              {group.items.map((item) =>
                item.kind === 'log' ? (
                  <RunEvent
                    key={item.key}
                    t={t}
                    entry={item.entry}
                    labelOf={labelOf}
                    dot
                    onSelect={(id) => {
                      if (id !== null) props.onFocus(id)
                    }}
                  />
                ) : (
                  <EventRow
                    key={item.key}
                    time={clockTime(item.at)}
                    mark={<Icon name={FIRE_ICON[item.fire.channel]} size={12} />}
                    testId="wl-hub-run-fire"
                    onClick={() => props.onPickFire(item.fire)}
                  >
                    {t(item.fire.joined === true ? 'hub.runFireJoined' : 'hub.runFireMade').replace(
                      '{name}',
                      item.fire.name,
                    )}
                  </EventRow>
                ),
              )}
            </EventList>
          </section>
        )
      })}
    </div>
  )
}
