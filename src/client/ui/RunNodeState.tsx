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
  SUMMARY_MAX,
} from '../../shared/runState.ts'
import type { Desktop } from '../app/desktop.ts'
import type { Run } from '../app/useRuns.ts'
import type { LocaleKey, T } from '../i18n.ts'
import { samePath, togglePin } from '../model/runDraft.ts'
import { shortTime } from '../model/time.ts'
import { RUN_TEXT } from './Canvas.tsx'
import { Icon, type IconName } from './Icon.tsx'
import { PickThumb } from './motion.tsx'
import { PreviewCard } from './PreviewCard.tsx'
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

/** 一排状态按钮里的一个。 */
export interface ChoiceOption<V extends string> {
  value: V
  text: string
  /** 用哪种状态色（`data-run-status`）。 */
  status: string
  /** 字前面的小图标 / 圆点：选中时弹一下。 */
  mark?: React.ReactNode
  tip?: string
  testId?: string
}

/**
 * 一排可换行的状态按钮（单选）：选中块从旧的一个滑到新的一个，颜色跟着状态色交叉淡过去
 * （见 motion.tsx 的 PickThumb）；字的颜色也是两层交叉淡（见 run.module.css 的 `.choiceText`），
 * 字重不变，换选中时这一排不会被挤动。
 */
export function Choices<V extends string>(props: {
  label: string
  value: V | null | undefined
  options: readonly ChoiceOption<V>[]
  onPick(value: V): void
}): React.JSX.Element {
  const { options } = props
  const picked = options.find((option) => option.value === props.value)
  const tones = [...new Set(options.map((option) => option.status))]
  return (
    <div className={run.choices} role="radiogroup" aria-label={props.label}>
      <PickThumb
        layout={`${props.value ?? ''}|${options.map((option) => option.value).join(',')}`}
        className={run.choiceThumb}
        tone={{
          list: tones,
          on: picked?.status,
          attr: 'data-run-status',
          className: run.choiceTone,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          className={run.choice}
          data-run-status={option.status}
          data-testid={option.testId}
          data-value={option.testId === undefined ? undefined : option.value}
          data-tip={option.tip}
          onClick={() => props.onPick(option.value)}
        >
          {option.mark !== undefined && (
            <span className={run.choiceMark} data-pick-pop="">
              {option.mark}
            </span>
          )}
          <span className={run.choiceText} data-text={option.text}>
            {option.text}
          </span>
        </button>
      ))}
    </div>
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
  /** 摘要、失败原因的弹窗：标题与图标块。 */
  name: string
  badge: React.ReactNode
  desktop: Desktop | undefined
}): React.JSX.Element {
  const { t, current, id, node } = props
  const summary = node.summary ?? ''
  const error = node.error ?? ''
  const pins = current.shown?.next ?? []
  const pinned = pins.includes(id)
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
        <Choices<NodeStatus>
          label={t('run.nodeStatus')}
          value={node.status}
          options={NODE_STATUSES.map((status) => ({
            value: status,
            text: t(RUN_TEXT[status]),
            status,
            mark: <Icon name={NODE_ICON[status]} size={12} />,
            tip: t(nodeHint(status)),
            testId: 'wl-run-node-status',
          }))}
          onPick={(status) => {
            if (status === 'done' && props.verdicts !== undefined && node.verdict === undefined) {
              current.setStatus(id, status)
              current.setField(path('verdict'), props.verdicts[0] ?? null)
              return
            }
            current.setStatus(id, status)
          }}
        />
        <div className={run.actions}>
          <button
            type="button"
            className={cx(ui.btn, ui.small, ui.soft)}
            aria-pressed={pinned}
            data-active={pinned}
            data-testid="wl-run-step-pin"
            data-tip={t('run.pinHint')}
            onClick={() => current.setField(['next'], togglePin(pins, id))}
          >
            <Icon name="flag" size={13} />
            {t(pinned ? 'run.unpin' : 'run.pin')}
          </button>
          {node.status !== 'pending' && (
            <button type="button" className={cx(ui.btn, ui.small, ui.soft)} onClick={props.onRerun}>
              <Icon name="reload" size={13} />
              {t('run.rerun')}
            </button>
          )}
        </div>
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
          <Choices
            label={t('run.verdict')}
            value={node.verdict}
            options={props.verdicts.map((verdict) => ({
              value: verdict,
              text: verdict,
              // 判定不分好坏：选中的用强调色，没选的灰。
              status: node.verdict === verdict ? 'running' : 'pending',
            }))}
            onPick={(verdict) =>
              current.setField(path('verdict'), node.verdict === verdict ? null : verdict)
            }
          />
        </section>
      )}

      <PreviewCard
        t={t}
        label={
          <>
            {t('run.summary')}
            <EditedDot on={isEdited(current.draft, path('summary'))} />
          </>
        }
        text={summary}
        name={props.name}
        badge={props.badge}
        meta={`${t('run.summary')} · ${[...summary].length} ${t('ins.chars')}`}
        copyLabel={t('run.copySummary')}
        desktop={props.desktop}
        testId="wl-run-summary"
        lines={3}
        edit={{
          placeholder: t('run.summaryPlaceholder'),
          maxLength: SUMMARY_MAX,
          testId: 'wl-run-summary-input',
          onChange: (value) => current.setField(path('summary'), value === '' ? null : value),
        }}
      />

      {(node.status === 'failed' || node.error !== undefined) && (
        <PreviewCard
          t={t}
          label={
            <>
              {t('run.error')}
              <EditedDot on={isEdited(current.draft, path('error'))} />
            </>
          }
          text={error}
          name={props.name}
          badge={props.badge}
          meta={`${t('run.error')} · ${[...error].length} ${t('ins.chars')}`}
          copyLabel={t('run.copyError')}
          desktop={props.desktop}
          testId="wl-run-error"
          lines={2}
          edit={{
            placeholder: t('run.errorPlaceholder'),
            testId: 'wl-run-error-input',
            onChange: (value) => current.setField(path('error'), value === '' ? null : value),
          }}
        />
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
