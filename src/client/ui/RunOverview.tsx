/**
 * dsh-workflow-lite — 实例视图右栏什么都没选时的概览：总状态与进度、执行位置、说明、基本信息、时间线；
 * 不记运行状态的实例只讲清楚为什么看不到进度。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunOverview
 */

import { isStep } from '../../shared/model.ts'
import type { RunCursor } from '../../shared/runCursor.ts'
import {
  type InstanceSummary,
  progressOf,
  RUN_STATUSES,
  type RunLogEntry,
  type RunState,
} from '../../shared/runState.ts'
import type { WorkflowDocument } from '../../shared/types.ts'
import type { Run } from '../app/useRuns.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { shortTime } from '../model/time.ts'
import css from './inspector.module.css'
import { cx } from './primitives.tsx'
import { EditedDot, isEdited } from './RunNodeState.tsx'
import { RunPosition } from './RunPosition.tsx'
import { RUN_STATUS_TEXT } from './RunTopBar.tsx'
import run from './run.module.css'
import ui from './ui.module.css'

/** 不记运行状态的实例：右栏只讲清楚为什么看不到进度，再列几样基本信息。 */
export function Untracked(props: {
  t: T
  summary: InstanceSummary
  snapshot: WorkflowDocument
}): React.JSX.Element {
  const { t, summary } = props
  return (
    <>
      <p className={css.help} data-testid="wl-run-untracked">
        {t('run.untrackedBanner')}
      </p>
      <section className={run.section}>
        <dl className={run.facts}>
          <dt>{t('run.mode')}</dt>
          <dd>{t(`settings.mode.${summary.mode}` as LocaleKey)}</dd>
          <dt>{t('run.started')}</dt>
          <dd>{shortTime(summary.createdAt)}</dd>
          <dt>{t('run.steps')}</dt>
          <dd>{props.snapshot.nodes.filter(isStep).length}</dd>
        </dl>
      </section>
    </>
  )
}

export function Overview(props: {
  t: T
  current: Run
  snapshot: WorkflowDocument
  state: RunState
  cursor: RunCursor | null
  summary: InstanceSummary | undefined
  labelOf(id: string): string
  onSelect(id: string | null): void
}): React.JSX.Element {
  const { t, current, state, summary } = props
  const progress = progressOf(state)
  const log = [...state.log].reverse()
  return (
    <>
      <section className={run.section}>
        <p className={run.sectionTitle}>
          <span>
            {t('run.overall')}
            <EditedDot on={isEdited(current.draft, ['status'])} />
          </span>
          <span className={run.progress}>
            {progress.done}/{progress.total}
          </span>
        </p>
        <div className={run.bar} aria-hidden="true">
          <div
            className={run.barFill}
            style={{
              transform: `scaleX(${progress.total === 0 ? 0 : progress.done / progress.total})`,
            }}
          />
        </div>
        <div className={run.choices} role="radiogroup" aria-label={t('run.overall')}>
          {RUN_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={state.status === status}
              className={run.choice}
              data-run-status={status}
              data-testid="wl-run-overall"
              data-value={status}
              title={t(`run.hint.${status}` as LocaleKey)}
              onClick={() => current.setField(['status'], status)}
            >
              <span className={run.dot} />
              {t(RUN_STATUS_TEXT[status])}
            </button>
          ))}
        </div>
      </section>

      {props.cursor !== null && (
        <RunPosition
          t={t}
          snapshot={props.snapshot}
          state={state}
          cursor={props.cursor}
          pinEdited={isEdited(current.draft, ['next'])}
          onPin={(ids) => current.setField(['next'], ids)}
          onSelect={props.onSelect}
        />
      )}

      <section className={run.section}>
        <p className={run.sectionTitle}>
          <span>
            {t('run.note')}
            <EditedDot on={isEdited(current.draft, ['note'])} />
          </span>
        </p>
        <textarea
          className={cx(ui.textarea, run.autoArea)}
          rows={2}
          value={state.note ?? ''}
          placeholder={t('run.notePlaceholder')}
          data-testid="wl-run-note"
          onChange={(event) =>
            current.setField(
              ['note'],
              event.currentTarget.value === '' ? null : event.currentTarget.value,
            )
          }
        />
      </section>

      <section className={run.section}>
        <dl className={run.facts}>
          {summary?.goal !== undefined && (
            <>
              <dt>{t('run.goal')}</dt>
              <dd>{summary.goal}</dd>
            </>
          )}
          <dt>{t('run.mode')}</dt>
          <dd>{t(`settings.mode.${state.mode}` as LocaleKey)}</dd>
          <dt>{t('run.started')}</dt>
          <dd>{shortTime(summary?.createdAt)}</dd>
          <dt>{t('run.updated')}</dt>
          <dd>{shortTime(state.updatedAt)}</dd>
          {summary?.statePath !== undefined && (
            <>
              <dt>{t('run.stateFile')}</dt>
              <dd className={run.path}>
                <code>{summary.statePath}</code>
              </dd>
            </>
          )}
        </dl>
      </section>

      <section className={cx(run.section, run.timelineSection)}>
        <p className={run.sectionTitle}>
          <span>{t('run.timeline')}</span>
          {log.length > 0 && <span className={run.progress}>{log.length}</span>}
        </p>
        {log.length === 0 ? (
          <p className={css.help}>{t('run.noEvents')}</p>
        ) : (
          <ul className={cx(run.timeline, run.timelineScroll)} data-testid="wl-run-timeline">
            {log.map((entry, index) => (
              <TimelineItem
                // biome-ignore lint/suspicious/noArrayIndexKey: 流水只追加，倒序后的下标就是稳定身份
                key={`${entry.at}-${index}`}
                t={t}
                entry={entry}
                labelOf={props.labelOf}
                onSelect={props.onSelect}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

const EVENT_TEXT: Record<RunLogEntry['event'], LocaleKey> = {
  start: 'run.event.start',
  done: 'run.event.done',
  failed: 'run.event.failed',
  waiting: 'run.event.waiting',
  skipped: 'run.event.skipped',
  resume: 'run.event.resume',
  transfer: 'run.event.transfer',
  edit: 'run.event.edit',
  next: 'run.event.next',
  note: 'run.event.note',
}

function TimelineItem(props: {
  t: T
  entry: RunLogEntry
  labelOf(id: string): string
  onSelect(id: string | null): void
}): React.JSX.Element {
  const { t, entry } = props
  const time = new Date(entry.at)
  const clock = Number.isNaN(time.getTime())
    ? entry.at
    : `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: 时间线行的键盘入口是右栏里的状态控件；点一下只是顺手定位
    <li className={run.event} onClick={() => props.onSelect(entry.node ?? null)}>
      <span className={run.eventTime}>{clock}</span>
      <span className={run.eventText}>
        {entry.by === 'user' && <span className={run.eventUser}>{t('run.byUser')} </span>}
        {entry.node !== undefined && <b>{props.labelOf(entry.node)} </b>}
        {t(EVENT_TEXT[entry.event])}
        {entry.round !== undefined &&
          entry.round > 1 &&
          ` · ${t('run.round').replace('{n}', String(entry.round))}`}
        {entry.verdict !== undefined && ` · ${entry.verdict}`}
        {entry.detail !== undefined && ` — ${entry.detail}`}
      </span>
    </li>
  )
}
