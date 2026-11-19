/**
 * dsh-workflow-lite — 一张触发卡片的触发记录：一条一行、每行一样高（结果色点、时刻、渠道、原因、结果），
 * 跳过 / 失败 / 不需要的原因写在同一行里、放不下就省略；点一行打开这次触发的详情（`dialogs/FireDialog`），
 * 建出了实例的行尾可以直接点过去看。
 *
 * 排着的（排队中）放在最上面：空心的点，原因那一格写背景信息的开头；详情里能取消。详情开着时那一次轮到了，
 * 详情跟着换成新读到的那一条。
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
  dayHead,
  FIRE_CHANNEL_TEXT,
  FIRE_KIND_TEXT,
  fireFallback,
  fireKind,
  fireWhy,
  groupByDay,
  queuePlace,
  settledFires,
} from '../../model/fireView.ts'
import { clockTime, pastTime } from '../../model/time.ts'
import { cx } from '../kit/cx.ts'
import { Icon } from '../kit/Icon.tsx'
import ui from '../kit/ui.module.css'
import ins from '../panel/panel.module.css'
import { FireDialog } from './dialogs/FireDialog.tsx'
import css from './fires.module.css'
import type { PrevRunView } from './triggerEnv.ts'

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
  /** 排着的在等的上次执行（详情里写）。 */
  waiting?: PrevRunView | undefined
  /** 取消排着的一次；取消不了回一句原因。 */
  onCancel?(fire: string): Promise<string | null>
  /** 把上次执行视为已结束；做不了回一句原因。 */
  onWaive?(): Promise<string | null>
}): React.JSX.Element | null {
  const { t, fires } = props
  const [picked, setPicked] = useState<FireRecord | null>(null)
  if (fires === null) return null
  if (fires.length === 0) {
    return <p className={ins.help}>{props.empty ?? t('trigger.historyEmpty')}</p>
  }
  const now = Date.now()
  // 排着的在最上面（新收到的在上），其余照旧。
  const queued = fires.filter((record) => record.outcome === 'queued')
  const settled = settledFires(fires)
  const live = picked === null ? null : (fires.find((record) => record.id === picked.id) ?? picked)
  const row = (record: FireRecord, when: string): React.JSX.Element => {
    const fallback = fireFallback(t, record)
    const why = fireWhy(record) ?? fallback ?? record.preview
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
          {why !== undefined && (
            <span className={css.fireWhy} data-warn={why === fallback || undefined}>
              {why}
            </span>
          )}
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
        {queued.map((record) => row(record, pastTime(t, record.at, now)))}
        {props.days === true
          ? groupByDay(settled).flatMap((group) => [
              <li key={`day-${group.day}`} className={css.day}>
                <span>{dayHead(t, group.day, now).name}</span>
                <span className={css.dayCount}>{group.fires.length}</span>
              </li>,
              ...group.fires.map((record) => row(record, clockTime(record.at))),
            ])
          : settled.map((record) => row(record, pastTime(t, record.at, now)))}
      </ul>
      {live !== null && (
        <FireDialog
          t={t}
          record={live}
          detail={props.detail}
          onOpenRun={props.onOpenRun}
          place={queuePlace(fires, live.id)}
          waiting={props.waiting}
          {...(props.onCancel === undefined ? {} : { onCancel: props.onCancel })}
          {...(props.onWaive === undefined ? {} : { onWaive: props.onWaive })}
          onClose={() => setPicked(null)}
        />
      )}
    </>
  )
}
