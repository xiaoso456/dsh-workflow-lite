/**
 * dsh-workflow-lite — 「触发方式」对话框头部标题右边的一块：一句话说这张卡片什么时候执行（不加粗、不上色），
 * 下面一行小字写下一次（定时）或写得不对的原因；贴着 ✕ 一个小标记写现在怎样（等待中、接收中、有改动没保存）。
 *
 * 规则和现状分开放：改设置只换中间的字，状态变了只换右边的标记。一直挂着，只换字、换属性（不插拔元素）。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/SourceSummary
 */

import { nextFire, scheduleIssue } from '../../../../shared/schedule.ts'
import { sourceIssue } from '../../../../shared/trigger.ts'
import type { TriggerSource } from '../../../../shared/types.ts'
import type { TriggerView } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
import { sourceSay } from '../../../model/triggerSay.ts'
import {
  momentText,
  scheduleIssueText,
  sourceIssueText,
  stateText,
  stateTone,
} from '../../../model/triggerText.ts'
import { cx } from '../../kit/cx.ts'
import tone from '../stateTone.module.css'
import { triggerTint } from '../TriggerMark.tsx'
import css from './summary.module.css'

/** 草稿写得不对的一句话；没问题是 `null`。 */
export function draftProblem(t: T, source: TriggerSource): string | null {
  if (source.kind === 'schedule') {
    const issue = scheduleIssue(source.schedule)
    return issue === null ? null : scheduleIssueText(t, issue)
  }
  const issue = sourceIssue(source)
  return issue === null ? null : sourceIssueText(t, issue)
}

/** 卡片开着、排着队时宿主排好的下一次（「每隔多久」从这一次往后数）；别的时候 `undefined`。 */
export function armedNext(view: TriggerView | undefined): number | undefined {
  return view !== undefined && (view.state === 'waiting' || view.state === 'elsewhere')
    ? view.next
    : undefined
}

export function SourceSummary(props: {
  t: T
  /** 草稿。 */
  source: TriggerSource
  /** 现场（草稿改过时不给：现场是图里那条规则的）。 */
  view: TriggerView | undefined
  /** 草稿和图里的不一样。 */
  dirty: boolean
}): React.JSX.Element {
  const { t, source, view } = props
  const now = Date.now()
  const say = sourceSay(t, source)
  const problem = draftProblem(t, source)
  const next =
    source.kind !== 'schedule'
      ? null
      : (armedNext(view) ?? nextFire(source.schedule, new Date(now))?.getTime() ?? null)
  const sub =
    problem ?? (next === null ? '' : t('trigger.next').replace('{time}', momentText(t, next, now)))
  const state = props.dirty
    ? { tone: 'warn', text: t('trigger.say.saveFirst') }
    : view === undefined
      ? null
      : {
          tone: stateTone(view.state, source.kind),
          text: stateText(t, view, source.kind, now, { next: false }),
        }
  return (
    <div
      className={css.summary}
      style={{ '--wl-kind': triggerTint(source.kind) } as React.CSSProperties}
      data-testid="wl-trigger-summary"
    >
      <div className={css.lines}>
        <p className={css.say} data-tip={say} data-testid="wl-trigger-rule-title">
          {say}
        </p>
        <p className={css.sub} data-problem={problem !== null} data-testid="wl-trigger-preview">
          {sub}
        </p>
      </div>
      <span
        className={cx(css.state, tone.tone)}
        data-tone={state?.tone}
        data-shown={state !== null}
        data-testid="wl-trigger-summary-state"
      >
        <span className={tone.dot} />
        {state?.text ?? ''}
      </span>
    </div>
  )
}
