/**
 * dsh-workflow-lite — 一张触发卡片的触发记录：一条一行、每行一样高（结果色点、时刻、渠道、原因、结果），
 * 跳过 / 失败 / 不需要的原因写在同一行里、放不下就省略；点一行打开这次触发的详情（`dialogs/FireDialog`），
 * 建出了实例的行尾可以直接点过去看。
 *
 * 列表自己一个框：最多露出 `rows` 行，再多在框里滚，不把外面撑长。
 *
 * `days` 时按天分组、每天一个小标题，行里只写钟点；不分组时今天的只写钟点、昨天写「昨天」、再早写月日。
 *
 * 画布上的面板（`TriggerStatus.tsx`）和工作流中心的「触发」页共用。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/FireList
 */

import { useState } from 'react'
import type { FireRecord, TriggerDetailResponse } from '../../../shared/wire/trigger.ts'
import type { T } from '../../i18n.ts'
import {
  dayText,
  FIRE_CHANNEL_TEXT,
  FIRE_KIND_TEXT,
  fireKind,
  fireWhen,
  fireWhy,
  groupByDay,
} from '../../model/fireView.ts'
import { clockTime } from '../../model/time.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import ins from '../panel/panel.module.css'
import { FireDialog } from './dialogs/FireDialog.tsx'
import css from './fires.module.css'

export function FireList(props: {
  t: T
  /** 还没读到是 `null`：先什么都不说，不把「还没读到」说成「没有记录」。 */
  fires: readonly FireRecord[] | null
  /** 一条都没有时说什么（缺省「还没有触发过」）。 */
  empty?: string
  /** 按天分组。 */
  days?: boolean
  /** 框里最多露出几行（再多在框里滚）。 */
  rows: number
  /** 读一次触发那一刻带的触发说明、背景信息（详情里用）。 */
  detail(fire: string): Promise<TriggerDetailResponse>
  onOpenRun(instance: string): void
}): React.JSX.Element | null {
  const { t, fires } = props
  const [picked, setPicked] = useState<FireRecord | null>(null)
  if (fires === null) return null
  if (fires.length === 0) {
    return <p className={ins.help}>{props.empty ?? t('trigger.historyEmpty')}</p>
  }
  const now = Date.now()
  const row = (record: FireRecord, when: string): React.JSX.Element => {
    const why = fireWhy(record)
    return (
      <li key={record.id} className={css.fire} data-outcome={fireKind(record)}>
        <button
          type="button"
          className={css.fireMain}
          aria-label={t('trigger.fireDetail')}
          data-testid="wl-trigger-fire"
          onClick={() => setPicked(record)}
        >
          <span className={css.dot} aria-hidden="true" />
          <span className={css.fireTime}>{when}</span>
          <span className={css.fireChannel}>{t(FIRE_CHANNEL_TEXT[record.channel])}</span>
          {why !== undefined && <span className={css.fireWhy}>{why}</span>}
          <span className={css.fireOutcome}>{t(FIRE_KIND_TEXT[fireKind(record)])}</span>
        </button>
        {record.instance !== undefined && (
          <button
            type="button"
            className={cx(ui.btn, ui.icon, ui.small, css.fireOpen)}
            aria-label={t('trigger.openRun')}
            data-tip={t('trigger.openRun')}
            data-testid="wl-trigger-open-run"
            onClick={() => props.onOpenRun(record.instance as string)}
          >
            <Icon name="arrowRight" size={13} />
          </button>
        )}
      </li>
    )
  }
  return (
    <>
      <ul className={css.fires} style={{ '--fire-rows': props.rows } as React.CSSProperties}>
        {props.days === true
          ? groupByDay(fires).flatMap((group) => [
              <li key={`day-${group.day}`} className={css.day}>
                <span>{dayText(t, group.day, now)}</span>
                <span className={css.dayCount}>{group.fires.length}</span>
              </li>,
              ...group.fires.map((record) => row(record, clockTime(record.at))),
            ])
          : fires.map((record) => row(record, fireWhen(t, record.at, now)))}
      </ul>
      {picked !== null && (
        <FireDialog
          t={t}
          record={picked}
          detail={props.detail}
          onOpenRun={props.onOpenRun}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  )
}
