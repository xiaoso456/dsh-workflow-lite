/**
 * dsh-workflow-lite — 「触发」页时间线上的一行：一次触发（{@link FireRow}，概览的「最近」也用）、接下来的一次（{@link PlanRow}）、
 * 时间轴上的「现在」（{@link NowRow}）。
 *
 * 同一份元素两种排法，由外面的 `data-layout` 定（见 fireRow.module.css）：清单一行横排（时刻、结果、说明、方式图标）；
 * 时间轴两行，左边一根连续的线、结果色的点，上面结果 + 方式、下面说明。换样子只换属性，不重建行。
 *
 * 点一行看这次触发的详情；悬停或键盘选中时露出「实例 →」（直接打开那次执行）和箭头。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/hub/triggers/FireRow
 */

import type { FireRecord } from '../../../../shared/wire/trigger.ts'
import { useNow } from '../../../app/useNow.ts'
import type { T } from '../../../i18n.ts'
import { FIRE_CHANNEL_TEXT, FIRE_KIND_SHORT, fireKind, fireWhy } from '../../../model/fireView.ts'
import { clockTime } from '../../../model/time.ts'
import { cx } from '../../kit/cx.ts'
import { Icon, type IconName } from '../../kit/Icon.tsx'
import tone from '../../trigger/stateTone.module.css'
import { TRIGGER_ICON } from '../../trigger/TriggerMark.tsx'
import css from './fireRow.module.css'

/** 每种渠道的图标：五种触发源用各自的，「立即触发一次」是闪电。 */
const CHANNEL_ICON: Record<FireRecord['channel'], IconName> = { ...TRIGGER_ICON, now: 'bolt' }

/** 方式：图标 + 名字（清单里名字收起来，悬停看）。 */
function How(props: { icon: IconName; text: string }): React.JSX.Element {
  return (
    <span className={css.how} data-tip={props.text}>
      <Icon name={props.icon} size={13} />
      <span className={css.howText}>{props.text}</span>
    </span>
  )
}

export function FireRow(props: {
  t: T
  record: FireRecord
  /** 时刻怎么写（按天分组时只写钟点）。 */
  when: string
  /** 会话的标题（发出去了的写「发进会话「…」」）；不知道的不给。 */
  sessionTitle?: (id: string) => string | undefined
  onPick(record: FireRecord): void
  onOpenRun(instance: string): void
}): React.JSX.Element {
  const { t, record } = props
  const kind = fireKind(record)
  const channel = t(FIRE_CHANNEL_TEXT[record.channel])
  const title = record.session === undefined ? undefined : props.sessionTitle?.(record.session)
  const what =
    fireWhy(record) ??
    (title === undefined ? t('hub.trgSentAny') : t('hub.trgSentTo').replace('{name}', title))
  const run = record.instance
  return (
    <li className={css.row} data-outcome={kind} data-pick data-run={run !== undefined || undefined}>
      <button
        type="button"
        className={css.main}
        aria-label={`${t('trigger.fireDetail')} ${props.when}`}
        data-testid="wl-trigger-fire"
        onClick={() => props.onPick(record)}
      >
        <time className={css.time}>{props.when}</time>
        <span className={css.dot} aria-hidden="true" />
        <span className={css.state}>{t(FIRE_KIND_SHORT[kind])}</span>
        <How icon={CHANNEL_ICON[record.channel]} text={channel} />
        <span className={css.what}>{what}</span>
        <span className={css.chev} aria-hidden="true">
          <Icon name="chevronRight" size={12} />
        </span>
      </button>
      {run !== undefined && (
        <button
          type="button"
          className={css.run}
          data-tip={t('trigger.openRun')}
          data-testid="wl-trigger-open-run"
          onClick={() => props.onOpenRun(run)}
        >
          {t('hub.trgRun')}
          <Icon name="arrowRight" size={11} />
        </button>
      )}
    </li>
  )
}

/**
 * 接下来的一次：清单里写「计划」和「明天 11月16日 · 17 小时后」，时间轴里上面写哪天、下面写还有多久。
 * 被动的（等外面来事）没有时刻，只写在等什么。
 */
export function PlanRow(props: {
  t: T
  /** 时刻；被动的没有。 */
  at?: number
  title: string
  /** 还有多久。 */
  after?: string
  icon: IconName
  how: string
}): React.JSX.Element {
  const { t } = props
  const listText = props.after === undefined ? props.title : `${props.title} · ${props.after}`
  return (
    <li className={css.row} data-outcome="plan" data-testid="wl-hub-trg-plan">
      <div className={css.main}>
        <time className={css.time}>{props.at === undefined ? '' : clockTime(props.at)}</time>
        <span className={css.dot} aria-hidden="true" />
        <span className={cx(css.state, css.listOnly)}>
          {props.at === undefined ? '' : t('hub.trgPlan')}
        </span>
        <span className={cx(css.state, css.railOnly)}>{props.title}</span>
        <How icon={props.icon} text={props.how} />
        <span className={cx(css.what, css.listOnly)}>{listText}</span>
        <span className={cx(css.what, css.railOnly)}>{props.after ?? ''}</span>
      </div>
    </li>
  )
}

/** 时间轴上的「现在」：状态色的点，写现在的状态和下一次（清单里不显示，头部状态条已经有了）。 */
export function NowRow(props: {
  t: T
  /** 状态的颜色分组（`stateTone`）。 */
  tone: string
  /** 「等待中 · 下一次 明天 02:30」。 */
  note: string
}): React.JSX.Element {
  // 钟点自己走，一分钟换一次就够。
  const now = useNow(30_000)
  return (
    <li
      className={cx(css.row, tone.tone)}
      data-outcome="now"
      data-tone={props.tone}
      data-testid="wl-hub-trg-now"
    >
      <div className={css.main}>
        <time className={css.time}>{clockTime(now)}</time>
        <span className={css.dot} aria-hidden="true" />
        <span className={css.state}>{props.t('hub.trgNow')}</span>
        <span className={css.nowNote}>{props.note}</span>
      </div>
    </li>
  )
}
