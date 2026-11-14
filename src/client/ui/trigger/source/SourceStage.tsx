/**
 * dsh-workflow-lite — 「触发方式」对话框的右边：顶上一句话（{@link SourceSummary}），下面是这种方式自己的设置。
 *
 * 一句话下面那一行写现在的情况：定时写下一次；别的写卡片现在的状态（开着、在不在跑）；草稿改过就说保存后生效
 * （现场是图里那条规则的，不是草稿的）。写得不对时换成原因、标红。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/trigger/source/SourceStage
 */

import { nextFire, scheduleIssue } from '../../../../shared/schedule.ts'
import { commandOf, sourceIssue } from '../../../../shared/trigger.ts'
import type { TriggerSource } from '../../../../shared/types.ts'
import type { TriggerView } from '../../../../shared/wire/trigger.ts'
import type { T } from '../../../i18n.ts'
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
import type { TriggerEnv } from '../triggerEnv.ts'
import { AfterStage } from './AfterStage.tsx'
import { HttpStage } from './HttpStage.tsx'
import { ListenStage } from './ListenStage.tsx'
import { PollStage } from './PollStage.tsx'
import { ScheduleStage } from './ScheduleStage.tsx'
import { SourceSummary } from './SourceSummary.tsx'
import css from './sourceStage.module.css'

/** 草稿写得不对的一句话；没问题是 `null`。 */
export function draftProblem(t: T, source: TriggerSource): string | null {
  if (source.kind === 'schedule') {
    const issue = scheduleIssue(source.schedule)
    return issue === null ? null : scheduleIssueText(t, issue)
  }
  const issue = sourceIssue(source)
  return issue === null ? null : sourceIssueText(t, issue)
}

export function SourceStage(props: {
  t: T
  node: string
  /** 草稿。 */
  source: TriggerSource
  /** 图里存着的。 */
  saved: TriggerSource
  /** 现场（草稿改过时不给）。 */
  view: TriggerView | undefined
  /** 草稿和图里的不一样。 */
  dirty: boolean
  env: TriggerEnv | null
  onChange(source: TriggerSource): void
}): React.JSX.Element {
  const { t, source, view, env } = props
  const problem = draftProblem(t, source)
  // 「每隔多久」从打开的那一刻起算：卡片开着时从宿主排的那一次往后数。
  const live =
    view !== undefined && (view.state === 'waiting' || view.state === 'elsewhere')
      ? view.next
      : undefined
  // 最近的输出是现在跑着的那条命令的：草稿换了方式、改了命令就不放。
  const showOutput =
    commandOf(source) !== undefined &&
    source.kind === props.saved.kind &&
    commandOf(source) === commandOf(props.saved)
  return (
    <div
      className={css.stage}
      style={{ '--wl-kind': triggerTint(source.kind) } as React.CSSProperties}
      data-testid="wl-trigger-when"
      data-kind={source.kind}
    >
      <SourceSummary t={t} source={source} problem={problem}>
        <Meta t={t} source={source} view={view} live={live} dirty={props.dirty} />
      </SourceSummary>
      {source.kind === 'schedule' && (
        <ScheduleStage
          t={t}
          schedule={source.schedule}
          live={live}
          onChange={(schedule) => props.onChange({ kind: 'schedule', schedule })}
        />
      )}
      {source.kind === 'poll' && (
        <PollStage
          t={t}
          node={props.node}
          source={source}
          env={env}
          showOutput={showOutput}
          onChange={props.onChange}
        />
      )}
      {source.kind === 'listen' && (
        <ListenStage
          t={t}
          node={props.node}
          source={source}
          env={env}
          showOutput={showOutput}
          onChange={props.onChange}
        />
      )}
      {source.kind === 'http' && <HttpStage t={t} node={props.node} env={env} />}
      {source.kind === 'after' && (
        <AfterStage t={t} source={source} env={env} onChange={props.onChange} />
      )}
    </div>
  )
}

/** 一句话下面的那一行。 */
function Meta(props: {
  t: T
  source: TriggerSource
  view: TriggerView | undefined
  live: number | undefined
  dirty: boolean
}): React.JSX.Element {
  const { t, source, view } = props
  const now = Date.now()
  const next =
    source.kind !== 'schedule'
      ? null
      : props.live !== undefined
        ? props.live
        : (nextFire(source.schedule, new Date(now))?.getTime() ?? null)
  return (
    <>
      {next !== null && (
        <span className={css.metaItem}>
          {t('trigger.next').replace('{time}', momentText(t, next, now))}
        </span>
      )}
      {view !== undefined && (
        <span
          className={cx(css.metaItem, tone.tone)}
          data-tone={stateTone(view.state, source.kind)}
        >
          <span className={tone.dot} />
          {stateText(t, view, source.kind, now, { next: false })}
        </span>
      )}
      {props.dirty && (
        <span className={cx(css.metaItem, css.mute)}>{t('trigger.say.saveFirst')}</span>
      )}
    </>
  )
}
