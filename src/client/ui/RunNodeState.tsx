/**
 * dsh-workflow-lite — 实例视图里一个步骤的运行状态：状态、轮次、判定、摘要、失败原因（都能改，改动进草稿），
 * 以及谁做的、什么时候开始结束。
 *
 * @module @xiaoso/dsh-workflow-lite/client/ui/RunNodeState
 */

import {
  NODE_STATUSES,
  type NodeStatus,
  type RunState,
  type StateEdit,
} from '../../shared/runState.ts'
import type { Run } from '../app/useRuns.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { samePath } from '../model/runDraft.ts'
import { shortTime } from '../model/time.ts'
import { RUN_TEXT } from './Canvas.tsx'
import { Icon, type IconName } from './Icon.tsx'
import { cx } from './primitives.tsx'
import run from './run.module.css'
import ui from './ui.module.css'

/** 步骤状态的一句话说明（悬停提示）。 */
export function nodeHint(status: NodeStatus): LocaleKey {
  return status === 'skipped' ? 'run.hint.skipped' : (`run.nodeHint.${status}` as LocaleKey)
}

export const NODE_ICON: Record<NodeStatus, IconName> = {
  pending: 'clock',
  running: 'play',
  waiting: 'hourglass',
  done: 'check',
  failed: 'alert',
  skipped: 'skip',
}

export function isEdited(draft: readonly StateEdit[], path: readonly string[]): boolean {
  return draft.some((edit) => samePath(edit.path, path))
}

/** 改了还没保存的字段：标题旁一个小圆点。 */
export function EditedDot(props: { on: boolean }): React.JSX.Element | null {
  return props.on ? <span className={run.edited} aria-hidden="true" /> : null
}

/** 状态小标（只读）：用到它的步骤、上下游里每一行行尾的那个。 */
export function StatusChip(props: {
  t: T
  status: NodeStatus | undefined
}): React.JSX.Element | null {
  if (props.status === undefined) return null
  return (
    <span className={run.status} data-run-status={props.status}>
      <span className={run.dot} />
      {props.t(RUN_TEXT[props.status])}
    </span>
  )
}

/** 状态、轮次、判定、摘要、失败原因。 */
export function StepStatus(props: {
  t: T
  current: Run
  id: string
  node: RunState['nodes'][string]
  verdicts: readonly string[] | undefined
  onRerun(): void
}): React.JSX.Element {
  const { t, current, id, node } = props
  const path = (field: string): string[] => ['nodes', id, field]
  const round = node.round ?? 0
  return (
    <>
      <section className={run.section}>
        <p className={run.sectionTitle}>
          <span>
            {t('run.nodeStatus')}
            <EditedDot on={isEdited(current.draft, path('status'))} />
          </span>
        </p>
        <div className={run.choices} role="radiogroup" aria-label={t('run.nodeStatus')}>
          {NODE_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              role="radio"
              aria-checked={node.status === status}
              className={run.choice}
              data-run-status={status}
              data-testid="wl-run-node-status"
              data-value={status}
              title={t(nodeHint(status))}
              onClick={() => {
                if (
                  status === 'done' &&
                  props.verdicts !== undefined &&
                  node.verdict === undefined
                ) {
                  current.setStatus(id, status)
                  current.setField(path('verdict'), props.verdicts[0] ?? null)
                  return
                }
                current.setStatus(id, status)
              }}
            >
              <Icon name={NODE_ICON[status]} size={12} />
              {t(RUN_TEXT[status])}
            </button>
          ))}
        </div>
        {node.status !== 'pending' && (
          <button type="button" className={cx(ui.btn, ui.small, ui.soft)} onClick={props.onRerun}>
            <Icon name="reload" size={13} />
            {t('run.rerun')}
          </button>
        )}
      </section>

      <section className={run.section}>
        <p className={run.sectionTitle}>
          <span>
            {t('run.roundLabel')}
            <EditedDot on={isEdited(current.draft, path('round'))} />
          </span>
          <span className={run.stepper}>
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('run.roundDown')}
              disabled={round <= 1}
              onClick={() => current.setField(path('round'), round - 1)}
            >
              <Icon name="minus" size={13} />
            </button>
            <span className={run.stepperValue}>{round === 0 ? '—' : round}</span>
            <button
              type="button"
              className={cx(ui.btn, ui.icon, ui.small)}
              aria-label={t('run.roundUp')}
              onClick={() => current.setField(path('round'), round + 1)}
            >
              <Icon name="plus" size={13} />
            </button>
          </span>
        </p>
      </section>

      {props.verdicts !== undefined && (
        <section className={run.section}>
          <p className={run.sectionTitle}>
            <span>
              {t('run.verdict')}
              <EditedDot on={isEdited(current.draft, path('verdict'))} />
            </span>
          </p>
          <div className={run.choices} role="radiogroup" aria-label={t('run.verdict')}>
            {props.verdicts.map((verdict) => (
              <button
                key={verdict}
                type="button"
                role="radio"
                aria-checked={node.verdict === verdict}
                className={run.choice}
                data-run-status={node.verdict === verdict ? 'running' : 'pending'}
                onClick={() =>
                  current.setField(path('verdict'), node.verdict === verdict ? null : verdict)
                }
              >
                {verdict}
              </button>
            ))}
          </div>
        </section>
      )}

      <section className={run.section}>
        <p className={run.sectionTitle}>
          <span>
            {t('run.summary')}
            <EditedDot on={isEdited(current.draft, path('summary'))} />
          </span>
        </p>
        <textarea
          className={cx(ui.textarea, run.autoArea)}
          rows={3}
          value={node.summary ?? ''}
          placeholder={t('run.summaryPlaceholder')}
          data-testid="wl-run-summary"
          onChange={(event) =>
            current.setField(
              path('summary'),
              event.currentTarget.value === '' ? null : event.currentTarget.value,
            )
          }
        />
      </section>

      {(node.status === 'failed' || node.error !== undefined) && (
        <section className={run.section}>
          <p className={run.sectionTitle}>
            <span>
              {t('run.error')}
              <EditedDot on={isEdited(current.draft, path('error'))} />
            </span>
          </p>
          <textarea
            className={ui.textarea}
            rows={2}
            value={node.error ?? ''}
            onChange={(event) =>
              current.setField(
                path('error'),
                event.currentTarget.value === '' ? null : event.currentTarget.value,
              )
            }
          />
        </section>
      )}
    </>
  )
}

/** 谁做的、什么时候开始、什么时候结束；都没有就不画。 */
export function StepFacts(props: {
  t: T
  node: RunState['nodes'][string] | undefined
}): React.JSX.Element | null {
  const { t, node } = props
  if (
    node === undefined ||
    (node.by === undefined && node.startedAt === undefined && node.finishedAt === undefined)
  ) {
    return null
  }
  return (
    <section className={run.section}>
      <dl className={run.facts}>
        {node.by !== undefined && (
          <>
            <dt>{t('run.by')}</dt>
            <dd>{node.by}</dd>
          </>
        )}
        {node.startedAt !== undefined && (
          <>
            <dt>{t('run.startedAt')}</dt>
            <dd>{shortTime(node.startedAt)}</dd>
          </>
        )}
        {node.finishedAt !== undefined && (
          <>
            <dt>{t('run.finishedAt')}</dt>
            <dd>{shortTime(node.finishedAt)}</dd>
          </>
        )}
      </dl>
    </section>
  )
}
